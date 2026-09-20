import type { z } from "zod";
import { normalizeE164 } from "../../_shared/phone.ts";
import { enqueue, QUEUE_NAMES } from "../../_shared/queue.ts";
import type { TakeMessageArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof TakeMessageArgsSchema>;

export interface TakeMessageResult {
  recorded: true;
}

/**
 * BACKEND_SPEC §7.2.6 — one message row per call (upsert against
 * `call_id`, re-invocation overwrites rather than duplicating). Enqueues a
 * tenant-facing notification; the final `call_logs.classification` value
 * remains owned by post-call analysis (`/voice-events` `call_analyzed`),
 * this just sets a same-call hint.
 */
export async function takeMessage(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
): Promise<TakeMessageResult> {
  const callerPhone = normalizeE164(args.caller_phone) ?? args.caller_phone;

  // GAP_REGISTER.md §2 Legal item 4 / real_estate — a caller who leaves a
  // message instead of completing a booking still gets their captured
  // intake data (matter_type, buyer_or_seller, etc.) on
  // `call_logs.structured_booking_payload`, the same column
  // `create_booking.ts` writes, rather than only inside the free-text
  // `message_text`. Merged into whatever `structured_booking_payload`
  // already holds (jsonb `||`) rather than overwritten, since a single
  // call can reach `take_message` after an earlier tool already wrote
  // something there.
  //
  // `callback_window` is folded in here too (not just left inside the
  // transient `messages_outbound.payload` row below) so it's durably
  // visible on the Call Detail page's `structured_booking_payload` render
  // regardless of which channel/template renders the staff SMS.
  const structuredPayload = {
    ...(args.structured_payload ?? {}),
    ...(args.callback_window ? { callback_window: args.callback_window } : {}),
  };
  await sql`
    update public.call_logs
    set message_text = ${args.message_text},
        classification = coalesce(classification, 'after_hours_message'),
        structured_booking_payload = coalesce(structured_booking_payload, '{}'::jsonb) || ${structuredPayload}::jsonb
    where id = ${ctx.callLogId} and tenant_id = ${ctx.tenantId}
  `;

  // Notification recipient: the tenant's designated human-handoff number
  // (`agent_configs.transfer_number`, tenant-config-only per G6) — the
  // schema has no separate "staff notification phone" column, and this is
  // the field that already represents "where the business wants to be
  // reached". Falls back to no SMS row (still recorded on call_logs above)
  // if the tenant hasn't configured one; the dashboard message thread is
  // the source of truth regardless of whether this notification send fires.
  const messageRows = await sql<{ id: string }>`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload, related_call_id)
    select ${ctx.tenantId}, 'sms', ac.transfer_number, 'take_message',
      ${{
        caller_name: args.caller_name ?? null,
        caller_phone: callerPhone,
        message_text: args.message_text,
        callback_window: args.callback_window ?? null,
      }}::jsonb,
      ${ctx.callLogId}
    from public.agent_configs ac
    where ac.tenant_id = ${ctx.tenantId} and ac.transfer_number is not null
    returning id
  `;
  const message = messageRows[0];
  if (message) {
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
  }

  return { recorded: true };
}
