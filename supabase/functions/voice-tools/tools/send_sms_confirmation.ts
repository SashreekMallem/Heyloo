import type { z } from "zod";
import { normalizeE164 } from "../../_shared/phone.ts";
import { enqueue, QUEUE_NAMES } from "../../_shared/queue.ts";
import type { SendSmsConfirmationArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof SendSmsConfirmationArgsSchema>;

export type SendSmsConfirmationResult =
  | { queued: true; message_id: string }
  | { queued: false; reason: "invalid_phone" | "booking_not_found" | "order_not_found" };

/**
 * BACKEND_SPEC §7.2.7 — enqueue-only, the actual send happens in the
 * `messages_outbound_queue` worker (§9/§10), never inline, to keep this
 * tool call fast. The row is always inserted `queued` and enqueued; the
 * worker decides SMS vs the email reroute (VOICE-ALERTS-1).
 */
export async function sendSmsConfirmation(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<SendSmsConfirmationResult> {
  const phone = normalizeE164(args.phone);
  if (!phone) return { queued: false, reason: "invalid_phone" };

  // EDGE_AUDIT M1: `args.booking_id`/`args.order_id` come straight from the
  // tool call — verify each actually belongs to the caller's OWN tenant
  // before it's used anywhere (the idempotency soft-check below, and the
  // `related_booking_id`/`related_order_id` write), same pattern as every
  // other write path in this directory (`cancel_booking`, `update_booking`,
  // `create_order`, `send_payment_link`).
  if (args.booking_id) {
    const bookingRows = await sql<{ id: string }>`
      select id from public.bookings where id = ${args.booking_id} and tenant_id = ${ctx.tenantId} limit 1
    `;
    if (!bookingRows[0]) return { queued: false, reason: "booking_not_found" };
  }
  if (args.order_id) {
    const orderRows = await sql<{ id: string }>`
      select id from public.orders where id = ${args.order_id} and tenant_id = ${ctx.tenantId} limit 1
    `;
    if (!orderRows[0]) return { queued: false, reason: "order_not_found" };
  }

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

  // VOICE-ALERTS-1: always `queued` + enqueued. This used to write
  // `pending_verification` (without enqueueing) whenever the tenant's A2P
  // campaign wasn't verified, so confirmations sat unsent forever (238 live
  // rows). The worker already decides at send time whether the sender is
  // usable (SMS) or the message is rerouted to the owner's email
  // (`resolveSmsRoute` -> `sender_not_verified`, BACKEND_SPEC §10.1). One
  // fewer round trip on this tool too (no `tenants.a2p_status` read).
  const inserted = await sql<{ id: string }>`
    insert into public.messages_outbound (
      tenant_id, channel, recipient, template_key, payload, status, related_booking_id, related_order_id
    ) values (
      ${ctx.tenantId}, 'sms', ${phone}, ${args.template_key}, '{}'::jsonb, 'queued',
      ${args.booking_id ?? null}, ${args.order_id ?? null}
    )
    returning id
  `;
  const message = inserted[0];
  if (!message) return { queued: false, reason: "invalid_phone" };

  await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });

  return { queued: true, message_id: message.id };
}
