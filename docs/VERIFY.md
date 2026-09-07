# VERIFY — assumed external-API shapes pending live confirmation

Per `CLAUDE.md` Rule 1 item 2: `docs.retellai.com` returns `EGRESS_BLOCKED`
from every build agent's environment (confirmed live during T2). Every shape
below was therefore built from (a) the spec docs' own Rule-1 research
(`docs/spec/BACKEND_SPEC.md`, `docs/spec/API_AND_FLOWS.md`, both already
flagged with their own `VERIFY:` markers) and/or (b) indexed WebSearch
snippets of the official docs (not a first-party `WebFetch`), plus a runtime
Zod boundary validator at every call site. Confirm each item against a live
Retell sandbox account before its dependent code path goes live (T4's
provisioning saga is the first real publish).

## T2 — packages/canonical-types, packages/adapters/retell

All entries below live in `packages/adapters/retell/src/raw-types.ts` and
`packages/adapters/retell/src/compiler/types.ts`, cross-referenced by these
ids in code comments.

### VERIFY-1 — webhook signature scheme

**Assumed:** `X-Retell-Signature: v={unix_ms_timestamp},d={hex_digest}`,
digest = `HMAC-SHA256(raw_body + timestamp, api_key)` (plain string
concatenation, not a separator), hex-encoded, 5-minute replay-window
tolerance, verified with the workspace's **webhook-badged** API key.
**Source:** indexed WebSearch snippet of
`docs.retellai.com/features/secure-webhook` (not fetched directly — blocked).
Matches `docs/spec/API_AND_FLOWS.md` A.1 "Inbound webhook" exactly.
**Confirm before go-live:** that `RETELL_API_KEY` (the single env var T3/T4
wire in) IS the webhook-badged key — if Retell issues a *separate* signing
secret in the current dashboard, `signature.ts`'s `apiKey` param must be
renamed/re-sourced accordingly.
**Code:** `packages/adapters/retell/src/signature.ts`.

### VERIFY-2 — inbound call webhook (`call_inbound`) request shape

**Assumed:** flat body `{call_id, from_number, to_number, agent_id?}`, per
`docs/spec/BACKEND_SPEC.md` §7.1. Some community sources describe Retell
wrapping lifecycle webhooks as `{event, call_inbound: {...}}` like
`call_started`/`call_ended`/`call_analyzed` — NOT independently confirmed
either way for this specific webhook.
**Confirm before go-live:** fire one real inbound test call against a
staging Retell agent pointed at a logging endpoint and capture the actual
body.
**Code:** `packages/adapters/retell/src/raw-types.ts` (`zRetellInboundCallWebhook`).

### VERIFY-3 — tool-call ("custom function") webhook envelope

**Assumed:** the default envelope nests the call under a `call` object
(`{call: {call_id, ...}, name, args}`), per an indexed snippet of
`docs.retellai.com/build/single-multi-prompt/custom-function` ("the webhook
request body includes a 'call' object... and the 'args' field..."; a
"Payload: args only" toggle exists but is NOT used by this compiler, so the
full envelope with `name` is always expected). This adapter accepts a
top-level `call_id` OR a nested `call.call_id` defensively (whichever is
present) since `docs/spec/BACKEND_SPEC.md` §7.2 assumed a flatter
`{call_id, name, args}` shape.
**Confirm before go-live:** capture one real tool-call webhook delivery
against a staging agent with a `check_availability`-style custom function
and confirm (a) the exact envelope shape, (b) whether the caller's live
number is exposed under `call.from_number` (assumed in `tool-call.ts`'s
`extractCallerNumber`, used for the G6 `lookup_customer` authorization
cross-check) or a differently-named field.
**Code:** `packages/adapters/retell/src/raw-types.ts` (`zRetellToolCallWebhook`),
`packages/adapters/retell/src/tool-call.ts`.

### VERIFY-4 — cost breakdown (`call_cost.product_costs[]`)

**Assumed:** `{product_costs: [{product, cost, unit_price?, is_transfer_leg_cost}],
total_duration_seconds?, combined_cost}`, per `docs/spec/API_AND_FLOWS.md`
A.1's own research. `product` is deliberately treated as an open string
(never a closed enum) — the exact enum values per LLM/TTS/telephony vendor
were an explicit open Week-0 ticket in `docs/SYSTEM_DESIGN.md` §13 even
before this build. `cost`/`unit_price`/`combined_cost` are assumed to already
be integer-ish USD cents (this codebase's Rule-2 money invariant); rounded
defensively in `normalizeCostBreakdown`.
**Confirm before go-live:** the actual unit (cents vs. fractional dollars)
and the full `product` enum, against a live sandbox call's `call_ended`
webhook AND `GET /get-call` response — this directly feeds the margin
cockpit's provider-repricing-drift alert (T-later), so a unit mismatch here
is a real billing-accuracy risk, not just a display bug.
**Code:** `packages/adapters/retell/src/raw-types.ts` (`zRetellCallCost`,
`zRetellProductCost`), `packages/adapters/retell/src/call-events.ts`
(`normalizeCostBreakdown`).

### VERIFY-5 — call lifecycle webhook envelope & `RetellCallObject` fields

**Assumed:** `{event: "call_started"|"call_ended"|"call_analyzed", call: {...}}`,
per `docs/spec/BACKEND_SPEC.md` §7.3. Fields this adapter reads
(`call_id`, `agent_id`, `from_number`, `to_number`, `start_timestamp`,
`end_timestamp`, `disconnection_reason`, `call_cost`) confirmed via an
indexed sample-payload snippet. The full `disconnection_reason` enum
(`RETELL_DISCONNECTION_REASONS` in `raw-types.ts`) is a best-effort list;
unrecognized values normalize to canonical `"unknown"` rather than rejecting
the event.
**Confirm before go-live:** the complete `disconnection_reason` enum against
a live account (several documented call outcomes: no-answer, dial-failed,
concurrency-limit — worth exercising each in a staging sandbox).
**Code:** `packages/adapters/retell/src/raw-types.ts` (`zRetellCallObject`,
`zRetellCallLifecycleWebhook`), `packages/adapters/retell/src/call-events.ts`.

### VERIFY-6 — agent lifecycle REST shapes (create/update-agent, create-conversation-flow, create-retell-llm, publish-agent-version)

**Assumed:** two-step protocol — (1) `POST /create-conversation-flow` (for
`compile_target: conversation_flow`) or `POST /create-retell-llm` (for
`multi_prompt`/`single_prompt`) returns `{conversation_flow_id}` or
`{llm_id}`; (2) `POST /create-agent` / `PATCH /update-agent/{id}` with
`response_engine: {type: "conversation-flow"|"retell-llm", conversation_flow_id|llm_id}`,
`voice_id`, `webhook_url` (call-events), and an **optimistically-named**
`inbound_webhook_url` field whose actual location (per-agent vs.
per-phone-number) is NOT confirmed; (3) `POST /publish-agent-version/{agent_id}`
returns `{agent_id, version}`. Per `docs/spec/API_AND_FLOWS.md` A.1's own
research: "a flow shared by multiple agents propagates to all of them" and
`PATCH /update-conversation-flow/{id}` "can 400 on a flow that is already
referenced by a *published* agent version" — this build does NOT yet
implement update-in-place for an already-published flow; T4's provisioning
saga must confirm the safe multi-tenant update pattern before relying on
`createOrUpdateAgent`'s update path in production.
**Confirm before go-live:** exact field names above, whether
`inbound_webhook_url` is agent- or number-scoped, the exact 400 conditions
on updating a published flow, and any per-workspace agent-count/rate
ceiling (`docs/SYSTEM_DESIGN.md` §13 Week-0 ticket).
**Code:** `packages/adapters/retell/src/raw-types.ts`
(`zRetellCreateOrUpdateAgentResponse`, `zRetellFlowResourceResponse`,
`zRetellPublishAgentVersionResponse`), `packages/adapters/retell/src/agents.ts`.

### VERIFY-7 — `POST /import-phone-number`

**Assumed:** body `{phone_number, termination_uri, inbound_agents: [{agent_id, weight?, agent_version?}], outbound_agent_id?, sip_trunk_auth_username?, sip_trunk_auth_password?}`
— confirmed via an indexed snippet of
`docs.retellai.com/api-references/import-phone-number` that the field is an
`inbound_agents` **array** (for multi-agent load balancing), NOT the
singular `inbound_agent_id` `docs/spec/BACKEND_SPEC.md` §7's prose
paraphrase assumed. This product never load-balances a number across
multiple agents, so the canonical `ImportPhoneNumberInput.inboundAgentId`
(singular) is always lowered to a one-element array.
**Confirm before go-live:** the exact response shape (assumed
`{phone_number, phone_number_pretty?}`) and the outbound-agent field name.
**Code:** `packages/adapters/retell/src/raw-types.ts`
(`zRetellImportPhoneNumberResponse`), `packages/adapters/retell/src/numbers.ts`.

### VERIFY-8 — Conversation Flow / Retell LLM node & edge wire schema

**Assumed:** entirely this codebase's OWN internally-consistent modeling
(`packages/adapters/retell/src/compiler/types.ts`) of the documented
concepts — confirmed via indexed search that node types include
`ConversationNode`, `FunctionNode`, `TransferCallNode`,
`ExtractDynamicVariablesNode`, and a per-node "Global Node" setting; that
edges carry a `transition_condition`; and that Retell LLM "states" are
named + carry a `state_prompt` and inter-state edges. The EXACT wire-level
field names (`instruction.text` vs. some other key, `global_node` vs.
`global_node_setting.description`, etc.) were **not** independently
confirmed — `docs.retellai.com` is egress-blocked in this environment.
**This is the single highest-risk VERIFY item**: T4 (first real publish
against a live Retell sandbox, per `docs/BUILD_PLAN.md` Wave 2) MUST
confirm every field name here against that sandbox and update this file +
the compiler's golden-file snapshots
(`packages/adapters/retell/src/compiler/__snapshots__/*.snap`) before any
template goes live. The compiler's STRUCTURE (state/transition/global-intent
lowering, the disclosure-line injection point per compile target) is
spec-driven and does not depend on Retell's exact field names — only the
wire serialization does.
**Code:** `packages/adapters/retell/src/compiler/types.ts`,
`conversation-flow.ts`, `multi-prompt.ts`, `single-prompt.ts`.

## Still open from the specs themselves (not re-litigated here)

`docs/spec/API_AND_FLOWS.md` A.1 already flags, independently of the above:
Retell's per-endpoint rate limits and per-workspace agent ceiling; the
webhook egress region (latency budget depends on co-locating edge functions
with it); SIP trunk credential rotation/expiry semantics; batch-simulation
testing's exact request/response schema. These are T3/T4/T6 concerns at the
point they're wired up, not re-duplicated here.
