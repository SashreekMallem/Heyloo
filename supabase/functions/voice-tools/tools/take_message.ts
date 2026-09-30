import type { z } from "zod";
import { alertCustomAnswers } from "../../_shared/custom-questions.ts";
import { normalizeE164 } from "../../_shared/phone.ts";
import type { TakeMessageArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { SqlClient } from "../../_shared/types.ts";
import { isPartialIntake } from "../../_shared/vertical-intake.ts";
import type { CallContext } from "../context.ts";
import { type OwnerAlertDeps, raiseOwnerAlert } from "../owner-alert-runner.ts";

type Args = z.infer<typeof TakeMessageArgsSchema>;

export interface TakeMessageResult {
  recorded: true;
  /** F5: set when the intake was stored incomplete (`structured_payload.intake_status: "partial"`); the message is recorded either way. */
  partial?: true;
}

/**
 * BACKEND_SPEC §7.2.6 — one message row per call (upsert against
 * `call_id`, re-invocation overwrites rather than duplicating). Raises the
 * owner's `message_taken` alert (one per call); the final `call_logs.classification` value
 * remains owned by post-call analysis (`/voice-events` `call_analyzed`),
 * this just sets a same-call hint.
 */
export async function takeMessage(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
  deps: OwnerAlertDeps,
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
  //
  // CALL-8 (docs/BUILD_PLAN.md): `caller_name`/`caller_phone` are ALSO
  // folded in here now, not just left on the transient `messages_outbound`
  // row below. Previously the caller's spoken name/callback number (as
  // distinct from the call's own real caller-id, `call_logs.caller_number`)
  // was durably recorded ONLY when the tenant had `agent_configs.
  // transfer_number` configured (the row below's own gate) — for a tenant
  // with none configured, every `take_message` call's captured name/phone
  // was silently dropped the moment the request finished, recoverable only
  // by re-reading the free-text `message_text` if the model happened to say
  // it there. This is what `_shared/vertical-intake.ts`'s required-field
  // check enforces the presence of before this function is ever called, so
  // it must be durably stored regardless of notification configuration —
  // exactly the same "record it even if the SMS can't be sent" posture this
  // column already has for every other field.
  const structuredPayload = {
    ...(args.structured_payload ?? {}),
    ...(args.callback_window ? { callback_window: args.callback_window } : {}),
    ...(args.caller_name ? { caller_name: args.caller_name } : {}),
    ...(callerPhone ? { caller_phone: callerPhone } : {}),
  };
  await sql`
    update public.call_logs
    set message_text = ${args.message_text},
        classification = coalesce(classification, 'after_hours_message'),
        structured_booking_payload = coalesce(structured_booking_payload, '{}'::jsonb) || ${structuredPayload}::jsonb
    where id = ${ctx.callLogId} and tenant_id = ${ctx.tenantId}
  `;

  // VOICE-ALERTS-1: the owner alert goes through the shared MESSAGING-1
  // producer (`_shared/owner-alerts.ts`), which picks the destination from
  // the tenant's delivery preferences (alert phone, else transfer number,
  // else email) and lets the worker fan out to SMS and/or email at send
  // time. This used to insert only when `agent_configs.transfer_number` was
  // set — 0 of 10 live tenants had one, so no owner was ever alerted. The
  // call_logs update above stays the source of truth either way.
  await raiseOwnerAlert(sql, ctx, deps, "take_message_owner_alert", {
    kind: "message_taken",
    payload: {
      caller_name: args.caller_name ?? null,
      caller_phone: callerPhone ?? null,
      message_text: args.message_text,
      callback_window: args.callback_window ?? null,
      // INTAKE-Q-1: the owner's custom questions and what the caller answered.
      ...alertCustomAnswers(structuredPayload),
      ...(Object.keys(structuredPayload).length > 0
        ? { structured_payload: structuredPayload }
        : {}),
    },
    relatedCallId: ctx.callLogId,
  });

  return isPartialIntake(args) ? { recorded: true, partial: true } : { recorded: true };
}
