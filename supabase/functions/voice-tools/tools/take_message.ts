import type { z } from "zod";
import { normalizeE164 } from "../../_shared/phone.js";
import { enqueue, QUEUE_NAMES } from "../../_shared/queue.js";
import type { TakeMessageArgsSchema } from "../../_shared/schemas/voice-tools.js";
import type { SqlClient } from "../../_shared/types.js";
import type { CallContext } from "../context.js";

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

  await sql`
    update public.call_logs
    set message_text = ${args.message_text},
        classification = coalesce(classification, 'after_hours_message')
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
      ${JSON.stringify({
        caller_name: args.caller_name ?? null,
        caller_phone: callerPhone,
        message_text: args.message_text,
        callback_window: args.callback_window ?? null,
      })}::jsonb,
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
