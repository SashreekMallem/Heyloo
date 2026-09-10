/**
 * Retell's own wire shapes — the ONLY file in the package (besides tests)
 * that may model a Retell-specific payload (CLAUDE.md Rule 2: nothing past
 * this adapter's boundary ever sees these types; every exported function
 * elsewhere in this package accepts/returns canonical types only).
 *
 * Every schema below was checked against reachable documentation at write
 * time (Sept 2026, CLAUDE.md Rule 1). `docs.retellai.com` itself returns
 * EGRESS_BLOCKED from this environment — confirmed live during this build —
 * so shapes are sourced from indexed search snippets of that same official
 * documentation (WebSearch, not WebFetch) plus BACKEND_SPEC/API_AND_FLOWS'
 * own Rule-1 research, and every field whose exact name/shape isn't
 * independently confirmed is marked `VERIFY-n` below, cross-referenced in
 * `docs/VERIFY.md`. Nothing here is copy-typed into a call site without the
 * Zod boundary validator this file IS.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// VERIFY-2 (LIVE-MINE-FIXES — CONTRADICTED, fixed): BACKEND_SPEC §7.1
// originally documented this as a flat `{call_id, from_number, to_number,
// agent_id?}` body. Live legacy production evidence (76 redeploys of the
// legacy `retell-assistant` edge function, read-only via the Supabase
// Management API — docs/BUILD_NOTES.md LIVE-MINE-EDGE item 1,
// docs/LEGACY_LIVE_FINDINGS.md § Edge Functions "VERIFY-2") shows Retell's
// real `call_inbound` webhook body is NESTED —
// `{event: "call_inbound", call_inbound: {from_number, to_number, agent_id?}}`
// — with NO `call_id` anywhere (Retell has not yet created/attached a call
// id at the point it asks who should handle an inbound call). Kept
// `.loose()` at both levels so an unexpected extra key doesn't itself cause
// a hard parse failure. One live sandbox call remains the final
// confirmation per VERIFY-2's standing recommendation.
// ---------------------------------------------------------------------------

export const zRetellInboundCallWebhook = z.looseObject({
  event: z.string().optional(),
  call_inbound: z.looseObject({
    from_number: z.string().min(1),
    to_number: z.string().min(1),
    agent_id: z.string().min(1).optional(),
  }),
});
export type RetellInboundCallWebhook = z.infer<typeof zRetellInboundCallWebhook>;

/** The `call_inbound` response wrapper Retell expects back (BACKEND_SPEC §7.1). */
export const zRetellInboundCallResponse = z.object({
  call_inbound: z.object({
    override_agent_id: z.string().min(1).optional(),
    dynamic_variables: z.record(z.string(), z.unknown()),
  }),
});
export type RetellInboundCallResponse = z.infer<typeof zRetellInboundCallResponse>;

// ---------------------------------------------------------------------------
// VERIFY-3: tool-call ("custom function") webhook. Confirmed via search
// (docs.retellai.com/build/single-multi-prompt/custom-function, indexed
// snippet): "the webhook request body includes a 'call' object ... and the
// 'args' field contains the arguments ... If 'Payload: args only' is
// enabled, the body is only the argument object (no name/call/args
// wrapper)." We therefore accept the call_id from EITHER the nested
// `call.call_id` (the documented default shape) OR a top-level `call_id`
// (BACKEND_SPEC §7.2's flatter assumed shape) — whichever is present — and
// require `name` + `args` at the top level (the "args only" mode is not
// used: our compiler always wires functions to send the full envelope, see
// compiler/conversation-flow.ts, so `name` is always available to dispatch
// on). VERIFY-3 tracks confirming the exact default envelope shape against
// a live sandbox call before go-live.
// ---------------------------------------------------------------------------

export const zRetellToolCallWebhook = z
  .looseObject({
    call_id: z.string().min(1).optional(),
    call: z.looseObject({ call_id: z.string().min(1) }).optional(),
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
  })
  .check((ctx) => {
    if (!ctx.value.call_id && !ctx.value.call?.call_id) {
      ctx.issues.push({
        code: "custom",
        message:
          "tool-call webhook must carry a call id either at top level or under `call.call_id`",
        input: ctx.value,
        path: ["call_id"],
      });
    }
  });
export type RetellToolCallWebhook = z.infer<typeof zRetellToolCallWebhook>;

/** `{result: <tool-specific JSON>}` — BACKEND_SPEC §7.2 response envelope. Never a non-2xx for a business-logic failure. */
export const zRetellToolCallResponse = z.object({ result: z.unknown() });
export type RetellToolCallResponse = z.infer<typeof zRetellToolCallResponse>;

// ---------------------------------------------------------------------------
// VERIFY-4 (RESOLVED, RETELL-VERIFY): `call_cost.product_costs[]`, each
// `{product, cost, unit_price?, is_transfer_leg_cost?}`, plus
// `total_duration_seconds`, `total_duration_unit_price`, `combined_cost` —
// confirmed verbatim, field-for-field, against `retell-typescript-sdk`'s
// `src/resources/call.ts` (`PhoneCallResponse.CallCost`/`CallCost.ProductCost`
// doc comments: "Cost for the product in **cents** for the duration of the
// call" / "Combined cost of all individual costs in **cents**"). The
// long-open "cents vs. fractional dollars" question is settled: CENTS,
// exactly as this codebase's money invariant (CLAUDE.md Rule 2) already
// assumed — no unit-conversion bug. `product` stays deliberately `z.string()`
// (open, never a closed enum) — the SDK itself only types it as `string` too,
// confirming there's no fixed enum to encode; normalizeProductCosts
// (call-events.ts) passes through any value it doesn't recognize as
// `"other"` rather than rejecting the whole payload.
// ---------------------------------------------------------------------------

export const zRetellProductCost = z.object({
  product: z.string().min(1),
  cost: z.number(), // Cents — confirmed via retell-typescript-sdk (VERIFY-4, resolved).
  unit_price: z.number().optional(),
  is_transfer_leg_cost: z.boolean().optional().default(false),
});
export type RetellProductCost = z.infer<typeof zRetellProductCost>;

export const zRetellCallCost = z.object({
  product_costs: z.array(zRetellProductCost),
  total_duration_seconds: z.number().optional(),
  total_duration_unit_price: z.number().optional(),
  combined_cost: z.number(),
});
export type RetellCallCost = z.infer<typeof zRetellCallCost>;

// ---------------------------------------------------------------------------
// VERIFY-5 (RESOLVED, RETELL-VERIFY): call lifecycle webhooks
// (`call_started`/`call_ended`/`call_analyzed`), each
// `{event, call: RetellCallObject}` — the event-name set and the default
// subscription (an agent with no explicit `webhook_events` gets exactly
// these three) are both confirmed verbatim against
// `retell-typescript-sdk`'s `src/resources/agent.ts`
// (`AgentCreateParams.webhook_events` doc comment: "If not set, defaults to
// call_started, call_ended, call_analyzed"). `RetellCallObject` fields used
// by cost/disconnection normalization below (`call_id`, `agent_id`,
// `from_number`, `to_number`, `start_timestamp`, `end_timestamp`,
// `disconnection_reason`, `call_cost`) are each confirmed present, with the
// same names, on the SDK's `PhoneCallResponse`. `.looseObject` so
// unused/unknown fields (the SDK's `PhoneCallResponse` has dozens more we
// don't read) never fail validation.
// ---------------------------------------------------------------------------

export const RETELL_EVENT_TYPES = ["call_started", "call_ended", "call_analyzed"] as const;
export const zRetellEventType = z.enum(RETELL_EVENT_TYPES);

export const zRetellCallObject = z.looseObject({
  call_id: z.string().min(1),
  agent_id: z.string().min(1).optional(),
  from_number: z.string().min(1).optional(),
  to_number: z.string().min(1).optional(),
  start_timestamp: z.number(), // epoch millis (Retell convention)
  end_timestamp: z.number().optional(),
  disconnection_reason: z.string().optional(),
  call_cost: zRetellCallCost.optional(),
});
export type RetellCallObject = z.infer<typeof zRetellCallObject>;

export const zRetellCallLifecycleWebhook = z.object({
  event: zRetellEventType,
  call: zRetellCallObject,
});
export type RetellCallLifecycleWebhook = z.infer<typeof zRetellCallLifecycleWebhook>;

/**
 * `disconnection_reason` — confirmed verbatim (RETELL-VERIFY, VERIFY-5
 * resolved) against `retell-typescript-sdk`'s `src/resources/call.ts`
 * (`PhoneCallResponse.disconnection_reason`), NOT the partial/guessed list
 * this file previously carried. Kept in sync with canonical-types'
 * `DISCONNECTION_REASONS`; unrecognized values still normalize to
 * canonical `"unknown"` (call-events.ts) rather than rejecting the event.
 */
export const RETELL_DISCONNECTION_REASONS = [
  "user_hangup",
  "agent_hangup",
  "call_transfer",
  "voicemail_reached",
  "ivr_reached",
  "inactivity",
  "max_duration_reached",
  "concurrency_limit_reached",
  "no_concurrency_fallback",
  "no_valid_payment",
  "scam_detected",
  "dial_busy",
  "dial_failed",
  "dial_no_answer",
  "invalid_destination",
  "telephony_provider_permission_denied",
  "telephony_provider_unavailable",
  "sip_routing_error",
  "marked_as_spam",
  "user_declined",
  "error_llm_websocket_open",
  "error_llm_websocket_lost_connection",
  "error_llm_websocket_runtime",
  "error_llm_websocket_corrupt_payload",
  "error_no_audio_received",
  "error_asr",
  "error_retell",
  "error_unknown",
  "error_user_not_joined",
  "registered_call_timeout",
  "transfer_bridged",
  "transfer_cancelled",
  "manual_stopped",
  "call_take_over",
] as const;

// ---------------------------------------------------------------------------
// VERIFY-6 (RESOLVED, RETELL-VERIFY): agent lifecycle REST shapes, confirmed
// against retell-typescript-sdk's src/resources/{agent,llm,
// conversation-flow}.ts:
//   - `response_engine: {type: "conversation-flow"|"retell-llm", ...}` — the
//     two discriminator string literals this codebase already used are both
//     confirmed verbatim (`AgentCreateParams.ResponseEngineConversationFlow`/
//     `ResponseEngineRetellLm`).
//   - `agent_id`/`version` on `AgentResponse` (create AND update) — both
//     confirmed required fields.
//   - `inbound_webhook_url` does NOT exist on the Agent resource at all
//     (confirmed absent from every Agent create/update/response interface) —
//     it is exclusively a PHONE-NUMBER field
//     (`PhoneNumber{Create,Update,Import}Params`/`PhoneNumberResponse`,
//     src/resources/phone-number.ts). This codebase's own VERIFY-6 open
//     question ("is it agent- or number-scoped?") is answered: NUMBER-scoped.
//     Moved to `ImportPhoneNumberInput`/numbers.ts accordingly; no longer
//     sent on the agent create/update body (agents.ts).
// ---------------------------------------------------------------------------

/**
 * Response from creating/updating the underlying conversation-flow or
 * retell-llm resource that an agent's `response_engine` then references.
 * Exactly one of the two id fields is expected, depending on which endpoint
 * was called — confirmed via `retell-typescript-sdk`'s
 * `src/resources/{llm,conversation-flow}.ts` (`LlmResponse.llm_id`,
 * `ConversationFlowResponse.conversation_flow_id`).
 */
export const zRetellFlowResourceResponse = z.looseObject({
  conversation_flow_id: z.string().min(1).optional(),
  llm_id: z.string().min(1).optional(),
});
export type RetellFlowResourceResponse = z.infer<typeof zRetellFlowResourceResponse>;

export const zRetellCreateOrUpdateAgentResponse = z.looseObject({
  agent_id: z.string().min(1),
  // Confirmed REQUIRED on `AgentResponse` (retell-typescript-sdk
  // src/resources/agent.ts) — RETELL-VERIFY, VERIFY-6 resolved. This is the
  // agent's draft version; `publishAgentVersion` needs it (the publish
  // endpoint has no "latest" shorthand).
  version: z.number().int(),
  response_engine: z
    .looseObject({
      llm_id: z.string().min(1).optional(),
      conversation_flow_id: z.string().min(1).optional(),
    })
    .optional(),
});
export type RetellCreateOrUpdateAgentResponse = z.infer<typeof zRetellCreateOrUpdateAgentResponse>;

// ---------------------------------------------------------------------------
// VERIFY-6 (resolved, RETELL-VERIFY): confirmed via retell-typescript-sdk's
// `AgentPublishParams`/`Agent.publish` that `POST /publish-agent-version/{id}`
// (a) REQUIRES a `{version: number, ...}` request body — there is no
// "publish whatever's latest draft" shorthand — and (b) returns `void` (no
// response body at all), NOT `{agent_id, version}` as this file previously
// assumed. `publishRetellAgentVersion` (agents.ts) no longer parses a
// response body for this call; the returned `version` is just an echo of
// the input the caller already supplied.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// VERIFY-7 (RESOLVED, RETELL-VERIFY): `POST /import-phone-number`, confirmed
// field-for-field against retell-typescript-sdk's
// `src/resources/phone-number.ts` (`PhoneNumberImportParams`):
//   - `inbound_agents` IS an array of `{agent_id, weight, agent_version?}` —
//     confirmed. BUT `weight` is a REQUIRED field on each entry ("total
//     weights must add up to 1"), not optional as this file previously
//     assumed — a single-agent number must still send `weight: 1`.
//     numbers.ts fixed accordingly.
//   - `outbound_agent_id` (singular) does NOT exist — confirmed the
//     equivalent field is `outbound_agents` (an ARRAY, same shape as
//     `inbound_agents`), not a bare id string. numbers.ts fixed.
//   - `sip_trunk_auth_username`/`sip_trunk_auth_password` confirmed exact.
//   - `inbound_webhook_url` confirmed present here (see VERIFY-6 above —
//     this is where it actually belongs, not on the Agent).
//   - Response (`PhoneNumberResponse`): `phone_number` (E.164, "used as the
//     unique identifier for phone number APIs") and `phone_number_pretty?`
//     both confirmed present; kept `.looseObject` since the real response
//     carries many more fields this adapter doesn't read.
// ---------------------------------------------------------------------------

export const zRetellImportPhoneNumberResponse = z.looseObject({
  phone_number: z.string().min(1),
  phone_number_pretty: z.string().optional(),
});
export type RetellImportPhoneNumberResponse = z.infer<typeof zRetellImportPhoneNumberResponse>;

// ---------------------------------------------------------------------------
// Outbound calls (GAP_REGISTER Cluster A item 6, `outbound.ts`).
// RETELL-VERIFY: `POST /v2/create-phone-call` (note the `/v2` prefix —
// confirmed via `retell-sdk`'s `Call.createPhoneCall`, distinct from
// `/create-agent`'s unprefixed path used elsewhere in this package) takes
// `{from_number, to_number, override_agent_id?, retell_llm_dynamic_
// variables?, metadata?}` and returns a `PhoneCallResponse` — this codebase
// only reads `call_id` from it, `.looseObject` since the real response
// carries dozens more fields (transcript, cost, etc., irrelevant at the
// moment the call is PLACED, before any of that exists).
// ---------------------------------------------------------------------------

export const zRetellCreatePhoneCallResponse = z.looseObject({
  call_id: z.string().min(1),
});
export type RetellCreatePhoneCallResponse = z.infer<typeof zRetellCreatePhoneCallResponse>;
