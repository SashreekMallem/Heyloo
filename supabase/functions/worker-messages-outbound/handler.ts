import type { ResendFetch } from "../_shared/providers/resend.ts";
import { sendEmail } from "../_shared/providers/resend.ts";
import type { TwilioFetch } from "../_shared/providers/twilio.ts";
import { sendSms } from "../_shared/providers/twilio.ts";
import type { MessagesOutboundQueueMsg } from "../_shared/queue.ts";
import { deleteMessage, moveToDeadLetter, QUEUE_NAMES, readBatch } from "../_shared/queue.ts";
import { renderTemplate } from "../_shared/templates.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `messages_outbound_queue` worker (BACKEND_SPEC §9/§10.1/§10.2, MASTER_SPEC
 * §3.3 "the `messages_outbound` worker checks `sms_opt_out` before every
 * send"). Channel dispatch covers `sms` (Twilio, with the A2P-pending ->
 * email-fallback state per BACKEND_SPEC §10.1) and `email` (Resend) fully;
 * `push`/`airtable` are Wave-2/T7 scope (browser-push subscriptions and the
 * Airtable adapter aren't built yet) — routed to an explicit `failed` status
 * with a clear error rather than silently dropped, matching the "never
 * silently failing" principle the spec states for A2P specifically.
 *
 * H1 fix: a PROVIDER send failure (Twilio/Resend actually rejected the
 * message) must THROW so `index.ts`'s catch engages pgmq's own
 * visibility-timeout retry and, after `MAX_ATTEMPTS`, `moveToDeadLetter` —
 * BACKEND_SPEC §9's "after 5 attempts, row status -> failed, moved to
 * messages_outbound_dlq" contract. Never true before this fix: every
 * provider response (2xx or not) was written straight to `status='failed'`
 * and swallowed, so a transient Twilio 5xx/Resend outage permanently
 * dropped the message on its FIRST attempt with no retry and no DLQ entry.
 * A genuinely PERMANENT provider rejection (opt-out, an invalid/undeliverable
 * recipient number/address) still resolves immediately to `status='failed'`
 * without throwing — retrying an unfixable rejection 5 times before
 * dead-lettering it wastes queue cycles and delays the DLQ signal for no
 * benefit. Pre-flight validation failures this worker detects itself before
 * ever contacting a provider (`no_sending_number`, `no_recipient_email`, an
 * unimplemented channel) are a separate case again — no provider was called
 * at all, so there is nothing to retry; those keep the original immediate-
 * fail behavior unconditionally.
 *
 * VERIFY (docs/VERIFY.md): the permanent-vs-transient Twilio/Resend error
 * classifiers below are training-knowledge-confident, stable, long-
 * documented error taxonomies (Twilio's numeric `code` on a message-create
 * rejection; Resend's `name` on a 4xx `/emails` error) — `twilio.com`/
 * `resend.com` doc fetches were egress-blocked in this build (matching this
 * file's siblings' existing VERIFY notes), so confirm both code/name lists
 * against a live sandbox call before relying on the permanent branch to
 * classify every real rejection correctly; misclassifying a genuinely
 * transient failure as permanent only means "retried 0 times instead of 5"
 * (fails closed toward the old behavior, never worse), and misclassifying a
 * permanent one as transient only costs wasted retries before the same DLQ
 * outcome — neither direction silently drops a message.
 */

const PERMANENT_TWILIO_ERROR_CODES = new Set([
  21211, // Invalid 'To' Phone Number
  21614, // 'To' number is not a valid, SMS-capable mobile number
  21408, // Permission to send to this region has not been enabled
  21610, // Recipient has replied STOP (opt-out desync defense-in-depth)
]);

function isPermanentTwilioFailure(body: unknown): boolean {
  const code = (body as { code?: unknown } | undefined)?.code;
  return typeof code === "number" && PERMANENT_TWILIO_ERROR_CODES.has(code);
}

const PERMANENT_RESEND_ERROR_NAMES = new Set([
  "validation_error",
  "invalid_to_address",
  "invalid_from_address",
  "missing_required_field",
]);

function isPermanentResendFailure(error: unknown): boolean {
  const name = (error as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && PERMANENT_RESEND_ERROR_NAMES.has(name);
}
export interface OutboundDeps {
  twilioFetch: TwilioFetch;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: (tenantId: string) => Promise<string | null>;
  resendFetch: ResendFetch;
  resendApiKey: string;
  resendFromAddress: string;
  fallbackTenantEmail: (tenantId: string) => Promise<string | null>;
  logger: Logger;
}

interface MessageRow {
  id: string;
  tenant_id: string;
  channel: string;
  recipient: string;
  template_key: string;
  payload: Record<string, unknown>;
  status: string;
  related_booking_id: string | null;
  related_order_id: string | null;
}

export type ProcessOutcome =
  | "sent"
  | "skipped_terminal"
  | "skipped_opt_out"
  | "rerouted_email"
  | "failed";

export async function processOutboundMessage(
  sql: SqlClient,
  messageId: string,
  deps: OutboundDeps,
): Promise<ProcessOutcome> {
  const rows = await sql<MessageRow>`
    select id, tenant_id, channel, recipient, template_key, payload, status, related_booking_id, related_order_id
    from public.messages_outbound where id = ${messageId}
  `;
  const message = rows[0];
  if (!message || message.status === "sent" || message.status === "delivered") {
    return "skipped_terminal";
  }

  let channel = message.channel;

  if (channel === "sms") {
    const optOutRows = await sql<{ sms_opt_out: boolean }>`
      select sms_opt_out from public.customers where tenant_id = ${message.tenant_id} and phone_e164 = ${message.recipient} limit 1
    `;
    if (optOutRows[0]?.sms_opt_out) {
      await sql`update public.messages_outbound set status = 'failed', error = 'sms_opt_out' where id = ${message.id}`;
      return "skipped_opt_out";
    }

    const tenantRows = await sql<{ a2p_status: string | null }>`
      select a2p_status from public.tenants where id = ${message.tenant_id}
    `;
    if ((tenantRows[0]?.a2p_status ?? "verified") !== "verified") {
      channel = "email"; // A2P-pending fallback (BACKEND_SPEC §10.1) — never silently drop.
    }
  }

  const rendered = renderTemplate(message.template_key, message.payload);

  if (channel === "sms") {
    const fromNumber = await deps.twilioFromNumber(message.tenant_id);
    if (!fromNumber) {
      await sql`update public.messages_outbound set status = 'failed', error = 'no_sending_number' where id = ${message.id}`;
      return "failed";
    }
    const result = await sendSms(deps.twilioFetch, deps.twilioAccountSid, deps.twilioAuthToken, {
      to: message.recipient,
      from: fromNumber,
      body: rendered.body,
    });
    const body = result.body as { sid?: string };
    if (!result.ok || !body.sid) {
      if (isPermanentTwilioFailure(result.body)) {
        await sql`update public.messages_outbound set status = 'failed', error = ${JSON.stringify(result.body)} where id = ${message.id}`;
        return "failed";
      }
      deps.logger.warn("worker_messages_outbound_transient_twilio_failure", {
        message_id: message.id,
        status: result.status,
      });
      throw new Error(`twilio_send_transient_failure:${result.status}`);
    }
    await sql`
      update public.messages_outbound
      set status = 'sent', provider_message_id = ${body.sid}, sent_at = now()
      where id = ${message.id}
    `;
    return "sent";
  }

  if (channel === "email") {
    const toEmail = await deps.fallbackTenantEmail(message.tenant_id);
    if (!toEmail) {
      await sql`update public.messages_outbound set status = 'failed', error = 'no_recipient_email' where id = ${message.id}`;
      return "failed";
    }
    const result = await sendEmail(deps.resendFetch, deps.resendApiKey, {
      from: deps.resendFromAddress,
      to: toEmail,
      subject: rendered.subject ?? "Update from your Heyloo assistant",
      html: `<p>${rendered.body}</p>`,
    });
    if (!result.ok) {
      if (isPermanentResendFailure(result.error)) {
        await sql`update public.messages_outbound set status = 'failed', error = ${JSON.stringify(result.error)} where id = ${message.id}`;
        return "failed";
      }
      deps.logger.warn("worker_messages_outbound_transient_resend_failure", {
        message_id: message.id,
        status: result.status,
      });
      throw new Error(`resend_send_transient_failure:${result.status}`);
    }
    await sql`
      update public.messages_outbound
      set status = 'sent', provider_message_id = ${result.id ?? null}, sent_at = now()
      where id = ${message.id}
    `;
    return message.channel === "sms" ? "rerouted_email" : "sent";
  }

  // push / airtable — not yet wired (Wave-2/T7).
  deps.logger.warn("messages_outbound_channel_not_implemented", {
    channel,
    message_id: message.id,
  });
  await sql`update public.messages_outbound set status = 'failed', error = 'channel_not_implemented' where id = ${message.id}`;
  return "failed";
}

// ---------------------------------------------------------------------------
// Batch-poll entry point (OPS-3, docs/BUILD_NOTES.md) — the read-batch/
// retry/dead-letter loop that used to live only in `index.ts`'s Deno
// `Deno.serve` handler, moved here so it's reusable from BOTH this
// function's own `index.ts` (unchanged manual-invoke endpoint) and
// `worker-tick/handler.ts` (the combined-dispatch entry). Portable/
// unit-tested exactly like the rest of this file — no `Deno` global, only
// `SqlClient`/`OutboundDeps`/queue.ts helpers.
// ---------------------------------------------------------------------------

export const OUTBOUND_VISIBILITY_TIMEOUT_SECONDS = 30;
export const OUTBOUND_BATCH_SIZE = 20;
export const OUTBOUND_MAX_ATTEMPTS = 5; // BACKEND_SPEC §9 — pgmq's own read_ct is the attempt counter for this queue.

export interface RunOutboundWorkerResult {
  processed: number;
  dead_lettered: number;
  batch_size: number;
}

export async function runOutboundWorker(
  sql: SqlClient,
  deps: OutboundDeps,
): Promise<RunOutboundWorkerResult> {
  const batch = await readBatch<MessagesOutboundQueueMsg>(
    sql,
    QUEUE_NAMES.messagesOutbound,
    OUTBOUND_VISIBILITY_TIMEOUT_SECONDS,
    OUTBOUND_BATCH_SIZE,
  );

  let processed = 0;
  let deadLettered = 0;
  for (const row of batch) {
    try {
      await processOutboundMessage(sql, row.message.message_id, deps);
      await deleteMessage(sql, QUEUE_NAMES.messagesOutbound, row.msg_id);
      processed += 1;
    } catch (err) {
      deps.logger.error("worker_messages_outbound_error", {
        error: String(err),
        msg_id: row.msg_id,
      });
      if (row.read_ct >= OUTBOUND_MAX_ATTEMPTS) {
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

  return { processed, dead_lettered: deadLettered, batch_size: batch.length };
}
