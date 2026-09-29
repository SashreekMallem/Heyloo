import type { z } from "zod";
import { normalizeE164 } from "../../_shared/phone.ts";
import { enqueue, QUEUE_NAMES } from "../../_shared/queue.ts";
import type { SendSmsConfirmationArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import { SMS_UNAVAILABLE_CONFIRMATION_MESSAGE } from "../../_shared/sms-availability.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof SendSmsConfirmationArgsSchema>;

export type SendSmsConfirmationResult =
  | { queued: true; message_id: string }
  | {
      queued: false;
      reason: "invalid_phone" | "invalid_template" | "booking_not_found" | "order_not_found";
    }
  /** MSG-3: the business has no usable SMS sender, so NO text is queued and the
   * model is told not to claim one (see `_shared/sms-availability.ts`). */
  | {
      queued: false;
      reason: "sms_unavailable";
      texting_available: false;
      message: string;
    };

export interface SendSmsConfirmationDeps {
  /** Whether a customer text would really be sent (`isSmsAvailable`). Required: a
   * caller that forgets it cannot compile, so no path can promise a text blindly. */
  smsAvailable: () => Promise<boolean>;
}

/**
 * VOICE-ALERTS-1 review: `template_key` comes straight from the model, and
 * this tool texts an arbitrary number. Only the customer-facing
 * confirmation templates may be requested: without the allowlist a prompt-
 * injected caller could have the agent queue an owner-alert template (paging
 * the owner with an empty alert) or `chat_phone_verification` (a code text
 * to any number). Any other key already rendered an empty body and failed in
 * the worker, so nothing legitimate is lost.
 */
export const CONFIRMATION_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  "booking_confirmation",
  "order_confirmation",
  "booking_cancelled",
]);

/**
 * BACKEND_SPEC §7.2.7 — enqueue-only, the actual send happens in the
 * `messages_outbound_queue` worker (§9/§10), never inline, to keep this
 * tool call fast.
 *
 * MSG-3: when the business cannot text (no carrier-verified SMS sender, or
 * its provider has no secrets — owner decision: no texting provider at
 * launch) nothing is queued and the result says so, so the agent confirms the
 * booking out loud and never claims a text was sent. Before this the row was
 * always queued and the worker rerouted it to the owner's inbox as "text not
 * sent yet", while the model was told `queued: true` and promised the caller
 * a text that would never arrive. Otherwise the row is inserted `queued` and
 * enqueued (VOICE-ALERTS-1).
 */
export async function sendSmsConfirmation(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
  deps: SendSmsConfirmationDeps,
): Promise<SendSmsConfirmationResult> {
  const phone = normalizeE164(args.phone);
  if (!phone) return { queued: false, reason: "invalid_phone" };
  if (!CONFIRMATION_TEMPLATE_KEYS.has(args.template_key)) {
    return { queued: false, reason: "invalid_template" };
  }
  if (!(await deps.smsAvailable())) {
    return {
      queued: false,
      reason: "sms_unavailable",
      texting_available: false,
      message: SMS_UNAVAILABLE_CONFIRMATION_MESSAGE,
    };
  }

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

  // VOICE-ALERTS-1: always `queued` + enqueued (once texting is available,
  // MSG-3 above). This used to write `pending_verification` (without
  // enqueueing) whenever the tenant's A2P campaign wasn't verified, so
  // confirmations sat unsent forever (238 live rows). The worker still
  // re-checks the sender at send time (`resolveSmsRoute`, BACKEND_SPEC
  // §10.1), e.g. when approval is revoked between this call and the send.
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
