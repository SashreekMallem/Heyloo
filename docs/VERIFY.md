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

| Item | Assumed shape | Confidence | Confirm against |
|---|---|---|---|
| Webhook signature scheme | `X-Retell-Signature: v=<unix_ms>,d=<hex HMAC-SHA256>`; digest = HMAC-SHA256(secret=webhook-badge API key, message=rawBody+timestamp, direct concatenation) | Medium — header format and "API key as secret" confirmed via WebSearch (Hookdeck's Retell webhook guide, Retell community forum); the exact concatenation (no separator) is inferred from "always verify against raw body" guidance, not read from source | `docs.retellai.com/features/secure-webhook`, or the `retell-sdk` npm package's own `verify()` source |
| `/voice-inbound`, `/voice-tools`, `/voice-events` request shapes | Canonical shapes per BACKEND_SPEC §7.1-7.3 (call_id/from_number/to_number/agent_id; call_id/name/args; event+call object) | Low-medium — BACKEND_SPEC itself flags these as its own canonical assumption, not verified against Retell's live reference | Retell's webhook + custom-function API reference |
| `call.call_analysis.custom_analysis_data` carrying `classification`/`outcome`/`follow_up_needed`/`legal_advice_given`/`emergency_detected` keys | Assumed the compiled template's per-state `extraction[]` fields land here under these literal names | Low — invented mapping, not sourced | Confirm against T2's actual Retell compiler output once built |
| `GET /v2/get-call/{id}`, `POST /create-agent`, `POST /publish-agent/{id}`, `POST /import-phone-number`, `POST /v2/create-web-call` REST paths | `api.retellai.com`, bearer auth | Medium — training-knowledge-confident Retell v2 REST shape | Retell API reference |
| `transfer_call` warm-transfer context-summary mechanism | Not implemented in this build (native Retell function, configured at template-compile time — T2's compiler) | N/A | Retell's transfer-call/handoff-summary docs before T2's compiler wires it |
| Health-check probe (`job-retell-health-failover`) | `GET /list-agents?limit=1` used as a lightweight reachability check | Low — no dedicated health/status endpoint confirmed to exist | Retell API reference / status page docs |
| Failover mechanism (flipping a Twilio number away from Retell) | Assumes `IncomingPhoneNumbers.VoiceUrl` update is sufficient | Low — Retell-imported numbers may route via a SIP trunk/domain instead of a plain voice webhook | Retell's phone-import docs; Twilio SIP trunking docs if so |

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
| Retell `/publish-agent-version/{id}` endpoint name | Corrected from T3's `_shared/providers/retell.ts` guess of `/publish-agent/{id}` to match T2's independently-researched `packages/adapters/retell/src/agents.ts` (`publishRetellAgentVersion`) | Same confidence as T2's own VERIFY-6 entry (Medium) | Retell API reference |
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
