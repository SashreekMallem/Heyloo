# API & Flows — Integration Contract

This is the integration contract build agents code against for every
third-party call the product makes (Part A) and for the numbered,
component-level walkthrough of every cross-system flow (Part B). It is
downstream of `docs/SYSTEM_DESIGN.md` (architecture/product authority),
`docs/MASTER_PLAN.md`/`docs/BUILD_PLAN.md` (business decisions, task waves),
and `docs/spec/BACKEND_SPEC.md` (schema/function granularity) — table,
column, function, and task-id names below match those documents exactly.

Per `CLAUDE.md` Rule 1, every entry below was checked against reachable
official documentation at write time (Sept 2026); where the docs site itself
was unreachable from this environment (`docs.retellai.com`, `www.twilio.com`
block outbound `WebFetch` here — only their content indexed by web search was
reachable, itself sourced from those same official docs), the entry says so
and is additionally marked **`VERIFY:`** with what a build agent must confirm
against a live sandbox/account before shipping the call site, per Rule 1
item 2. Nothing here should be copy-typed into code without also adding the
runtime Zod validator at the boundary that Rule 1 requires.

---

# Part A — External API Map

## A.1 Retell (voice provider, behind `VoiceProvider` / `packages/adapters/retell`, T2/T3)

All Retell calls are REST, `Authorization: Bearer <RETELL_API_KEY>`, base
`https://api.retellai.com`. Every call in this section lives only inside
`packages/adapters/retell` — no other package may reference a Retell payload
shape directly (CLAUDE.md Rule 2).

### Agent lifecycle: create / update / delete agent

- **Purpose:** materialize a tenant's compiled `agent_configs` row as a live
  Retell agent (or update one after a template/config change).
- **Endpoint:** `POST /create-agent`, `PATCH /update-agent/{agent_id}`,
  `DELETE /delete-agent/{agent_id}`. Body sets `response_engine` (pointing at
  the conversation-flow/LLM id below), `voice_id` (ElevenLabs id, portable
  per SYSTEM_DESIGN §3), and webhook URLs.
- **Auth:** Bearer API key (workspace-scoped).
- **Called from:** provisioning saga step "compile + create agent" (T4, Flow
  2 step 4) and the template-update staged-publish path (T6, Flow 9); never
  called from the hot request path.
- **Rate limits/cost:** no published per-endpoint rate limit found; agents
  themselves are free to create — cost accrues only per-call. **VERIFY:**
  exact write-QPS ceiling and any per-workspace agent-count ceiling — this is
  one of the Week-0 Retell support tickets SYSTEM_DESIGN §13 already calls
  out ("agent ceiling, rate limits").
- **Failure handling:** provisioning saga step is retried with the tenant's
  idempotency key (config row not marked `published_at` until success);
  create/update failures surface as a provisioning-saga alert, never a
  silent partial tenant state.

### Conversation flow / LLM: create + publish version

- **Purpose:** lower the canonical `agent_templates.states/transitions/
  global_intents/tools` graph (BACKEND_SPEC §1.3) into Retell's Conversation
  Flow format (or multi-prompt/single-prompt for legal/real-estate/generic
  per SYSTEM_DESIGN §4.1), then publish an immutable version.
- **Endpoint:** `POST /create-conversation-flow-component` /
  `POST /create-conversation-flow`, `PATCH /update-conversation-flow/{id}`,
  then `POST /publish-agent-version/{agent_id}`. Published versions are
  immutable and can be pinned to a phone number or an environment tag
  (staging vs prod), which is exactly how G16 (staging Retell account for
  CI) and Flow 9 (staged template rollout) are implemented.
- **Auth:** Bearer API key.
- **Called from:** template compiler (`packages/adapters/retell`, T2) at
  publish time; the compiler refuses to call publish if the compiled output
  does not contain the `disclosure_line` verbatim in the first turn
  (BACKEND_SPEC §1.3 — a CI gate, not just a code-review convention).
- **Rate limits/cost:** community reports show `PATCH /update-conversation-
  flow/{id}` can 400 on a flow that is already referenced by a *published*
  agent version — the documented workflow is update-flow → update-agent →
  publish-agent-version, and a flow shared by multiple agents propagates to
  all of them, so multi-tenant flows must be tested on a non-production
  agent first. **VERIFY:** exact 400 conditions and whether "one flow per
  tenant" vs "one flow per template version, referenced by many tenants'
  agents" is the safe multi-tenant pattern — confirm against a staging
  workspace before Wave 1 goes live (SYSTEM_DESIGN §13 Week-0 ticket:
  "publish reliability").
- **Failure handling:** publish failures block the provisioning saga /
  template rollout at that step and alert; never silently fall back to an
  unpublished draft serving live traffic.

### Phone number: create (buy through Retell) vs import (bring Twilio number)

- **Purpose:** attach the tenant's Twilio-owned number (SYSTEM_DESIGN §2 —
  "we own ALL numbers in Twilio, never the voice vendor") to the compiled
  agent, inbound and (later) outbound.
- **Endpoint used:** `POST /import-phone-number` — **not** `/create-phone-
  number` (that endpoint buys a Retell-managed number directly from Retell,
  which we deliberately never do, per the anti-lock-in decision). Import
  requires Twilio Elastic SIP Trunking enabled on the purchased number first;
  body: `phone_number` (E.164), `termination_uri` (`<trunk>.pstn.twilio.com`
  for Twilio), `inbound_agent_id`, optional `outbound_agent_id`, optional SIP
  trunk auth username/password, optional country restriction.
- **Auth:** Bearer API key.
- **Called from:** provisioning saga step "import number" (T4, Flow 2 step
  5), immediately after the Twilio `IncomingPhoneNumbers` purchase (A.2).
- **Rate limits/cost:** Retell numbers ~$2/mo per MASTER_PLAN §2 economics
  table (import is the same underlying resource, cost is per-minute
  telephony, not per-import-call). **VERIFY:** exact SIP trunk credential
  rotation/expiry semantics, and Retell's documented webhook egress region
  (Week-0 ticket, SYSTEM_DESIGN §2/§5/§13 — edge functions must be pinned to
  the same region for the latency budget).
- **Failure handling:** import failure retried with the Twilio number left
  purchased-but-unrouted (TwiML still points nowhere dangerous); saga alert;
  no tenant goes live on a number that failed import.

### Inbound webhook (Retell → us): the dispatch resolver

- **Purpose:** at the start of every call, resolve number → tenant → agent
  config → dynamic variables, and optionally override which agent handles
  the call — this is Retell's "call_inbound" webhook, hit synchronously
  before/at call start.
- **Endpoint (ours):** `POST /voice/inbound` (Supabase edge function, T3).
  Retell calls this against the URL configured on the phone number /
  agent's inbound webhook setting.
- **Auth:** HMAC signature verification — Retell signs webhooks with
  HMAC-SHA256 keyed on the account's API key; header `X-Retell-Signature`,
  format `v={unix_ms_timestamp},d={hex_digest}` over `raw_body + timestamp`.
  Verify against the **raw** body before parsing JSON (CLAUDE.md Rule 2);
  reject (fail closed) on missing/invalid signature or stale timestamp
  (clock-skew window, SYSTEM_DESIGN §8).
- **Called from:** `/voice/inbound` (T3), hot path budget same as tool calls
  — p50<200ms/p95<500ms — since it gates when the caller starts hearing
  audio.
- **Rate limits/cost:** none published beyond the generic 10s timeout/3-retry
  webhook delivery policy (see call-events entry below, same delivery
  mechanics apply). **VERIFY:** confirm the exact webhook name/payload shape
  Retell uses for the pre-call dynamic-variable-injection hook (community
  sources call it "call_inbound"/"Inbound Webhook" inconsistently; some
  material describes it as part of the same webhook-overview surface as
  call_started) against a live sandbox call before building `/voice/inbound`
  parsing.
- **Failure handling:** if `/voice/inbound` errors or exceeds the timeout,
  the call must not silently drop — SYSTEM_DESIGN's hot-path rule is a
  graceful fallback ("I'll take your details...") rather than relying on
  Retell's own retry/timeout as the failure path.

### Tool-call webhook (Retell → us): the hot path

- **Purpose:** every in-call tool invocation (`check_availability`,
  `create_booking`, `lookup_customer`, `send_message`, vertical-specific
  tools) — Retell's LLM decides to call a tool, POSTs to our configured
  Custom Function URL, and narrates our JSON response back to the caller.
- **Endpoint (ours):** `POST /voice/tools` (T3). One handler, dispatched by
  tool `name` to canonical `ToolCall{name, args, callId}` →
  `ToolResult` shapes (never raw Retell payload past the adapter boundary,
  CLAUDE.md Rule 2).
- **Auth:** same HMAC signature scheme as above; additionally, **tool-level
  authorization** (G6) is enforced in the handler itself, not just at the
  webhook layer — `lookup_customer` scoped to the caller's own E.164 number
  by default, `transfer_call` destinations resolved only from
  `agent_configs.transfer_number` (tenant-config-only), never from anything
  the caller said.
- **Called from:** `/voice/tools` (T3); this is *the* latency-budgeted path
  (p50<200ms, p95<500ms, hard abort 1.5s → graceful fallback, filler speech
  on every call) per SYSTEM_DESIGN §5. Circuit breaker: rolling per-tool
  error/timeout rate >20%/min short-circuits new calls into message-taking
  mode.
- **Rate limits/cost:** Retell's own request timeout to our endpoint is
  documented as part of the general webhook delivery policy (10s, 3
  retries) — but SYSTEM_DESIGN explicitly forbids ever relying on that as
  the failure path; our own 1.5s abort must fire first.
- **Failure handling:** timeout/error inside 1.5s → return a fallback tool
  result ("I'll have someone confirm and text you") rather than let Retell's
  retry re-invoke a non-idempotent write; booking-writing tools are
  idempotent via `bookings.idempotency_key = call_id + slot` so a Retell
  retry that *does* land twice is a no-op, not a duplicate (BACKEND_SPEC
  §1.4).

### Call events webhook (Retell → us): `call_started` / `call_ended` / `call_analyzed`

- **Purpose:** call lifecycle notifications — three (or four, including
  `transcript_updated`) webhook events per call, all sharing the same
  `call_id`.
- **Endpoint (ours):** `POST /voice/events` (T3): verify signature against
  raw body → idempotent insert into `webhook_events` (unique `(source,
  event_id)`, BACKEND_SPEC §1.5) → **fast 2xx ack** → background work
  (recording pull, cost ingestion, notification fan-out — Flow 1 steps 8–10).
- **Auth:** same `X-Retell-Signature` HMAC scheme as above. Fail closed:
  missing secret/signature = reject, never skip (CLAUDE.md Rule 2).
- **Called from:** background processing triggered off `/voice/events`;
  ordering is **not** guaranteed (`call_ended` can arrive before
  `call_started` per SYSTEM_DESIGN §8) — the handler must tolerate either
  order via upsert-by-`retell_call_id`, not insert-only.
- **Rate limits/cost:** delivery is POST with a 10-second timeout; no 2xx
  within 10s triggers a retry, up to 3 total attempts. This is why the
  handler must ack fast and defer real work to a queue (pgmq worker), not do
  recording/cost work inline.
- **Failure handling:** `webhook_events` unique constraint makes retried
  deliveries a no-op; nightly `get-call` reconciliation (below) is the
  safety net for any call whose webhooks never arrived or errored past
  retries.

### GET /get-call reconciliation

- **Purpose:** authoritative pull-based backfill for cost + analysis data —
  the nightly safety net for webhook loss, and the source for the itemized
  `product_costs[]` cost breakdown ingested into `cost_events`.
- **Endpoint:** `GET /get-call/{call_id}`. Response includes `call_cost`
  (`product_costs[]`, each `{product, cost, unit_price, is_transfer_leg_cost}`
  plus `total_duration_seconds`, `total_duration_unit_price`,
  `combined_cost`), `call_analysis`, and transcript fields.
- **Auth:** Bearer API key.
- **Called from:** pg_cron nightly reconciliation job (T3/BUILD_PLAN Wave 1)
  — scans `call_logs` for rows missing `cost_cents`/`classification` past a
  threshold age and backfills via this endpoint; also callable ad hoc from
  the admin cockpit's per-call cost-vs-billed page for a manual re-pull.
- **Rate limits/cost:** read-only, no cost beyond the API call itself.
  **VERIFY:** per-call cost schema stability is another explicit Week-0
  ticket in SYSTEM_DESIGN §13 ("cost schema") — confirm `product` enum
  values per LLM/TTS/telephony vendor Retell may route through, since the
  margin cockpit's provider-repricing-drift alert depends on `raw` jsonb
  matching what the cockpit's parsers expect (BACKEND_SPEC `cost_events.raw`).
- **Failure handling:** reconciliation failures on a given call are logged
  and retried the next night; they never block that call's already-written
  booking/customer data (in-call tool writes are authoritative and
  independent of this enrichment pass, SYSTEM_DESIGN §4.4).

### Batch tests / LLM simulation testing (CI gate, T6)

- **Purpose:** the adversarial red-team + regression suite that gates every
  template publish (Flow 9) — an AI-simulated caller runs a scripted
  scenario against the compiled agent in text, and a graded pass/fail with a
  written explanation becomes the CI signal.
- **Endpoint:** Retell's Simulation/Batch Testing surface (test cases =
  `{user_prompt describing the simulated caller, LLM the simulated user runs
  on}`, run singly or as a batch against a target agent/version).
- **Auth:** Bearer API key, run **only against the staging Retell account**
  (G16 — never test against prod agents).
- **Called from:** CI batch-simulation harness (T6) on every template PR;
  gates the staged-publish flow (Flow 9).
- **Rate limits/cost:** simulated runs are text-only against an LLM, cheaper
  than real voice calls, but **cannot** validate background-noise handling
  or interruption/barge-in behavior — those require real voice-call testing,
  a documented limitation. The batch-test API also excludes custom-LLM
  agents (`response_engine` must be `retell-llm` or `conversation-flow`,
  which matches our compile targets). **VERIFY:** exact request/response
  schema and pass/fail grading contract against the staging account before
  wiring CI — this skill's own out-of-session fetch of `docs.retellai.com`
  is blocked in this environment, so schema fields above are from indexed
  search snippets only, not a first-party fetch.
- **Failure handling:** any failed test case blocks publish; the harness
  reports per-case transcripts for triage, not just pass/fail counts.

### Concurrency

- **Purpose:** know current live-call concurrency vs the account's limit —
  feeds the margin cockpit's "concurrency 80%" alert rule (SYSTEM_DESIGN
  §11) and the per-tenant concurrency model (G27 — second simultaneous call
  to one tenant gets a second agent instance, monitored against the pool).
- **Endpoint:** `GET /get-concurrency` → `{base_concurrency, ...}` (SDK:
  `client.concurrency.retrieve()`).
- **Auth:** Bearer API key.
- **Called from:** a lightweight periodic poll (could double as the Retell
  outage synthetic health-check probe, Flow 6) and the admin cockpit's
  bottleneck view.
- **Rate limits/cost:** default concurrency is 20 free concurrent
  calls/lines, then **$8/mo per additional line** (MASTER_PLAN §2 economics
  table); this is called out in SYSTEM_DESIGN §5 as "the first wall" before
  Postgres throughput ever becomes an issue at realistic call volumes.
- **Failure handling:** approaching-limit alert (80% threshold) surfaces in
  the cockpit before calls start hard-failing with `concurrency_limit_
  reached`; a hard-limit hit for a tenant should degrade gracefully (queue
  message / voicemail) rather than drop the caller.

### SMS sending path

- **Purpose:** customer SMS confirmations, business notifications, and
  two-way SMS conversations with the AI agent itself.
- **Endpoint:** Retell ships a native **chat-agent SMS channel** — the same
  agent prompt/tools/knowledge-base config can run over SMS via Retell's
  chat agents, integrated through Twilio numbers that have passed A2P 10DLC
  (`POST /create-sms-chat` / `create-chat-completion` for outbound/inbound
  SMS chat turns; SMS Node available inside Conversation Flow). This is
  **US-only, excludes toll-free numbers**, and requires the number's A2P
  campaign to be verified — otherwise our own direct-Twilio SMS path (A.2)
  is used for simple templated notifications (booking confirmations,
  after-hours alerts) that don't need the LLM.
- **Auth:** Bearer API key for the Retell-side call; underlying delivery
  still rides the same Twilio number/campaign.
- **Called from:** (a) two-way SMS conversation continuation — when a caller
  texts back after a call, Retell's chat agent handles it using the same
  canonical template; (b) simple one-shot notifications (booking
  confirmation, usage alerts, after-hours notice) are sent **directly via
  Twilio Messages API** (A.2), not through Retell, since they're templated
  text with no need for LLM narration — this is `messages_outbound.channel
  = 'sms'` in BACKEND_SPEC §1.5, `provider_message_id` = the Twilio SID.
- **Rate limits/cost:** SMS/MMS billed per Twilio's standard messaging
  rates plus whatever Retell's chat-agent minute-equivalent pricing is for
  agent-driven SMS turns. **VERIFY:** Retell's chat-agent SMS pricing unit
  (it is not documented alongside per-minute voice pricing in the sources
  reachable here) — confirm before the margin cockpit tries to attribute
  SMS-channel cost to `cost_events`.
- **Failure handling:** while a tenant's number is in the "SMS pending
  verification" A2P state (G4, 1–5 business days), SMS sends fail closed
  with an **email fallback** rather than a silently-swallowed message
  (SYSTEM_DESIGN §7); `messages_outbound.status = 'pending_verification'`
  is the explicit state for this, never a bare `'failed'`.

---

## A.2 Twilio (telephony — WE own every number, never the voice vendor)

Base `https://api.twilio.com` (Voice/Numbers) and
`https://lookups.twilio.com` (Lookup). Auth: HTTP Basic (Account SID as
username, Auth Token as password) or an API Key/Secret pair scoped to a
subaccount if tenant-level subaccounts are ever adopted (not decided in
SYSTEM_DESIGN — flat single-account model assumed for Wave 1).

### Number search / purchase

- **Purpose:** find and buy the number a new tenant will use, area-code
  matched to their business address.
- **Endpoint:** `GET /2010-04-01/Accounts/{Sid}/AvailablePhoneNumbers/
  {CountryCode}/Local.json` (or `/TollFree.json`), then `POST
  /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers.json` with the chosen
  `PhoneNumber`.
- **Auth:** Basic (Account SID/Auth Token).
- **Called from:** provisioning saga step "buy number" (T4, Flow 2 step 5).
- **Rate limits/cost:** number cost ~$1–2/mo per MASTER_PLAN §2 economics
  ("numbers ~$2/mo"); no unusual rate limit on search/buy for our low
  provisioning volume.
- **Failure handling:** no numbers found in the requested area code → saga
  falls back to a nearby area code or a toll-free number, surfaced to the
  signup flow rather than silently stalling provisioning.

### Number configuration (voice webhook / SIP trunk / failover routing)

- **Purpose:** point the purchased number at the Retell SIP trunk normally,
  and at the failover TwiML (`<Dial>` owner cell / `<Record>` voicemail)
  during a Retell outage (Flow 6) — this is a plain
  `IncomingPhoneNumbers` **update**, not a Retell-side call.
- **Endpoint:** `POST /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers/
  {NumberSid}.json` — `VoiceUrl`/`TrunkSid` fields, or Elastic SIP Trunking
  origination-URI config once the number is enrolled in a trunk (required
  before Retell can `import-phone-number` it, A.1).
- **Auth:** Basic.
- **Called from:** provisioning saga (initial setup), Retell health-check
  failover job and its recovery counterpart (T3, Flow 6).
- **Failure handling:** the failover flip itself must be idempotent/cheap
  (single field update) since it fires under outage pressure; a failed flip
  retries immediately rather than leaving calls stuck mid-transition.

### Port-in API (customer bringing an existing number in)

- **Purpose:** onboard a tenant who wants to keep their existing published
  number rather than get a new one, and — symmetrically — the guaranteed
  port-**out** SLA at offboarding (G7, Flow 8) works the other direction
  through the same porting surface.
- **Endpoint:** `PortIn` resource (Public Beta as of the sources reachable
  here) — bulk/single port requests up to 1,000 numbers per request, with
  Twilio auto-generating and emailing a digitally-signed electronic LOA to
  the authorized representative (no manual LOA PDF needed).
- **Auth:** Basic.
- **Called from:** an onboarding-flow branch (not the default happy path —
  most new tenants take a fresh number per MASTER_PLAN's default forwarding
  wizard design) and the offboarding/port-out flow (Flow 8) when the
  *losing* side is us.
- **Rate limits/cost:** porting SLA is carrier-dependent (days), not an API
  rate limit concern. **VERIFY:** current production availability of the
  Porting API (listed as Public Beta in the sources reachable here) —
  confirm GA status and any beta waitlist requirement before building the
  self-serve port-in step of signup.
- **Failure handling:** port requests can be rejected by the losing carrier
  (wrong account info, number not eligible) — surfaced as a tenant-visible
  status, not a silent stall; number stays on the old carrier and forwarding
  wizard's temporary-number path is offered as a bridge.

### A2P 10DLC brand + campaign registration (reseller/ISV flow)

- **Purpose:** register the platform as an ISV/reseller brand so every
  tenant's number can send compliant SMS, per G4.
- **Endpoint:** `BrandRegistration` resource
  (`POST /v1/a10dlc/BrandRegistrations` under Messaging), then a
  Campaign/Use-Case resource per tenant registered against that brand via
  the documented ISV API walkthrough (`onboarding-isv-api` guide — separate
  paths exist for Standard/Low-Volume-Standard vs Sole-Proprietor brands).
  Twilio's own guidance: **rate-limit Brand/Campaign registration API
  requests to 1/sec.**
- **Auth:** Basic, under the platform's own primary Business Profile set to
  Business Type = "ISV Reseller or Partner."
- **Called from:** Week-0 setup (platform-level brand, started early per
  SYSTEM_DESIGN §13 — "lead time!") once; per-tenant campaign registration
  fires during provisioning (T4, Flow 2 step 6), non-blocking, with the
  tenant sitting in `messages_outbound`-adjacent "SMS pending verification"
  state (1–5 business days) until TCR vets the campaign.
- **Rate limits/cost:** 1 req/sec self-imposed cap per Twilio's own
  recommendation; campaign vetting fees are a per-campaign Twilio/TCR cost,
  not per-API-call.
- **Failure handling:** a rejected/failed campaign vet must **never**
  silently fail confirmations — SYSTEM_DESIGN §7 requires an explicit
  pending-verification UI state with an **email fallback** so the tenant
  isn't left thinking SMS is working when it isn't.

### Lookup API v2 (carrier detection for the forwarding wizard)

- **Purpose:** detect the tenant's existing phone's carrier during the
  forwarding wizard so we can render carrier-specific conditional-forward
  instructions (e.g. `*61`/`*71` style codes vary meaningfully by carrier).
- **Endpoint:** `GET /v2/PhoneNumbers/{PhoneNumber}?Fields=line_type_
  intelligence` (and/or `Fields=carrier` on Lookup v1-equivalent data folded
  into v2). Line Type Intelligence returns mobile/landline/fixed-VoIP/
  non-fixed-VoIP/toll-free classification and carrier name, worldwide.
- **Auth:** Basic.
- **Called from:** the forwarding wizard step of onboarding (T5 frontend +
  a thin backend proxy route, Flow 2 step 8) — this is a **paid** Lookup
  data package per lookup, so it's called once per tenant during wizard
  setup, not repeatedly.
- **Rate limits/cost:** billed per lookup call; no unusual rate ceiling for
  our onboarding-time call volume. **VERIFY:** current per-lookup price for
  the `line_type_intelligence` package specifically (pricing pages were not
  independently fetched here).
- **Failure handling:** lookup failure/unknown carrier → wizard falls back
  to a generic "most carriers" instruction set plus a manual "verify by
  placing a test call" step (the verification call, Flow 2 step 9, is
  authoritative regardless of what Lookup says).

### SMS (direct Twilio path, for simple templated notifications)

- **Purpose:** booking confirmations, after-hours notices, usage alerts —
  anything that doesn't need the LLM to narrate, sent faster/cheaper direct
  from our backend than round-tripping through a Retell chat agent.
- **Endpoint:** `POST /2010-04-01/Accounts/{Sid}/Messages.json`
  (`MessagingServiceSid` preferred over a bare `From` number so sender
  selection/A2P compliance is centrally managed) with `StatusCallback` set
  to our webhook.
- **Auth:** Basic.
- **Called from:** notification fan-out at booking/order write time (Flow 1
  step 12), usage-alert cron (Flow 3 step 2), forwarding-wizard/verification
  confirmations.
- **Rate limits/cost:** standard Twilio per-segment SMS pricing; Messaging
  Service throughput limits apply per number/campaign class, not something
  our per-tenant volume should hit.
- **Failure handling:** delivery status callback (`queued→sent→delivered/
  undelivered/failed`) updates `messages_outbound.status`; a hard failure
  (unregistered A2P campaign, carrier filtering) does **not** retry
  silently — it surfaces as a dashboard/email-fallback path, matching the
  Retell-SMS entry above.

### Spam-score / reputation (STIR/SHAKEN + CNAM, inbound gate + outbound reputation)

- **Purpose:** (inbound, G8) reject/deprioritize spoofed or low-attestation
  robocalls before they ever reach Retell and burn paid minutes; (outbound,
  G9) keep our tenants' caller-ID from being flagged "Potential Spam" by
  carrier analytics.
- **Endpoint/mechanism:** Twilio performs STIR/SHAKEN verification
  automatically on inbound calls to Twilio local numbers and adds a
  `StirVerstat` parameter to the voice request webhook (values reflect
  attestation level A/B/C — A = fully verified caller ID, C = fails
  requirements, common for spoofed/international robocalls); CNAM
  registration and attaching purchased numbers to our approved Business
  Profile is what earns outbound calls **A-level attestation** in the first
  place, which is itself an input to third-party call-analytics spam
  scoring (Twilio's own "Voice Integrity" product surfaces spam-likelihood
  signals too).
- **Auth:** none beyond the standard voice-webhook request (Basic covers any
  Voice Integrity API calls if used).
- **Called from:** `/voice/inbound` resolver (T3) reads `StirVerstat`
  (and any Voice Integrity spam-score field, if that add-on product is
  enabled) as an early gate — attestation C + known-spam pattern routes to
  the fast dead-air/hang-up path (`spam_robocall` classification,
  SYSTEM_DESIGN §4.2) before ever invoking the LLM, so junk calls "never
  burn paid minutes."
- **Rate limits/cost:** Voice Integrity spam-score lookups are a paid
  add-on if used; STIR/SHAKEN attestation itself is included with Twilio
  voice, no extra call. **VERIFY:** whether Voice Integrity (or an
  equivalent third-party spam-score product) is actually provisioned for
  Week 0 — SYSTEM_DESIGN §7/§13 requires the gate but doesn't name a
  specific paid product to wire; confirm against Twilio's current Voice
  Integrity offering and pricing before committing to a specific API shape.
- **Failure handling:** missing `StirVerstat` (e.g., non-Twilio-originated
  legs, older carriers) means the gate falls back to the existing
  pre-agent silence-detection heuristic (dead-air/looping-audio pattern,
  10–15s hang-up) rather than blocking a legitimate call for lack of a
  signal.

---

## A.3 Stripe (billing)

Base `https://api.stripe.com`. Auth: `Authorization: Bearer <STRIPE_SECRET_
KEY>` (test/live mode keys never mixed); webhook signature verification via
Stripe SDK's `constructEvent(rawBody, signature, endpointSecret)`.

### Checkout Session (subscription creation at signup)

- **Purpose:** the card-required, vertical-priced subscription checkout at
  signup (SYSTEM_DESIGN §9, MASTER_PLAN §1 Onboarding decision).
- **Endpoint:** `POST /v1/checkout/sessions`, `mode=subscription`, line
  items = the vertical's base-fee `price` plus the metered-minutes `price`
  (see Billing Meters below) at the `price_version` snapshotted onto the
  new `tenants` row; `success_url`/`cancel_url` point at the provisioning
  progress screen.
- **Auth:** secret key, server-side only (never exposed to the browser —
  the Route Handler that creates the session is the only caller, per
  FRONTEND_STACK.md's Next.js API-route pattern).
- **Called from:** `/signup` step "create checkout session" (T5 route
  handler → T4 backend), Flow 2 step 1.
- **Rate limits/cost:** standard Stripe API rate limits (not a concern at
  our signup volume); Stripe's own processing fees flow into
  `payment_processing_events` from the resulting charges, not from this
  call itself.
- **Failure handling:** session-creation failure surfaces inline at signup
  (retry button); no `tenants` row is marked `active` until
  `checkout.session.completed` is received — signup is not "done" on
  redirect alone.

### Billing Meters (usage-based billing: meter create + meter events)

- **Purpose:** bill actual per-call minutes as the metered component of the
  subscription, sourced from our own usage ledger (source of truth) and
  mirrored into Stripe purely for invoice generation (SYSTEM_DESIGN §3 —
  "own usage ledger as source of truth").
- **Endpoint:** a `Meter` object is created once per metered price
  (`event_name`, `customer_mapping.event_payload_key` default
  `stripe_customer_id`, `value_settings.event_payload_key` default
  `value`) — this is a one-time platform-level setup, not per-tenant.
  Usage is then reported via `POST /v1/billing/meter_events`
  (`event_name`, `payload={stripe_customer_id, value}`, an idempotent
  `identifier` — recommend `call_id`, since uniqueness only needs to hold
  within a rolling 24h+ window and `call_id` is already globally unique).
  For higher throughput than the standard endpoint supports, a v2
  meter-event-**stream** exists (session-token auth, up to 10,000 req/s)
  — not needed at our volume (SYSTEM_DESIGN §5: "100 concurrent calls ≈
  5–6 tool calls/sec," and meter events fire once per completed call, not
  per tool call).
- **Auth:** secret key (standard meter-events endpoint) or a session token
  minted via a meter-event-session call (v2 stream, not needed here).
- **Called from:** cost-ingestion step of `/voice/events` background
  processing (Flow 1 step 9 / Flow 3 step 1) — one meter event per
  completed, billable call; owner test-calls (G13) and minutes past an
  opted-in hard cap (G14) are **excluded** before this call fires, not
  filtered after.
- **Rate limits/cost:** standard endpoint has its own (unpublished in
  sources reached here) throughput ceiling well above our per-call
  cadence; **VERIFY:** exact meter-event ingestion latency before Stripe's
  billing-cycle cutoff, so late-arriving reconciliation events (from the
  nightly `get-call` backfill, A.1) that land after invoice finalization
  are handled as a documented "meter event adjustment" rather than lost —
  Stripe does expose a meter-event-adjustment create endpoint for exactly
  this correction case.
- **Failure handling:** a failed meter-event POST is retried from the
  `usage_events` row (not yet marked "reported") rather than dropped —
  since `usage_daily`/`usage_events` is the source of truth per
  SYSTEM_DESIGN §3, a lost Stripe meter event is a recoverable
  reconciliation problem, not a lost-revenue problem.

### Subscriptions

- **Purpose:** the underlying object Checkout creates and that billing
  cycles against; also updated directly for plan changes, pause (seasonal
  pause, G24), and cancellation (Flow 8).
- **Endpoint:** `GET/POST/DELETE /v1/subscriptions/{id}` — `cancel_at_
  period_end` for graceful offboarding, `pause_collection` for seasonal
  pause.
- **Auth:** secret key.
- **Called from:** T4 billing/lifecycle functions; admin cockpit's tenant
  detail actions; the offboarding flow (Flow 8 step 1).
- **Failure handling:** every subscription mutation is confirmed by its
  webhook (`customer.subscription.updated/deleted`) before we mark our own
  `tenants.status` — never optimistic-update ahead of the webhook, since
  that's exactly the "fake paid" class of bug the old system audit found.

### Customer portal

- **Purpose:** self-serve payment-method update, invoice history, and (if
  enabled) plan changes — surfaced from `invoice.payment_failed` dunning
  emails and the billing settings page.
- **Endpoint:** `POST /v1/billing_portal/sessions` (`customer`,
  `return_url`) → redirect the tenant to the returned portal URL.
- **Auth:** secret key, server-side session creation only.
- **Called from:** T5 billing settings page route handler; dunning email
  link (Flow 3 step 4).
- **Failure handling:** session-creation failure falls back to a support
  contact link rather than a dead redirect.

### Webhooks consumed

Minimum set per Stripe's own subscriptions-with-Checkout guidance, plus the
platform's own needs:

| Event | Consumer |
|---|---|
| `checkout.session.completed` | provisions the tenant (Flow 2 step 2) |
| `invoice.paid` | marks `billing_invoices` paid, continues service (Flow 3 step 4) |
| `invoice.payment_failed` | dunning flow, customer-portal link (Flow 3 step 4) |
| `invoice.created` / `invoice.finalized` | `billing_invoices` draft→finalized transition |
| `customer.subscription.updated` | plan/pause/status sync onto `tenants.status` |
| `customer.subscription.deleted` | offboarding trigger (Flow 8 step 1) |
| `charge.refunded` | refund/guarantee mechanics (G33), referral clawback check (Flow 4 step 6) |
| `charge.dispute.created` | same clawback path, plus an ops alert |
| `payout.paid` / balance-transaction events | `payment_processing_events` actual-fee ingestion |

All arrive at `/webhooks/stripe` (T3/T4): signature-verified against raw
body → idempotent `webhook_events` insert (unique `(source='stripe',
event_id)`) → fast ack → background processing, identical pattern to the
Retell webhook handlers (CLAUDE.md Rule 2).

### Refunds

- **Endpoint:** `POST /v1/refunds` (`charge` or `payment_intent`, optional
  partial `amount`).
- **Auth:** secret key; gated behind admin-cockpit action + `admin_actions`
  audit-log entry (BACKEND_SPEC §1.1) — never a bare API call without an
  audit trail, per G15.
- **Called from:** admin cockpit refund action (money-guarantee mechanics,
  G33) — abuse guardrails (signup-cycle limits) checked *before* calling
  this, not after.
- **Failure handling:** refund failure surfaces to the admin, not silently
  retried (money-touching writes need an explicit human retry decision).

### stripe-sync-engine tables

- **Purpose:** mirror Stripe's own objects (`customers`, `subscriptions`,
  `invoices`, `charges`, `prices`, `products`) into a `stripe` Postgres
  schema so the margin cockpit and admin cockpit can SQL-join against
  billing state without live-calling the Stripe API on every page load.
- **Mechanism:** `@supabase/stripe-sync-engine` — a library (or its
  `stripe-sync-fastify` standalone-server variant) that creates the
  `stripe` schema via its own migrations and keeps it current purely off
  the same webhook stream already being consumed above (it registers its
  own managed webhook endpoint, or can share ours — **VERIFY**: whether we
  run it as a library inside an existing edge function/worker vs its
  standalone Fastify server, and reconcile that against our "lean edge
  functions" rule, CLAUDE.md Rule 2 — a full Fastify server is a different
  deployment shape than a Supabase edge function).
- **Called from:** T4 setup (one-time schema install + webhook
  registration); the cockpit's SQL views read `stripe.*` tables directly.
- **Failure handling:** sync lag is a reporting-freshness issue only —
  `billing_invoices`/`revenue_events` (our own tables) remain the
  authoritative source for money math; `stripe.*` is a read-optimized
  mirror, never written to directly by application code.

---

## A.4 PayPal (referral payouts)

Base `https://api-m.paypal.com` (or `api-m.sandbox.paypal.com` for
non-prod). Auth: OAuth2 client-credentials (`POST /v1/oauth2/token` with
Basic client_id:secret → bearer access token, short-lived, refreshed per
call or cached).

### Payouts API — batch create

- **Purpose:** monthly referral-partner payout run (Flow 4 step 4).
- **Endpoint:** `POST /v1/payments/payouts` — body `{sender_batch_header:
  {sender_batch_id, email_subject, ...}, items: [{recipient_type: 'EMAIL',
  amount: {value, currency}, receiver: partner.paypal_email, note,
  sender_item_id}]}`. Max 15,000 items per batch (far above our partner
  count for the foreseeable term); `sender_batch_id` reused within 30 days
  is rejected as a duplicate — this **is** our idempotency guarantee, so
  the batch id should be deterministic per payout period (e.g.
  `referral-payout-{period}`).
- **Auth:** Bearer (OAuth2 client-credentials token).
- **Called from:** monthly referral-payout cron (T4), reading
  `commission_events` in `'accrued'` status grouped by partner
  (BACKEND_SPEC §1.7).
- **Rate limits/cost:** PayPal's ~$0.25/payout fee is already priced into
  the referral economics (SYSTEM_DESIGN §3/§10). **VERIFY:** current
  per-item fee and any minimum-payout-amount threshold per country (not
  independently confirmed here) before finalizing the "$100 after 2nd paid
  month" default qualification amount against real payout costs.
- **Failure handling:** batch create returns `201` with a `payout_batch_id`
  immediately (async processing) — batch/item status is polled via `GET
  /v1/payments/payouts/{batch_id}` or (preferred) received via PayPal
  webhooks (`PAYMENT.PAYOUTSBATCH.SUCCESS`, item-level
  `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`/`FAILED`/`BLOCKED`/`UNCLAIMED`) updating
  `referral_payouts.status`; a failed/blocked item (bad email, unverified
  PayPal account) does not block the rest of the batch and is retried next
  cycle once the partner's `w9_status`/PayPal-account issue is resolved.

---

## A.5 Outreach engine (T8, "not this repo's product surface" per MASTER_PLAN but the API calls the outreach admin panel makes)

### Apollo (people/org search + enrichment)

- **Purpose:** primary lead source for verticals where Apollo is strong
  (legal via bar directories, real estate, auto, vet) — search first,
  enrich selectively.
- **Endpoint:** `POST` to the People API Search and Organization Search
  endpoints (`docs.apollo.io/reference/people-api-search`,
  `.../organization-search`) for prospecting; `.../organization-enrichment`
  (single) or bulk (`up to 10 companies/call`) for enrichment; a "waterfall
  enrichment" mode cascades to third-party sources when Apollo's own record
  is incomplete, no code change required.
- **Auth:** API key header (`x-api-key` per Apollo's documented pattern).
- **Called from:** lead-fetch step of the outreach admin panel (T8, Flow 5
  step 1–2).
- **Rate limits/cost:** **People Search is credit-free**; email enrichment
  = 1 credit, phone enrichment = 8 credits per the current documented
  pricing; credit pool size scales with plan tier. This is the basis for
  the "~$355–470/mo all-in at 1,250 sends/wk" outreach cost estimate in
  SYSTEM_DESIGN §3 — **VERIFY** current credit-to-dollar conversion against
  the account's actual plan before relying on that estimate for the CAC
  dashboard.
- **Failure handling:** enrichment failures (no match found) leave the lead
  at its pre-enrichment fidelity — never block the campaign-add step on a
  failed enrichment call.

### Outscraper / Apify Maps scraper

- **Purpose:** Google-Maps-sourced leads for verticals where Apollo is
  weak (restaurants, motels — per VERTICAL_RESEARCH.md's finding that
  owners in these verticals aren't well represented on Apollo/LinkedIn).
- **Endpoint:** Outscraper's Google Maps Search API (pay-per-record,
  documented ~$3/1,000 records past a free tier) or Apify's Google Maps
  Scraper actor (`apify/google-maps-scraper` or similar, run via Apify's
  standard Actor-run API) — either returns name/address/website/phone/
  category/rating without needing a Google Maps API key.
- **Auth:** Outscraper API key (query param or header) / Apify API token
  (Bearer) + actor-run endpoint.
- **Called from:** lead-fetch step (T8, Flow 5 step 1) for the
  restaurant/motel verticals specifically, per MASTER_PLAN's "blend with
  Yelp/Maps/license-roll data per vertical" guidance.
- **Failure handling:** scraped leads with no phone/email are dropped
  before dedup, not sent to Claude personalization (nothing to
  personalize toward).

### Smartlead / Instantly (cold-email sender)

- **Purpose:** the actual send + open/click/reply tracking engine; the
  provider choice between the two is **not decided** in the source docs
  (both named throughout as alternatives) — **VERIFY/DECIDE:** pick one
  before T8 build starts; document the choice in `docs/BUILD_NOTES.md`
  per CLAUDE.md Rule 4, since this file cannot resolve an open business
  decision.
- **Endpoint (Smartlead):** REST, versioned `/api/v1/...`; campaign
  create/manage, lead add at scale, webhook management via `POST
  https://server.smartlead.ai/api/v1/webhook/create` (`name, webhook_url,
  association_type, event_type_map`) covering `EMAIL_OPENED/CLICKED/
  REPLIED/BOUNCED`, `LEAD_UNSUBSCRIBED`, `LEAD_CATEGORY_UPDATED`,
  `SEQUENCE_COMPLETED`.
- **Endpoint (Instantly v2):** REST at `api.instantly.ai/api/v2`, Bearer
  API key, scoped keys; `POST .../campaign/createCampaign`, `POST
  .../lead/createLead` (with a `custom_variables` field — this is where
  the Claude-personalized opening line rides in), webhook schema under
  `.../schemas/def-39` covering the same open/click/reply/bounce/
  unsubscribe event set. API v2 access requires the Growth plan or above.
- **Auth:** Bearer API key (both).
- **Called from:** campaign-send step (T8, Flow 5 step 4–5).
- **Rate limits/cost:** sender-platform monthly fee is part of the
  "~$355–470/mo all-in" outreach estimate (SYSTEM_DESIGN §3); complaint
  rate >0.3% must auto-pause the campaign (hard rule, SYSTEM_DESIGN §11) —
  implemented by polling/webhook-tracking `campaigns.complaint_rate`
  (BACKEND_SPEC §1.8) and calling the campaign-pause endpoint the moment
  it crosses threshold.
- **Failure handling:** webhook delivery failures for reply/bounce events
  are a lead-scoring gap, not a send-blocking one — the nightly outreach
  reconciliation (mirrors the Retell `get-call` pattern) should re-pull
  campaign stats via the sender's read API as a backstop. **VERIFY:**
  whether either platform exposes an equivalent stats-pull endpoint for
  this backstop.

### Claude API (personalization + reply classification)

- **Purpose:** (a) draft a personalized opening line per lead from
  scraped/enriched context (~$0.02/lead per SYSTEM_DESIGN §3); (b)
  classify inbound replies into `interested/not_interested/unsubscribe/
  question/auto_reply` (`replies.ai_intent`, BACKEND_SPEC §1.8).
- **Endpoint/model:** `POST /v1/messages` via the official Anthropic SDK
  (never raw HTTP in a TypeScript codebase, per this environment's
  `claude-api` skill). **Personalization** is not latency-sensitive (leads
  are fetched in batches, not per-request) — use the **Message Batches
  API** (`client.messages.batches.create`, 50% cheaper, results within
  hours) with `model: "claude-sonnet-5"` (cost-tier appropriate for a
  short templated-personalization task; do not reach for the top-tier
  model here). **Reply classification** is a short classification task
  (`max_tokens ~256`) — also a good Batches-API candidate if a few hours'
  latency before a lead surfaces in the funnel view is acceptable, or a
  plain synchronous call on `claude-sonnet-5` if replies should route to
  the admin feed same-day; either way, this is a "simplest tier" job per
  the `claude-api` skill's own guidance table (classification/extraction →
  single Claude API call, no agent/tool loop needed).
- **Auth:** `ANTHROPIC_API_KEY` (or org OAuth profile per the skill's auth
  precedence) — server-side only, never exposed to the outreach admin
  panel's browser bundle.
- **Called from:** personalization step right before campaign-add (Flow 5
  step 3); classification step on `EMAIL_REPLIED` webhook receipt (Flow 5
  step 6).
- **Rate limits/cost:** standard Anthropic API pricing (current-generation
  Sonnet-tier ≈ $2/$10 per 1M input/output tokens at time of writing;
  Batches API halves that) — the ~$0.02/lead figure in SYSTEM_DESIGN §3 is
  directional and should be re-measured against actual token counts once
  real prompts exist, not treated as a hard ceiling.
- **Failure handling:** a `refusal` stop reason or API error on
  personalization falls back to a non-personalized template opener for
  that lead (never blocks the send); classification errors leave
  `ai_intent` null and the reply surfaces in an "unclassified" admin queue
  rather than being silently miscategorized.

---

## A.6 Deep-integration adapters (`IntegrationAdapter`, Layer 2, T7)

Common interface per MASTER_PLAN §1: `syncCatalog`, `pushBooking`/
`pushOrder`, `checkAvailability`, `handleWebhook`, `refreshAuth` — one
status-mapping table per adapter into the canonical booking lifecycle
(`scheduled→confirmed→checked_in→completed/no_show/cancelled/rescheduled`,
BACKEND_SPEC §1.4). Two connection modes exist across these adapters:
**OAuth2** (Square, Clio, Google, Microsoft) and **self-generated paste-key**
(Shopmonkey, Cloudbeds, and ezyVet's partner-credential variant) —
VERTICAL_RESEARCH.md §"Architecture implications" explicitly calls out that
onboarding must support both.

### Shopmonkey (auto repair)

- **Auth model:** Shopmonkey **2.0** uses OAuth2 Bearer tokens via
  `/auth/login` (the older 1.0 API-key-in-Settings flow is explicitly
  deprecated for new integrations per Shopmonkey's own docs — build
  against `shopmonkey.dev`, the 2.0 developer portal, not the legacy
  support-article flow).
- **Calls our adapter makes:** (1) `syncCatalog` — pull service
  categories/labor rates if exposed (2.0 endpoint TBD, **VERIFY** against
  the 2.0 quickstart); (2) `checkAvailability`/read shop schedule; (3)
  `pushBooking` — create an appointment/work order tied to a customer +
  vehicle; (4) webhook or polling for staff-made reschedules/cancellations
  (two-way sync, G11); (5) `refreshAuth` — OAuth token refresh.
- **VERIFY:** Shopmonkey 2.0's exact endpoint paths/scopes — the 1.0 docs
  found are explicitly marked "should no longer be used for new
  integrations," and 2.0's public surface (`shopmonkey.dev`) needs a
  first-party fetch/sandbox signup this environment couldn't complete via
  indexed search alone. Also **VERIFY** Tekmetric's write-API availability
  per MASTER_PLAN's "verify Tekmetric write API in week 1" instruction —
  Tekmetric is a documented fast-follow, not a Wave-1 build target here.
- **Failure handling:** on `refreshAuth` failure or a revocation webhook,
  mark the connection `disconnected` + dashboard banner (salvaged pattern,
  SYSTEM_DESIGN §14) — booking writes fall back to primary-tier (SMS/
  email/Airtable) rather than silently failing.

### ezyVet (veterinary)

- **Auth model:** OAuth2 **Client Credentials** grant, but access is
  **partner-gated** — a developer applies for integration and receives an
  approved `partner_id` + `client_id`/`client_secret` before any token can
  be minted; access tokens have a **12-hour TTL**.
- **Calls our adapter makes:** (1) `syncCatalog` — resources/appointment
  types across ~216 documented endpoints (animals/patients, contacts/
  clients, appointments, consultations); (2) `checkAvailability`; (3)
  `pushBooking` — create appointment tied to animal+client records; (4)
  polling for staff changes (ezyVet's webhook coverage for appointment
  changes specifically needs confirmation — VERTICAL_RESEARCH.md already
  flags ezyVet as one of the providers where two-way sync likely needs
  **polling**, not webhooks); (5) `refreshAuth` — re-mint the 12h token.
- **Rate limits:** a **global 180 calls/minute per database per partner**
  limit, in addition to endpoint-specific limits — the adapter must
  throttle/queue writes accordingly, especially for any bulk catalog sync.
- **VERIFY:** exact application/approval turnaround time for the
  `partner_id` (this is a light gate per VERTICAL_RESEARCH.md, "standard
  registration form," but still a lead-time item to start early,
  analogous to the A2P brand registration).
- **Failure handling:** same disconnected-banner pattern as above;
  additionally, given the 12h token TTL, `refreshAuth` should run
  proactively (e.g. at 10h) rather than reactively on first 401, to avoid
  a live booking-write racing an expired token.

### Google Calendar (generic calendar adapter, G10 — promoted to early build)

- **Auth model:** OAuth2 (Google Cloud OAuth consent screen, `calendar`
  scope).
- **Calls our adapter makes:** (1) `checkAvailability` — `freebusy.query`
  across the connected calendar(s) (more efficient than reading raw
  events for scheduling purposes); (2) `pushBooking` — `events.insert`
  (and `events.patch`/`events.update` for reschedule/cancel); (3)
  two-way sync via **push notifications** — `events.watch` registers a
  notification channel that fires on any change to the watched calendar,
  the correct mechanism for pulling back staff-made changes (G11) rather
  than polling; (4) `refreshAuth` — standard OAuth refresh-token flow;
  (5) channel renewal — watch channels expire and must be re-registered
  before expiry (**VERIFY** current default channel TTL).
- **Failure handling:** revoked OAuth grant (detected via a 401 on
  refresh, or Google's own revocation notification if configured) →
  disconnected banner; this adapter is explicitly the fallback-mode
  universal option (SYSTEM_DESIGN §11 gap register, G10) so its failure
  mode should degrade to primary-tier behavior more gracefully than any
  other adapter, since it's often the *only* integration a solo-operator
  tenant has.

### Microsoft Graph (Outlook/Microsoft 365 Calendar, same adapter family as above)

- **Auth model:** OAuth2 (Microsoft Entra ID app registration,
  `Calendars.ReadWrite` delegated or application scope depending on
  single-tenant-per-mailbox vs multi-mailbox access pattern).
- **Calls our adapter makes:** (1) `checkAvailability` — `POST
  /me/calendar/getSchedule` (or `/users/{id}/calendar/getSchedule`) across
  the connected mailbox(es); (2) `pushBooking` — `POST /me/events` (create)
  / `PATCH` (update/cancel); (3) two-way sync via **change notification
  subscriptions** — `POST /v1.0/subscriptions` (`changeType`,
  `notificationUrl`, `resource`, `expirationDateTime`, `clientState` used
  as our HMAC-equivalent shared secret to verify inbound notifications);
  (4) subscription **renewal** before `expirationDateTime` (Graph
  subscriptions have short max lifetimes and must be proactively renewed,
  unlike a "set and forget" webhook); (5) `refreshAuth` — OAuth refresh.
- **Failure handling:** same disconnected-banner + primary-tier-fallback
  pattern; a lapsed (un-renewed) subscription silently stops delivering
  change notifications, so the adapter's renewal job needs its own
  health-check/alert distinct from the OAuth-revocation alert.

### Square (Orders + Bookings)

- **Auth model:** OAuth2, standard Square OAuth scopes:
  `APPOINTMENTS_READ`/`APPOINTMENTS_WRITE` (buyer-level) or
  `APPOINTMENTS_ALL_READ`/`APPOINTMENTS_ALL_WRITE` (seller-level, needed
  for our adapter acting on the tenant's behalf across all their staff/
  resources) for Bookings; Orders API scopes for the restaurant adapter.
- **Calls our adapter makes (Bookings, Square-Appointments-wedge vertical):**
  (1) `checkAvailability` — `POST /v2/bookings/availability/search`; (2)
  `pushBooking` — `POST /v2/bookings` (requires `location_id`, `start_at`,
  and an `AppointmentSegment` with `team_member_id` +
  `service_variation_id`/`service_variation_version`); (3) `syncCatalog`
  — `POST /v2/catalog/search` (price at
  `variations[0].item_variation_data.price_money.amount`, per the salvaged
  hard-won API knowledge in SYSTEM_DESIGN §14); (4) webhooks for booking
  changes (Square supports webhook subscriptions for
  `booking.created`/`booking.updated`-class events).
- **Calls our adapter makes (Orders, restaurant port):** `POST /v2/orders`
  (create then push modifiers/line items), fulfillment shape differs for
  pickup vs delivery (salvaged knowledge, SYSTEM_DESIGN §14); webhook
  signature = `HMAC-SHA256(notificationUrl + rawBody)`, base64-encoded
  (also salvaged, verify unchanged against current Square docs before
  reusing the old codebase's verifier).
- **Failure handling:** identical disconnected-banner pattern; the
  restaurant adapter additionally must fix the old system's known bugs
  (tax/fee omission, dedup, idempotency — MASTER_PLAN §1 Phase 2) rather
  than porting them forward.

### Cloudbeds (motel/small-hotel upsell tier)

- **Auth model:** OAuth2; uniquely, the property **owner self-generates
  an API key in their own Cloudbeds dashboard** — zero platform-level
  approval gate (VERTICAL_RESEARCH.md), making this one of the
  paste-key-style connections even though the underlying mechanism is
  OAuth2 rather than a bare static key.
- **Calls our adapter makes:** (1) `syncCatalog` — `getRoomTypes` +
  `getRatePlans`; (2) `checkAvailability` against the property's room
  inventory; (3) `pushBooking` — `postReservation` (for multi-room
  bookings, the `rooms`/`adults`/`children` arrays are duplicated per
  room index, per the salvaged/researched API shape); (4) polling for
  staff-made changes (Cloudbeds' webhook coverage for reservation edits
  needs confirmation — treat as poll-based two-way sync unless verified
  otherwise).
- **Failure handling:** same pattern; Cloudbeds is explicitly the
  deep-integration **upsell** only (motels are primary-tier-first per
  MASTER_PLAN §1) so a disconnected Cloudbeds adapter should fall back
  cleanly to the owner-maintained room/rate config already used for the
  primary-tier quote path, not to an error state.

### Clio (legal, Wave-2 alternative pick)

- **Auth model:** OAuth2 Authorization Code flow; token exchange/refresh
  at `https://app.clio.com/oauth/token`.
- **Calls our adapter makes:** (1) `checkAvailability`/`pushBooking` —
  Clio's Calendar/CalendarEntry resources (API v4, documented under the
  `Calendars` tag) used to book an intake consult onto the firm's
  calendar rather than a native "booking" object (matches
  VERTICAL_RESEARCH.md's "lead-capture + calendar event" integration
  shape, distinct from Shopmonkey/Square's "direct booking write" shape);
  (2) `createContact`/Matters lookup for conflict-check context (the
  opposing-party-name capture happens in-call per SYSTEM_DESIGN §4.3, but
  the adapter can check it against existing Clio Contacts as an
  assist, never an auto-clear); (3) webhook or polling for
  attorney-made calendar changes.
- **VERIFY:** Clio's exact webhook coverage for calendar-entry changes
  (two-way sync mechanism) and marketplace-listing requirements if the
  adapter is ever distributed beyond our own account — not confirmed
  here; also unresolved per VERTICAL_RESEARCH.md is whether attorney
  trust friction and Smith.ai's incumbency make this vertical worth the
  build at all (10 discovery calls gate this per MASTER_PLAN §1 Phase 3).
- **Failure handling:** disconnected-banner pattern; legal intake's
  `legal_advice_given` guardrail (BACKEND_SPEC §1.5) is independent of
  adapter connection state and must never be affected by adapter status.

### Follow Up Boss (real estate, Wave-2 primary pick)

- **Auth model:** HTTP Basic Auth using the **API key as username, empty
  password** — each Follow Up Boss user has their own key (Admin → API
  screen).
- **Calls our adapter makes:** (1) `createContact` — the documented
  pattern is **not** a direct contact-create call but posting to the
  `/events` endpoint with lead details, which triggers the account's own
  automation rules to create/update the Person record (this is the
  idiomatic FUB integration shape, not a quirk to route around); (2)
  `pushBooking`/appointment scheduling — also via `/events`-driven
  automation or a direct `/appointments` create, triggering
  `appointment.created`/`appointment.updated` webhook events on the
  other side; (3) webhook subscription for `peopleCreated`/
  `peopleUpdated`/`appointment.*` — real two-way sync, webhook-based, not
  polling (FUB's webhook coverage is broad per its docs).
- **Failure handling:** disconnected-banner pattern; per
  VERTICAL_RESEARCH.md this write is "trivial and barely needed" since
  fallback mode (our own lead-capture) is nearly as good — so a FUB
  outage should be a low-severity banner, not a blocking error for the
  real-estate vertical's core flow.

### NexHealth (dental, Wave-3, requires tenant BAA independent of Retell's)

- **Auth model:** `POST /authenticates` with an API key in the
  `Authorization` header → returns a bearer token (session-style, not
  standard OAuth2 — **VERIFY** token TTL/refresh cadence, not found in
  sources reachable here).
- **Calls our adapter makes:** (1) `checkAvailability` — `GET
  /appointment_slots` (query interface requiring a `subdomain` plus
  location id(s)/provider id(s), returns valid start times); (2)
  `pushBooking` — `POST /appointments`, requiring the patient, provider,
  location, and time all resolved first (documented as "who, where,
  when"); (3) `syncCatalog` — provider/location/appointment-type sync
  feeding the slot query; (4) webhook or polling for staff-made changes
  (NexHealth, as an aggregator sitting in front of multiple underlying
  PMSs, has documented webhook support in general — **VERIFY** per-PMS
  webhook fidelity, since NexHealth's own docs note real-practice
  onboarding can take 2–6 weeks and behavior may vary by the underlying
  PMS it's bridging to).
- **Rate limits/cost:** free tier then ~$0.10/call per
  VERTICAL_RESEARCH.md's researched figure — **VERIFY** against
  NexHealth's current pricing page directly (not independently confirmed
  in this pass).
- **Failure handling:** disconnected-banner pattern; additionally, dental
  is the one vertical requiring a **tenant-facing BAA** at onboarding
  (G22) independent of the Retell BAA — this is a compliance gate on
  onboarding the dental vertical at all, not an adapter-call detail, and
  must block dental tenant activation until signed, regardless of
  NexHealth connection status.

---

## A.7 Misc

### Airtable API (upsert push for tenants who want it as a delivery channel)

- **Purpose:** one-way sync of bookings/orders/leads into a tenant's own
  Airtable base, a primary-tier delivery option alongside SMS/email/
  dashboard (SYSTEM_DESIGN §1).
- **Endpoint:** `PATCH /v0/{baseId}/{tableIdOrName}` with
  `performUpsert: {fieldsToMergeOn: [...]}` — find-or-create in one call;
  batched up to **10 records per request**.
- **Auth:** tenant-provided Airtable Personal Access Token, pasted at
  connect time (paste-key connection mode) scoped to the specific
  base/table.
- **Called from:** notification fan-out (Flow 1 step 12), same trigger
  point as SMS/email.
- **Rate limits/cost:** **5 requests/second per base**; batching up to 10
  records/request means effective throughput up to ~50 records/sec — far
  above our per-tenant booking volume, but the adapter must still queue/
  throttle if a burst (e.g. a bulk historical import) is ever built.
- **Failure handling:** conflict handling per G30 — one-way push plus
  **change-detection warnings** (if the tenant has since edited the
  Airtable row directly, our next push either overwrites with a visible
  warning banner or skips with a flagged conflict, per the salvaged UX
  pattern referenced in SYSTEM_DESIGN §11 — exact overwrite-vs-skip
  policy is a `DECIDE:` left to T7 build time, not specified further in
  source docs).

### Email provider (Resend recommended)

- **Purpose:** transactional email — booking confirmations (email
  channel), weekly value emails, dunning notices, SMS-pending-verification
  fallback (G4), data-export delivery links (Flow 8).
- **Recommendation:** **Resend** — `docs/spec/BACKEND_SPEC.md` and
  `docs/FRONTEND_STACK.md` don't name a provider (only `messages_outbound.
  channel = 'email'` exists as a schema slot), so this is a fresh pick,
  not a locked one; Resend is recommended over Postmark for a Next.js/
  Vercel stack given first-party React-email-template support and a
  webhook event model that maps cleanly onto `messages_outbound.status`.
  Postmark remains a reasonable fallback if Resend's deliverability/
  sending-domain reputation proves an issue during the 4–6-week domain
  warm-up window shared with the outreach engine — **DECIDE** finally once
  a sending domain is chosen (SYSTEM_DESIGN §15 open decision #7).
- **Endpoint:** `POST /emails` (`from`, `to`, `subject`, `html`/`react`).
- **Auth:** API key, Bearer.
- **Called from:** notification fan-out (Flow 1), dunning (Flow 3),
  onboarding emails (Flow 2), data-export delivery (Flow 8).
- **Rate limits/cost:** per-plan sending volume caps; not a concern at
  Wave-1 tenant counts.
- **Failure handling:** webhook events (`email.sent/delivered/bounced/
  complained/delivery_delayed`) update `messages_outbound.status`; a
  `bounced` recipient should feed the same suppression logic the outreach
  engine uses (`suppression_list`, BACKEND_SPEC §1.8) so a bad tenant/
  customer email address doesn't get retried indefinitely.

### Sentry

- **Purpose:** error monitoring across the Next.js app (`apps/web`) and
  Supabase Deno edge functions — same project, per FRONTEND_STACK.md.
- **Endpoint/mechanism:** `@sentry/nextjs` SDK (client/server/edge
  instrumentation files per Next.js App Router convention) and the Sentry
  Deno SDK added directly inside each edge function for exception/
  performance capture — Supabase's own docs document this exact pattern
  for Edge Functions.
- **Auth:** DSN (public, safe to ship client-side) + an auth token for any
  release/source-map upload step in CI.
- **Called from:** global error boundaries (T5), every edge function's
  top-level error handler (T3), release-health tracking across deploys
  (T10 ops task).
- **Failure handling:** Sentry itself being down must never block a
  request — SDK calls are fire-and-forget/non-blocking by design; this is
  a monitoring dependency, not a request-path dependency.

### Website scraper (demo-agent generator, T9)

- **Purpose:** URL → sanitized scrape → seeded personalized demo agent
  (<60s per MASTER_PLAN/SYSTEM_DESIGN §9), and the same mechanism reused
  for outreach's demo step (Flow 5 step 7).
- **Endpoint/mechanism:** not a named third-party API — an in-house fetch
  + HTML-to-text extraction (or a headless-render if the target site is
  JS-heavy) against the tenant/lead's own public website, immediately
  followed by **sanitization against instruction-like patterns before
  injection** into the demo agent's dynamic variables (G21 — prompt-
  injection defense applies to scraped content, not just caller speech).
- **Auth:** none (public page fetch); respects robots.txt/reasonable
  rate-limiting as a good-citizen scraper, not because a provider
  contract requires it.
- **Called from:** `/demo` marketing flow (T5/T9) and the outreach demo
  step (Flow 5 step 7).
- **Failure handling:** unreachable/blocked site → demo generator falls
  back to a generic vertical template with just the business name, rather
  than blocking demo generation entirely; sanitizer rejecting the whole
  scrape (too much instruction-like content) has the same fallback.

---

# Part B — End-to-End Flows

Each numbered step names the exact component/function/API from Part A (or
the exact table/function from `docs/spec/BACKEND_SPEC.md`).

## Flow 1 — Inbound call → answered → booking created → notifications → dashboard update → cost ingestion

1. Caller dials the tenant's Twilio number (owned by us, E.164, imported
   into Retell via SIP trunk `termination_uri=*.pstn.twilio.com`, A.1/A.2).
2. Twilio routes the call over the SIP trunk to Retell. Retell's inbound
   webhook hits our `POST /voice/inbound` (A.1) with the caller/called
   numbers.
3. `/voice/inbound` resolves `phone_numbers.e164` → `tenant_id` →
   `agent_configs` (BACKEND_SPEC §1.2/§1.3) and returns dynamic variables
   (business name, hours, `assistant_name`, `dynamic_variable_overrides`)
   — synchronous, hot-path budget (p50<200ms).
4. The compiled Retell agent begins the call; the compiler-enforced
   `disclosure_line` (BACKEND_SPEC §1.3) is spoken verbatim in the first
   turn, before any other content, regardless of vertical.
5. Mid-call, the agent invokes `check_availability` → Retell POSTs to
   `POST /voice/tools` (A.1). The handler reads `availability_slots`
   (GIST-indexed, precomputed, BACKEND_SPEC §1.4) — one indexed read,
   <10ms — and returns open slots for the LLM to narrate. If the call's
   vertical/state graph reaches a `global_intents` emergency node instead
   (e.g. vet triage red-flags), this step is bypassed entirely for the
   escalation path.
6. Caller confirms a slot → agent invokes `create_booking` → `/voice/tools`
   performs one `INSERT` into `bookings` inside its GIST exclusion
   constraint + `idempotency_key = call_id + slot` transaction
   (BACKEND_SPEC §1.4); `fn_invalidate_availability_on_booking` (BACKEND_
   SPEC §3.5) flips the matching `availability_slots.is_available` in the
   same logical unit of work.
7. Call ends. Retell POSTs `call_ended` to `POST /voice/events` (A.1):
   HMAC-verified against raw body → idempotent insert into
   `webhook_events` (unique `(source='retell', event_id)`) → fast 2xx ack.
8. Background processing (queued off the ack, pgmq worker): pull the call
   recording (must land inside Retell's recording-retention window, <10
   min), ingest `call_cost.product_costs[]` into `cost_events`
   (BACKEND_SPEC §1.6), emit a Stripe Billing Meter event
   (`POST /v1/billing/meter_events`, A.3) for the billable minutes.
9. `call_analyzed` webhook (separately timed, may race step 7 — ordering
   is not guaranteed, SYSTEM_DESIGN §8) delivers `classification`,
   `call_summary`, `sentiment`, `structured_booking_payload`,
   `state_trace`, `variable_values` — merged into `call_logs` as
   **enrichment only**; the in-call `create_booking` write from step 6
   remains authoritative for the booking-critical fields (SYSTEM_DESIGN
   §4.4).
10. The `trg_broadcast_bookings`/`trg_broadcast_call_logs` triggers
    (BACKEND_SPEC §3.4) fire `realtime.broadcast_changes` onto the
    tenant's private `tenant:{tenant_id}` channel → the dashboard's
    subscribed client (RLS-gated on `realtime.messages`) receives the
    "updated" event and calls `invalidateQueries` (FRONTEND_STACK.md) — no
    row payload rides the broadcast itself, just a refetch signal.
11. Server-side notification fan-out (fired from the write in step 6/8,
    not from the broadcast): SMS confirmation via Twilio Messages API
    (A.2) or Retell chat-agent SMS if a conversational reply is expected;
    email via Resend (A.7); Airtable `performUpsert` push (A.7) if
    configured — each recorded as a `messages_outbound` row.
12. Nightly `get-call` reconciliation (pg_cron, A.1) backfills any call
    whose `cost_cents`/`classification` never arrived via webhook, as the
    safety net for step 8/9.

## Flow 2 — Signup → checkout → provisioning saga → forwarding wizard → verification call → first real call celebration

1. `/signup` (T5): business-type selection → vertical price card
   (SYSTEM_DESIGN §1) → account creation (Supabase Auth) → our backend
   creates a Stripe `POST /v1/checkout/sessions` (A.3, `mode=subscription`,
   base + metered-minutes line items at the snapshotted `price_version`).
2. `checkout.session.completed` webhook (A.3) → `/webhooks/stripe` →
   idempotent `webhook_events` insert → triggers the provisioning saga
   (T4).
3. Saga step "tenant row": create `tenants` (vertical, plan, timezone,
   `stripe_customer_id`) — BACKEND_SPEC §1.1.
4. Saga step "compile + create agent": template compiler resolves
   `agent_templates` + `agent_configs` overrides → Retell
   `POST /create-conversation-flow` → `PATCH /update-agent` →
   `POST /publish-agent-version` (A.1) — refuses to publish without the
   `disclosure_line` verbatim in the first turn.
5. Saga step "buy + import number": Twilio
   `GET /AvailablePhoneNumbers/{Country}/Local` → `POST
   /IncomingPhoneNumbers` (A.2) → enable Elastic SIP Trunking → Retell
   `POST /import-phone-number` (A.1) referencing the agent from step 4.
6. Saga step "A2P" (parallel, non-blocking): Twilio `BrandRegistration` +
   Campaign create (A.2) under the platform's ISV/reseller brand; tenant
   enters `messages_outbound`-adjacent "SMS pending verification" state
   (1–5 business days) with email notifications meanwhile as the fallback
   channel (G4).
7. Saga step "usage ledger wiring": attach the tenant's subscription item
   to the platform's Stripe Billing Meter (A.3) so future
   `POST /v1/billing/meter_events` calls roll up correctly.
8. Dashboard shows a provisioning-progress screen (polling or the same
   tenant-scoped realtime channel as Flow 1 step 10) → forwarding wizard:
   tenant enters their existing business number; wizard calls Twilio
   Lookup v2 (`Fields=line_type_intelligence`, A.2) to detect carrier and
   render carrier-specific conditional-forwarding instructions.
9. Automated verification call: backend places an outbound call (Retell
   `create-phone-call` against the compiled agent, or a direct Twilio
   call) to the tenant's real business line to confirm forwarding is live
   and audio quality/latency is acceptable → `phone_numbers.
   forwarding_verified_at` set (BACKEND_SPEC §1.2).
10. First real inbound customer call executes Flow 1 end-to-end. The
    dashboard's first `call_logs` row for this tenant (detected off the
    same realtime broadcast as Flow 1 step 10) triggers the "first-call
    celebration" UI moment; the weekly value-email cadence (Resend, A.7)
    begins from this point.

## Flow 3 — Monthly billing cycle → meter events → invoice → margin rollup

1. Every completed, billable call's cost-ingestion step (Flow 1 step 8)
   emits `POST /v1/billing/meter_events` (A.3) with an idempotent
   `identifier` (recommend `call_id`); owner test-calls (`caller_number =
   tenants.owner_test_phone`, G13) and minutes past an opted-in
   `usage_hard_cap_minutes` (G14) are excluded from `usage_events.
   is_billable` **before** this call fires (BACKEND_SPEC §1.6).
2. Nightly `fn_upsert_usage_daily` (BACKEND_SPEC §3.3) rolls
   `usage_events` into `usage_daily` per tenant+day+`price_version`;
   `v_usage_alerts` (BACKEND_SPEC §2) flags tenants crossing 80%/100% of
   included minutes → notification fan-out (Twilio SMS/Resend email + a
   dashboard banner).
3. At period end, Stripe's billing engine reads the meter's aggregated
   usage against the subscription's metered price and auto-generates the
   invoice; `invoice.created`/`invoice.finalized` webhooks (A.3) land at
   `/webhooks/stripe`.
4. `invoice.paid` → `billing_invoices` (unique `(tenant_id, period_start,
   period_end)`, BACKEND_SPEC §1.6) marked paid, service continues.
   `invoice.payment_failed` → dunning: notification + Stripe customer
   portal link (`POST /v1/billing_portal/sessions`, A.3) + a pause
   countdown.
5. `payment_processing_events` ingested from the resulting Stripe charges/
   balance transactions (actual card/ACH fees, not estimated) — feeds true
   margin, not list-price margin.
6. Monthly margin rollup job joins `revenue_events` (from paid invoices)
   against `cost_events` (Retell call costs) + `fixed_cost_allocations` +
   `commission_events` → `v_tenant_margin`/`v_call_cost_vs_billed`
   (BACKEND_SPEC §2) power the cockpit's waterfall, per-customer margin,
   and negative-margin auto-diagnosis.
7. stripe-sync-engine (A.3) keeps a read-optimized `stripe.*` schema
   mirror current off the same webhook stream, so the cockpit can SQL-join
   billing state without live Stripe calls.

## Flow 4 — Referral: link click → signup → qualification → payout

1. Partner shares a `referral_links` URL/code (BACKEND_SPEC §1.7); a click
   sets an attribution cookie as a fallback and increments the link's
   click count.
2. New tenant signs up (Flow 2); the referral code/cookie is attached at
   checkout, creating a `referrals` row (`status='pending'`,
   `attribution_source='link'|'cookie'`).
3. Referral-qualification cron (`fn_check_referral_qualification`,
   BACKEND_SPEC §3.7) runs against `billing_invoices` — default rule:
   qualifies once the referred tenant has **2 paid** invoices — and
   snapshots the flat `$X` from `platform_settings` onto
   `amount_cents_snapshot` at that moment.
4. Qualified, non-fraud-flagged referrals accrue a `commission_events` row
   (`status='accrued'`). The monthly payout batch job aggregates accrued
   commissions per partner (W-9 on file required, else held) → PayPal
   `POST /v1/payments/payouts` (A.4, deterministic `sender_batch_id` per
   period as the idempotency guard).
5. PayPal batch/item-status webhooks (`PAYMENT.PAYOUTSBATCH.SUCCESS`,
   item-level equivalents) update `referral_payouts.status` and
   `commission_events.status → 'paid'`.
6. Anti-fraud (G34): self-referral detection (matching payment
   fingerprint/domain/device) sets `referrals.fraud_flag`, blocking step 3
   from ever qualifying it; a later `charge.refunded`/
   `charge.dispute.created` Stripe webhook (A.3) on the referred tenant
   triggers a clawback, reversing `qualified_at`/recovering already-paid
   commission where possible.
7. Partners crossing $2k/yr cumulative `ytd_payout_cents` are flagged for
   1099-NEC generation at year-end (admin-reviewed before filing).

## Flow 5 — Outreach: lead fetch → personalize → send → reply → demo → customer

1. Admin panel (T8) triggers lead fetch: Apollo People/Organization Search
   (A.5) for Apollo-strong verticals, Outscraper/Apify Maps (A.5) for
   Apollo-weak ones (restaurants/motels) → raw rows land in `leads`,
   deduped against `suppression_list` and existing `leads` (BACKEND_SPEC
   §1.8).
2. Optional Apollo Enrichment call (credit-metered, A.5) fills phone/
   revenue/employee-count for scoring.
3. Claude Message Batches API call (A.5, `claude-sonnet-5`) drafts a
   personalized opening line per lead from scraped/enriched context —
   batched since the send isn't latency-sensitive.
4. Personalized leads pushed into the chosen sender platform (Smartlead or
   Instantly, A.5 — provider TBD, see A.5 note) via its campaign/lead-add
   API, personalization riding in as a custom field/variable; domain
   warm-up (4–6 weeks, started day 1) already complete by send time.
5. Sender platform sends; webhook events (`EMAIL_SENT/OPENED/CLICKED/
   REPLIED/BOUNCED/UNSUBSCRIBED`) land at our outreach webhook →
   `send_events` (BACKEND_SPEC §1.8); `campaigns.complaint_rate` monitored,
   auto-pause at >0.3%.
6. On a reply webhook, a synchronous Claude API call (A.5) classifies
   intent → `replies.ai_intent`; interested replies surface in the admin
   funnel view.
7. Interested lead routed to the demo-agent generator (T9, A.7): scrape
   the lead's own website (sanitized per G21) → seed a personalized
   Retell agent (A.1, `POST /create-agent` against a demo template) + a
   demo phone number/web-call widget; sales follow-up references the live
   demo.
8. Lead converts through the normal signup flow (Flow 2); `leads.
   converted_tenant_id` set, closing the loop into `cac_events`/
   `pipeline_costs` vs `revenue_events` for the CAC dashboard
   (BACKEND_SPEC §1.6/§1.8).

## Flow 6 — Retell outage → detection → failover → recovery

1. pg_cron synthetic health-check job probes Retell every few minutes —
   e.g. `GET /get-concurrency` (A.1) as a lightweight liveness signal, or
   a synthetic test call against a canary agent.
2. On N consecutive failures, the failover job flips each affected
   tenant's Twilio `IncomingPhoneNumbers` voice config (A.2, `POST
   /IncomingPhoneNumbers/{Sid}`) from the Retell SIP trunk to
   forward-to-owner-cell TwiML with a voicemail (`<Record>`) fallback —
   this is a Twilio-side update, not a Retell call, so it works even
   while Retell itself is unreachable.
3. Tenant notified via Twilio SMS/Resend email (A.2/A.7, independent of
   Retell) — "AI briefly down, calls are ringing your phone."
4. Automated status page updates from the same health-check signal
   (<5 min time-to-comms, T10).
5. Calls during the outage are logged as manual-fallback in `call_logs`
   (no Retell cost/analysis available) — excluded from AI-handled metrics
   and never billed as AI-handled minutes.
6. On N consecutive health-check successes, the recovery job flips the
   Twilio number back to the Retell SIP trunk and notifies the tenant AI
   is back.
7. The `/voice/tools` circuit breaker (SYSTEM_DESIGN §5, rolling per-tool
   error rate >20%/min) is a narrower, faster sibling of this flow: it
   degrades one tenant's live calls to message-taking mode without a full
   provider failover, and can trip independently of the platform-wide
   health check.

## Flow 7 — Provider migration (Retell → X) drill

1. A new `packages/adapters/<provider>` implements the full
   `VoiceProvider` interface (`parseInboundCallRequest`, `parseToolCalls`,
   `formatToolResult`, `verifyWebhookSignature`, `normalizeCallEvent`,
   `provisionPhoneNumber`, `getCallCost`) against the new provider's API —
   core booking/billing/dashboard code never changes, since it only ever
   sees canonical `ToolCall`/`ToolResult`/normalized-call-event shapes
   (CLAUDE.md Rule 2).
2. The template compiler (T2) gains a new lowering target for the same
   canonical `agent_templates.states/transitions/global_intents/tools`
   graph — the DB row is untouched, only the compiled artifact changes.
3. Contract tests against fixture payloads recorded from the new
   provider's sandbox validate the adapter before any tenant traffic
   touches it (mirrors the Retell contract-test requirement from T2).
4. Because every number lives in Twilio (A.2) and never the voice vendor,
   migrating one tenant is: re-run the provisioning saga's "import number"
   step (Flow 2 step 5 analog) against the new provider, then flip the
   Twilio number's SIP-trunk/TwiML target — no customer-visible number
   change, no port required.
5. Staged rollout: a canary tenant first, then a feature-flagged
   percentage-based cutover across tenants, watching the per-tool
   latency/error cockpit view (SYSTEM_DESIGN §5/§11) for regressions
   before completing; old-provider agents are torn down only after a bake
   period, matching the staged-publish discipline of Flow 9.

## Flow 8 — Tenant cancellation → port-out → data export → retention wind-down

1. Tenant requests cancellation → Stripe `DELETE`/`cancel_at_period_end`
   on the subscription (A.3); `customer.subscription.deleted` webhook
   confirms before we act.
2. Guaranteed port-out (G7): Retell's agent is un-imported from the
   number first (so no in-flight call is orphaned), then the number's
   port-out proceeds as a standard Twilio-hosted-number release
   cooperating with the gaining carrier's port request (A.2's PortIn
   surface, symmetric to Flow 2's optional port-in path) — guaranteed
   because the number was always ours in Twilio, never Retell's.
3. Data export job packages `call_logs`, `bookings`, `customers`,
   recordings into a downloadable bundle, delivered via a time-limited
   signed URL email (Resend, A.7).
4. `tenants.deleted_at` set (soft delete only) — `cost_events`,
   `revenue_events`, `billing_invoices`, `commission_events` are never
   cascade-deleted (BACKEND_SPEC's no-cascade-destruction rule).
5. Retention wind-down: recordings purge per the tenant's
   `retention_days` (BIPA-aware default 30–90, G3) via a scheduled
   Storage-object deletion job; `customers`/`call_logs` PII scrubbed or
   anonymized after the published retention/destruction policy window —
   a separate, typically longer, clock than the recordings purge.
6. If this tenant was itself a qualified referral, the referral clawback
   check (Flow 4 step 6) runs against the cancellation/any refund.

## Flow 9 — Template update → simulation CI → staged publish to tenants

1. A template author edits an `agent_templates` row's canonical
   `states[]/transitions[]/global_intents[]/tools[]` (BACKEND_SPEC §1.3)
   in a versioned migration/PR (`unique (vertical, version)`).
2. The CI batch-simulation harness (T6) runs the vertical's adversarial +
   happy-path test-case suite through Retell's LLM Simulation/Batch
   Testing (A.1) against a **staging** Retell account/agent compiled from
   the new template version (G16) — red-team prompt-injection cases must
   still respect tool authorization/disclosure invariants.
3. On green CI, the compiler publishes a new Retell conversation-flow
   version + `POST /publish-agent-version` (A.1) still against staging.
4. Feature-flagged staged rollout (G35): the new template version is
   attached to a small canary percentage of tenants' `agent_configs`
   first, monitored via the per-tool/per-call cockpit for latency/error/
   classification-drift regressions, before promoting to every tenant on
   that vertical.
5. Rollback: `agent_configs` simply repoints `template_version` (and the
   corresponding Retell agent version, immutable once published) to the
   prior version — no redeploy required.

## Flow 10 — Deep-integration connect (OAuth adapter) → catalog sync → two-way sync steady state

1. Tenant clicks "Connect <adapter>" → OAuth popup (Square/Clio/FUB/
   Google/Microsoft, A.6) or a paste-API-key modal (Shopmonkey/Cloudbeds/
   ezyVet-style, A.6) depending on the adapter's auth model.
2. OAuth callback exchanges the code for access+refresh tokens at the
   provider's token endpoint; tokens stored encrypted against the tenant's
   `IntegrationAdapter` connection record; auto-connect if the provider
   account has exactly one location, else a picker (salvaged UX pattern,
   SYSTEM_DESIGN §14).
3. Initial `syncCatalog`: the adapter pulls services/resources/
   availability shape (Square `POST /v2/catalog/search`, Cloudbeds
   `getRoomTypes`/`getRatePlans`, ezyVet resource endpoints, NexHealth
   provider/location sync, A.6) into `offerings`/`resources`/
   `availability_slots`, tagged with the adapter's foreign ids for
   round-tripping.
4. Steady-state `pushBooking`: when our booking core writes/updates a
   booking for a connected tenant, the adapter also writes it into the
   external system (NexHealth `POST /appointments`, Square `POST
   /v2/bookings`, Cloudbeds `postReservation`, Shopmonkey work-order
   create, ezyVet appointment create, Clio calendar entry, FUB `/events`,
   Google `events.insert`, Microsoft Graph `POST /me/events`) — mapped
   through that adapter's single status-mapping table into the canonical
   booking lifecycle.
5. Two-way sync (G11): where the provider supports it, staff-made
   cancellations/reschedules arrive as webhook events (`handleWebhook`) —
   Square, FUB, Clio (webhook coverage to verify), Google (`events.watch`
   channels), Microsoft Graph (`/subscriptions`, renewed before
   `expirationDateTime`); where it doesn't (Shopmonkey/ezyVet/Cloudbeds
   lack broad webhook coverage per current research), a polling job
   re-reads recent changes on an interval instead.
6. Revocation handling (salvaged, generalized to all adapters,
   SYSTEM_DESIGN §14): a provider-side OAuth revocation webhook, or a
   failed `refreshAuth`, marks the connection `disconnected` and raises a
   dashboard banner; the adapter falls back to primary-tier delivery
   (SMS/email/Airtable, A.7) for that tenant rather than silently failing
   future pushes.

---

# Completeness self-check

The following cannot be fully specified without a live provider
account/sandbox, and are marked `VERIFY:`/`DECIDE:` inline above as well:

1. **Retell**: exact webhook payload field names for the pre-call
   dynamic-variable/inbound-webhook hook; the precise 400 conditions on
   `PATCH /update-conversation-flow/{id}` for a flow already referenced by
   a published agent (multi-tenant flow-sharing pattern needs a staging
   test); Retell's webhook egress region (a named Week-0 support ticket
   in SYSTEM_DESIGN §13 itself); agent-count/write-QPS ceilings; exact
   Batch/Simulation Testing request/response schema; chat-agent SMS
   pricing unit. `docs.retellai.com` was not directly fetchable from this
   environment (egress-blocked) — everything Retell-related above is
   sourced from indexed third-party/community pages describing that same
   documentation, not a first-party fetch, and should be re-verified
   against a live account before the T2/T3 build starts.
2. **Twilio**: current GA status of the Porting API (Public Beta in
   sources reachable here); current Lookup `line_type_intelligence`
   per-call price; whether a Voice Integrity-class spam-score product is
   actually the intended G8 mechanism vs. STIR/SHAKEN attestation alone.
3. **Stripe**: exact meter-event ingestion latency vs. invoice-
   finalization cutoff (affects how late-arriving `get-call` reconciliation
   corrections are handled — meter-event-adjustment vs. next-period
   catch-up); stripe-sync-engine's deployment shape (library-inside-edge-
   function vs. its standalone Fastify server) against the "lean edge
   functions" rule.
4. **PayPal**: current per-payout fee and any minimum-payout/country
   verification thresholds, needed to finalize the referral $X amount
   against real payout economics.
5. **Adapters — access gates that require an actual application**:
   Shopmonkey 2.0's exact endpoint surface (1.0 docs are explicitly
   deprecated for new integrations); ezyVet's `partner_id` approval
   turnaround; NexHealth's per-underlying-PMS webhook fidelity and
   current per-call pricing; Clio's webhook coverage for calendar changes
   and whether the vertical clears its 10-discovery-call validation gate
   at all (MASTER_PLAN §1 Phase 3); Tekmetric's write-API availability
   (explicitly flagged as a Week-1 verification in MASTER_PLAN §1, not a
   Wave-1 build target in this doc).
6. **Outreach**: Smartlead vs. Instantly is an open business decision in
   the source docs themselves (both named as alternatives, never
   resolved) — build agents must not silently default to one; log the
   choice to `docs/BUILD_NOTES.md` per CLAUDE.md Rule 4 once made.
7. **Misc**: final email-provider decision (Resend recommended here, not
   locked — SYSTEM_DESIGN §15 open decision #7 ties this to the outreach
   sending-domain choice); Airtable overwrite-vs-skip conflict policy
   (G30) is a `DECIDE:` left open by source docs, not resolved here;
   current per-token cost/pricing for every named LLM and third-party API
   is time-sensitive and should be re-measured at build time rather than
   trusted from this pass.
8. **Cross-cutting**: every dollar figure carried over from SYSTEM_DESIGN/
   MASTER_PLAN (Retell all-in cost/min, outreach all-in monthly cost,
   Apollo credit pricing, NexHealth per-call cost) is explicitly
   directional in its source document and was not independently
   re-priced against a live billing account in this pass — treat as
   planning inputs, not contractual numbers, until confirmed.
