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
// VERIFY-2: inbound call webhook ("call_inbound"). BACKEND_SPEC §7.1 documents
// this as a flat `{call_id, from_number, to_number, agent_id?}` body; some
// community sources describe Retell wrapping call-lifecycle webhooks as
// `{event, call_inbound: {...}}` like it does for call_started/call_ended.
// We validate the flat shape (matching the spec we're building against) but
// keep the schema `.loose()` so an unexpected wrapper key doesn't itself
// cause a hard parse failure elsewhere — VERIFY-2 in docs/VERIFY.md tracks
// confirming this against a live sandbox call before go-live.
// ---------------------------------------------------------------------------

export const zRetellInboundCallWebhook = z.looseObject({
  call_id: z.string().min(1),
  from_number: z.string().min(1),
  to_number: z.string().min(1),
  agent_id: z.string().min(1).optional(),
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
// VERIFY-4: call cost breakdown. Confirmed structure via API_AND_FLOWS.md's
// own Rule-1 research (community/indexed sources, `get-call` response):
// `call_cost.product_costs[]`, each `{product, cost, unit_price,
// is_transfer_leg_cost}`, plus `total_duration_seconds`,
// `total_duration_unit_price`, `combined_cost`. The exact `product` enum
// values per LLM/TTS/telephony vendor were an explicit open Week-0 ticket in
// SYSTEM_DESIGN §13 — never assume a closed enum here; `product` is
// deliberately `z.string()`, and normalizeProductCosts (call-events.ts)
// passes through any value it doesn't recognize as `"other"` rather than
// rejecting the whole payload. VERIFY-4 tracks confirming the full `product`
// enum against a live sandbox account before the margin cockpit's
// repricing-drift alert depends on it.
// ---------------------------------------------------------------------------

export const zRetellProductCost = z.object({
  product: z.string().min(1),
  cost: z.number(), // Retell's convention: cost is in CENTS per community sources — see VERIFY-4.
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
// VERIFY-5: call lifecycle webhooks (`call_started`/`call_ended`/
// `call_analyzed`), each `{event, call: RetellCallObject}` (BACKEND_SPEC
// §7.3, API_AND_FLOWS.md "Call events webhook"). `RetellCallObject` fields
// used by cost/disconnection normalization below are confirmed via search
// (sample payload fields: event, call_type, from_number, to_number,
// direction, call_id, agent_id, call_status, start_timestamp,
// end_timestamp, disconnection_reason). `.looseObject` so unused/unknown
// fields never fail validation — we only assert the subset this adapter
// actually reads.
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

/** Retell's documented `disconnection_reason` values we know of, mapped in call-events.ts; unknowns fall back to "unknown". */
export const RETELL_DISCONNECTION_REASONS = [
  "user_hangup",
  "agent_hangup",
  "call_transfer",
  "voicemail_reached",
  "no_answer",
  "dial_failed",
  "error",
  "concurrency_limit_reached",
  "max_duration_reached",
] as const;

// ---------------------------------------------------------------------------
// VERIFY-6: agent lifecycle REST responses (create/update/publish-agent).
// Field names per API_AND_FLOWS.md A.1 ("Agent lifecycle") + general Retell
// API conventions (`agent_id`, `response_engine.{type,conversation_flow_id|
// llm_id}`). Kept loose — we only assert the ids this adapter returns to
// callers; VERIFY-6 tracks confirming the full request/response shape
// (including exact `response_engine` discriminator values for
// conversation-flow vs retell-llm) against a live sandbox before Wave 1
// goes live, per API_AND_FLOWS.md's own flagged "publish reliability" and
// "agent ceiling, rate limits" Week-0 tickets.
// ---------------------------------------------------------------------------

/**
 * Response from creating/updating the underlying conversation-flow or
 * retell-llm resource that an agent's `response_engine` then references
 * (API_AND_FLOWS.md A.1 "Conversation flow / LLM: create + publish
 * version"). Exactly one of the two id fields is expected, depending on
 * which endpoint was called; VERIFY-6 tracks confirming the exact field
 * name against a live sandbox.
 */
export const zRetellFlowResourceResponse = z.looseObject({
  conversation_flow_id: z.string().min(1).optional(),
  llm_id: z.string().min(1).optional(),
});
export type RetellFlowResourceResponse = z.infer<typeof zRetellFlowResourceResponse>;

export const zRetellCreateOrUpdateAgentResponse = z.looseObject({
  agent_id: z.string().min(1),
  response_engine: z
    .looseObject({
      llm_id: z.string().min(1).optional(),
      conversation_flow_id: z.string().min(1).optional(),
    })
    .optional(),
});
export type RetellCreateOrUpdateAgentResponse = z.infer<typeof zRetellCreateOrUpdateAgentResponse>;

export const zRetellPublishAgentVersionResponse = z.looseObject({
  agent_id: z.string().min(1),
  version: z.number().int(),
});
export type RetellPublishAgentVersionResponse = z.infer<typeof zRetellPublishAgentVersionResponse>;

// ---------------------------------------------------------------------------
// VERIFY-7: `POST /import-phone-number`. Confirmed via search
// (docs.retellai.com/api-references/import-phone-number, indexed snippet):
// request body carries `termination_uri` and an `inbound_agents` ARRAY of
// `{agent_id, weight?, agent_version?}` objects (load-balancing across
// multiple agents) — NOT the singular `inbound_agent_id` BACKEND_SPEC §7's
// prose paraphrase assumed. This adapter's canonical
// `ImportPhoneNumberInput.inboundAgentId` (single agent — this product
// never load-balances a number across multiple agents) is lowered to a
// one-element `inbound_agents` array below. VERIFY-7 tracks confirming the
// exact response shape and outbound-agent field name against a live sandbox
// before go-live.
// ---------------------------------------------------------------------------

export const zRetellImportPhoneNumberResponse = z.looseObject({
  phone_number: z.string().min(1),
  phone_number_pretty: z.string().optional(),
});
export type RetellImportPhoneNumberResponse = z.infer<typeof zRetellImportPhoneNumberResponse>;
