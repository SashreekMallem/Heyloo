import type { z } from "zod";
import { normalizeE164 } from "../../_shared/phone.ts";
import { enqueue, QUEUE_NAMES } from "../../_shared/queue.ts";
import type { SendSmsConfirmationArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof SendSmsConfirmationArgsSchema>;

export type SendSmsConfirmationResult =
  | { queued: true; message_id: string }
  | { queued: false; reason: "invalid_phone" };

/**
 * BACKEND_SPEC §7.2.7 — enqueue-only, the actual Twilio send happens in the
 * `messages_outbound_queue` worker (§9/§10), never inline, to keep this
 * tool call fast. `status` is set to `pending_verification` up front when
 * the tenant's A2P 10DLC campaign isn't yet vetted (G4) — VERIFY.md: this
 * assumes a `tenants.a2p_status` column per BACKEND_SPEC §10.1's own
 * `DECIDE:` recommendation; coordinate with T1 that it lands (see
 * supabase/functions/BUILD_NOTES.md).
 */
export async function sendSmsConfirmation(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<SendSmsConfirmationResult> {
  const phone = normalizeE164(args.phone);
  if (!phone) return { queued: false, reason: "invalid_phone" };

  // Idempotency soft-check: don't double-confirm on a Retell tool-call retry.
  if (args.booking_id) {
    const existing = await sql<{ id: string }>`
      select id from public.messages_outbound
      where tenant_id = ${ctx.tenantId} and related_booking_id = ${args.booking_id} and template_key = ${args.template_key}
      limit 1
    `;
    const prior = existing[0];
    if (prior) return { queued: true, message_id: prior.id };
  }

  const tenantRows = await sql<{ a2p_status: string | null }>`
    select a2p_status from public.tenants where id = ${ctx.tenantId}
  `;
  const a2pStatus = tenantRows[0]?.a2p_status ?? "verified";
  const status = a2pStatus === "verified" ? "queued" : "pending_verification";

  const inserted = await sql<{ id: string }>`
    insert into public.messages_outbound (
      tenant_id, channel, recipient, template_key, payload, status, related_booking_id, related_order_id
    ) values (
      ${ctx.tenantId}, 'sms', ${phone}, ${args.template_key}, '{}'::jsonb, ${status},
      ${args.booking_id ?? null}, ${args.order_id ?? null}
    )
    returning id
  `;
  const message = inserted[0];
  if (!message) return { queued: false, reason: "invalid_phone" };

  if (status === "queued") {
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
  }
  // pending_verification rows are picked up by the messages_outbound worker's
  // own sweep once the tenant's A2P status flips to verified, or routed to
  // the email fallback per MASTER_SPEC §3.3 — never left silently unsent.

  return { queued: true, message_id: message.id };
}
