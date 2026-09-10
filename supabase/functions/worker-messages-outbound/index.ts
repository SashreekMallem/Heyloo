// Deno entrypoint (excluded from ../tsconfig.json). Invoked by the
// pg_cron "Queue worker poll" job (BACKEND_SPEC §8, every minute) via
// pg_net.http_post — verify_jwt false, auth is a shared cron secret header
// (this function is never meant to be internet-facing-useful; the secret
// just keeps it from being invoked by anything other than the cron job).

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import type { MessagesOutboundQueueMsg } from "../_shared/queue.ts";
import { deleteMessage, moveToDeadLetter, QUEUE_NAMES, readBatch } from "../_shared/queue.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { processOutboundMessage } from "./handler.ts";

const logger = createLogger({ fn: "worker-messages-outbound" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const TWILIO_ACCOUNT_SID = requireEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = requireEnv("TWILIO_AUTH_TOKEN");
const RESEND_API_KEY = requireEnv("RESEND_API_KEY");
const RESEND_FROM_ADDRESS = requireEnv("RESEND_FROM_ADDRESS");

const VISIBILITY_TIMEOUT_SECONDS = 30;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5; // BACKEND_SPEC §9 — pgmq's own read_ct is the attempt counter for this queue.

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const batch = await readBatch<MessagesOutboundQueueMsg>(
    sql,
    QUEUE_NAMES.messagesOutbound,
    VISIBILITY_TIMEOUT_SECONDS,
    BATCH_SIZE,
  );

  const deps = {
    twilioFetch: fetch,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    async twilioFromNumber(tenantId: string): Promise<string | null> {
      const rows = await sql<{ e164: string }>`
        select e164 from public.phone_numbers where tenant_id = ${tenantId} and released_at is null and is_primary limit 1
      `;
      return rows[0]?.e164 ?? null;
    },
    resendFetch: fetch,
    resendApiKey: RESEND_API_KEY,
    resendFromAddress: RESEND_FROM_ADDRESS,
    async fallbackTenantEmail(tenantId: string): Promise<string | null> {
      const rows = await sql<{ email: string }>`
        select u.email from public.memberships m
        join auth.users u on u.id = m.user_id
        where m.tenant_id = ${tenantId} and m.role = 'owner'
        limit 1
      `;
      return rows[0]?.email ?? null;
    },
    logger,
  };

  let processed = 0;
  let deadLettered = 0;
  for (const row of batch) {
    try {
      await processOutboundMessage(sql, row.message.message_id, deps);
      await deleteMessage(sql, QUEUE_NAMES.messagesOutbound, row.msg_id);
      processed += 1;
    } catch (err) {
      logger.error("worker_messages_outbound_error", { error: String(err), msg_id: row.msg_id });
      if (row.read_ct >= MAX_ATTEMPTS) {
        await moveToDeadLetter(sql, QUEUE_NAMES.messagesOutbound, row.msg_id, row.message);
        // BACKEND_SPEC §9: "after 5 attempts, row status -> failed, moved to
        // messages_outbound_dlq for manual admin review" — the DLQ move
        // above only removes the pgmq message; the domain row itself must
        // also flip to `failed` here, or an exhausted-retry message stays
        // `status='queued'` forever with no admin-visible signal at all.
        await sql`
          update public.messages_outbound
          set status = 'failed', error = ${String(err)}
          where id = ${row.message.message_id} and status not in ('sent', 'delivered')
        `;
        deadLettered += 1;
      }
      // else: leave in queue — becomes visible again after the visibility
      // timeout for the next poll to retry.
    }
  }

  return jsonResponse({ processed, dead_lettered: deadLettered, batch_size: batch.length });
});
