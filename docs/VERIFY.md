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

**OPS-4 follow-up (2026-09-20):** the signature-verification logic above
was always correct, but the edge functions' ENV WIRING wasn't — `voice-
tools`, `voice-events`, `voice-inbound`, and `job-keep-warm` all read a
distinct `RETELL_WEBHOOK_SIGNING_SECRET` var via `requireEnv`, which is
unset on the live project (only `RETELL_API_KEY` is), crashing cold start.
Fixed with `requireRetellWebhookKey()` in
`supabase/functions/_shared/deno/env.ts` — `RETELL_WEBHOOK_SIGNING_SECRET`
if set (explicit override), else `RETELL_API_KEY`. See
`docs/BUILD_NOTES.md` OPS-4.

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
| `call.call_analysis.custom_analysis_data` carrying `classification`/`outcome`/`follow_up_needed`/`legal_advice_given`/`emergency_detected` keys | The compiled template's per-state `extraction[]` fields land here under these literal names | Medium (upgraded from Low) — no longer just an assumed mapping: `packages/adapters/retell/src/compiler/extraction.ts`'s `compilePostCallAnalysisData()` sets Retell's `post_call_analysis_data[].name` to `field.field` verbatim (SDK-confirmed field-for-field against `AgentResponse.{String,Enum,Boolean,Number}AnalysisData`), `agents.ts` attaches it to every create/update-agent body, and every shipped template (`packages/templates/src/verticals/*.ts`) now actually declares `classification`/`outcome`/`follow_up_needed` on every state via `shared/extraction.ts`'s `withCallOutcomeExtraction`, plus `emergency_detected` (vet/dental/auto-repair/the shared `safetyEmergencyState()`) and `legal_advice_given` (legal) — asserted for every template by `packages/templates/src/red-team/structural.test.ts`. What's still unconfirmed is Retell's RUNTIME behavior, not this codebase's request shape: whether Retell's own post-call LLM extractor actually populates `custom_analysis_data` keyed exactly by these `name`s in practice for a real call, which the SDK's `custom_analysis_data?: unknown` type can't confirm either way. | A live sandbox call confirming `custom_analysis_data` comes back keyed by these exact names (this repair pass could not make one — no live/remote operations in scope) |
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

## Cluster B fix wave — signup/checkout/provisioning/forwarding (2026-09-10)

### STRIPE-VERIFY-1 — Dispute object has no `customer` field — **RESOLVED (indexed WebSearch, docs.stripe.com egress-blocked)**

`docs.stripe.com` returned `EGRESS_BLOCKED` from this session (same as
every prior Stripe VERIFY item in this file). Via indexed WebSearch of
Stripe's own API reference pages (`docs.stripe.com/api/disputes/object`,
`docs.stripe.com/api/charges/object`) rather than a first-party fetch:

- The **Dispute** object (`charge.dispute.created`'s `data.object`) carries
  `charge` (the disputed Charge's id, string) and `payment_intent`, but
  **no `customer` field** — confirmed via two independent search snippets
  of the same reference page, not merely inferred.
- The **Charge** object (`charge.refunded`'s `data.object` — Stripe fires
  this event ON the Charge itself) DOES carry `customer` as a plain string
  ID (not an expandable object by default) — confirmed via a real captured
  example payload (`"customer": "cus_Na6dX7aXxi11N4"`) in a third-party
  webhook-catalog snippet of Stripe's own documented shape.

`supabase/functions/webhooks-stripe/handler.ts`'s referral-clawback case
was built against this confirmed shape: `charge.refunded` reads
`obj["customer"]` directly; `charge.dispute.created` instead resolves the
tenant via `payment_processing_events.stripe_charge_id` (a mapping this
same handler already writes on `charge.succeeded`) rather than assuming a
`customer` field that doesn't exist on Dispute. Still recommend one real
signed `charge.dispute.created` test delivery (Stripe CLI `trigger
charge.dispute.created`) against a live/test-mode webhook endpoint before
first production reliance, per this file's standing "confirm before
go-live" posture for every entry built without a first-party fetch.

## Cluster C fix wave — realtime + dashboard/admin truthfulness (2026-09-10)

### SUPABASE-REALTIME-VERIFY-1 — `realtime.broadcast_changes()` client payload shape — **RESOLVED (indexed WebSearch + GitHub, supabase.com egress-blocked)**

`supabase.com/docs/guides/realtime/broadcast` returned `EGRESS_BLOCKED` from
this session. Via indexed WebSearch plus a first-party (non-`docs.*`)
GitHub fetch of `supabase/supabase`'s own
`examples/prompts/use-realtime.md`:

- `realtime.broadcast_changes(topic, event, operation, table, schema, new,
  old)`'s trigger-function signature was already correct in
  `fn_broadcast_tenant_update()` (`supabase/migrations/20260907131400_functions_triggers.sql`).
- The payload the CLIENT receives on `.on("broadcast", {event}, ({payload})
  => ...)` includes top-level `topic`, `operation`, `table`, `schema`,
  `record` (NEW), `old_record` (OLD) fields — confirmed via the example's
  own documented field list. `apps/web/src/lib/realtime/tenant-realtime-provider.tsx`'s
  existing `payload.table` access was therefore already correct against the
  real payload shape; the actual bug (E2E_FLOWS_AUDIT.md B3) was the
  channel/topic STRING mismatch (`private-tenant-${tenantId}` vs the
  backend's `'tenant:' || tenant_id`), now fixed via the shared
  `getTenantRealtimeChannelName()` helper (`apps/web/src/lib/realtime/channel.ts`).
- Recommend one real end-to-end check (a `call_logs`/`bookings` insert
  against a live Supabase Realtime instance with the dashboard subscribed)
  before first production reliance, since this environment has no live
  Realtime server to test the actual WebSocket delivery against — only the
  topic-string-equality half of the fix was verifiable statically/via unit
  test here.

**Code:** `apps/web/src/lib/realtime/channel.ts`,
`apps/web/src/lib/realtime/tenant-realtime-provider.tsx`.

### AIRTABLE-VERIFY-1 — OAuth2+PKCE endpoints, token exchange shape, scopes — **UNRESOLVED, built against researched shape per Rule 1.2**

`airtable.com/developers/web/api/oauth-reference` and
`support.airtable.com` both returned `EGRESS_BLOCKED` from this session —
no first-party fetch was possible (unlike the Supabase Realtime item
above, no reachable first-party GitHub source was found for Airtable's own
OAuth implementation either). Built from indexed WebSearch snippets of
third-party integration write-ups (a `dev.to`/`playfulprogramming.com`
Node+Angular PKCE walkthrough, `community.airtable.com` threads on the
`/token` endpoint's Basic-auth + `code_verifier` contract,
`docs.arcade.dev`/`prismatic.io` scope references) — **not confirmed
against Airtable's own docs**:

- Authorize: `GET https://airtable.com/oauth2/v1/authorize` with
  `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`,
  `code_challenge`, `code_challenge_method=S256`.
- Token: `POST https://airtable.com/oauth2/v1/token`,
  `application/x-www-form-urlencoded`, `grant_type=authorization_code`,
  `code`, `redirect_uri`, `client_id`, `code_verifier`; `Authorization:
  Basic base64(client_id:client_secret)` header sent only when a
  `client_secret` exists (some Airtable OAuth app registrations are
  public/no-secret) — **assumed, not confirmed**: whether Airtable
  actually rejects the header's absence/presence the other way is
  unverified.
- Response: `{access_token, refresh_token?, expires_in, token_type?,
  scope?}` — a Zod boundary validator
  (`AirtableTokenResponseSchema`, `apps/web/src/app/api/tenant/delivery/airtable/shared.ts`)
  rejects anything that doesn't match this shape rather than trusting it
  blindly.
- Bases list (to auto-connect/pick a base): `GET
  https://api.airtable.com/v0/meta/bases` → `{bases: [{id, name}, ...]}` —
  **least confident item**, reconstructed from general familiarity with
  Airtable's Web API meta endpoints rather than a specific search hit;
  also Zod-validated (`AirtableBasesResponseSchema`) so a shape mismatch
  fails closed (falls back to no `provider_account_id`/`base_name`) rather
  than crashing or silently misattributing a base.
- Scopes used: `data.records:read data.records:write schema.bases:read`
  (space-delimited, matching OAuth2's standard `scope` param convention) —
  the exact delimiter/format is unconfirmed.
- No revoke endpoint was found documented anywhere reachable — disconnect
  (`apps/web/src/app/api/tenant/delivery/airtable/disconnect/route.ts`)
  only clears our own stored token, does not call Airtable to revoke it
  (flagged in that route's own docstring).

**MUST be confirmed against Airtable's own current OAuth reference
(`airtable.com/developers/web/api/oauth-reference`) from an environment
that can actually reach it, before registering a real Airtable OAuth app
and relying on this in production** — every external call in this flow is
Zod-validated at the boundary so a wrong assumption fails closed (a clear
error surfaced to the popup) rather than silently misbehaving, but the
flow has not been exercised against a real Airtable OAuth app at all.

**Code:** `apps/web/src/app/api/tenant/delivery/airtable/{shared.ts,connect/route.ts,callback/route.ts,disconnect/route.ts}`.

## Cluster D fix wave — tenant screens + bookings UI (2026-09-10)

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| `api-payment-link-resend` edge function name | `apps/web`'s `/api/tenant/payment-links/[id]/resend` Route Handler calls `callEdgeFunction("api-payment-link-resend", ...)` — no function under this or any similar name exists in `supabase/functions/` at the time this cluster ran (grepped the full directory listing). Requested in `docs/audit/FIX_REQUESTS.md` from whichever cluster owns `supabase/functions`, with the exact request/response contract this Route Handler expects (`{tenant_id, payment_link_id}` in, proxies whatever status/body comes back — no fake success synthesized on this side). Same "frontend built against the documented contract, backend function pending" pattern as T5's `api-checkout-session`/`api-billing-portal` entries above. | Medium — the contract (mint a fresh Stripe Checkout Session mirroring `voice-tools/tools/send_payment_link.ts`'s existing shape, update `payment_links`, enqueue an SMS) is derived directly from that already-built, already-verified tool; only the function's deployed NAME and its exact existence are unconfirmed | `supabase/functions/` directory listing once built — if the name differs, it's a one-line fix in the Route Handler above |
| `public.fn_enqueue_message_outbound` RPC | Assumed to not exist yet (grepped every migration for `pgmq.send`/`fn_enqueue` — zero hits) — this cluster's new Messages-thread reply and the pre-existing booking-notification insert (`api/tenant/bookings/[id]/route.ts`) both write a real `messages_outbound` row today but cannot enqueue it from `apps/web` (PostgREST has no `pgmq` schema access). Requested in `docs/audit/FIX_REQUESTS.md`. Until it lands, these rows are honest `status: 'queued'` — never claimed as delivered. | High confidence the gap is real (verified: `worker-messages-outbound` only ever reads via `pgmq.read`, never scans the table by status) — low confidence on the RPC's eventual exact name/signature, since it doesn't exist yet | `supabase/migrations/*.sql` once added |
| `supabase/functions/_shared/templates.ts`'s `"owner_reply"` case | Assumed to not exist (read the file directly — confirmed absent, falls to the `default: {body: ""}` case today) | High — read directly from the file, not inferred | Same file, once the one-case addition requested in `docs/audit/FIX_REQUESTS.md` lands |
| `tenants.vertical`'s real (short-form) values vs. `packages/supabase-client/src/database.types.ts`'s `TenantRow.vertical` union | The DB CHECK constraint (`supabase/migrations/20260907130100_tenancy.sql:15`) is short-form (`auto/vet/legal/...`, matching `@heyloo/canonical-types`' `Vertical`); the hand-maintained `database.types.ts` union is still long-form (`auto_repair/veterinary/...`) — same root cause as cluster B's `vertical-mapping.ts` finding above. This cluster's new Vertical-details tab reads `tenants.vertical` and sidesteps the wrong union with an explicit `as string` cast (documented inline) rather than trusting it. | High — both sides read directly from source (the migration's CHECK clause vs. the type file), not inferred | `packages/supabase-client/src/database.types.ts`, once regenerated/fixed per the FIX_REQUESTS.md entry |

## Cluster E fix wave — voice tools, workers, failover, adapter security (2026-09-10)

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| postgres.js `connection: { statement_timeout }` startup parameter (EDGE_AUDIT M2) | `docs.postgresql.org`/`www.postgresql.org` were not tested directly, but postgres.js's own README (`raw.githubusercontent.com/porsager/postgres/v3.4.9/README.md`, reachable — GitHub raw content is not behind the same egress block as provider marketing/doc sites) documents `connection: {application_name: '...', ...other connection parameters, see https://www.postgresql.org/docs/current/runtime-config-client.html}` as arbitrary Postgres startup-packet parameters, and `statement_timeout` is one of Postgres's own long-stable client-config GUCs (not postgres.js-specific). Also confirmed the library's `.execute()`/`.cancel()` API in the same README, and deliberately did NOT use it (a protocol-level cancel is explicitly documented there as best-effort/racy — "no guarantee ... might even result in canceling another query" — whereas a session-level `statement_timeout` is enforced by Postgres itself regardless of any JS-side race). | High — first-party source fetched directly, not a WebSearch snippet | A live query against a real `SUPABASE_DB_URL` once deployed, confirming the GUC is honored over the pooler connection this codebase uses (session-mode pooler, port 5432) the same way it would on a direct connection |
| Twilio permanent-vs-transient SMS error codes (EDGE_AUDIT H1) | `21211` (invalid "To" number), `21614` (not a valid mobile number), `21408` (region not enabled), `21610` (recipient replied STOP) treated as PERMANENT (no retry); every other Twilio Messages-API rejection shape (5xx, unknown/missing `code`, network failure) treated as TRANSIENT (retried via the queue). `www.twilio.com`/`twilio.com` doc fetches (`WebFetch`) returned `EGRESS_BLOCKED` in this build even though a bare `curl` HEAD to the same host returned 200 — same class of block this codebase's other Twilio-touching files (`_shared/twilio-signature.ts`, `_shared/providers/twilio.ts`) already flag. These four codes are long-stable, widely-documented (training-knowledge-confident) Twilio error codes, not a first-party fetch. | Medium — misclassifying a real permanent rejection as transient only costs wasted retries before the same eventual DLQ outcome (never worse than the old always-instant-fail behavior); misclassifying a transient one as permanent means "retried 0 times" (fails toward the OLD behavior, never silently drops more than before) | A live Twilio sandbox send to a deliberately invalid number, confirming the exact `code` value in the response body matches one of the four above |
| Resend permanent-vs-transient email error `name` values (EDGE_AUDIT H1) | `validation_error`, `invalid_to_address`, `invalid_from_address`, `missing_required_field` treated as PERMANENT; anything else (including `internal_server_error`, `rate_limit_exceeded`, or a missing/unrecognized `name`) treated as TRANSIENT. `resend.com` doc fetch (`WebFetch`) returned `EGRESS_BLOCKED` (same as this codebase's existing `_shared/providers/resend.ts` VERIFY note for the `/emails` request shape itself). Training-knowledge-confident Resend API error taxonomy, not a first-party fetch. | Medium — same fail-direction reasoning as the Twilio item above | A live Resend sandbox send with a deliberately malformed recipient address, confirming the response's `name` field |
| Twilio `IncomingPhoneNumbers` GET response's `voice_url` field name (EDGE_AUDIT H2, `getIncomingPhoneNumber` in `_shared/providers/twilio.ts`) | Same long-stable Twilio 2010-04-01 REST API this file's other calls already target (`updateIncomingPhoneNumberVoiceUrl` sets `VoiceUrl` as a form param; the GET response is assumed to echo it back as `voice_url`, matching the REST API's consistent snake_case JSON convention for this resource) — `api.twilio.com` egress-blocked, same as every other Twilio call in this file. | Medium-high — this is the read-side mirror of a call this codebase already relies on in production; a wrong field name fails CLOSED (`retell_health_failover_snapshot_failed` logged, failover still proceeds, restore just can't run for that number) rather than silently restoring the wrong value | A live Twilio sandbox `GET /Accounts/{Sid}/IncomingPhoneNumbers/{Sid}.json` call |
| Airtable record create/update REST shape (`_shared/providers/airtable.ts`, new `pushToAirtable` in `worker-adapter-push/handler.ts`) | `POST/PATCH https://api.airtable.com/v0/{baseId}/{tableIdOrName}` with body `{fields: {...}, typecast: true}`, response `{id, fields, createdTime}` — long-stable, widely-documented Airtable Web API convention. `airtable.com/developers/web/api` egress-blocked in this build, same as this codebase's existing Airtable OAuth work (`apps/web/src/app/api/tenant/delivery/airtable/**`, see that section above). | Medium — matches every third-party summary/community reference this codebase's other Airtable VERIFY entry already cites; not a first-party fetch | A live Airtable base + a real connected `adapter_connections` row, confirming the request/response shape and that `typecast: true` correctly coerces a `Total ($)` number field |

## Cluster F fix wave — referral payout webhook, churn/retention, integrations (2026-09-10)

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| PayPal `/v1/notifications/verify-webhook-signature` request/response shape (`supabase/functions/webhooks-paypal/signature.ts`) | `developer.paypal.com` egress-blocked (same as `_shared/providers/paypal.ts`'s own existing VERIFY note). Request body `{transmission_id, transmission_time, cert_url, auth_algo, transmission_sig, webhook_id, webhook_event}` sourced from the five `PAYPAL-TRANSMISSION-ID`/`PAYPAL-TRANSMISSION-TIME`/`PAYPAL-CERT-URL`/`PAYPAL-AUTH-ALGO`/`PAYPAL-TRANSMISSION-SIG` request headers; response `{verification_status: "SUCCESS"\|"FAILURE"}` — cross-checked via GitHub code search (`mcp__github__search_code`) against multiple independent real-world PayPal Payouts webhook integrations' source (not memory alone), all agreeing on these exact field names. This endpoint/shape has been stable and unchanged across PayPal's own SDKs for years. | Medium-high — corroborated by several independent real integrations, not a single source, but no first-party PayPal doc fetch succeeded | A live PayPal sandbox webhook delivery, confirming the header names and `verification_status` field against a real `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` delivery |
| PayPal `PAYMENT.PAYOUTS-ITEM.*` event resource shape (`supabase/functions/webhooks-paypal/schema.ts`'s `parsePayoutItemResource`) | `resource.payout_batch_id` (top-level string) and `resource.payout_item.sender_item_id` (nested, matching `_shared/providers/paypal.ts`'s `createPayoutBatch` request-time `sender_item_id: referral_partner_id`) plus `resource.transaction_status`. Cross-checked via GitHub code search against several independent PayPal Payouts webhook consumers. | Medium — same corroboration basis as above | Same live sandbox delivery — inspect the raw `resource` object of a real `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` event |
| Retell `DELETE /delete-phone-number/{phone_number}` (`supabase/functions/job-offboarding/retell-delete.ts`) | Confirmed via a direct `WebFetch` of the official `retell-typescript-sdk` GitHub source (`raw.githubusercontent.com/RetellAI/retell-typescript-sdk/main/src/resources/phone-number.ts`, reachable — `docs.retellai.com` itself egress-blocked, same class of block `_shared/providers/retell.ts`'s own VERIFY note documents) — the SDK's `PhoneNumber.delete()` method builds exactly this path/verb. | High — first-party SDK source fetched directly, not a summary or memory | A live Retell sandbox account + imported number, confirming the DELETE call actually un-imports it (a 404 on retry is treated as already-done, per this file's own docstring) |
| Supabase Storage bulk-delete/list REST shape (`job-retention-sweep/index.ts`'s `removeFromStorage`, and the offboarding/retention-sweep design more broadly) | `DELETE {SUPABASE_URL}/storage/v1/object/{bucket}` with JSON body `{prefixes: string[]}`, bearer-auth with the secret key — confirmed by reading the actual installed `@supabase/storage-js@2.116.0` package source in `node_modules` (`StorageFileApi.remove()`), not a doc fetch (`supabase.com` storage docs were not separately re-tested here; the installed SDK's own source is the authority per CLAUDE.md Rule 1 item 2's "official npm SDK source" fallback). | High — read directly from the installed package's own source code | A live call against a real Supabase Storage bucket, confirming the response shape on success/partial-failure |

**Code:** `supabase/functions/webhooks-paypal/**`, `supabase/functions/job-offboarding/**`, `supabase/functions/job-retention-sweep/**`.

## Cluster G fix wave — test coverage, CI guards, marketing static rendering (2026-09-10)

### EDGE-AUDIT-M4 — Stripe/Twilio hand-rolled webhook signature schemes — **RESOLVED, both CONFIRMED exact, no code change needed**

`docs.stripe.com` and `www.twilio.com`/`twilio.com` were egress-blocked again
in this pass (same as every prior attempt logged elsewhere in this file).
Per CLAUDE.md Rule 1 item 2, confirmed instead against each provider's
official npm SDK source, fetched directly via `raw.githubusercontent.com`
(reachable) since neither `stripe` nor `twilio` is an installed
`node_modules` package in this repo — both edge functions are hand-rolled
specifically to avoid the provider-SDK-in-Deno dependency, per
`_shared/stripe-signature.ts`/`_shared/twilio-signature.ts`'s own docstrings
— so the installed-package fallback the other entries in this file used
wasn't available; the packages' own GitHub source stood in as the
equivalent first-party authority.

- **Stripe** (`supabase/functions/_shared/stripe-signature.ts`). Source:
  `stripe/stripe-node` (`master` branch), `src/Webhooks.ts`. CONFIRMED
  exact, byte-for-byte:
  - `EXPECTED_SCHEME = 'v1'`, `DEFAULT_TOLERANCE = 300` (seconds) — matches
    this file's `toleranceMs = 5 * 60 * 1000` default exactly.
  - Signed payload = `` `${timestamp}.${payload}` `` (literal dot) — matches
    this file's `` `${timestamp}.${rawBody}` `` exactly.
  - Header parsed by splitting on `,` then `=`, collecting `t` and every
    `v1` value (multiple `v1`s during secret rotation) — matches this
    file's `header.split(",")` / `part.split("=", 2)` loop exactly.
  - Verification accepts a match against **any** parsed `v1` signature
    (`details.signatures.filter(secureCompare...).length`) — matches this
    file's `v1Signatures.some((sig) => timingSafeEqual(expected, sig))`
    exactly.
  - HMAC-SHA256, hex-encoded — matches `hmacSha256Hex` exactly.
  - One behavioral difference, in the safer direction only: the SDK's own
    `constructEvent` defaults `tolerance` to `0` (skips the timestamp check
    entirely unless the caller passes one explicitly — the SDK's own source
    comment flags this as being fixed in a future major version), whereas
    this file's `verifyStripeSignature` always enforces the 300s
    `DEFAULT_TOLERANCE`-equivalent by default. Not a mismatch to fix — this
    codebase's default is strictly stricter (rejects a stale/replayed
    timestamp the SDK's own default would silently accept), so left as-is.
  - No code change. Confidence raised from High (long-stable-scheme,
    WebSearch-based) to Confirmed (first-party source-code-based).
- **Twilio** (`supabase/functions/_shared/twilio-signature.ts`). Source:
  `twilio/twilio-node` (`main` branch), `src/webhooks/webhooks.ts`
  (`getExpectedTwilioSignature`/`toFormUrlEncodedParam`) — independent
  re-confirmation of the same SDK this file's existing "Twilio — RESOLVED"
  entry above already confirmed against an older `lib/webhooks/webhooks.js`
  path; re-fetched here specifically to settle EDGE_AUDIT M4's own named
  worry ("Twilio's exact parameter-concatenation rule for non-ASCII `Body`
  values"). CONFIRMED exact, including that specific worry:
  - `toFormUrlEncodedParam(paramName, paramValue)` for a plain string value
    (which is what a `Body` field always is — the array branch only exists
    for a form field the client repeated, e.g. multi-value params, never an
    SMS body) is exactly `paramName + paramValue` — no percent-encoding, no
    escaping, no ASCII-only assumption. The whole assembled `data` string is
    then UTF-8-encoded (`Buffer.from(data, "utf-8")`) before HMAC-SHA1. This
    codebase's `message += key + (formParams[key] ?? "")` followed by
    `encoder.encode(message)` (a `TextEncoder`, UTF-8 by spec) is the exact
    same construction — a non-ASCII `Body` (emoji, accented characters) is
    concatenated as a plain JS string either way, then UTF-8-encoded once at
    the very end. There is no separate "non-ASCII rule" in the real
    algorithm for this codebase to have gotten wrong.
  - Sorted keys (`Object.keys(params).sort()`), each concatenated directly
    onto the URL with no separator, HMAC-SHA1 keyed on the auth token,
    base64 output — matches `sortedKeys`/`message += key + value`/
    `hmacSha1Base64(authToken, message)` exactly (confirms this file's
    existing high-confidence entry rather than superseding it).
  - No code change.

**Code:** no changes — both `supabase/functions/_shared/stripe-signature.ts`
and `supabase/functions/_shared/twilio-signature.ts` are unmodified;
this entry only raises documented confidence from "long-stable scheme,
docs unreachable" to "confirmed against first-party SDK source."

## DB-B2/DB-B3 repair — `scripts/ci/cron-queues-check.ts` / `.github/workflows/ci.yml`

- **Supabase CLI (`supabase status -o env`'s field names).** `supabase.com`
  returned `EGRESS_BLOCKED` from this build environment (Rule 1 item 2).
  Per that rule's fallback, confirmed instead against the CLI's own current
  source: `git clone https://github.com/supabase/cli` (reachable — GitHub,
  not `supabase.com`), `apps/cli/src/command-internal/status-values.ts`.
  Confirmed exact:
  - `-o env`'s default output var for the local Postgres connection string
    is `DB_URL` (`fieldKey: "db.url"`, `defaultName: "DB_URL"`), and it is
    "always set unconditionally, before any gating" (that file's own
    comment on `statusValuesFromState`) — i.e. present regardless of which
    services (`auth`, `studio`, ...) are enabled, unlike every other field.
  - `supabase status --help` (run locally via `npx --yes supabase status
    --help`, since the CLI binary itself is a public npm/GitHub artifact,
    not a `supabase.com` page) independently confirms `-o env`/`--output`
    as current, live flags on the installed `latest` version.
  `scripts/ci/cron-queues-check.ts` and the new `cron-queues-check` CI job
  in `.github/workflows/ci.yml` read `$DB_URL` (aliased to
  `SUPABASE_DB_URL` in the workflow) on this basis. Not independently
  re-verified end-to-end inside a live `supabase start` in this environment
  (Docker's daemon is unavailable in this sandbox — `docker ps` fails with
  "no such file or directory" for the socket); the existing `rls-probe` CI
  job's own `API_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY` reads from the exact
  same `-o env` output already run green in this repo's real CI, and this
  entry's `DB_URL` field is resolved by the identical code path in the same
  source file — same confidence class as those, not a fresh guess.

## Repair task — impersonation server-side boundary

### VERIFY-IMPERSONATION-1 — `custom_access_token_hook` input event shape

`supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook` returned
`EGRESS_BLOCKED` from this build environment when checked for the exact
input JSON fields GoTrue passes into the hook (specifically: whether a
`session_id` is present alongside `user_id`/`claims`/`authentication_method`,
which would let `20260910110000_impersonation_claim.sql`'s
`custom_access_token_hook` update bind an `impersonation_sessions` row to one
specific session rather than to a `target_user_id` generally). The existing
hook already in this repo (`20260907131400_functions_triggers.sql`) reads
only `event->>'user_id'` and `event->'claims'`, so the update in this
migration is written against that same, already-relied-upon shape rather
than guessing an unconfirmed `session_id` field. Practical consequence
(documented in the migration's own header comment): while an admin's
impersonation session for a given tenant owner is active (<=30 min,
audited start/end), that owner's own independent login would also receive
the `impersonated_by`/`impersonation_edit_enabled` claims until the session
ends or expires. Confirm the current hook event schema against live docs
before relying on this in a fresh project; if a `session_id` field exists,
`impersonation_sessions` should gain a `session_id` column and the hook
should join on it instead of bare `target_user_id`.

### VERIFY-IMPERSONATION-2 — `generate_link` (Auth Admin API) has no `app_metadata` override

Confirmed via the installed `@supabase/supabase-js`/GoTrue admin client type
declarations in `node_modules` (docs.supabase.com blocked per Rule 1 item 2
fallback): `generateLink` accepts `email`/`password`/`type`/`redirectTo`/
`data` (user metadata merged into `user_metadata`, not `app_metadata`) —
there is no parameter to inject arbitrary `app_metadata` claims at mint
time. This is why the impersonation claim is stamped by
`custom_access_token_hook` (joining the new `impersonation_sessions` table)
rather than baked into the magic-link mint call itself — option (a) from
the repair task, not (b). Re-confirm against current
supabase.com/docs/reference/javascript/auth-admin-generatelink before
relying on a future `app_metadata`-override parameter that may not exist.

## Repair task — admin cockpit proxy contract + Airtable sync truthfulness (2026-09-10)

### VERIFY-REPAIR-1 — `/api/admin/[...path]` proxy target vs. `admin/index.ts` path derivation

By the time this repair task started, `apps/web/src/app/api/admin/[...path]/route.ts`
and `supabase/functions/admin/index.ts` had already been fixed (by another
repair cluster working the same tree) to agree on the single deployed
function slug `admin` — the proxy targets
`${supabaseFunctionsUrl}/admin/${path.join("/")}` and `index.ts` strips
`/functions/v1/admin/` (not just `/functions/v1/`) before dispatching on
`ctx.path`. Confirmed by reading both files directly and by the passing
`apps/web/src/app/api/admin/[...path]/route.test.ts` (asserts the exact
constructed upstream URL) plus `supabase/functions/admin/handler.test.ts`.
No further code change was needed for this item; verifying this contract
against live Supabase Edge Functions routing docs (`supabase.com/docs/guides/functions/routing`)
was still blocked by egress in this environment — this internal
cross-file check (one registered function slug in `supabase/config.toml`,
proxy and index.ts agreeing on the same prefix) is the evidence trail.

### AIRTABLE-VERIFY-2 — Meta API "list tables for a base" shape (`airtableTablesUrl`, `AirtableTablesResponseSchema`)

`GET https://api.airtable.com/v0/meta/bases/{baseId}/tables` →
`{tables: [{id, name, ...}]}` — used once, right after OAuth connect, to
auto-pick the base's first table as the adapter's push target
(`adapter_connections.metadata.tableIdOrName`). `airtable.com/developers/web/api`
was egress-blocked in this session, same as every other Airtable item in
this file (AIRTABLE-VERIFY-1 above) — this is the same long-stable Meta
API convention that entry's Bases-list endpoint already relies on, not a
first-party fetch. Zod-validated (`AirtableTablesResponseSchema`) so a
shape mismatch fails closed: `tableIdOrName` stays unset, and
`worker-adapter-push/handler.ts`'s `pushToAirtable` honestly no-ops via its
existing `adapter_push_missing_metadata` log rather than pushing to a
guessed table. **MUST be confirmed against Airtable's own current Meta API
reference** before relying on this in production. A real per-tenant table
picker UI (letting the tenant choose instead of auto-picking the first
table) remains a follow-up, same as the existing multi-base-picker gap
already flagged in `docs/BUILD_NOTES.md`.

**Code:** `apps/web/src/app/api/tenant/delivery/airtable/{shared.ts,callback/route.ts}`.

### VERIFY-REPAIR-2 — Airtable sync-log table split, resolved by picking `adapter_sync_state` as source of truth

`apps/web/src/app/api/tenant/delivery/airtable/status/route.ts` previously
read `public.airtable_sync_state` (the older, Airtable-only table) for its
sync-log viewer, while `supabase/functions/worker-adapter-push/handler.ts`'s
`recordSyncSuccess` — shared by every T7 adapter including Airtable's
`pushToAirtable` branch — writes into the generic `public.adapter_sync_state`
table. A real push success therefore never appeared in the dashboard. Fixed
by pointing the status route at `adapter_sync_state` filtered
`provider = 'airtable'` (the writer's actual table) rather than
special-casing the writer to target the older Airtable-only table — this
keeps every T7 adapter's push-bookkeeping on one code path. RLS already
carries a tenant-scoped select policy on `adapter_sync_state`
(`adapter_sync_state_select`, `supabase/migrations/20260907160000_t7_adapter_connections.sql`)
and its `provider` CHECK constraint already includes `'airtable'`
(`supabase/migrations/20260910100000_adapter_connections_airtable_provider.sql`),
so no migration was needed for this fix — verified by reading both files
directly, not assumed. `public.airtable_sync_state` itself is now
write-orphaned (no code path inserts into it); left in place rather than
dropped, since dropping a table is outside this repair task's scope and
not requested by any other cluster.

**Code:** `apps/web/src/app/api/tenant/delivery/airtable/status/route.ts`.

### FIX-1 — `fn_enqueue_message_outbound` service_role JWT shape assumption

`public.fn_enqueue_message_outbound` (`supabase/migrations/20260910100200_
fn_enqueue_message_outbound.sql`) now branches on `current_setting('request
.jwt.claims', true)::jsonb ->> 'role' = 'service_role'` to detect a
service-role PostgREST caller (see `docs/BUILD_NOTES.md`'s FIX-1 entry for
the full bug/fix account). This assumes PostgREST, when authenticating a
request with Supabase's `service_role` API key, sets `request.jwt.claims`
to a JWT payload whose top-level `role` claim is literally the string
`"service_role"` — the same assumption every pre-existing helper in this
schema already makes for `authenticated`/`anon` (`fn_jwt_tenant_id()`/
`fn_jwt_role()` in `supabase/migrations/20260907131500_rls.sql`, unchanged
by this pass), just extended to the one remaining role value. `supabase.com
/docs` was unreachable from this environment (same egress constraint as
every other Rule-1 item in this file), so this was verified LOCALLY
instead: a throwaway-Postgres harness (`docs/BUILD_NOTES.md` FIX-1's
reproducibility section) with `set_config('request.jwt.claims', '{"role":
"service_role"}', false)` confirmed the function takes the service-role
branch and enqueues, and a second run with an `authenticated`/mismatched-
tenant claim confirmed the original no-op path is untouched — this
confirms the SQL logic is correct given the assumed claim shape, not that
a real hosted Supabase project's PostgREST actually sets that claim this
way. **MUST be confirmed against a real deployed call** (e.g. re-check
after the next live deploy that a booking-confirmation SMS sent via
`api/tenant/bookings/[id]` actually reaches `status: 'sent'`, not stuck at
`'queued'`) before treating this as fully proven in production, per
CLAUDE.md Rule 1.2's "no Docker/`supabase start`" fallback path.

**Code:** `supabase/migrations/20260910100200_fn_enqueue_message_outbound.sql`.

## GAP_REGISTER Cluster A (this pass) — packages/adapters/retell, packages/canonical-types

### VERIFY-9 — Function Node `tool_id` for a `tool_type: "local"` tool assumed to equal the tool's `name`

`retell-sdk`'s `ConversationFlowCreateParams.FunctionNode` (confirmed via
`node_modules/.pnpm/retell-sdk@5.64.0/.../src/resources/conversation-flow.ts`)
requires `tool_id: string` + `tool_type: "local" | "shared"`, but a
"local" tool declared inline in the SAME flow's top-level `tools[]`
(`CustomTool`) carries no separate `id` field at all on the wire — its doc
comment says only `name` must be unique ("Name of the tool. Must be
unique within all tools available to LLM at any given time"). This
compiler (`packages/adapters/retell/src/compiler/conversation-flow.ts`,
GAP_REGISTER §1.4 "Function-node tool locking") therefore sets
`tool_id: <the tool's name>` for every `tool_type: "local"` Function Node
it emits — a reasonable inference from the SDK types, not a documented
guarantee. `docs.retellai.com` was unreachable from this environment
(same egress constraint as every other item in this file); the assumption
should be confirmed against a live sandbox `create-conversation-flow` call
(or a Retell dashboard-authored flow with a Function Node, inspected via
`get-conversation-flow`) before this code path goes live. If wrong, the
fix is confined to `buildNode()` in `conversation-flow.ts` — nothing
downstream depends on the exact `tool_id` value beyond round-tripping it
back to Retell.

**Code:** `packages/adapters/retell/src/compiler/conversation-flow.ts`.

### VERIFY-10 — outbound `POST /v2/create-phone-call` — response fields beyond `call_id`

Endpoint path, request shape (`{from_number, to_number, override_agent_id?,
retell_llm_dynamic_variables?, metadata?}`), and the `/v2` prefix are
confirmed field-for-field against `retell-sdk`'s
`Call.createPhoneCall`/`CallCreatePhoneCallParams` (high confidence — this
is a typed SDK method body, not an inferred webhook payload). The response
(`PhoneCallResponse`) carries many more fields than this codebase reads;
`packages/adapters/retell/src/raw-types.ts`'s `zRetellCreatePhoneCallResponse`
only validates `call_id` (`.looseObject`, so extra fields never fail
parsing) since that's the only field `outbound.ts` currently needs. Low-risk
open item — confirm against a live sandbox call before outbound calling
goes live, same as every other item in this file.

**Code:** `packages/adapters/retell/src/outbound.ts`, `raw-types.ts`.

## GAP_REGISTER Cluster C/D (this pass, 2026-09-10) — supabase/functions/voice-tools, worker-adapter-push

### VERIFY-CD-1 — Square `GET /v2/bookings/{booking_id}` (retrieve booking) endpoint path/shape

`worker-adapter-push/handler.ts`'s new Square booking UPDATE/CANCEL path
(GAP_REGISTER.md §4 Cluster C — FIX-1 had disclosed every pusher was
CREATE-only) needs the booking's current `version` (Square's optimistic-
concurrency field) before either a `PUT /v2/bookings/{id}` update or a
`POST /v2/bookings/{id}/cancel`. `PUT .../bookings/{booking_id}` (update)
and `POST .../bookings/{booking_id}/cancel` were both confirmed field-for-
field via `WebFetch` against `developer.squareup.com/reference/square/
bookings-api/{update-booking,cancel-booking}` (CLAUDE.md Rule 1 — reachable
this build). The retrieve call (`GET /v2/bookings/{booking_id}`) could NOT
be independently confirmed the same way — the reference page rendered as
nav-only content to the fetch tool — so `retrieveSquareBookingVersion()`
(`worker-adapter-push/handler.ts`) assumes the standard REST convention
every other confirmed Square endpoint in this file already follows (same
base path, `{resource}/{id}` GET-to-retrieve shape used by e.g. `/v2/
orders/{order_id}`), reading `body.booking.version` from the response.
**MUST be confirmed against a live Square sandbox call** before this
update/cancel path goes live — if the path or response shape is wrong,
`retrieveSquareBookingVersion` returns `null` (already handled: the pusher
logs `adapter_push_square_retrieve_failed` and returns `false`, so a
wrong assumption here fails closed — no booking is ever silently
mis-updated/mis-cancelled — but the update/cancel push itself would never
succeed until fixed).

**Code:** `supabase/functions/worker-adapter-push/handler.ts`
(`retrieveSquareBookingVersion`, `updateSquareBooking`, `cancelSquareBooking`).

### VERIFY-CD-2 — Google Calendar `PATCH`/`DELETE` event endpoints

Confirmed field-for-field via `WebFetch` against `developers.google.com/
calendar/api/v3/reference/events/{patch,delete}` (CLAUDE.md Rule 1 —
reachable this build): `PATCH https://www.googleapis.com/calendar/v3/
calendars/{calendarId}/events/{eventId}` (partial update) and `DELETE`
same path. High confidence — standard, well-documented Calendar API v3
REST paths, matching this file's own already-confirmed `insertCalendarEvent`/
`getCalendarEvent` path shape (`_shared/providers/google-calendar.ts`).
Not flagging this as an open item; noted here only because it's new
surface added alongside VERIFY-CD-1 in the same pass.

**Code:** `supabase/functions/worker-adapter-push/handler.ts`
(`patchGoogleCalendarEvent`, `deleteGoogleCalendarEvent`).

### VERIFY-11 — GoTrue `POST /auth/v1/admin/invite` response body shape (team invite)

Confirmed the REQUEST shape (endpoint path, method, body fields, and that
`redirectTo` is sent as a `redirect_to` query parameter, not a body field)
field-for-field via `WebFetch` against `supabase/auth-js`'s
`GoTrueAdminApi.inviteUserByEmail` source
(`src/GoTrueAdminApi.ts`) — high confidence. The exact RESPONSE body shape
on success (whether the invited user's id is a top-level `id` field or
nested under a `user` key) and the exact error shape/status GoTrue returns
for an email that already has an account (assumed here: HTTP 422 and/or an
`error_code`/`msg` field matching `/already registered|already exists/i`)
were NOT independently confirmed against a live GoTrue instance or the
GoTrue OpenAPI spec's `/admin` section (that file's admin section did not
render in this build's `WebFetch` pass). `inviteUser`
(`supabase/functions/_shared/providers/supabase-admin.ts`) is written
defensively against this uncertainty — it checks both `body.id` and
`body.user?.id` for the created-user id, and treats a 422 status OR a
matching `error_code`/`msg` as "already exists" — but **should be
confirmed against a live Supabase Auth instance** before relying on the
`alreadyExists` branch in production; a wrong assumption here fails
closed in the caller (`api-team-invite/handler.ts` surfaces
`invite_failed` rather than silently dropping the invite) but the
"already exists — add directly instead" UX path may not trigger correctly
until confirmed.

**Code:** `supabase/functions/_shared/providers/supabase-admin.ts`
(`inviteUser`), `supabase/functions/api-team-invite/handler.ts`.

### VERIFY-12 — Geocod.io `GET /v2/geocode` forward-geocoding shape (repair pass, restaurant B4 fix)

MASTER_SPEC §3.0's `VERIFY:` open item ("Geocodio vs Google", BUILD_NOTES.md
line ~361/600) was picked here: Geocodio, single-address forward geocoding.
Confirmed via `WebFetch` against `www.geocod.io/docs/` (reachable in this
environment): `GET https://api.geocod.io/v2/geocode`, auth as the `api_key`
query param, address as the `q` query param, `limit=1` for a single best
match. Response: `{ results: [{ location: { lat, lng }, ... }, ...] }` —
`results[0].location.lat`/`.lng` are the fields read. Not independently
re-confirmed against a second source (single WebFetch pass) and not
exercised against a live API key (`GEOCODE_API_KEY` is unset in this build,
same as every other environment secret) — `geocodeAddress` fails closed
(returns `{ok: false}`, never throws) on a non-2xx response or a body
missing `results[0].location.lat`/`.lng`, and `create_order`'s caller ONLY
attempts the geocode+save when a `geocode` dep (fetchImpl + apiKey) is
explicitly wired in — unwired (no `GEOCODE_API_KEY`), the order still
completes exactly as before, just without ever populating
`customer_addresses.geocode` for that caller. Should be re-confirmed
against a live Geocodio account/API key before the first production
delivery order relies on the radius check actually firing.

**Code:** `supabase/functions/_shared/providers/geocode.ts` (`geocodeAddress`),
`supabase/functions/voice-tools/tools/create_order.ts` (caller, best-effort
address save after a confirmed delivery order).

## T6 — packages/templates (repair pass: batch-simulation CI harness)

### VERIFY-13 — Retell `Tests` (batch-simulation) API shape — **wrapper implemented (WAVE-2 integration pass); `transcript_snapshot` internals still unconfirmed**

**Update (WAVE-2 integration pass):** the provider-side wrapper this entry
originally flagged as missing now exists —
`packages/adapters/retell/src/tests-api.ts`'s
`createRetellBatchSimulationClient`, exported from that package's
`index.ts`. This pass also got LIVE access to `docs.retellai.com` (every
page fetched loaded normally, unlike every prior Retell VERIFY entry's
note that it stayed egress-blocked) and cross-checked
`create-test-case-definition`, `create-batch-test`, and `list-test-runs`
against the live API reference pages, not just the SDK source — all three
match the SDK types below exactly, nothing new found. The wrapper is
unit-tested (`tests-api.test.ts`) against an injected `fetchImpl`/`sleep`,
no live account needed for the plumbing itself.

**Still open, exactly as this entry originally flagged:** `transcript_snapshot`'s
internal shape. This pass's live `docs.retellai.com` fetches of
`get-test-run`/`list-test-runs` confirm the field is genuinely
undocumented beyond "object, nullable" even in the live reference (not an
egress artifact) — the SDK typing it `unknown` on purpose is accurate, not
an SDK gap. `normalizeTranscriptSnapshot` (`tests-api.ts`) is written
against the closest OFFICIALLY-DOCUMENTED sibling shape this same SDK uses
for the same concept elsewhere — the `Call` resource's
`transcript_with_tool_calls` discriminated union
(`resources/call.d.ts`: `Utterance | ToolCallInvocationUtterance |
ToolCallResultUtterance | NodeTransitionUtterance | ...`) — behind a Zod
boundary that throws a loud, specific, actionable error (never a silently
empty/default transcript) the instant a real payload doesn't match one of
a few candidate top-level array keys
(`transcript_with_tool_calls`/`transcript_object`/`turns`/`transcript`) or
turn shapes. **Action required before the live leg ships, unchanged from
this entry's original text:** a real Retell staging account run,
inspecting one actual `transcript_snapshot` payload, to confirm or correct
this parser.

BUILD_PLAN.md:56's "batch-simulation CI harness" deliverable previously
shipped only its seed data (`red-team/simulation-scenarios.ts`,
`injection-fixtures.ts`) with the actual Retell wiring left as documented
future work. This pass implements the harness itself
(`red-team/run-simulation.ts`, `grader.ts`, `simulation-types.ts`) but
could NOT exercise it against a live Retell staging account — this
sandboxed repair session has no `RETELL_API_KEY`/staging credential and is
under an explicit no-remote-operations constraint. Per CLAUDE.md Rule 1
item 2, the integration is written against a shape confirmed from the
current OFFICIAL source, with the harness itself failing closed (throws,
never fabricates a pass) when the live piece isn't wired — see
`run-simulation.ts`'s `loadRealClient`.

**Docs-first check performed:** `docs.retellai.com` was NOT reachable from
this environment this pass either (matches every prior Retell VERIFY
entry's own note that it stays egress-blocked). Per CLAUDE.md's repair-task
instructions, fell back to the officially-published `retell-sdk` npm
package's own generated source as authority (same methodology as every
`RETELL-VERIFY`-resolved item in this file) —
`node_modules/retell-sdk@5.64.0/resources/tests.d.ts`, the SDK's `client.
tests` resource. This is a genuinely separate resource from `client.
batchCall` (real outbound phone calls) and `client.call` — `tests` is
Retell's actual simulated/graded test-case-run capability
(`ProviderCapabilities.supportsBatchSimulationTesting` on
`RETELL_CAPABILITIES`, `packages/adapters/retell/src/provider.ts`).

**Confirmed shape (from `tests.d.ts`, high confidence — generated SDK
source, not a search snippet):**
- `Tests.createTestCaseDefinition({name, response_engine, user_prompt,
  metrics, dynamic_variables?, llm_model?, tool_mocks?})` → a
  `test_case_definition_id`. `response_engine` is `{type: "conversation-
  flow", conversation_flow_id, version?}` or `{type: "retell-llm", llm_id,
  version?}` — i.e. the SAME published-agent resource id
  `createOrUpdateRetellAgent`/`publishRetellAgentVersion`
  (`packages/adapters/retell/src/agents.ts`, both canonical `VoiceProvider`
  methods already in this codebase) produce, published to a STAGING account
  only (SYSTEM_DESIGN §8, G16).
- **`user_prompt` is a PERSONA description an LLM-driven simulated caller
  follows for the WHOLE call** ("User prompt to simulate in the test
  case") — NOT a literal fixed turn-by-turn script. This corrects an
  implicit assumption in this package's own prior `README.md` draft (which
  described `InjectionFixture`/`SimulationScenario` caller turns as "seeding
  one simulated call" without specifying how) — `run-simulation.ts`'s
  `buildPersonaPrompt` builds a persona instruction FROM the scripted
  `callerTurns`/`callerTurn` ("say these lines in order, then continue
  naturally") rather than passing them as literal dialogue.
- `Tests.createBatchTest({response_engine, test_case_definition_ids})` → a
  `test_case_batch_job_id`, `status: 'in_progress' | 'complete'`,
  `pass_count`/`fail_count`/`error_count`.
- `Tests.getTestRun(testCaseJobID)` / `listTestRuns(batchJobID)` →
  `TestCaseJobResponse` with `status: 'pending'|'in_progress'|'pass'|'fail'|
  'error'`, `result_explanation`, and `transcript_snapshot: unknown` (typed
  opaque by the SDK itself — "Can be either ConversationFlowPlaygroundSnapshot
  or RetellLlmPlaygroundSnapshot").
- `tool_mocks` (`{tool_name, input_match_rule: {type:'any'} | {type:
  'partial_match', args}, output, result?}`) lets a test case fake one
  tool's return value so a run never hits a live downstream integration —
  relevant for a future refinement (mocking `check_availability`/
  `create_booking` results deterministically) but not required for this
  pass's harness to be real.

**NOT independently confirmed / left for the live-account pass:** the exact
polling cadence/timeout for `status` to leave `'in_progress'`/`'pending'`;
whether `transcript_snapshot`'s actual shape is stable/documented enough to
write a permanent Zod boundary validator against (the SDK types it
`unknown` on purpose); and the exact tool-call-log field names inside that
snapshot (needed to populate this package's own provider-agnostic
`SimulationTranscript.toolCalls`/`reachedStates` — `simulation-types.ts`).
**Action required before the live leg ships:** a real Retell staging
account call, inspecting one actual `transcript_snapshot`, to write the
adapter-side normalizer (`packages/adapters/retell`, filed in
`docs/audit/FIX_REQUESTS.md`) with a Zod validator at that exact boundary,
per CLAUDE.md Rule 1.

**Code:** `packages/templates/src/red-team/{simulation-types,grader,
run-simulation}.ts`. The provider-side wrapper this shape describes,
`createRetellBatchSimulationClient`, now exists at
`packages/adapters/retell/src/tests-api.ts` (WAVE-2 integration pass — see
this entry's update note above and `docs/audit/FIX_REQUESTS.md`'s matching
entry).

## OUTREACH-2 — Outscraper Google Maps Reviews API (`/maps/reviews-v3`)

**Endpoint/params — HIGH confidence, confirmed against the official
`outscraper` npm package (`outscraper-node@2.2.2`) fetched and inspected
directly in this session (`index.js`'s own `googleMapsReviews(...)`
method body, not a search snippet):** `GET /maps/reviews-v3`, `X-API-KEY`
header auth, query params `query` (place id(s), comma-joined),
`reviewsLimit`, `limit`, `sort`, `async` — same request shape as the
already-integrated `/maps/search-v3` this codebase uses for lead fetch.
Async envelope (`id`/`results_location`, terminal `status` strings
`"Completed"`/`"Failed"`/`"Running"`) confirmed identical to the
search endpoint by the SDK's own bundled
`examples/Async Google Maps Reviews.md`. The response nests an array of
place objects, each carrying a `reviews_data` array — confirmed by the
SDK's own `examples/Google Maps Reviews.md` (`place.reviews_data.forEach(
review => console.log(review.review_text))`). The Maps Search endpoint's
own per-result `place_id` field (needed to know WHICH place id to pass to
Reviews) is likewise confirmed from that same package's
`examples/Google Maps.md` ("Scrap Places by Place Ids": `place.place_id`).

**Per-review field names beyond `review_text` — MEDIUM confidence:**
`review_rating`, `review_timestamp`, `review_datetime_utc`, and the
place-level `google_id` were confirmed against outscraper.com's own public
Google Maps Reviews API product page and pricing page, reached via this
environment's page-fetch tool — which returns an AI-summarized
reconstruction of the page's content, not raw HTML/byte inspection. The
pricing figure ($3/1,000 reviews past a 500-review free tier, $1/1,000
past 100k) matches the already-integrated Maps Search endpoint's
confirmed rate exactly, which is corroborating but not independent
confirmation of the review-specific field names. **Action before this
scoring pass is trusted for anything beyond re-ranking (e.g. before
`phone_complaint_evidence.rating`/`.date` are surfaced anywhere
customer-facing):** make one real Outscraper Reviews API call against a
live account and diff the actual response against
`OutscraperReview`/`OutscraperPlaceReviews`
(`supabase/functions/_shared/providers/outscraper.ts`) — every field is
already typed `?:` optional and the classifier's own zod boundary
(`_shared/schemas/review-score.ts`) never assumes a field is present, so a
mismatch degrades to a missing field, not a crash, in the meantime.

**Code:** `supabase/functions/_shared/providers/outscraper.ts`
(`startGoogleMapsReviews`/`pollGoogleMapsReviews`),
`supabase/functions/job-outreach-review-score/`.

## SITE REPAIR (2026-09-14) — deferred Sentry/PostHog init

**Endpoint/feature:** `@sentry/nextjs`'s `Sentry.init()` (browser SDK,
`apps/web/instrumentation-client.ts`) and `posthog-js` (via
`@heyloo/analytics`, invoked from `apps/web/src/app/providers.tsx`) —
both moved from an eager, module-scope call to a dynamic `import()`
deferred until the visitor's first interaction or a 4s fallback timeout
(`apps/web/src/lib/perf/defer-non-critical.ts`), to bring the home
route's initial JS back under the creative brief's binding 250KB gz
budget (measured 955.2KB gz before this change, Sentry the single
largest contributor).

**Assumed shape / tradeoff:** Sentry's own docs (fetched live,
docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build,
plus the SDK's GitHub issue tracker) confirm dynamic-`import()`
code-splitting is a valid, documented way to keep the SDK's weight out of
an initial bundle, but are explicit that deferring `Sentry.init()` means
errors that occur before it initializes are missed and tracing data can
lose some accuracy — an accepted tradeoff here for the binding perf
budget, not an oversight. No page specifically titled a
"lazy-loading Sentry.init" guide was found on docs.sentry.io as of this
session (a fetch of a guessed URL 404'd) — **VERIFY before relying on
this further:** re-check docs.sentry.io/platforms/javascript/guides/nextjs
for a first-party lazy-init pattern (e.g. a lighter loader script) that
might supersede this dynamic-import approach.

**Code:** `apps/web/instrumentation-client.ts`,
`apps/web/src/app/providers.tsx`,
`apps/web/src/lib/perf/defer-non-critical.ts`.

## SITE REPAIR (2026-09-14, 2nd pass) — Sentry moved out of the global
## client instrumentation file entirely; marketing/signup lose browser
## error monitoring

**Endpoint/feature:** `@sentry/nextjs`'s `Sentry.init()`, browser side.
The deferred-`import()` above was real and correct, but a further
measurement found it insufficient on its own: `instrumentation-client.ts`
is a Next.js convention loaded on EVERY route unconditionally (Next's own
docs: "this file runs before your application becomes interactive"), so
the SDK stayed reachable from the marketing route's build-time module
graph regardless of when the code inside it actually ran. `Sentry.init()`
now lives in a new component, `apps/web/src/lib/perf/sentry-init.tsx`'s
`<SentryInit>` (same deferred-`import()`/first-interaction pattern),
mounted only from the `(tenant)`/`(admin)`/`(partner)` root layouts —
never from `(marketing)/layout.tsx` or the shared `[locale]/layout.tsx`.
`instrumentation-client.ts` itself is now `export {}` — no
`@sentry/nextjs` reference anywhere in it.

**Tradeoff (deliberate, not an oversight):** marketing pages — the
homepage, pricing, demo, and every page under `signup/**` (the signup
flow lives inside the `(marketing)` route group) — no longer get
browser-side Sentry error monitoring at all. Server-side error capture
(`apps/web/instrumentation.ts`, Node runtime) is unaffected — this is
strictly a client-side/browser-JS-error gap. If this tradeoff is
reconsidered later, the DSN/env wiring in `sentry-init.tsx` is unchanged
from the original `instrumentation-client.ts` code, so re-enabling it
marketing-wide is a matter of mounting `<SentryInit>` from
`[locale]/layout.tsx` instead (accepting the JS-budget cost that was the
whole reason it was moved) rather than any new integration work.

**Code:** `apps/web/instrumentation-client.ts`,
`apps/web/src/lib/perf/sentry-init.tsx`,
`apps/web/src/app/[locale]/{(tenant),(admin),(partner)}/layout.tsx`.

## OPS-3 (2026-09-20) — why worker-messages-outbound's specific edge
## function path was the disproportionately lossy one

**Endpoint/feature:** Supabase's Edge Functions gateway/routing layer
(`https://qulcubtwqsqgqpfgvorn.supabase.co/functions/v1/<name>`) — not a
third-party API this repo calls, but the platform's own request routing
for its deployed functions.

**What was confirmed (CLAUDE.md Rule 1 — fetched live this session, cited
in `docs/BUILD_NOTES.md` OPS-3):** pg_net (`github.com/supabase/pg_net`
`src/worker.c`) runs one persistent background worker with one persistent
`curl_multi_init()` handle and no per-host connection cap or HTTP-version
override; libcurl's own docs (`curl.se/libcurl/c/CURLMOPT_PIPELINING.html`)
confirm HTTP/2 multiplexing (`CURLPIPE_MULTIPLEX`) has been on by default
since curl 7.62.0 and multiplexes concurrent transfers to the same host
over one shared connection when added to the same multi handle — both
facts a live experiment's result is consistent with (loss followed the
target *function*, not the cron job/dispatch slot).

**What was NOT confirmed:** the precise, final-mile reason
worker-messages-outbound's specific `/functions/v1/worker-messages-outbound`
path was the one that was disproportionately slow/lossy at Supabase's edge
in that experiment (a per-function concurrency/cold-start limit? a
region-routing quirk? something specific to that function's own request
handling under Supabase's gateway?) — this would need Supabase's own
current edge-functions-routing/infra docs (supabase.com/docs/guides/
functions), which were not fetched for this specific question this
session (time-boxed to the assigned OPS-3 experiment + fix). The fix
applied (one combined `net.http_post` per minute via a new `worker-tick`
function instead of three concurrent ones to the same host) removes the
condition the evidence pointed to regardless of this final-mile detail,
so it was not blocking, but the underlying "why that one path" question
is still open.

**Code:** `supabase/functions/worker-tick/handler.ts`'s header comment
(cites the same sources), `docs/BUILD_NOTES.md` OPS-3 entry (full
experiment log).
