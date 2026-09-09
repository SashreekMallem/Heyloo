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

**RETELL-VERIFY update**: although `docs.retellai.com` stays egress-blocked,
the official `retell-sdk` npm package (published from
`RetellAI/retell-typescript-sdk`) installs cleanly and its GitHub source is
reachable via `raw.githubusercontent.com` — a first-party, non-`docs.*`
source. A dedicated pass re-verified every Retell `VERIFY-*` item below
against that SDK's own generated request/response types and its own
webhook-signing source; most are now marked **RESOLVED** (either confirmed
correct as originally built, or a real mismatch found and fixed — see each
item and `docs/BUILD_NOTES.md`'s RETELL-VERIFY entry for the full list).
Only the two items that are genuinely webhook PAYLOAD shapes (VERIFY-2,
VERIFY-3) remain open — webhooks aren't part of either SDK's typed REST
surface at all, so a live sandbox call is still the only way to confirm
those exactly.

## T2 — packages/canonical-types, packages/adapters/retell

All entries below live in `packages/adapters/retell/src/raw-types.ts` and
`packages/adapters/retell/src/compiler/types.ts`, cross-referenced by these
ids in code comments.

### VERIFY-1 — webhook signature scheme — **RESOLVED (RETELL-VERIFY)**

**Confirmed:** `X-Retell-Signature: v={unix_ms_timestamp},d={hex_digest}`,
digest = `HMAC-SHA256(raw_body + timestamp, api_key)` (plain string
concatenation, not a separator), hex-encoded, 5-minute replay-window
tolerance — **confirmed byte-for-byte** against the OFFICIAL
`retell-sdk` npm package's own `src/lib/webhook_auth.ts`
(`symmetric.verify`/`sign`, exported as `verify`/`sign` from the package
root): `verify = (body, apiKey, signature) => symmetric.verify(body,
apiKey, signature)`, and `symmetric.verify` computes
`HMAC-SHA256(secret, input + poststamp)` with `FIVE_MINUTES = 5*60*1000`
as the default tolerance. The API key itself IS the signing secret
(no separate "webhook-badged" secret exists in the SDK's own contract).
**Source:** `raw.githubusercontent.com/RetellAI/retell-typescript-sdk/main/src/lib/webhook_auth.ts`
(reachable — `docs.retellai.com` itself stayed egress-blocked).
**No code change needed** — `packages/adapters/retell/src/signature.ts`
and `supabase/functions/_shared/retell-signature.ts` already matched this
exactly.
**Code:** `packages/adapters/retell/src/signature.ts`,
`supabase/functions/_shared/retell-signature.ts`.

### VERIFY-2 — inbound call webhook (`call_inbound`) request shape — **code fix applied (LIVE-MINE-FIXES); one live test call still the final confirmation**

**Assumed:** flat body `{call_id, from_number, to_number, agent_id?}`, per
`docs/spec/BACKEND_SPEC.md` §7.1. **RETELL-VERIFY checked the official
`retell-sdk`/`retell-typescript-sdk` for this** — webhook PAYLOAD shapes
are genuinely NOT part of either SDK's generated `src/resources/*.ts`
types (those model client→server REST calls; a webhook is a
server→client push with no corresponding typed resource). This remains
unconfirmed exactly as before. Partial corroboration only:
`CallCreatePhoneCallParams.override_agent_id` (a real, confirmed SDK
field used for OUTBOUND calls) independently confirms `override_agent_id`
is Retell's genuine naming convention for "override which agent handles
this call" — the same concept our assumed `call_inbound` RESPONSE envelope
uses, though that response envelope itself is still unconfirmed.
**Confirm before go-live:** fire one real inbound test call against a
staging Retell agent pointed at a logging endpoint and capture the actual
body.
**Code:** `packages/adapters/retell/src/raw-types.ts` (`zRetellInboundCallWebhook`).

**LIVE-MINE-EDGE update (docs/LEGACY_LIVE_FINDINGS.md § Edge Functions):**
read the deployed source of the legacy production project's
`retell-assistant` edge function (76 production redeploys, read-only via
the Supabase Management API, never reachable from `legacy/`'s committed
repo — that repo has no Retell code at all, only a prior `vapi-*`
integration). Its `call_inbound` handling is:
```js
if (payload.event === "call_inbound" && payload.call_inbound) {
  const { from_number, to_number } = payload.call_inbound;
```
i.e. the real envelope is **nested** — `{event: "call_inbound",
call_inbound: {from_number, to_number, ...}}` — not the flat
`{call_id, from_number, to_number, agent_id?}` body assumed above. The
RESPONSE envelope this same live code returns
(`{call_inbound: {override_agent_id?, dynamic_variables}}`) already
matches this codebase's assumption exactly, so only the REQUEST-side
assumption is contradicted. This is strong (production code that
processed real traffic for months) but not a captured-raw-body-level
confirmation, so status here moves to **contradicted-by-live-code,
recommend fix, still fire one staging test call to close it out
completely** rather than fully RESOLVED. See
`docs/LEGACY_LIVE_FINDINGS.md` § Edge Functions ("VERIFY-2") for the full
writeup and exact contradicting file:line
(`supabase/functions/_shared/schemas/voice-inbound.ts:11-17`,
`packages/adapters/retell/src/raw-types.ts:31-36`); a fix recommendation
is logged in `docs/BUILD_NOTES.md` (LIVE-MINE-EDGE).

**LIVE-MINE-FIXES update — code fix applied.** `VoiceInboundRequestSchema`
(`supabase/functions/_shared/schemas/voice-inbound.ts`) and
`zRetellInboundCallWebhook` (`packages/adapters/retell/src/raw-types.ts`)
now both validate the nested `{event, call_inbound: {from_number,
to_number, agent_id?}}` shape (no `call_id` field — confirmed absent from
the live evidence above), with `.passthrough()`/`.loose()` kept at both
levels. `supabase/functions/voice-inbound/handler.ts`,
`packages/adapters/retell/src/inbound.ts`, and canonical
`InboundCallContext.providerCallId` (now optional,
`packages/canonical-types/src/voice-provider.ts`) were updated to match —
every place that previously logged or read `call_id` off this webhook now
either omits it or logs the raw `to`/`from` number instead. All affected
unit tests/fixtures were updated to the nested shape, plus a regression
test (`supabase/functions/voice-inbound/handler.test.ts`,
`packages/adapters/retell/src/inbound.test.ts`) asserting the OLD flat
legacy-assumed shape is now correctly REJECTED. The RESPONSE envelope
(`{call_inbound: {override_agent_id?, dynamic_variables}}`) was
unchanged, per the standing recommendation. **Status stays
"code fix applied, not fully RESOLVED"** — per VERIFY-2's own standing
recommendation, one real inbound test call against a staging Retell agent
remains the cheapest way to remove all doubt before this goes live.

### VERIFY-3 — tool-call ("custom function") webhook envelope — **still open (webhook payload), one assumption corroborated**

**Assumed:** the default envelope nests the call under a `call` object
(`{call: {call_id, ...}, name, args}`). **RETELL-VERIFY**: same limitation
as VERIFY-2 — this is a webhook payload, not a typed SDK resource, so the
exact envelope (whether `call_id` sits at the top level, the nested
`call` object's exact fields) remains unconfirmed. One real corroboration
found: `LlmCreateParams.CustomTool.args_at_root`'s own doc comment ("If set
to true, the parameters will be passed as root level JSON object instead
of nested under 'args'") confirms the DEFAULT (unset) envelope nests
params under `args` — exactly this codebase's assumption — since this
compiler never sets `args_at_root: true`. This adapter still accepts a
top-level `call_id` OR a nested `call.call_id` defensively (whichever is
present).
**Confirm before go-live:** capture one real tool-call webhook delivery
against a staging agent with a `check_availability`-style custom function
and confirm (a) the exact envelope shape, (b) whether the caller's live
number is exposed under `call.from_number` (assumed in `tool-call.ts`'s
`extractCallerNumber`, used for the G6 `lookup_customer` authorization
cross-check) or a differently-named field.
**Code:** `packages/adapters/retell/src/raw-types.ts` (`zRetellToolCallWebhook`),
`packages/adapters/retell/src/tool-call.ts`.

**LIVE-MINE-EDGE update — RESOLVED.** The legacy production project's
`retell-tools` edge function (50 production redeploys, read-only via the
Supabase Management API) does exactly:
```js
const payload = await req.json();
const { args: parameters, name: function_name } = payload;
const call_id = payload.call?.call_id;
const from_number = payload.call?.from_number;
```
This confirms both open sub-questions directly, from code that processed
real production Retell tool-call traffic: (a) the envelope is
`{name, args, call: {call_id, from_number, to_number, ...}}` exactly as
assumed, and (b) the caller's live number is exposed under
`call.from_number` exactly as `extractCallerNumber` assumes. **VERIFY-3
is now RESOLVED** — no code change needed; this adapter already matches.
Full writeup: `docs/LEGACY_LIVE_FINDINGS.md` § Edge Functions
("VERIFY-3").

### VERIFY-4 — cost breakdown (`call_cost.product_costs[]`) — **RESOLVED (RETELL-VERIFY)**

**Confirmed:** `{product_costs: [{product, cost, unit_price?, is_transfer_leg_cost?}],
total_duration_seconds, total_duration_unit_price, combined_cost}` —
confirmed field-for-field against the official SDK's
`src/resources/call.ts` (`PhoneCallResponse.CallCost`/`CallCost.
ProductCost`). **The unit question is settled: CENTS**, confirmed verbatim
from the SDK's own doc comments ("Cost for the product in **cents** for
the duration of the call" / "Combined cost of all individual costs in
**cents**") — this codebase's existing assumption (integer USD cents, per
CLAUDE.md Rule 2's money invariant) was correct. `product` stays
deliberately `z.string()` (open, never a closed enum) — the SDK itself
also only types it as `string`, confirming there genuinely is no fixed
enum to encode (the SYSTEM_DESIGN §13 Week-0 ticket about this can be
closed as "confirmed open by design," not "needs a live account to
enumerate").
**No code change needed** for the unit itself; `raw-types.ts`'s doc
comments updated to cite the confirmed source.
**Code:** `packages/adapters/retell/src/raw-types.ts` (`zRetellCallCost`,
`zRetellProductCost`), `packages/adapters/retell/src/call-events.ts`
(`normalizeCostBreakdown`).

### VERIFY-5 — call lifecycle webhook envelope & `RetellCallObject` fields — **RESOLVED (RETELL-VERIFY)**

**Confirmed:** `{event: "call_started"|"call_ended"|"call_analyzed", call: {...}}`
— the event-name set AND the fact that these three are the DEFAULT
subscription (an agent with no explicit `webhook_events` override gets
exactly these) are both confirmed via `src/resources/agent.ts`'s
`AgentCreateParams.webhook_events` doc comment ("If not set, defaults to
call_started, call_ended, call_analyzed"). Every field this adapter reads
(`call_id`, `agent_id`, `from_number`, `to_number`, `start_timestamp`,
`end_timestamp`, `disconnection_reason`, `call_cost`) confirmed present,
same names, on `PhoneCallResponse` (`src/resources/call.ts`).
**The full `disconnection_reason` enum is now confirmed** (34 values,
verbatim from `PhoneCallResponse.disconnection_reason`) — the previous
9-value guessed list was WRONG in several places (`no_answer` doesn't
exist, the real value is `dial_no_answer`; a single generic `error` value
doesn't exist, the real values are a family of `error_*` variants;
`transfer_bridged`/`transfer_cancelled`/`manual_stopped`/`call_take_over`/
etc. were entirely missing). **Fixed**: both
`RETELL_DISCONNECTION_REASONS` (raw-types.ts) and canonical
`DISCONNECTION_REASONS` (`packages/canonical-types/src/voice-provider.ts`)
updated to the full confirmed list.
**Code:** `packages/adapters/retell/src/raw-types.ts` (`zRetellCallObject`,
`zRetellCallLifecycleWebhook`), `packages/adapters/retell/src/call-events.ts`.

### VERIFY-6 — agent lifecycle REST shapes (create/update-agent, create-conversation-flow, create-retell-llm, publish-agent-version) — **RESOLVED (RETELL-VERIFY) — 3 real mismatches found and FIXED**

**Confirmed via `src/resources/{agent,llm,conversation-flow}.ts`:**
- `response_engine: {type: "conversation-flow"|"retell-llm", ...}` — both
  discriminator string literals confirmed exactly.
- `agent_id`/`version` on `AgentResponse` (create AND update) — both
  REQUIRED response fields, confirmed.
- **`inbound_webhook_url` does NOT exist on the Agent resource at all** —
  confirmed absent from every Agent create/update/response interface. It
  is exclusively a PHONE-NUMBER field
  (`PhoneNumber{Create,Update,Import}Params`/`PhoneNumberResponse`,
  `src/resources/phone-number.ts`). **FIXED**: removed from
  `CreateOrUpdateAgentInput`/`agents.ts`'s agent-create body; moved to
  `ImportPhoneNumberInput`/`numbers.ts` (see VERIFY-7) and to the Deno
  `_shared/providers/retell.ts`'s `importPhoneNumber`; two new required env
  vars added (`RETELL_SIP_TRUNK_TERMINATION_URI`,
  `RETELL_INBOUND_WEBHOOK_URL`, documented in `.env.example`) since
  `api-provision/handler.ts` previously wired neither the required
  `termination_uri` nor this webhook URL into its import call at all.
- **`POST /publish-agent-version/{agent_id}` REQUIRES a
  `{version: number, version_description?, version_title?}` body — there
  is NO "publish whatever's latest draft" shorthand** — confirmed via
  `AgentPublishParams`. **AND it returns `void`** (no response body at
  all) — confirmed via `Agent.publish`'s own return type — NOT
  `{agent_id, version}` as this file previously assumed. Every real call
  under the old code would have 4xx'd (missing required field) and, even
  if it hadn't, thrown parsing a response body that doesn't exist.
  **FIXED**: `PublishAgentVersionInput` gained a required `version` field;
  `CreateOrUpdateAgentResult` (and the Deno create-agent response
  handling) now surfaces `version` so callers have it to publish with;
  `publishRetellAgentVersion` (agents.ts) sends `{version}` and no longer
  parses a response body; `api-provision/handler.ts` fetches the CURRENT
  version via a new `getAgent` (`GET /get-agent/{id}`) helper immediately
  before publishing (robust whether the agent was just created or already
  existed from an earlier saga run); `admin/handler.ts`'s template-publish
  flow reads `version` off its own just-made create-agent response.
**Code:** `packages/adapters/retell/src/raw-types.ts`
(`zRetellCreateOrUpdateAgentResponse`), `packages/adapters/retell/src/agents.ts`,
`packages/canonical-types/src/voice-provider.ts`,
`supabase/functions/_shared/providers/retell.ts`,
`supabase/functions/admin/handler.ts`,
`supabase/functions/api-provision/{handler,index}.ts`.

### VERIFY-7 — `POST /import-phone-number` — **RESOLVED (RETELL-VERIFY) — 2 real mismatches found and FIXED**

**Confirmed via `PhoneNumberImportParams` (`src/resources/phone-number.ts`):**
- `inbound_agents` IS an array of `{agent_id, weight, agent_version?}` —
  confirmed. **But `weight` is REQUIRED** ("total weights must add up to
  1"), not optional as previously assumed — a single-agent number still
  needs an explicit `weight: 1`. **FIXED** in `numbers.ts` and
  `_shared/providers/retell.ts`/`api-provision/handler.ts`.
- **`outbound_agent_id` (a bare string) does NOT exist** — the real field
  is `outbound_agents`, an ARRAY of the same `{agent_id, weight,
  agent_version?}` shape as `inbound_agents`. **FIXED** — `numbers.ts` now
  lowers `ImportPhoneNumberInput.outboundAgentId` (singular, this
  product's own canonical shape) to a one-element `outbound_agents` array.
- `termination_uri` (REQUIRED, no `?`), `sip_trunk_auth_username`/
  `sip_trunk_auth_password`, and `inbound_webhook_url` (see VERIFY-6) all
  confirmed exact.
- Response (`PhoneNumberResponse`): **there is no `phone_number_id`
  field** — the number's own `phone_number` (E.164) IS its unique
  identifier ("used as the unique identifier for phone number APIs," per
  the SDK's own doc comment). `zRetellImportPhoneNumberResponse`
  (`{phone_number, phone_number_pretty?}`) already matched this — but
  `api-provision/handler.ts`'s Deno-side call read a `phone_number_id`
  field that never existed, so `phone_numbers.retell_number_id` was
  ALWAYS written as `null` in production. **FIXED**.
**Code:** `packages/adapters/retell/src/raw-types.ts`
(`zRetellImportPhoneNumberResponse`), `packages/adapters/retell/src/numbers.ts`,
`supabase/functions/_shared/providers/retell.ts`,
`supabase/functions/api-provision/handler.ts`.

### VERIFY-8 — Conversation Flow / Retell LLM node & edge wire schema — **RESOLVED (RETELL-VERIFY) — the single highest-risk item; 4 real mismatches found and FIXED, 1 genuine architecture gap flagged (not fixed, see below)**

**Confirmed field-for-field against `src/resources/{conversation-flow,
llm}.ts`** (Stainless-generated from Retell's real OpenAPI spec):

- **CORRECT as originally built, no change**: `ConversationNode = {id,
  type:"conversation", name, instruction: {type:"prompt", text}, edges}`;
  `Edge = {id, destination_node_id, transition_condition: {type:"prompt",
  prompt} | equation}`; Retell LLM `State = {name, state_prompt?, edges:
  [{destination_state_name, description}], tools: [full tool defs]}`
  (states DO carry full tool objects per state, unlike conversation-flow);
  the `custom` function tool's `{name, type:"custom", url, description?}`
  fields; `general_prompt`/`starting_state` (multi_prompt) and
  `general_prompt`/`general_tools` (single_prompt) flat top-level fields.
- **WRONG #1 — `model_choice` object required for conversation_flow,
  NOT a flat `model` string.** `ConversationFlowCreateParams.model_choice:
  {model, type:"cascading", high_priority?}` is REQUIRED — confirmed via
  the SDK. Retell LLM (`LlmCreateParams.model`) keeps a flat, OPTIONAL
  `model` string — the two are NOT wire-compatible. **FIXED**: `agents.ts`
  (Node) and `admin/handler.ts` (Deno) now branch on `compile_target`
  when attaching the model immediately before the REST call.
- **WRONG #2 — `start_speaker: "user"|"agent"` is REQUIRED on
  `ConversationFlowCreateParams`** (optional on Retell LLM) — a gap this
  task's own new type-level SDK contract test caught directly (see below).
  **FIXED**: the compiler now always emits `start_speaker: "agent"` (every
  template opens with the agent's own greeting/disclosure line, never a
  user-speaks-first flow).
- **WRONG #3 — `global_node: true` (a bare boolean) is not a real field.**
  The real field is `global_node_setting: {condition: string, cool_down?,
  go_back_conditions?, ...}` — an OBJECT, with `condition` REQUIRED
  ("cannot be empty") — confirmed via
  `ConversationFlowCreateParams.ConversationNode.GlobalNodeSetting`.
  **FIXED** in both `packages/adapters/retell/src/compiler/
  conversation-flow.ts` and its Deno duplicate
  (`supabase/functions/_shared/compiler/template-compiler.ts`); `condition`
  is populated from the same `global_intent.description` text already
  used for the scoped (non-"any") edge case.
- **WRONG #4 — `tool_ids` is NOT a field on a plain `ConversationNode` at
  all.** Confirmed absent from every property Retell documents on it — it
  exists ONLY on `SubagentNode`, a node type this compiler doesn't emit.
  **FIXED**: removed from `RetellConversationNode`/both compiler
  implementations. **Genuine architecture gap flagged, NOT redesigned
  (CLAUDE.md Rule 4)**: there is no hard per-node tool-restriction
  mechanism for a flat conversation-flow graph — every node effectively
  has access to every tool the flow's top-level `tools[]` declares;
  per-state steering is soft/prompt-only (the node's own `instruction.text`
  telling the model which tools make sense there). This conflicts with
  SYSTEM_DESIGN §4.1's stated goal ("hard slot-filling... tool-backed
  nodes only... model cannot invent") for this compile target specifically.
  A real hard restriction would require adopting `SubagentNode` — a
  materially different graph shape, out of scope for a verify-and-fix
  pass; logged in `docs/BUILD_NOTES.md`'s RETELL-VERIFY entry as a
  follow-up for whoever next revisits the conversation-flow compiler.
- **WRONG #5 (minor) — custom-tool `parameters.properties` is REQUIRED**
  whenever `parameters` is present at all (confirmed via
  `LlmCreateParams.CustomTool.Parameters`), even though this codebase's
  broader canonical `JsonSchemaObject` (used for template-authoring)
  allows omitting it. **FIXED**: all three compiler files now default an
  omitted `properties` to `{}` when lowering a canonical tool.

**Type-level contract test added** (`packages/adapters/retell/src/
sdk-contract.test.ts`, `retell-sdk` as a devDependency of this package
ONLY) — imports the SDK's own types and statically asserts this package's
compiler output is assignable to them; this is what caught #2
(`start_speaker`) directly and will keep catching a future SDK field
rename at `tsc` time.

**Code:** `packages/adapters/retell/src/compiler/types.ts`,
`conversation-flow.ts`, `multi-prompt.ts`, `single-prompt.ts`,
`sdk-contract.test.ts`; `supabase/functions/_shared/compiler/
template-compiler.ts`.

## Still open from the specs themselves (not re-litigated here)

`docs/spec/API_AND_FLOWS.md` A.1 already flags, independently of the above:
Retell's per-endpoint rate limits and per-workspace agent ceiling; the
webhook egress region (latency budget depends on co-locating edge functions
with it); SIP trunk credential rotation/expiry semantics; batch-simulation
testing's exact request/response schema. These are T3/T4/T6 concerns at the
point they're wired up, not re-duplicated here.

## T3 — voice hot path, webhooks, admin, workers, jobs (supabase/functions/)

This build had **all outbound egress to vendor documentation sites
blocked** by this environment's network policy (`WebFetch` returned
`EGRESS_BLOCKED` for `docs.retellai.com`, `supabase.com`, `docs.stripe.com`,
`www.twilio.com`). `WebSearch` (server-side, not subject to the same
block) was used instead to fetch third-party summaries where possible —
noted per item below. Every item below has a Zod validator or a hand-rolled
verifier at its boundary (never an un-typed `any` pass-through), and a code
comment at its call site duplicating this entry so it's found in context,
not only here. Code lives under `supabase/functions/` (Deno Edge
Functions) — a separate runtime from T2's `packages/adapters/retell`
(Node) above, so some items below (e.g. Retell's webhook signature scheme)
are independently re-derived here rather than reusing T2's code, since
Deno can't import that Node package without a bundling step neither task
adds (see `docs/BUILD_NOTES.md`'s T3 entry for the full rationale).

## Retell

RETELL-VERIFY re-checked every row below against the OFFICIAL `retell-sdk`
npm package (v5.64.0, published from `RetellAI/retell-typescript-sdk`,
reachable via `raw.githubusercontent.com` even though `docs.retellai.com`
itself stayed egress-blocked) — see the T2 `VERIFY-1..8` entries above for
the full resolution detail; this table is kept for T3's own
independently-re-derived Deno-side items.

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| Webhook signature scheme | `X-Retell-Signature: v=<unix_ms>,d=<hex HMAC-SHA256>`; digest = HMAC-SHA256(secret=API key, message=rawBody+timestamp, direct concatenation) | **RESOLVED** — confirmed byte-for-byte against the official `retell-sdk`'s own `src/lib/webhook_auth.ts` (`symmetric.verify`/`sign`). No code change needed (`_shared/retell-signature.ts` already matched). | — (resolved) |
| `/voice-inbound`, `/voice-tools`, `/voice-events` request shapes | Canonical shapes per BACKEND_SPEC §7.1-7.3 (call_id/from_number/to_number/agent_id; call_id/name/args; event+call object) | Medium (partially resolved) — the `call_started`/`call_ended`/`call_analyzed` envelope and every `RetellCallObject` field this codebase reads are confirmed via the SDK's `PhoneCallResponse`/`AgentCreateParams.webhook_events` (see VERIFY-5, resolved); the inbound-call and tool-call webhook ENVELOPES themselves remain unconfirmed — genuinely outside either SDK's typed surface (see VERIFY-2/VERIFY-3) | A live sandbox call for the two still-open envelopes specifically |
| `call.call_analysis.custom_analysis_data` carrying `classification`/`outcome`/`follow_up_needed`/`legal_advice_given`/`emergency_detected` keys | Assumed the compiled template's per-state `extraction[]` fields land here under these literal names | Low — invented mapping, not sourced; the SDK confirms `custom_analysis_data?: unknown` exists but says nothing about its literal key names (those come from the agent's OWN configured post-call-analysis schema, which is a business config the SDK naturally can't type) | Confirm against T2's actual Retell compiler output + a live sandbox call |
| `GET /v2/get-call/{id}`, `POST /create-agent`, `POST /publish-agent-version/{id}`, `POST /import-phone-number`, `POST /v2/create-web-call` REST paths | `api.retellai.com`, bearer auth | **RESOLVED** — every path confirmed exactly against the SDK's own resource files (`call.retrieve`, `agent.create`, `agent.publish`, `phoneNumber.import`, `call.createWebCall`) | — (resolved) |
| `transfer_call` warm-transfer context-summary mechanism | Not implemented in this build (native Retell function, configured at template-compile time — T2's compiler) | N/A | Retell's transfer-call/handoff-summary docs before T2's compiler wires it |
| Health-check probe (`job-retell-health-failover`) | Was `GET /list-agents?limit=1` | **RESOLVED, and WRONG as built** — confirmed via `Agent.list` (`src/resources/agent.ts`) that the real call is `POST /v2/list-agents?limit=1` (a POST, at `/v2/...`, not a GET to a bare `/list-agents`). The old call would 404/405 against the real API, making every health check register Retell as perpetually down. **FIXED** in `job-retell-health-failover/handler.ts`. | — (resolved) |
| Failover mechanism (flipping a Twilio number away from Retell) | Assumes `IncomingPhoneNumbers.VoiceUrl` update is sufficient | Low — still unconfirmed; the SDK is Retell's own API surface and says nothing about how a Twilio-owned, Retell-imported number's failover-away behavior should work on the Twilio side | Twilio SIP trunking docs / a live sandbox test |

## Twilio

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| `X-Twilio-Signature` algorithm | Full URL + sorted-concatenated POST params, HMAC-SHA1 with the account's primary Auth Token, base64 | High — long-stable, widely-documented `RequestValidator` scheme, confirmed via WebSearch against multiple independent sources | `twilio.com/docs/usage/webhooks/webhooks-security` |
| REST API paths (`Messages.json`, `IncomingPhoneNumbers.json`) | `api.twilio.com/2010-04-01` | High — long-stable Twilio REST API | Twilio REST API reference |
| Advanced Opt-Out keyword list (STOP/START/HELP) | CTIA/carrier-standard set (`stop,stopall,unsubscribe,cancel,end,quit` / `start,yes,unstop` / `help,info`) | Medium — matches Twilio's documented default list from training knowledge | Twilio's Advanced Opt-Out Features docs |

## Stripe

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| Webhook signature scheme | `Stripe-Signature: t=<unix_s>,v1=<hex HMAC-SHA256>[,v1=...]`; signed payload = `${t}.${rawBody}`; 300s default tolerance | High — long-stable, versioned-stable public contract | `docs.stripe.com/webhooks/signatures` |
| `STRIPE_API_VERSION` pin (`2025-08-27.basil`) | Placeholder — not confirmed live | Low | Stripe API changelog for the current pinned version at deploy time |
| Checkout Session / Billing Meter Event / balance_transaction field names | Standard v1 REST shapes, form-encoded with bracket nesting | Medium | Stripe API reference |

## Supabase platform mechanics

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| `EdgeRuntime.waitUntil` background-task pattern | `EdgeRuntime.waitUntil(promise)`; free-plan 150s / paid-plan 400s duration cap | High — confirmed via WebSearch against `supabase.com/docs/guides/functions/background-tasks` and Supabase's own blog post | Re-confirm the current cap before relying on long-running background work |
| pgmq function signatures (`pgmq.send`/`read`/`pop`/`delete`/`archive`) | `pgmq.send(queue_name text, msg jsonb, delay int default 0)`; `pgmq.read(queue_name text, vt int, qty int)` (3-arg historical form — WebSearch surfaced a reported 4-arg `jsonb`-filter variant in some pgmq versions) | Medium — core send/pop signatures confirmed stable via WebSearch (pgmq GitHub/PGXN docs); `read`'s exact current arity for the pgmq version Supabase ships is NOT confirmed | `supabase.com/docs/guides/queues/pgmq`, pgmq's own CHANGELOG for the version Supabase pins |
| Supabase connection-pooler mode for Edge Functions (session vs transaction) | Assumed session-mode pooler (prepared statements persist) | Low — not verified live | Supabase connection docs |
| Storage REST API upload path (`POST /storage/v1/object/{bucket}/{path}`) | Standard Supabase Storage REST shape | Medium | Supabase Storage API reference |

## Square (webhooks-pos)

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| Webhook signature scheme | HMAC-SHA256(notificationUrl + rawBody), base64 | Low — explicitly carried forward from the legacy repo's Clover/Square salvage note per BACKEND_SPEC §7.6's own instruction ("re-verify... only the shape is carried forward as a starting hypothesis") | Square's current webhook signature docs |
| Notification envelope (`type`, `data.id`) | Assumed `order.*`/`booking.*`/`oauth.authorization.revoked` event-type prefixes | Low | Square Webhooks API reference |

## PayPal

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| OAuth2 client-credentials + Payouts API | `POST /v1/oauth2/token`, `POST /v1/payments/payouts` | Medium — long-stable REST v1 API | PayPal Payouts API reference; confirm sandbox vs live base URL selection |

## Anthropic

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| Messages API envelope + `anthropic-version` header | `api.anthropic.com/v1/messages`, `2023-06-01` | High — stable, documented contract | `docs.anthropic.com` for current model id defaults |
| Message Batches API (T8) | `POST /v1/messages/batches` (`{requests: [{custom_id, params}]}`), `GET /v1/messages/batches/{id}` (`processing_status`, `results_url`), results as JSONL at `results_url` (`{custom_id, result: {type, message?}}`) | High — this is the stable, documented Messages Batches contract per the `claude-api` skill's own reference table, not a guess | `docs.anthropic.com`/the `claude-api` skill's `{lang}/claude-api/batches.md` before a live run |
| Model ids: `claude-haiku-4-5` (research/classification), `claude-sonnet-5` (personalization writes) | Per this build's own explicit task instruction (not independently re-derived) | High — the instruction, not a search result, is the source here | Re-confirm current model ids/pricing against the `claude-api` skill or `docs.anthropic.com` before go-live, since these drift over time |

## Resend

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| `POST /emails` | `api.resend.com/emails`, bearer auth | Medium | Resend API reference |

## Schema/coordination items (not a vendor API — cross-checked against T1's actual migrations, not just BACKEND_SPEC's prose)

T1's migrations landed concurrently with this build; every item below was
re-checked against the real `supabase/migrations/*.sql` files (not just
BACKEND_SPEC/MASTER_SPEC's prose) once they existed, and code was corrected
to match wherever it had guessed a different column/table name. Confirmed
matches (no fix needed): `webhook_events`, `payment_links`, `cost_events`,
`usage_events`, `billing_invoices`, `admin_actions`, `tenants` (incl.
`a2p_status`, `review_url`, `owner_test_phone`, `manual_mode`,
`usage_hard_cap_minutes`), `phone_numbers`, `call_logs`, `agent_configs`,
`bookings.identity_verified_by`, `alerts`, `provisioning_runs` (status enum
is `succeeded`, not `done` — code originally used the wrong value, fixed),
`customers.consent`/`sms_opt_out` (top-level columns, not nested in
`metadata` — code originally wrote/read consent under `metadata.consent`,
fixed to use the real `consent` column directly).

Corrected mismatches (found once T1's migrations existed, fixed in this
build):
- `messages_inbound` real columns are `from_e164`/`to_e164`/
  `twilio_message_sid`/`phone_number_id`/`customer_id`/`classification`
  (enum `stop`|`help`|`other`) — webhooks-twilio-sms/handler.ts originally
  used invented `from_number`/`to_number`/`provider_message_id` names, fixed.
- `tenants.review_request_enabled` (no trailing "s" on "request") —
  job-review-request/handler.ts originally guessed `review_requests_enabled`.
- `demo_sessions` has no `status` enum or separate `hours_detected`/
  `services_detected` columns — it's `scraped_summary jsonb` (+ `sanitized`
  boolean, `agent_config_snapshot` jsonb, `retell_call_token`,
  `demo_phone_e164`). api-demo-agent/handler.ts originally assumed the
  BACKEND_SPEC-prose column shape; rewritten to derive "pending review" vs.
  "confirmed" from whether `retell_call_token` is set, matching T1's actual
  design.

Still-genuine gaps (no matching table/column exists anywhere in T1's
migrations as of this build):
- ~~`tool_health` table~~ — **resolved by T4**:
  `supabase/migrations/20260907140000_t4_tool_health_a2p_billing.sql` adds
  it, with `call_id text` (not `uuid` as originally guessed here — Retell's
  own call-id string, may not resolve to a `call_logs` row yet at insert
  time). `tool-stats.ts`'s emission and `job-alert-evaluation`'s
  `evaluateToolFailureSpike` now have a real table to read/write.
- No dedicated tenant-geocode column exists anywhere (only
  `customer_addresses.geocode` for the CUSTOMER side, which create_order.ts
  now reads for real). `agent_configs.dynamic_variable_overrides.
  tenant_geocode` (create_order.ts's own placement for the business's own
  location) is this build's reasonable-but-unconfirmed choice — MASTER_SPEC
  §3.0 only says "precompute tenant geocode at settings-save" without
  pinning where. `delivery_radius_m`/`min_order_cents` in that same jsonb
  bag ARE confirmed (T1's `20260907130300_agent_templates.sql` comment
  lists them explicitly); `tax_rate_bps` is this build's own addition, not
  named by either spec.

## T4 — api-checkout, admin cockpit/config-lab/referrals/cac/templates,
## job-referral-payouts, api-a2p-register, dunning, waitlist YES (supabase/functions/, scripts/)

This task's assignment described Stripe/Twilio/PayPal docs as "reachable" —
in this build environment they were NOT (`WebFetch` returned
`EGRESS_BLOCKED` for `docs.stripe.com`/`www.twilio.com`/
`developer.paypal.com`, identically to T2/T3's experience). `WebSearch`
(server-side, not blocked) was used instead per CLAUDE.md Rule 1 item 2 —
every shape below traces to an indexed search result, never memory alone.

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| Stripe Billing Meter create (`POST /v1/billing/meters`) | `event_name`, `customer_mapping: {type: "by_id", event_payload_key}`, `value_settings: {event_payload_key}`, `display_name` | Medium — object/field NAMES confirmed via indexed search of Stripe's own API reference pages (`docs.stripe.com/api/billing/meter`); the exact create-endpoint parameter list (vs. just the resulting object shape) was not independently re-confirmed | Stripe API reference, `billing/meter/create` |
| Metered Price backed by a Meter (`recurring.meter`, `recurring.usage_type`) | `billing_scheme: "per_unit"`, `recurring: {interval, meter: <meter_id>, usage_type: "metered"}` | Medium — "every metered price now requires a backing Meter" confirmed via search; exact field name (`recurring.meter` vs. a differently-nested field) not independently re-confirmed against a live create-price call | Stripe API reference, Prices API |
| `scripts/setup-stripe.ts`'s idempotency check (list meters by `event_name`, list nothing for prices — creates a fresh Product/Price every run once the price-card row lacks ids) | Own design choice, not vendor-specified | N/A (design decision) | — |
| Twilio A2P Brand/Campaign base host | `messaging.twilio.com/v1/a2p/BrandRegistrations` (NOT `api.twilio.com/v1/a10dlc/...`, which is what BACKEND_SPEC's own prose guessed and this build corrects) | Medium-high — confirmed via multiple indexed Twilio doc-page titles referencing this exact host+path | `twilio.com/docs/messaging/api/brand-registration-resource` |
| Twilio Campaign (UsAppToPerson) create | `POST /v1/Services/{MessagingServiceSid}/Compliance/Usa2p`, fields `BrandRegistrationSid`, `Description`, `MessageFlow`, `UsAppToPersonUsecase`, `HasEmbeddedLinks`, `HasEmbeddedPhone`, plus `PrivacyPolicyUrl`/`TermsAndConditionsUrl` (confirmed via search to be REQUIRED as of a documented 2026-06-30 Twilio change — today's date, 2026-09-07, is after that cutover, so this build includes them unconditionally rather than treating them as optional) | Medium | `twilio.com/docs/messaging/api/usapptoperson-resource`, the 2026-06-30 campaign-registration changelog entry |
| `CustomerProfileBundleSid`/`A2PProfileBundleSid` (Brand create inputs) | Assumed to be pre-created Trust Hub profile bundles from a manual Week-0 Console setup step, not created by any code in this build | Low — not independently confirmed; `api-a2p-register/handler.ts` doesn't create a Brand at all (only Campaigns against an existing `TWILIO_A2P_BRAND_SID` env var), so this only matters for whoever does the one-time platform brand setup | Twilio's ISV onboarding walkthrough |
| Supabase Auth Admin `generate_link` (`POST /auth/v1/admin/generate_link`) response field (`action_link` vs `properties.action_link`) | `_shared/providers/supabase-admin.ts` checks both shapes defensively | Low — genuinely unconfirmed in this build (egress-blocked); GoTrue's admin API surface has changed field nesting across versions before | Supabase Auth (GoTrue) admin API reference |
| Retell `/publish-agent-version/{id}` endpoint name | Corrected from T3's `_shared/providers/retell.ts` guess of `/publish-agent/{id}` to match T2's independently-researched `packages/adapters/retell/src/agents.ts` (`publishRetellAgentVersion`) | **RESOLVED** — endpoint name confirmed exactly via the official `retell-sdk`'s `Agent.publish` (`src/resources/agent.ts`); RETELL-VERIFY additionally found (and fixed) that the call also needs a `{version}` request body and returns no response body at all — see VERIFY-6 (resolved) in the T2 section above | — (resolved) |
| `_shared/compiler/template-compiler.ts` | Deliberate duplication of `packages/adapters/retell/src/compiler/*`'s pure lowering logic (conversation_flow/multi_prompt/single_prompt + disclosure gate), ported because Deno can't import a Node pnpm workspace package — same rationale as every `_shared/providers/*.ts` module. NOT a vendor-API confidence question but a maintenance-debt flag: the two implementations can drift. Follow-up: extract the compiler's pure logic into a zero-runtime-dependency package both Node and Deno can import (an `npm:`-publishable build, or a bundled single-file artifact), then delete this duplicate. | N/A (internal design debt, not external-API risk) | — |
| Admin `/admin-templates/:id/publish`'s scope | Publishes/validates a TEMPLATE version (creates a smoke-test Retell agent tagged `heyloo-template-<id>-v<version>`, flips `agent_templates.is_active`) — does NOT fan out to re-publish every tenant already on an older version of that template. BACKEND_SPEC's Flow 9 ("Template update → simulation CI → staged publish to tenants") describes that fan-out as a separate concern; this build treats per-tenant re-publish as a follow-up (would need a rollout-strategy decision — all at once vs. staged/canary — not specified) | N/A (scope decision) | Confirm against FRONTEND_SPEC/whoever builds the Templates admin UI what "publish" should visibly do for already-provisioned tenants |
| `job-referral-payouts` — no `/webhooks-paypal` consumer exists yet | This job's success means "PayPal accepted the batch," not "every partner was paid" — item-level `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`/`FAILED`/`BLOCKED`/`UNCLAIMED` webhooks (API_AND_FLOWS.md A.4) aren't consumed anywhere, so `referral_payouts.status` stays `'sent'` forever rather than transitioning to a final `paid`/`failed` state | N/A (scope gap, follow-up) | — |
| `webhooks-twilio-sms`'s "yes"/"start" keyword conflict | `sms-compliance.ts`'s `START_KEYWORDS` already includes "yes" (CTIA opt-in vocabulary, built by T3) — MASTER_SPEC §3.4's waitlist flow independently specs "reply YES" for a completely different purpose (auto-booking a freed slot). Resolved in `handler.ts`: a bare "yes"/"y" is checked against an open waitlist notification FIRST; only when there's no match does it fall through to the ordinary START/opt-in behavior. Documented here as a genuine spec-vs-spec conflict found during integration, not a bug in either individual spec. | N/A (found conflict, resolved) | — |

## T5 — apps/web, packages/ui, packages/supabase-client, packages/config (Wave 2)

This build environment could not reach live Supabase/Stripe/Retell/PostHog/
Sentry endpoints (`.env.local` uses placeholder hosts — `https://
placeholder.supabase.co` hangs on connect rather than failing fast, so
anything server-side that depends on it, e.g. `/signup/plan`'s price-card
fetch, could not be exercised end-to-end in this session either). Every
client-shape item below was built directly from BACKEND_SPEC.md §7's
documented request/response JSON, not memory of the vendor's own docs —
confirm the two named ASSUMED edge function names before this code path is
exercised against a real deploy.

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| `api-checkout-session` edge function name | `apps/web`'s `/api/checkout/session` Route Handler calls `callEdgeFunction("api-checkout-session", ...)` — BACKEND_SPEC §7 documents the request/response contract for a checkout-session endpoint but this build did not find a task that had actually created a function under this exact name at the time T5 ran | Medium — the JSON contract (body shape, `{url}` response) is real spec text; only the function's deployed NAME is unconfirmed | `supabase/functions/` directory listing once T4/whichever task owns Stripe checkout has actually deployed it — if the name differs, it's a one-line fix in `apps/web/src/app/api/checkout/session/route.ts` |
| `api-billing-portal` edge function name | Same situation as above, for `apps/web`'s `/api/billing/portal` Route Handler | Medium (same reasoning) | Same — `supabase/functions/` listing |
| `tenants.status` enum values | Confirmed against T1's actual migration (`trialing|active|past_due|paused|canceled`), NOT the illustrative `pending_payment/provisioning/suspended` prose in FRONTEND_SPEC.md's redirect-matrix section — see BUILD_NOTES.md T5 entry | High — read directly from T1's migration SQL, not inferred | — (already reconciled, not open) |
| Vertical enum spelling (DB vs. canonical `Vertical` type) | `auto_repair`/`veterinary`/etc. (DB) vs. `auto`/`vet`/etc. (T2's `Vertical` type) — mapped explicitly in `packages/supabase-client/src/vertical-mapping.ts` rather than assumed to match | High — both sides read directly from their respective source files, not inferred | — (already reconciled, not open) |
| `leads.source` enum value used by the admin outreach leads filter, and `referral_partners` FTC-disclosure columns referenced by `/api/partner/disclosure` | Neither was found in T1's actual migrations at the time T5 ran; both surfaces were built against the closest existing column/shape rather than inventing a migration (out of this task's exclusive paths) | Low — a genuine schema gap, not a confidence-in-a-guess question | Whoever owns `supabase/migrations` next: add the missing enum value/columns, or confirm the UI should instead read something already-named differently |
| `customer_notes` / phone port-in tables | No dedicated table exists for either; `/api/tenant/customers/:id/notes` and `/api/phone/port-in` Route Handlers are built against the closest existing table each maps to (documented inline in each handler) | Low-medium | Same as above — confirm the mapping is the intended one, or add dedicated tables |
| `packages/supabase-client/src/database.types.ts` | Hand-maintained against the ~35 tables this task's surfaces actually query — NOT a full `supabase gen types typescript` mirror of T1's complete schema. A column this build doesn't query could drift without this file noticing. | N/A (maintenance-debt flag, not a vendor-API guess) | Regenerate via the Supabase CLI against a live project and diff, once one exists; wire that into CI |
| PostHog/Sentry DSN and project host values | `.env.example`/`.env.local` document the variable NAMES (`NEXT_PUBLIC_POSTHOG_KEY`/`HOST`, `NEXT_PUBLIC_SENTRY_DSN`) per FRONTEND_STACK.md; no real project was provisioned in this build environment to obtain real values | N/A (infra provisioning, not a code-shape question) | Whoever provisions the actual PostHog/Sentry projects for this deploy |

## T8 — Outreach engine: lead fetch, Claude personalization, Smartlead
## send, reply classification, admin outreach panel (supabase/functions/,
## Wave 3)

This task's own instruction text asserted `docs.apollo.io`, Outscraper,
Smartlead, and Anthropic docs are "reachable" in this environment. Directly
tested and found otherwise: `WebFetch` returned `EGRESS_BLOCKED` for
`docs.apollo.io` and `getaddrinfo ENOTFOUND` for `docs.smartlead.ai` — the
same experience every prior task (T2/T3/T4/T5) already logged for their own
assigned vendor docs. `WebSearch` (server-side, not blocked) was used
instead per CLAUDE.md Rule 1 item 2; every row below traces to an indexed
summary of that vendor's own current API reference pages, not memory.

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| Apollo People Search | `POST api.apollo.io/api/v1/mixed_people/api_search` (NOT `/mixed_people/search`, which 403s on non-enterprise plans per the indexed summary), `x-api-key` header, credit-free, no email/phone returned | Medium-high — endpoint path and the api_search-vs-search distinction both independently confirmed via multiple indexed doc-page summaries | `docs.apollo.io/reference/people-api-search` |
| Apollo Organization Search / Bulk Enrichment | `POST /api/v1/mixed_companies/search`; `GET /api/v1/organizations/enrich` (single); `POST /api/v1/organizations/bulk_enrich` (up to 10 companies, `details: [{domain}]`) | Medium — paths confirmed via indexed summaries; the exact bulk_enrich request body shape (`details` array vs. `domains[]` query param — this build uses `details`) is the lower-confidence part | `docs.apollo.io/reference/bulk-organization-enrichment` |
| Apollo credit-to-dollar conversion (People Search credit-free; org enrichment credit-metered) | Not converted to a dollar figure anywhere in this build's code — API_AND_FLOWS.md A.5 itself says this needs the account's actual plan rate, so `api-outreach-fetch-leads` merges enrichment facts onto a lead without writing any `pipeline_costs`/`cac_events` row for it | N/A (deliberately not guessed) | Whoever owns the CAC dashboard's real-dollar accuracy next: confirm the live account's credit pricing and wire a real cost write |
| Outscraper Google Maps Search | `GET api.app.outscraper.com/maps/search-v3?query=...&limit=...&async=true`, `X-API-KEY` header, async response `{id, results_location}`, poll `results_location` for `{status, data: [[...]]}` | Medium — auth header and the async/`results_location` poll pattern confirmed high-confidence via multiple indexed summaries (incl. Outscraper's own webhook-signature-verification doc, which independently corroborates the async-request shape); the exact query-string parameter names (`query`/`limit`/`async`) are the part not independently re-confirmed against a live call | `docs.outscraper.com`, `/maps/search-v3` reference |
| Outscraper cost estimate (~$3/1,000 records) | Used verbatim from API_AND_FLOWS.md A.5's own already-researched figure (`OUTSCRAPER_COST_CENTS_PER_1000_RECORDS = 300`) — not independently re-derived here | Medium — inherited from a prior Rule-1 pass, re-stated not re-verified | Outscraper's current pricing page, before relying on this for a real invoice reconciliation |
| Smartlead base URL + auth | `server.smartlead.ai/api/v1`, `?api_key=...` query param auth (not a header) | High — consistently confirmed across every indexed Smartlead API-reference page found | `api.smartlead.ai` current reference |
| Smartlead campaign create/status/leads-add | `POST /campaigns/create` (`{name}` -> `{id}`/`{campaign:{id}}`, defensively read both); `POST /campaigns/{id}/leads` (`{lead_list: [...]}`, up to 400/call, response `{added_count, skipped_count}`); `PATCH /campaigns/{id}/status` (`{status: "START"\|"PAUSED"\|"STOPPED"}`) | Medium-high — every endpoint path and the START/PAUSED/STOPPED enum independently confirmed via indexed API-reference page titles | `api.smartlead.ai/api-reference/campaigns/*` |
| Smartlead webhook create | `POST /webhook/create` (`{name, webhook_url, association_type: "campaign", email_campaign_id, event_type_map}`) | Medium — shape confirmed via an indexed example payload from Smartlead's own webhook-integration guide | `helpcenter.smartlead.ai`'s webhook-integration article, `api.smartlead.ai/api-reference/webhooks/events` |
| Smartlead webhook payload field names (`event_type`, `campaign_id`, `to_email`, `message_id`) | High confidence for these four (confirmed via an indexed real example payload for `EMAIL_SENT`) | High for the four named fields | Same as above |
| Smartlead `EMAIL_REPLY` reply-body field name | UNCONFIRMED — this build's `webhooks-outreach/index.ts` tries `reply_message`/`reply_body`/`email_body`/`message` in priority order, since no indexed source gave the exact key name for this specific event's body field | Low — a genuine guess-with-fallbacks, not a confirmed shape | `api.smartlead.ai/api-reference/webhooks/events`, or a real test webhook delivery to a logging endpoint before go-live |
| Smartlead spam-complaint event | **Does not appear to exist** in Smartlead's documented event catalog (`EMAIL_SENT/OPEN/LINK_CLICK/REPLY/BOUNCE`, `LEAD_UNSUBSCRIBED`, `LEAD_CATEGORY_UPDATED` — no distinct complaint/spam-report event found across any indexed source) | Low-medium confidence that this is a genuine product gap, not just an indexing miss | Confirm directly with Smartlead support/account docs before relying on the CAN-SPAM 0.3% auto-pause rule to ever fire from a live webhook — until then, `POST /admin-outreach/replies/:id/actions {action:"suppress"}` (manual) or a bounce-rate proxy is the practical path; the auto-pause CODE PATH itself is fully implemented and unit-tested, only the live trigger is in question |
| Smartlead sequence-step/email-template authoring | Not called anywhere in this build — `admin-outreach`'s campaign-create makes an empty draft campaign at Smartlead; `custom_fields.opening_line`/`can_spam_footer` are assumed to ride into whatever sequence-step template an operator authors directly in the Smartlead dashboard via that platform's own merge-field syntax | Low — a real, disclosed assumption, not verified against a live sequence | Confirm Smartlead's merge-field syntax for `custom_fields` and that an operator has actually authored a sequence referencing `{{opening_line}}` before the first real send |
| `messages_outbound.tenant_id NOT NULL` vs. a pre-tenant lead | Genuine schema constraint (T1) — this build's "mark interested" reply action sends via a **direct Resend call** (`AdminDeps.resend`), never through `messages_outbound`/`worker-messages-outbound`, since a lead has no tenant to satisfy that column | High — read directly from T1's migration, not inferred | — (already reconciled, not open) |

## Anthropic (T8 additions — see also the earlier `## Anthropic` section above for T3's original entry)

Already folded into the `## Anthropic` table above (Message Batches API row
+ the model-id row) rather than duplicated here — listed in this section
header only so a reader searching "T8" finds the pointer.

## T9 — Ops hardening (Sentry wiring, `supabase/functions/_shared/sentry.ts`)

`develop.sentry.dev` (Sentry's own SDK/protocol documentation) returned
`EGRESS_BLOCKED` to `WebFetch` in this build, matching every prior task's
identical experience with vendor doc sites. `WebSearch` (server-side, not
blocked) surfaced indexed summaries of Sentry's own publicly-documented
Envelope protocol and DSN format, corroborated across multiple independent
sources (Sentry's own developer-docs page titles, third-party
fetch-based-reporter implementations for edge-adjacent runtimes like
Cloudflare Workers, which face the identical "no full SDK" constraint this
codebase does) — no first-party fetch, per CLAUDE.md Rule 1 item 2.

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| DSN format | `https://<public_key>@<host>/<path_prefix>/<project_id>` — a standard-library-parseable URL (`new URL(dsn)`, username = public key, last path segment = project id, any remaining path = a self-hosted subpath prefix) | High — DSN's URL-shaped format is long-stable and independently confirmed across every SDK's own source/docs | Sentry project Settings → Client Keys (DSN), for a real DSN's exact shape |
| Envelope endpoint | `POST https://<host><path_prefix>/api/<project_id>/envelope/` | High — consistently named across Sentry's developer docs and third-party summaries | `develop.sentry.dev`'s envelope/transport reference, once reachable |
| Envelope wire format | Three newline-delimited JSON lines: envelope header (`{event_id, sent_at, dsn}`), item header (`{type: "event", content_type: "application/json"}`), event payload (`{event_id, timestamp, platform, level, logger, message: {formatted}, environment, release, tags, extra}`) | Medium-high — the three-line structure and header field names are independently confirmed via multiple indexed summaries of Sentry's own envelope spec; the exact permitted/expected key set on the innermost event payload (beyond what this build actually sends) was not exhaustively enumerated from a first-party source | Send one real event (see `docs/OPS_RUNBOOK.md` §2's verification step) and confirm it renders correctly in the Sentry Issues UI — the practical, sufficient confirmation for this build's actual usage (message-only events, no exception/stacktrace payloads) |
| `Content-Type: application/x-sentry-envelope` on the POST body | Confirmed via an indexed summary explicitly naming this as the envelope endpoint's expected content type (with `text/plain`/form-encoded also accepted to minimize CORS preflights — irrelevant here, this is a server-to-server call) | High | Same as above |
| Auth via the envelope header's own `dsn` field (rather than a separate `X-Sentry-Auth` header) | Confirmed via an indexed summary: "the Envelope endpoint allows authentication via an Envelope header by setting the dsn Envelope header to the full DSN string" | Medium-high — explicitly stated in an indexed developer-docs summary, not independently re-derived | Same as above — a `401`/`403` on the real test send would mean this auth path needs the additional `X-Sentry-Auth` header instead |

**Code:** `supabase/functions/_shared/sentry.ts` (`parseDsn`,
`envelopeEndpoint`, `buildErrorEnvelope`, `sendToSentry`), wired into
`supabase/functions/_shared/logger.ts`'s `error()` path. Fail-open by
design regardless of outcome here (see that file's own header comment) —
a wrong assumption above means Sentry silently doesn't receive events, not
that any function call breaks; still worth confirming per
`docs/OPS_RUNBOOK.md` §2's manual verification step before relying on this
for production alerting.

## T7 — Deep-integration adapters (`packages/adapters/{shopmonkey,ezyvet,
## google-calendar,square}`, `supabase/functions/{webhooks-pos,
## worker-adapter-push,api-adapter-connect,_shared/providers/*}`)

Per the task's own instruction that these four vendors' docs are "generally
reachable online," `WebFetch` was tried directly against `shopmonkey.dev`
and `developer.squareup.com` first — both returned `EGRESS_BLOCKED` in this
environment, the same experience every prior task logged for its own
assigned vendor docs. `WebSearch` (server-side, not blocked) was used
instead per CLAUDE.md Rule 1 item 2 for every item below; nothing here
traces to memory. This extends (does not replace) the existing
`## Square (webhooks-pos)` entry above, which T3 wrote for the
`handleWebhook` verify/normalize slice only.

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| Shopmonkey auth model | A self-generated, pasted API key (Bearer token) minted from an authenticated Shopmonkey session via a `/apikey` route — resolved this way over API_AND_FLOWS.md's per-adapter section's literal "OAuth2 Bearer tokens via `/auth/login`" line, reconciling it with that same document's own preamble calling Shopmonkey a "self-generated paste-key" adapter (see `packages/adapters/shopmonkey/src/client.ts`'s docstring for the full reasoning) | Medium — the `/apikey` route's existence and behavior (mints a key carrying the requesting user's own permissions, optionally time-limited) is corroborated by an indexed summary of Shopmonkey's own docs; the exact route path/response shape was not independently re-derived | `shopmonkey.dev`'s Authentication guide |
| Shopmonkey base URL | `https://api.shopmonkey.cloud/v3` | Low — not independently confirmed; the "v3" path segment is corroborated (an indexed summary confirms "v3... will be the first part of the path for any URL"), the host itself is an educated guess following common SaaS API-subdomain convention | `shopmonkey.dev`'s Quickstart/Overview pages, or a real API key's first authenticated call |
| Shopmonkey labor rate / customer / appointment endpoints (`/laborrate`, `/customer`, `/appointment`) | Assumed REST-conventional paths/fields (`GET /laborrate` -> `{data: [...]}`, `GET /customer?phone=...`, `POST /appointment` with `customerId`/`laborRateId`/`bayId`/`startAt`/`endAt`) | Low — no first-party fetch of the actual endpoint reference reached in this build; every field name here is a documented hypothesis, guarded by a runtime Zod validator per CLAUDE.md Rule 1 item 2 (`packages/adapters/shopmonkey/src/{catalog,booking}.ts`) | `shopmonkey.dev`'s API reference, once reachable, or a real sandbox account |
| Shopmonkey webhook signature scheme | `HMAC-SHA256(rawBody)`, hex, header `x-shopmonkey-signature` | Low — a documented hypothesis (the common webhook-HMAC pattern), not corroborated against Shopmonkey's own docs at all; BACKEND_SPEC §7.6 itself flags this as unconfirmed | `shopmonkey.dev`'s Webhooks guide |
| Shopmonkey webhook/two-way-sync coverage for staff-made reschedules/cancellations | Unknown whether a webhook exists at all — `pullChanges` (poll-based, `GET /appointment?updatedAfter=...`) is wired as the adapter's real two-way sync path regardless of the webhook path's fate | Low | Same as above |
| ezyVet auth model | OAuth2 Client Credentials grant, 12h access-token TTL, partner-gated (`partner_id` + platform-level `client_id`/`client_secret`, one set shared across every connected practice) | High for the grant type/TTL (independently corroborated by both API_AND_FLOWS.md's own prior research and fresh WebSearch during this build); Medium for the exact token-endpoint path (`{practiceBaseUrl}/oauth/access_token`) and grant-body field names (`partner_id` alongside the standard `client_id`/`client_secret`/`grant_type`) — not independently re-derived from a first-party source | `developers.ezyvet.com/docs/v1/` |
| ezyVet per-practice base URL | Each connected practice ("database") has its own base URL — modeled as `adapter_connections.metadata.baseUrl`, supplied by the tenant at connect time (`api-adapter-connect`'s `paste_key` action for ezyVet) since there is no per-tenant OAuth redirect to derive it from | Medium — the per-database API shape itself is well-corroborated; the exact URL pattern (subdomain vs. path-based) was not independently confirmed | `developers.ezyvet.com`, or direct confirmation from the practice's ezyVet admin during onboarding |
| ezyVet rate limit | 180 calls/minute per database per partner — enforced client-side via a sliding-window limiter (`packages/adapters/ezyvet/src/client.ts`) | High — stated directly in API_AND_FLOWS.md A.6's own prior research | `developers.ezyvet.com`'s rate-limiting docs |
| ezyVet appointment-type/contact/appointment endpoints (`/appointmenttype`, `/contact`, `/appointment`) | Assumed REST-conventional paths/fields, matching the ~216-endpoint noun-per-resource convention API_AND_FLOWS.md A.6 describes | Low — same posture as Shopmonkey's endpoints above: a documented hypothesis behind a runtime Zod validator, not a first-party-confirmed shape | `developers.ezyvet.com/docs/v1/` |
| ezyVet webhook coverage for appointment changes | Assumed NOT confirmed to exist at all (API_AND_FLOWS.md A.6 and VERTICAL_RESEARCH.md both flag this explicitly) — `handleWebhook` always returns `{valid: false}` with an explicit reason rather than guessing a scheme; `pullChanges` (poll) is the only two-way sync path wired for this adapter | Medium-high confidence this absence-of-confirmation is real, not just an indexing gap (two independent prior research passes both flag it) | `developers.ezyvet.com`, direct vendor confirmation |
| Square OAuth (`/oauth2/authorize`, `/oauth2/token`) | Standard authorization-code + refresh_token grants at `connect.squareup.com`; refresh-token-obtained access tokens expire 30 days after issuance, SAME refresh token returned (not rotated) | High — independently corroborated by fresh WebSearch during this build against multiple Square API-reference pages | `developer.squareup.com/docs/oauth-api/overview`, `.../migrate-to-refresh-tokens` |
| Square Bookings (`/v2/bookings`, `/v2/bookings/availability/search`) | `POST /v2/bookings` requires `Booking.location_id`/`start_at`/`AppointmentSegment.team_member_id`/`service_variation_id`/`service_variation_version`; supports an `idempotency_key` body field | High — independently corroborated by fresh WebSearch against Square's own Bookings API reference during this build (matches SYSTEM_DESIGN §14's salvage note) | `developer.squareup.com/reference/square/bookings-api` |
| Square Catalog (`POST /v2/catalog/search`, price at `variations[0].item_variation_data.price_money.amount`) | Unchanged from T3's original salvage-note hypothesis | Medium (carried forward, not re-verified this pass beyond the fresh WebSearch corroborating the endpoint path itself) | `developer.squareup.com/reference/square/catalog-api` |
| Square webhook signature header name (`x-square-hmacsha256-signature`) | Confirmed via fresh WebSearch during this build (multiple independent sources name this exact header) — raises confidence on the existing `## Square (webhooks-pos)` entry above from "Low" toward "Medium-high" for the header name/algorithm specifically, though the overall scheme is still flagged for a live-sandbox re-verify per that entry | Medium-high (this build's re-check) | `developer.squareup.com/docs/webhooks/step3validate` |
| Square `Square-Version` header / API version pinning | Assumed required on every REST call, pinned to a specific date string (`2026-01-22` in this build, VERIFY: bump before go-live) | Medium — the header's existence and date-versioning convention is standard/well-known for Square's API; the specific date pinned is a build-time placeholder, not something to verify per se, just to keep current | `developer.squareup.com/docs/build-basics/versioning` |
| Google Calendar OAuth | Standard Google OAuth2 authorization-code flow, `access_type=offline&prompt=consent` for a refresh token, `https://www.googleapis.com/auth/calendar` scope | High — standard, extremely well-documented OAuth2 pattern | `developers.google.com/identity/protocols/oauth2/web-server` |
| Google Calendar `freeBusy`/`events.insert`/`events.list`/`events.watch` | Assumed field names (`timeMin`/`timeMax`/`items[].id`; `start.dateTime`/`end.dateTime`; `showDeleted`/`orderBy=updated`/`updatedMin`; `id`/`type: "web_hook"`/`address`/`token`/`params.ttl`) | Medium-high — independently corroborated by fresh WebSearch during this build against multiple Google Calendar API reference/guide pages | `developers.google.com/workspace/calendar/api/v3/reference/*` |
| Google Calendar watch-channel default TTL | 604800 seconds (7 days); no documented maximum found in this pass | Medium — corroborated by fresh WebSearch, but the search explicitly could not confirm an upper bound | `developers.google.com/workspace/calendar/api/guides/push` |
| Google Calendar push-notification body | Confirmed (both by this build's own design reasoning and WebSearch corroboration) to carry NO diffable event content — only `X-Goog-*` headers (`Channel-ID`/`Channel-Token`/`Resource-ID`/`Resource-State`/`Message-Number`) identifying the channel and its state; the actual delta requires a separate `events.list` call | High — this "notification carries no payload, fetch after" pattern is independently corroborated across Google's own push-notification docs for every watched resource type, and matches the identical Clover/Square salvage-note pattern already relied on elsewhere in this codebase | Same as above |

**Design decisions flagged here as genuine gaps, not vendor-API VERIFY items:**

- **`adapter_connections.access_token`/`refresh_token` are stored as
  plaintext.** Encrypting these at rest (pgsodium/Vault, or an
  application-layer envelope) needs a decision this task cannot make blind
  (which KMS, key-rotation story, and whether Supabase Vault is even
  provisioned on the target project) — flagged in the migration's own
  comment (`20260907160000_t7_adapter_connections.sql`) and here. Treat
  this as a pre-go-live blocker for any adapter carrying a real OAuth
  refresh token (Square, Google Calendar), not a nice-to-have.
- **Offering/resource -> provider-catalog-id mapping rides in the existing
  generic `metadata` jsonb column** (`offerings.metadata.adapter_external_id.
  <provider>`, `resources.metadata.adapter_external_id.<provider>`) rather
  than a dedicated mapping table, since T7's build directive authorized
  exactly ONE new migration (spent on `adapter_connections`/
  `adapter_sync_state`). A future task adding a real "catalog sync writes a
  mapping table" flow (populated automatically from `syncCatalog` rather
  than requiring a human to hand-edit `metadata` JSON) is the more robust
  long-term design — flagged here and in `docs/BUILD_NOTES.md`'s T7 entry.
- **The poll-based two-way sync (`pollAdapterChanges`,
  `worker-adapter-push/handler.ts`) is contract-tested but NOT wired to any
  scheduler.** BACKEND_SPEC §7.6 calls for "poll-back on a schedule" — that
  schedule (a new `job-adapter-sync` cron function + `pg_cron` entry) is
  T3/T4's established territory (`job-*` functions), outside this task's
  exclusive paths (`webhooks-pos/`, `worker-adapter-push/`,
  `_shared/providers/*.ts`). Flagged as a named follow-up, not silently
  assumed solved.
- **`IntegrationAdapter` (the canonical interface every
  `packages/adapters/{shopmonkey,ezyvet,google-calendar,square}` package
  implements) is intentionally duplicated four times** rather than living
  in `@heyloo/canonical-types` (T2's package, alongside `VoiceProvider`) —
  this task's exclusive paths list only the four adapter directories, not
  `packages/canonical-types`. See `packages/adapters/shopmonkey/src/
  adapter-types.ts`'s own docstring for the full reasoning (mirrors T4's
  identical precedent for `_shared/compiler/template-compiler.ts`
  duplicating `packages/adapters/retell/src/compiler/*`).
- **Every Node-package adapter (`packages/adapters/*`) is duplicated again
  as a lean `_shared/providers/*.ts` module for the Deno Edge Function
  runtime** — same Deno/Node workspace-package boundary T3 and T4 already
  documented for Retell/Twilio/Stripe/PayPal/Anthropic/Resend and the
  template compiler, applied here to all four T7 adapters. The Node
  packages are the reference implementation (fully unit-tested against the
  canonical `IntegrationAdapter` contract) for any future Node-side
  consumer (a CLI tool, a non-Deno service, or a future admin-cockpit
  "sync catalog now" action's test suite); the `_shared/providers/*.ts`
  versions are what actually runs in production today.

## PROVIDERS-VERIFY pass (2026-09-08) — resolution log

Per CLAUDE.md Rule 1 + this task's own instruction: `docs.*` sites remained
egress-blocked (`developer.squareup.com`, `developers.google.com`,
`developer.paypal.com`, `www.twilio.com`, `docs.apollo.io`,
`docs.outscraper.com`, `docs.smartlead.ai`, `shopmonkey.dev`,
`developers.ezyvet.com` all returned `connect_rejected`/`EGRESS_BLOCKED`),
but `registry.npmjs.org` and `raw.githubusercontent.com` were BOTH fully
reachable — every item below traces to actual official-package source code
(downloaded npm tarballs, or files fetched directly from an `apolloio`-org
GitHub repo via `raw.githubusercontent.com`), not memory or WebSearch
summaries. This section is the audit trail; inline VERIFY items above are
left as-is (not rewritten in place) except where a fix is noted here.
Retell items (VERIFY-1 through VERIFY-8, and every `## Retell` table row)
are explicitly OUT OF SCOPE — a parallel agent owns those.

### Square — RESOLVED, high confidence

Source: official `square` npm SDK, v45.1.0 (`square-nodejs-sdk`, Fern-
generated from Square's own API definition) — downloaded tarball, read
`api/types/*.d.ts` + `serialization/types/*.js` (wire field names) +
`wrapper/WebhooksHelper.js` (real signature-verification source, not just
types) directly.

- **Webhook signature scheme**: CONFIRMED byte-for-byte —
  `HMAC-SHA256(notificationUrl + rawBody)`, base64, header
  `x-square-hmacsha256-signature`. A new contract test
  (`packages/adapters/square/src/contract.test.ts`) round-trips this
  adapter's `verifySquareWebhookSignature` against the SDK's OWN
  `WebhooksHelper.verifySignature` at runtime — both agree. No code change;
  confidence raised from "Low — carried forward from legacy Clover notes"
  to "Confirmed against official SDK source."
- **Webhook envelope** (`{merchant_id, type, event_id, data: {type, id,
  object}}`): CONFIRMED — matches `BookingCreatedEvent`/`OrderCreatedEvent`/
  `OauthAuthorizationRevokedEvent` exactly. One nuance found: the inner
  `data.object` nests differently per event family (`{booking: {...}}` for
  bookings, `{order_created: {...}}`/`{order_updated: {...}}` — a LEAN
  summary object, not the full Order — for orders); harmless here since
  this adapter stores `data.object` opaquely as `changes` rather than
  destructuring specific fields.
- **Bookings** (`POST /v2/bookings` body/response) and **Orders**
  (`POST /v2/orders` body/response): CONFIRMED exact field-for-field —
  `location_id`, `start_at`, `customer_note`, `appointment_segments[].
  team_member_id/service_variation_id/service_variation_version`,
  `line_items[].base_price_money`, `fulfillments[].{PICKUP,DELIVERY}`,
  top-level `idempotency_key`, response `{booking:{id,status}}`/
  `{order:{id}}`.
- **Availability search** (`POST /v2/bookings/availability/search`):
  CONFIRMED exact — `query.filter.{start_at_range,location_id,
  segment_filters[].service_variation_id}`, response
  `{availabilities:[{start_at,location_id,appointment_segments}]}`.
- **OAuth2 token refresh** (`POST /oauth2/token`): CONFIRMED exact —
  `client_id`/`client_secret`/`grant_type`/`refresh_token` request,
  `access_token`/`refresh_token`/`expires_at`/`merchant_id` response,
  including the specific claim "the SAME refresh token is returned on a
  refresh_token grant" (verbatim in the SDK's own doc comment).
- **FIXED — Catalog search location filter (`syncCatalog`)**: this build's
  `enabled_location_ids` request param on `POST /v2/catalog/search` was
  WRONG — that endpoint has no location-filter field at all (confirmed
  absent from the SDK's `SearchCatalogObjectsRequest` type);
  `enabled_location_ids` belongs only to the different `POST /v2/catalog/
  search-catalog-items` endpoint this adapter doesn't call. Fixed by
  removing the bogus param and post-filtering matched items via
  `present_at_all_locations`/`present_at_location_ids`/
  `absent_at_location_ids` (fields every `CatalogObjectBase` genuinely
  carries, per the SDK's own type) — `packages/adapters/square/src/
  catalog.ts`, new tests in `catalog.test.ts`.
- **FIXED — `Square-Version` header**: bumped from this build's placeholder
  `2026-01-22` to `2026-08-19` — the exact default the SDK's own generated
  client sends today. Re-bump whenever `square` is next updated in
  `package.json`. Fixed in both `packages/adapters/square/src/client.ts`
  and `supabase/functions/_shared/providers/square.ts`.
- **Devdependency added**: `square@45.1.0` in `packages/adapters/square/
  package.json` devDependencies ONLY (no runtime import anywhere under
  `src/index.ts`'s import graph) + a compile-time/runtime contract test,
  `packages/adapters/square/src/contract.test.ts`.

### Google Calendar — RESOLVED, high confidence, NO code changes needed

Source: official `googleapis` npm SDK, v178.0.0 — `build/src/apis/
calendar/v3.d.ts` (the generated `calendar_v3` namespace).

Every shape this adapter relies on was independently confirmed exact, with
zero mismatches found: `freeBusy` (`timeMin`/`timeMax`/`items[].id` request,
`calendars[id].busy[].{start,end}` response — `Schema$TimePeriod`'s own doc
comment: "end (exclusive)"/"start (inclusive)"), `events.insert`
(`start.dateTime`/`end.dateTime`, and the event-id charset+length rule this
adapter's `toGoogleEventId` targets — `Schema$Event.id`'s doc comment
states the EXACT regex this build had flagged as unconfirmed: "lowercase
letters a-v and digits 0-9... length... between 5 and 1024 characters"),
and the push-notification `Channel` resource (`id`/`type: "web_hook"`/
`address`/`token`/`params`, `expiration` — confirmed "Unix timestamp, in
milliseconds", matching this adapter's own docstring claim exactly).
Devdependency added: `googleapis@178.0.0` in `packages/adapters/
google-calendar/package.json` devDependencies ONLY, plus a compile-time
contract test, `packages/adapters/google-calendar/src/contract.test.ts`.

### PayPal — PARTIALLY RESOLVED

Source: official `@paypal/payouts-sdk` npm package, v1.1.1
(`paypal/Payouts-NodeJS-SDK`) — last published 2021, but still the
authoritative source this task's own instructions name.

- **OAuth2 client-credentials grant + Payouts body shape**: CONFIRMED exact
  — `POST /v1/oauth2/token` with HTTP Basic auth (`clientId:clientSecret`
  base64) + `grant_type=client_credentials` form body (this build's
  existing implementation already matched, unchanged); Payouts body
  `{sender_batch_header: {sender_batch_id, email_subject, recipient_type,
  ...}, items: [{note, amount:{currency,value}, receiver, sender_item_id}]}`
  — this build's existing `createPayoutBatch` already matched exactly
  (per-item `recipient_type` this build sets is ALSO independently
  supported per Payouts' own item schema, not a conflict with the
  batch-header-level field the SDK's README example shows).
- **FIXED (lower-certainty) — base URL**: changed from `api-m.(sandbox.)
  paypal.com` to `api.(sandbox.)paypal.com` (no `-m`) to match the SDK's
  `paypal_environment.js` exactly. Flagged explicitly: this SDK package
  hasn't been republished since 2021, and PayPal is independently known to
  have introduced an `api-m.paypal.com` host for some newer REST surfaces
  — a live sandbox OAuth token call against `api.sandbox.paypal.com` is
  still worth doing before the first real payout batch to rule out the
  older host having been retired for this specific v1 endpoint.
  `supabase/functions/_shared/providers/paypal.ts` + the one test fixture
  referencing this URL (`job-referral-payouts/handler.test.ts`).

### Twilio — RESOLVED, high confidence

Source: official `twilio` npm SDK, v6.1.0 (`twilio-node`).

- **`X-Twilio-Signature` algorithm**: CONFIRMED byte-for-byte against the
  SDK's own `lib/webhooks/webhooks.js` (`getExpectedTwilioSignature`) —
  full URL + params sorted by key, each `key+value` concatenated directly
  (no separator) onto the URL, HMAC-SHA1(authToken), base64. Matches
  `supabase/functions/_shared/twilio-signature.ts` exactly — no code
  change, confidence raised from High (WebSearch-based) to Confirmed
  (source-code-based).
- **REST paths** (`/Accounts/{Sid}/Messages.json` with `To`/`From`/`Body`;
  `/Accounts/{Sid}/IncomingPhoneNumbers.json` with `PhoneNumber`/
  `VoiceUrl`/`FriendlyName`): CONFIRMED exact.
- **A2P Brand/Campaign** (`messaging.twilio.com/v1/a2p/BrandRegistrations`
  with `CustomerProfileBundleSid`/`A2PProfileBundleSid`/`BrandType`;
  `/v1/Services/{Sid}/Compliance/Usa2p` with `BrandRegistrationSid`/
  `Description`/`MessageFlow`/`UsAppToPersonUsecase`/`HasEmbeddedLinks`/
  `HasEmbeddedPhone`/`PrivacyPolicyUrl`/`TermsAndConditionsUrl`): CONFIRMED
  exact.
- **FIXED — A2P campaign sample messages**: this build's original
  `SampleMessage1`/`SampleMessage2`/... indexed-suffix guess matched NO
  field Twilio's real API recognizes. The confirmed field is
  `MessageSamples` (REQUIRED — the SDK throws if omitted), an array
  serialized as the SAME key repeated once per value
  (`qs.stringify({arrayFormat: "repeat"})`, confirmed in the SDK's own
  `lib/base/RequestClient.js`) — e.g. `MessageSamples=a&MessageSamples=b`,
  not indexed suffixes. This means every real `createA2pCampaign` call in
  this build up to now would have silently sent NO sample messages at all.
  Fixed in `supabase/functions/_shared/providers/twilio.ts`
  (`twilioMessagingRequest` now accepts `Record<string, string|string[]>`
  and appends repeated keys for array values).
- **FIXED — campaign-status HTTP verb** (a different, Smartlead-adjacent
  finding logged under Smartlead below, N/A here — Twilio was already POST
  everywhere it needed to be).

### Apollo — RESOLVED (2 shape fixes), one endpoint corrected

Source: `apolloio/n8n-nodes-apollo` — Apollo's OWN integrations team's
GitHub repo (fetched directly via `raw.githubusercontent.com`,
`nodes/Apollo/Apollo.node.ts` + `credentials/ApolloApi.credentials.ts`).
First-party Apollo source, not a community/third-party connector.

- **FIXED — People Search endpoint**: this build's original
  `POST /mixed_people/api_search` guess (justified at the time by a
  WebSearch summary claiming the plain `/search` path "403s on
  non-enterprise plans") is NOT what Apollo's own connector calls — it
  uses `POST /mixed_people/search` and never touches an `api_search`
  variant anywhere in its source. Fixed to `/mixed_people/search`,
  superseding the earlier indexed-summary-based claim.
- **FIXED — People Search filter field**: `organization_domains`, not
  `q_organization_domains_list` as this build originally guessed.
- **FIXED — Organization bulk-enrich body**: a flat `{domains: [...]}`
  array of domain strings, not `{details: [{domain}, ...]}` as this build
  originally guessed.
- **CONFIRMED unchanged**: `X-Api-Key` header (this connector's own
  `credentials/ApolloApi.credentials.ts`), base URL
  `api.apollo.io/api/v1`, Organization Search endpoint/fields
  (`POST /mixed_companies/search`, `organization_locations`).
- **Still NOT confirmed**: response-body field names (`people`/
  `organizations`/`pagination.total_entries`) — this connector passes the
  raw Apollo response straight through unparsed, so it corroborates
  nothing about response shape. Still worth a live-sandbox confirm before
  relying on this for real spend.
- Fixed in `supabase/functions/_shared/providers/apollo.ts`.

### Outscraper — RESOLVED (2 bugs fixed)

Source: official `outscraper` npm SDK, v2.2.2 (`outscraper/outscraper-node`)
— `index.js` (real request-building source) + its own bundled
`examples/Async Google Maps Reviews.md`.

- **FIXED — result-count limit param name**: this build's `limit` query
  param on `GET /maps/search-v3` matches NOTHING the real API expects —
  the SDK's own `googleMapsSearchV3` sends `organizationsPerQueryLimit`
  instead. This build's `limit` param was being silently ignored by
  Outscraper on every real call. Fixed.
- **FIXED — poll terminal-status value**: this build's poller checked for
  `status === "Success"` or `"Finished"` — NEITHER value appears anywhere
  in the SDK's own documented status vocabulary. The SDK's own bundled
  usage example states the real values explicitly: `"Running"` (poll
  again), `"Completed"` (success, data present), `"Failed"` (terminal
  failure). This build's poller would NEVER have detected a finished job
  in production — every real lead-fetch would have exhausted its retry
  budget and returned zero leads. Fixed to check for `"Completed"`
  (success) and `"Failed"` (now also treated as terminal, rather than
  retried until the attempt budget silently ran out).
- **CONFIRMED unchanged**: base URL `api.app.outscraper.com`, `X-API-KEY`
  header, `query`/`async` param names, the async `results_location` poll
  pattern.
- Fixed in `supabase/functions/_shared/providers/outscraper.ts` + the one
  test fixture asserting the old `"Success"` status
  (`api-outreach-fetch-leads/handler.test.ts`).

### Smartlead — ONE FIX, TWO NEW OPEN CONFLICTS FLAGGED (no blind guess made)

Source: `smartlead-mcp-server` npm package, v1.2.1 — an UNOFFICIAL,
community-built MCP server, but one with a real, executable `axios`-based
API client (not just docs prose) — cross-referenced against
`n8n-nodes-smartlead` v1.2.0 (also unofficial, more minimal) where it
overlaps.

- **FIXED — campaign-status HTTP verb**: this build's `PATCH
  /campaigns/{id}/status` guess is very likely wrong. The MCP server's
  entire Smartlead client — campaign create, schedule/settings/status
  update, leads add, webhook upsert, EVERY mutating call — uses
  `apiClient.post(...)`; none uses PATCH or PUT anywhere in that codebase.
  That's a real API client's consistent cross-endpoint verb convention,
  stronger evidence than this build's original page-title-level guess.
  Fixed `PATCH` -> `POST` in `updateCampaignStatus`
  (`supabase/functions/_shared/providers/smartlead.ts`) and the one test
  asserting the old verb (`webhooks-outreach/handler.test.ts`).
- **NOT changed, flagged as a genuine open conflict — leads-add endpoint**:
  this build's `POST /campaigns/{id}/leads` + `{lead_list: [...]}` (this
  build's own prior "Medium-high confidence... independently confirmed via
  indexed API-reference PAGE TITLES" claim) conflicts with this MCP
  server's `POST /campaigns/{id}/leads/bulk` + `{leads: [...]}`. Both
  sources are unofficial/community-maintained with no way to adjudicate
  from this environment — left UNCHANGED rather than trading one unverified
  guess for another. Confirm against a real sandbox call before relying on
  either.
- **NOT changed, flagged as a genuine open conflict — webhook creation**:
  this build's global `POST /webhook/create` (`association_type:
  "campaign"`, `event_type_map` as a boolean map) conflicts with this MCP
  server's per-campaign `POST /campaigns/{id}/webhooks` (`event_types` as
  an ARRAY, not a map). Same reasoning as above — left unchanged, flagged.
- **Corroborated (raises confidence, no code change)**: the MCP server's
  own `WebhookEventType` enum lists exactly `EMAIL_SENT`/`EMAIL_OPEN`/
  `EMAIL_LINK_CLICK`/`EMAIL_REPLY`/`LEAD_UNSUBSCRIBED`/
  `LEAD_CATEGORY_UPDATED` — no distinct spam/complaint event, and no
  `EMAIL_BOUNCE` either — independently corroborating this build's existing
  "Smartlead spam-complaint event does not appear to exist" VERIFY note
  (raises that from Low-medium toward Medium confidence; `EMAIL_BOUNCE`'s
  absence here is noted but not acted on — omission from one third-party
  enum isn't strong enough evidence to remove a harmless-if-unrecognized
  key from this build's own event-type-map type).

### Anthropic — RECONFIRMED, no code changes needed

Source: this session's own `claude-api` skill (loaded fresh this pass,
cached 2026-06-24 — more recent than this build's original T3/T8 pass).

- **Model ids**: `claude-haiku-4-5` and `claude-sonnet-5` (both used by
  this build's outreach call sites) are confirmed CURRENT, correctly-priced
  model ids in the skill's own "Current Models" table — no drift found,
  no change needed.
- **Message Batches contract** (`POST /v1/messages/batches` ->
  poll `processing_status` until `"ended"` -> stream JSONL results keyed by
  `custom_id`, `result.type` in `succeeded`/`errored`/`canceled`/
  `expired`): reconfirmed exactly matching this build's existing
  `_shared/providers/anthropic.ts` implementation — no change.
- `anthropic-version: 2023-06-01` and the Messages API envelope itself
  were not independently re-verified this pass beyond the skill's own
  implicit corroboration (it documents no header change) — left as
  "presumed stable," same posture as before.

### Shopmonkey — STILL FLAGGED, no authoritative source found (tried, documented)

Tried, in order: (1) npm registry search for `shopmonkey`/`@shopmonkey/*`
packages — only `@pipedream/shopmonkey` exists, and its `shopmonkey.app.mjs`
is an empty Pipedream scaffold stub with ZERO real API calls (no endpoint
paths, no auth wiring beyond a placeholder) — not informative. (2) Several
GitHub org/repo name guesses (`Shopmonkey/api-docs`, `shopmonkeyus/*`,
`ShopmonkeyUS/*`) via `raw.githubusercontent.com` — all 404, no public repo
found under any guessed name. (3) The actual API host
(`api.shopmonkey.cloud`) directly — blocked by the same egress policy as
the docs site (`connect_rejected`, not merely a docs-site-specific block).
Genuinely no authoritative source reachable from this environment — every
existing Shopmonkey VERIFY item (auth model, base URL, endpoint shapes,
webhook signature scheme) stands exactly as previously documented, UNCHANGED.

### ezyVet — STILL FLAGGED, no authoritative source found (tried, documented)

Tried: npm registry search for `ezyvet`/`ezyvet-*`/`@ezyvet/*` — zero
packages found (search itself returned an empty result set, not just 404s
on guessed names). Several GitHub org/repo name guesses
(`ezyVet/api`, `ezyvet/api-client`, `ezyVet/openapi`, `ezyvet-com/api-docs`)
via `raw.githubusercontent.com` — all 404. No authoritative source
reachable; matches this build's own prior acknowledgment ("ezyVet:
unlikely to have an SDK"). Every existing ezyVet VERIFY item stands exactly
as previously documented, UNCHANGED.

**Code:** fixes above live in `packages/adapters/{square,google-calendar}/
src/*.ts` (+ new `contract.test.ts` in each), `supabase/functions/_shared/
providers/{square,paypal,twilio,apollo,outscraper,smartlead}.ts`, and the
handful of test files these changes required updating (listed inline
above). `docs/BUILD_NOTES.md`'s PROVIDERS-VERIFY entry lists every file
touched.
