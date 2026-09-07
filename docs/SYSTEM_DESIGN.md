# Heyloo System Design v2 — Production E2E Build Spec

Definitive build spec for the complete redo. v2 folds in eleven research
streams: Retell API mapping, Supabase production architecture, self-serve
lifecycle, outreach engine, margin cockpit, provider portability, payment
processing, **per-vertical pricing**, **conversation-layer design**,
**latency/data-access engineering**, and an **adversarial gap review (41
findings)**. Owner decisions locked: complete rebuild · Retell behind an
abstraction · message-first core primary / integrations secondary · no n8n ·
update-triggered tenant-scoped realtime (no polling, no global fan-out) ·
in-house referrals · Stripe + ACH push · customer side designed from zero.

Companion docs: `AUDIT_2026-09.md` (why the old code is discarded),
`MASTER_PLAN.md` (business decisions), `VERTICAL_RESEARCH.md` (market data).

---

## 1. Product & pricing

**Primary tier (any business, live fast):** AI answers the phone → booking/
order/lead stored in OUR database → delivered via SMS, email, Airtable, and
a live dashboard. No integration required. **Secondary tier:** adapters
writing into the customer's own system (Shopmonkey, ezyVet, Square,
Cloudbeds, Clio, Follow Up Boss, + a generic Google/Outlook Calendar adapter
— see gap G10). Verticals steer marketing; signup is open to all.

### Per-vertical price card (researched, not guessed)

| Vertical | Base | Incl. min | Overage | Expected usage | Margin | Competitor anchor |
|---|---|---|---|---|---|---|
| Auto repair | $299 | 300 | $0.35 | ~300 min/mo | ~88% | AutoLeap AIR $179–409; VoiceController $99 |
| Veterinary | $349 | 500 | $0.40 | 500–800 | 80–84% | PupPilot $125/doctor; AgentZap $109+ |
| Legal intake | $399 | 300 | $0.45 | 300–450 | 87–91% | Ruby (human) $250–1,725; Smith.ai human $292–975 |
| Dental | $349 | 350 | $0.40 | 350–600 | 80–88% | Peerlogic $199; Weave suite $300–800 (their voice AI still waitlisted) |
| Real estate | $349 | 150 | $0.40 | 80–160 | ~95% | Structurely $499–999; Ylopo $895–2,000 effective |
| Motels | $299 | 400 | $0.35 | 400–750 | 73–85% | Human answering $250–1,725; Canary = enterprise-only |
| Restaurants | $249 | 500 | $0.30 | 500–900 | 72–77% | Loman $199–529 (defensive pricing; not a GTM lead) |
| Generic | $299 | 300 | $0.40 | 250–350 | 87–90% | Rosie $49–299, MyAIFrontDesk $65–99, Smith.ai AI $97.50 |

- **Pricing display:** marketing site says "starting at $299/mo"; the real
  vertical price card is revealed at signup step 2 (after business-type
  selection, before Stripe Checkout). Every vertical competitor gates real
  pricing; a published matrix would be the outlier and a comparison gift.
- **Generic-tier defense vs the $49–99 floor:** no punitive per-call overage
  (Smith.ai charges $9.75–11/call over plan), booking-write + SMS standard
  (Rosie gates booking to $149), real dashboard with recordings/transcripts,
  and vertical templates nobody at the floor offers.
- 10–15% annual-prepay discount on base fee only. ACH pushed for all
  accounts (fee $3.99 vs ~$15/invoice on card). Loss-framing in sales: each
  vertical's missed-call loss ($135k/yr auto, $100–182k/yr vet,
  $3.2–6.5k/missed legal call) vs a ~$300–400/mo product.

## 2. Architecture overview

```
 Caller ──PSTN──> Twilio number (WE own ALL numbers in Twilio — never the
                  voice vendor → provider switch is same-day config, and
                  tenant port-OUT on cancellation is guaranteed (G7))
                    │ import/SIP
                    ▼
          Retell agent (per tenant, compiled from our canonical template)
                    │ tool calls / webhooks (HMAC, raw-body verify)
                    ▼
 ┌──────────────────────── SUPABASE (one region, pinned) ────────────────┐
 │ Edge functions (lean, region-pinned, kept warm):                      │
 │  /voice/inbound  number→tenant→agent+dynamic-variables resolver       │
 │  /voice/tools    availability/booking/customer/message (hot path:     │
 │                  p50<200ms, p95<500ms, abort 1.5s → fallback)         │
 │  /voice/events   call_started/ended/analyzed → verify → dedup →       │
 │                  fast-ack → background: recording pull (<10 min!),    │
 │                  cost ingestion, notification fan-out                 │
 │  /webhooks/stripe|outreach|pos  · /admin/* (AAL2 + audit log)         │
 │ Postgres: RLS everywhere (JWT app_metadata tenant_id via Custom       │
 │  Access Token Hook; CI cross-tenant probe must return 0 rows);        │
 │  GIST exclusion constraint = double-booking impossible;               │
 │  precomputed availability_slots (14–30d window, trigger-invalidated)  │
 │ pgmq + pg_cron: queue workers, nightly get-call reconciliation,       │
 │  rollups, billing, retention sweeps, churn scoring, alerts,           │
 │  Retell health check → auto-failover (G5)                             │
 │ Realtime: DB trigger on tenant writes → broadcast on that tenant's    │
 │  PRIVATE channel only (RLS on realtime.messages) → frontend refetch.  │
 │  Fires only on update, delivered only to that tenant.                 │
 │ Storage: recordings/{tenant}/{call} — signed URLs, per-tenant         │
 │  retention windows (BIPA-aware defaults, G3)                          │
 └───────────────────────────────────────────────────────────────────────┘
        │                                   │
 Tenant dashboard · Admin cockpit    Stripe · Twilio SMS (A2P) · email ·
 · Partner portal                    Airtable · PayPal Payouts · adapters
```

## 3. Stack decisions

| Concern | Decision | Basis |
|---|---|---|
| Voice provider | Retell, agent-per-tenant, behind `VoiceProvider` interface with capability flags | Free HIPAA BAA; itemized `product_costs[]` per call; inbound webhook = multi-tenant dispatch |
| Agent authoring | Canonical schema in OUR DB: system prompt + JSON-Schema tools + **abstract state graph** (states, transitions, global_intents) compiled per provider | Provider flow builders are mutually untranslatable; our graph compiles to Retell conversation-flow, multi-prompt, or a single mega-prompt per target |
| Telephony | All numbers in Twilio, imported to Retell; **guaranteed port-out on cancellation** | Anti-lock-in for us AND the customer |
| Backend | Supabase: Postgres + Auth + edge functions + pgmq + pg_cron + Storage, one pinned region | Infra ~$150–350/mo @50 tenants |
| Realtime | Update-triggered broadcast on private per-tenant channels; frontend refetches on event | Owner decision: fires only on update, only to that tenant |
| Payments | Stripe (Checkout + Billing Meters: licensed base + metered minutes) + ACH push; own usage ledger as source of truth | MoR portals cost 40–70% more; refund-fee loss only ~$15–60/mo; ledger independence lowers switching cost |
| Referrals | In-house: links, flat $X/qualified referral (admin-configurable), PayPal Payouts ($0.25), W-9 + 1099-NEC at $2k/yr, FTC disclosure required | Owner decision |
| Outreach | No n8n. Admin-panel lead fetch (Apollo + Outscraper/Apify + license rolls) → Claude personalization (~$0.02/lead) → Smartlead/Instantly API → reply webhooks → Claude intent classification | Owner decision; ~$355–470/mo all-in at 1,250 sends/wk |
| Voice IDs | ElevenLabs voice IDs in canonical config | Portable across providers as TTS backend |

## 4. Conversation layer (per-vertical design)

### 4.1 Prompt architecture per vertical

| Vertical | Engine (compiled target) | Why |
|---|---|---|
| Auto, dental, motel, restaurant | **Conversation Flow** (node graph) | Hard slot-filling; typed Extract-DV nodes; model cannot invent prices/menu items/rates — tool-backed nodes only |
| Veterinary | Conversation Flow + **global emergency node** | Red-flag escape reachable from any point in the call — structurally guaranteed, not model-discretionary |
| Legal | **Multi-prompt states** | Hard-gated conflict-check + no-advice guardrail per state, with open empathetic discovery a rigid graph would flatten |
| Real estate, generic | **Single prompt** | Qualification is conversational; over-structuring reads as interrogation; under the ~1000-word/5-tool threshold |

The choice is a **compile target**, not authored per provider: our DB stores
`states[]` (prompt fragment, allowed tools, validation), `transitions[]`
(intent/predicate conditions), `global_intents[]` (emergency, human-request,
solicitor). The compiler lowers this to Retell's format — or any provider's.

### 4.2 Call taxonomy (12 classes, every call lands in exactly one)

new booking · reschedule · cancel · question/FAQ · status check · sales lead
(quote, no commit — capture contact, `follow_up_needed`) · **solicitor
calling the business** (polite deflect, optional message, never transfer) ·
wrong number · **spam/robocall** (dead-air/looping-audio pattern → hang up
within 10–15s, stop burning minutes) · **emergency** (vertical red-flags →
global escalation, booking flow bypassed) · after-hours message · transfer
request. In-call tools drive routing; **post-call analysis is the
authoritative final classification**; a call can migrate class mid-call.

### 4.3 Input collection per vertical (validated against real front-desk protocols)

One field at a time → confirm → next. Digit-by-digit read-backs for phones/
dates, slower cadence on read-back.

- **Auto:** name · phone · vehicle year/make/model (validated) · symptom →
  service category · drop-off vs wait · time (via `check_availability`).
- **Vet:** owner+phone · pet name/species/breed/age · new vs existing ·
  **triage FIRST**: red-flags (bloat, seizure, can't breathe, hit-by-car,
  toxin ingestion, male cat straining, severe bleeding, blue gums) →
  immediate ER referral/warm transfer, never diagnosis · else symptom vs
  routine · time. (Vet is NOT HIPAA — animal records aren't PHI; no BAA
  gate needed, unlike dental.)
- **Legal:** name+phone · matter type · open discovery ("walk me through
  it") · urgency (SOL, custody, court date) · **opposing party full name
  BEFORE substantive discussion** (conflict check — flagged for human
  review, never auto-cleared) · referral source. Hard guardrail in every
  state: no legal advice, no merits opinion, no fee quotes beyond
  configured consult fee. `legal_advice_given` boolean must always be
  false — alerts if ever true.
- **Dental:** patient name · new vs existing · pain triage (pain/swelling/
  fever/knocked-out tooth → urgency tiers, same-day check) · time.
  **DOB/insurance deferred to a secure post-call form link** — PHI stays
  out of transcripts where possible.
- **Real estate:** buyer/seller · property or area · pre-approved? ·
  timeline · budget · showing time — covered in ~2 minutes, conversational.
- **Motel:** dates · guests · room type · **rate only from the
  owner-configured rate table via tool call** · payment/cancel policy ·
  no-availability → offer nearest alternative.
- **Restaurant:** order vs reservation branch early · items from tool-backed
  catalog only · pickup/delivery or party size · allergies asked explicitly
  · full read-back before close.
- **Generic:** name · phone · reason · message · callback window.

### 4.4 Data saved per call

Two sources, deliberately separate: **in-call tool args are authoritative**
for booking-critical fields (written synchronously by `/voice/tools`);
post-call analysis (`call_analyzed` + nightly `get-call` reconciliation) is
enrichment: `classification` (12-enum), `outcome`, `sentiment`,
`call_successful`, `call_summary`, `follow_up_needed`, `urgency_flag`
(set IN-call on red-flags, never waiting for post-call), `message_text`,
`structured_booking_payload` (vertical schema), `extracted_entities`,
`disconnection_reason`, latency fields, tool-call stats — **plus (from the
old system's production experience): `state_trace` (which conversation-graph
states the call visited — essential for debugging compiled flows),
`variable_values` (the dynamic context the agent actually had at call
time), and `stereo_recording_url` (dual-channel, for QA/disputes)**.
Vertical custom post-call fields map to Retell's typed Bool/Text/Number/Enum
extraction.

### 4.5 Conversation quality & disclosure rules

- **Mandatory, non-removable opening disclosure in every greeting, every
  state:** AI status + recording notice ("Thanks for calling {{business}},
  this is their AI assistant — this call may be recorded"). Covers
  two-party-consent recording states AND AI-disclosure laws (CA AB 2905
  et al.) in one line. Wording per vertical is an owner decision (clumsy
  disclosure can raise hang-ups); presence is not.
- Silence: nudge ~2s, again ~5–7s, message-mode ~10–12s. Barge-in tuned
  (VAD + confidence + word count; backchannels ≠ interruptions).
- Give-up ladder: 2 failed clarifications on one field → yes/no
  simplification; 3 total misunderstandings → transfer/message. Escalation
  triggers: explicit human request, anger/sentiment, compliance-sensitive
  asks (legal advice, diagnosis), emergencies, language mismatch.
- Warm transfers always carry a context summary — caller never repeats.
- Low-confidence booking-critical fields are never silently accepted —
  offer a texted link for self-entry instead.

## 5. Latency & data-access engineering (hot path)

**Budget:** Retell's own loop is ~680–920ms; caller tolerance ~1.5–2s/turn.
Our tool endpoints: **p50 <200ms, p95 <500ms, hard abort 1.5s** → graceful
"I'll take your details and have someone confirm" fallback. Filler speech on
every tool call. Never let Retell's 10s timeout/retry be the failure path.

- **Availability = precomputed.** `availability_slots` (tenant, resource,
  slot range, is_available) materialized 14–30 days ahead, partial index on
  open slots, GIST range index, trigger-invalidated by booking writes and
  schedule changes, rolled forward nightly. Hot query = one indexed read,
  <10ms. Timezone math baked in at materialization (tenant IANA tz), never
  in the hot path.
- **Booking = one INSERT, race-proof.** GIST **exclusion constraint** on
  (resource_id, tstzrange) where status='confirmed' — two concurrent
  callers physically cannot double-book. Unique `idempotency_key`
  (call_id+slot): Retell retries return the existing booking, never a
  duplicate. Slot flip + booking in one transaction — no consistency window.
- **Customer lookup** = E.164-normalized unique index (tenant, phone).
- **Static context (hours, services, greeting, short FAQ) rides in dynamic
  variables at call start — zero tool calls.** Above a few KB (big menus)
  it moves to a targeted lookup tool; oversized injected context taxes
  every turn's tokens and latency.
- **Infra rules:** edge functions region-pinned with the DB (confirm
  Retell's webhook egress region via support); keep-warm ping every 3–5
  min; lean handlers (no ORM on `/voice/tools`); module-scope DB client;
  session-mode/dedicated pooler so prepared statements actually reuse.
- **Circuit breaker:** rolling per-tool error/timeout rate; above threshold
  (~20%/min) new calls short-circuit to message-taking mode until reset.
  Per-tool p50/p95/p99 + error rate feed the cockpit bottleneck view +
  alerts.
- **Load reality:** 100 concurrent calls ≈ 5–6 tool calls/sec — trivial for
  Postgres. The first wall is Retell's 20-concurrent-call default ($8/line
  beyond). Risk is tail latency, not throughput.

## 6. Data model (consolidated)

Core: `tenants` (vertical, plan, price_version, branding, business_hours +
**exceptions/holidays**, timezone, retention_days, stripe_customer_id,
referrer_id, language config) · `memberships` · `platform_admins` ·
`admin_actions` (audit log incl. impersonation, G15) · `phone_numbers`
(twilio_sid, forwarding_verified_at, spam-label status) · `agent_templates`
(canonical prompt + tools + state graph, versioned) · `agent_configs` ·
`offerings` · `resources` · `availability_slots` · `bookings` (exclusion
constraint, idempotency, source_call_id) · `orders` · `customers` (E.164) ·
`call_logs` (full spec §4.4) · `messages_outbound` · `webhook_events`
(unique source+event_id).

Money: `cost_events` (per `product_costs[]` entry, provider column) ·
`revenue_events` · `usage_events`/`usage_daily` (tenant+day+price_version) ·
`billing_invoices` (unique tenant+period) · `payment_processing_events`
(actual Stripe fees) · `commission_events` · `cac_events` ·
`fixed_cost_allocations`.

Referrals: `referral_partners` (payout method, W-9 status, 1099 YTD) ·
`referral_links` · `referrals` (status, qualified_at — default rule: after
referred customer's 2nd paid month) · `referral_payouts`. $X read from
`platform_settings`, snapshotted per referral.

Outreach: `leads` · `campaigns` · `send_events` · `replies` (ai_intent) ·
`suppression_list` · `pipeline_costs`.

Discipline: RLS on every table (CI-verified), tenant_id indexed, money in
cents, soft-delete tenants, no cascade destruction of financial history,
timestamped reproducible migrations, seed/demo data per vertical for QA.

## 7. Security & compliance

Everything from v1 (JWT claims hook, fail-closed webhooks, hashed tokens,
revocable sessions, MFA admin, Sentry) **plus the gap-review mandates**:

- **In-audio compliance (blockers G1/G2):** AI + recording disclosure in
  every greeting — compiler-enforced constant, not tenant-editable.
- **BIPA (G3):** counsel review of voice processing; short default recording
  retention (30–90 days, tenant-extendable with consent flow); no
  caller-voice-recognition features; published retention/destruction policy.
- **Prompt-injection defense (G6):** tool-level authorization —
  `lookup_customer` scoped to the caller's own number by default;
  `transfer_call` destinations tenant-config-only, never caller-influenced;
  adversarial red-team prompts in the CI simulation gate; scraped demo-site
  content sanitized of instruction-like patterns before injection (G21).
- **A2P 10DLC (G4):** platform registers as reseller brand via Twilio;
  campaign vetting designed into onboarding with an explicit "SMS pending
  verification" state (1–5 business days) and email fallback — never
  silently failing confirmations.
- **PCI/PHI in audio (G20):** real-time card-number redaction before any
  restaurant/motel tenant takes phone payments; documented PHI handling for
  dental (tenant-facing BAA at dental onboarding, G22) independent of the
  Retell BAA.
- **Inbound spam (G8):** Twilio spam-score/STIR-SHAKEN gate before
  connecting to Retell + pre-agent silence detection — junk calls never
  burn paid minutes.
- **Outbound reputation (G9):** CNAM registration, caller-ID reputation
  registries, per-number spam-label monitoring.
- Legal pages: ToS, privacy policy, DPA (we process the SMB's customer
  PII), recording/AI disclosure documentation.

## 8. Reliability & failover

- **Retell outage failover (blocker G5):** active health check (synthetic
  test call/API probe every few minutes); on failure, auto-flip Twilio
  routing to forward-to-owner-cell → voicemail, SMS the tenant ("AI briefly
  down, calls ring your phone"), auto-restore on recovery. Phase 1, not
  later — Retell had multiple 1-hour+ outages in 2026.
- Automated status page wired to monitoring (<5 min time-to-comms).
- Graceful deploys: versioned edge functions, in-flight tool calls drain.
- Webhook ordering tolerance (call_ended before call_started), clock-skew
  window on HMAC, nightly reconciliation.
- Quarterly backup **restore drill** into a scratch project. PITR on.
- Solo-founder continuity: break-glass credentials with a trusted contact,
  documented runbook (G18). Published support SLA for critical outages
  (G19).
- Staging Retell account for CI/template QA — never test against prod
  agents (G16). Feature flags/staged rollout for template + code changes
  (G35).

## 9. Customer lifecycle

As v1 (URL→personalized demo agent <60s → card-required checkout +
money-back guarantee → provisioning saga → per-carrier forwarding wizard
with automated verification call → first-call celebration → weekly value
emails → churn scoring → self-serve editing → docs chatbot), **plus gap
fixes:** owner test-calls detected (registered cell) and excluded from
billable usage (G13) · customer-facing usage alerts at 80%/100% of included
minutes + optional hard cap (G14) · seasonal pause plan for motels/
restaurants (G24) · offboarding = guaranteed number port-out SLA, data
export, retention wind-down (G7) · refund/guarantee mechanics with
signup-cycle abuse guardrails (G33) · during-hours transfer-no-answer
fallback (voicemail + SMS + dashboard flag, G29) · caller-callback
continuity via phone-number-keyed recent-context lookup (G28) · Spanish/
bilingual as per-tenant language config in the template compiler (G12) ·
TTY/relay call handling reviewed for ADA (G25) · multi-location and
multi-staff-calendar modeling before any multi-location tenant onboards
(G26) · per-tenant concurrency behavior defined (second simultaneous call
→ second agent instance; Retell pool monitored) (G27).

## 10. Referral program (in-house)

Unique links/codes → attribution at checkout (+cookie fallback) → flat $X
per qualified referral (admin-configurable; suggested $100 after 2nd paid
month) → monthly PayPal Payouts batch ($0.25 each) → W-9 at signup,
auto-1099-NEC at $2k/yr, FTC disclosure copy required. Anti-fraud (G34):
self-referral detection (matching payment fingerprint/domain/device),
qualification delay, clawback on refund/chargeback of the referred account.
Partner portal: link, clicks, signups, qualified, pending/paid. Later:
reseller/white-label tier (~$55/agent + wholesale minutes precedent).

## 11. Admin panel

**Margin cockpit** (9 pages + alerts) as specified: waterfall, per-customer
margin with negative-margin auto-diagnosis, per-call cost vs billed,
provider-repricing drift markers, Config Lab, referral P&L, CAC per channel,
bottleneck view (now including per-tool latency percentiles), alert rules
(price drift >8%, negative margin, usage spike 2.5×, concurrency 80%,
tool-failure spike, commission>margin, payment failures). Margin levers
ranked: LLM tier per vertical ($375–1,925/mo @50) · commission caps ·
ACH (~$560) · voice tiers ($300–625) · wasted minutes ($150–450) ·
BYO-Twilio later · Retell volume tier at ~200+ customers.

**Outreach (no n8n):** fetch-leads → dedupe → Claude personalize → push to
sender API → reply webhooks → intent-classified feed → funnel + CAC.
Hard rules: CAN-SPAM, <0.3% complaints auto-pause, 4–6 wk domain warm-up
started day 1, never AI-voice cold calls (TCPA), no LinkedIn automation;
Lob postcards optional.

**Adapters:** interface now includes **two-way sync** (webhook-or-polling
pull-back of staff-made cancellations/reschedules — G11) and the generic
**Google/Outlook Calendar adapter promoted into early build** (G10 — the
most universal scheduling surface for solo operators). Airtable sync gets
conflict handling (one-way push + change detection warnings, G30).

## 12. Gap register

41 findings from the adversarial review, tracked as `docs/` backlog:
**Blockers (in Phase 1):** G1 recording-consent disclosure · G2 AI
disclosure · G3 BIPA posture · G4 A2P 10DLC flow · G5 Retell failover ·
G6 prompt-injection/tool authorization · G7 customer number port-out.
**High (before scaling past pilots):** G8 inbound spam gate · G9 number
reputation · G10 calendar adapter · G11 two-way sync · G12 bilingual ·
G13 owner test-call carve-out · G14 overage alerts · G15 admin audit/
impersonation · G16 Retell staging · G17 restore drills · G18 continuity
plan · G19 support SLA · G20 PCI/PHI redaction · G21 scrape sanitization ·
G22 tenant BAA. **Medium:** G23–G36 (holiday hours, seasonal pause, TTY,
multi-location, per-tenant concurrency, callback continuity, transfer
no-answer, Airtable conflicts, deploy draining, webhook ordering, refund
abuse, referral fraud, feature flags, tax-nexus tracking). **Low:** G37–41.

## 13. Build order (updated)

- **Week 0:** old-system security triage · new repo + CI + RLS cross-tenant
  test harness · **start domain warm-up** · Retell support tickets (agent
  ceiling, rate limits, cost schema, webhook egress region, publish
  reliability) · Stripe/Twilio/Apollo accounts · **A2P reseller-brand
  registration started** (lead time!) · counsel questions (BIPA, recording
  consent) filed.
- **Weeks 1–4 (Layer 1):** schema + auth/RLS · VoiceProvider + Retell
  adapter + template compiler (states graph → conversation-flow) with
  compiler-enforced disclosure line · booking core (slots table, exclusion
  constraint, idempotency) · hot-path tool endpoints built to the latency
  budget · message delivery (SMS with pending-verification state, email,
  Airtable) · call event pipeline + recording archival + cost ingestion ·
  **Retell health-check failover** · tool-level authorization + red-team CI
  gate · tenant dashboard (tenant-scoped realtime) · demo-agent generator
  with scrape sanitization. Milestone: a stranger books a real appointment
  by phone; the business gets the SMS; margin row lands in the cockpit.
- **Weeks 4–7 (money + Wave 1):** Checkout (vertical price card at step 2)
  → provisioning saga · forwarding wizard + verification call · usage
  ledger → Stripe Meters + customer usage alerts + owner-test carve-out ·
  margin cockpit v1 · referral program v1 · `adapters/autorepair`
  (Shopmonkey) + `adapters/vet` (ezyVet) + **generic calendar adapter** ·
  migrate the restaurant client; retire old system · first cold sends.
- **Weeks 7–10:** outreach admin full funnel · retention automation ·
  support chatbot · bilingual support · Wave 2 adapter (FUB teams-angle or
  Clio post-discovery-calls) · two-way sync for live adapters · admin
  audit/impersonation · staging environment hardening.
- **Weeks 10–14:** Wave 3 (NexHealth + tenant BAA flow, Square Bookings
  wedge, Cloudbeds) · PCI redaction before phone-payment tenants · load
  tests at purchased concurrency · per-vertical pricing experiments ·
  scale toward 50 customers.

## 14. Carry-overs from the old codebase (salvage pass)

The old system served a real restaurant customer; a dedicated salvage pass
mined it for features/knowledge the rebuild should keep:

**Features v2 lacked — now adopted:**
- **Manual mode** (adopt as-is, generalized): a per-tenant "I'll handle it
  myself" switch — dashboard banner, consequence-explaining confirm dialog,
  CRUD unlocks, orders/bookings routed to SMS. This is the field-tested UI
  for the message-first primary tier and a trust feature for nervous
  first-week customers.
- **Support tickets** (adopt redesigned): tenant-facing tickets linked to
  call_id/booking, internal-vs-visible notes, status lifecycle — the paper
  trail for the "transfer request"/"after-hours message" call classes.
- **Tenant API tokens** (Phase 2/3, redesigned — hashed this time):
  per-tenant external API access; a real differentiator for customers who
  want to pull their own data.
- **Customer segmentation** (adopt): VIP/Loyal/Returning/New by lifetime
  activity on the customers page.
- **Rich AI-context settings** (adopt into template dynamic variables):
  manager name/phone, "special instructions for the AI" free text, parking
  info, accessibility notes, prep time, delivery radius/minimums, accepted
  payment types — real fields a real business needed.
- **Assistant persona name** (adopt): owner names their AI; composes with
  the mandatory disclosure — "Hi, this is Maria, the AI assistant for
  Joe's Pizza — this call may be recorded."
- **Adapter revocation handling** (adopt, generalized to all adapters):
  on provider-side OAuth revocation webhook, mark connection disconnected +
  dashboard banner — never silently fail future pushes.

**Hard-won API knowledge preserved for the restaurant adapter port**
(reference: `CLOVER_CRUD_DOCUMENTATION.md`, kept):
- Clover: refresh at min(10% lifetime left, 1h); refresh tokens live 14
  days and are ROTATED on every refresh (must save the new one); merchant_id
  parsed from the access-token JWT or callback param, not the token
  exchange; orders = create then POST line items individually, `unitQty`
  not `quantity`, integer cents, never send `id`; webhooks carry no payload
  (fetch the order after).
- Square: catalog via POST /v2/catalog/search; price at
  `variations[0].item_variation_data.price_money.amount`; delivery vs
  pickup need different `fulfillments` shapes; webhook signature =
  HMAC-SHA256(notificationUrl + rawBody), base64.

**UX patterns worth reusing:** OAuth popup + triple-sent postMessage +
meta-refresh fallback pages (with a FIXED origin check); auto-connect when
one location / picker when many; reauthorize-updates-not-duplicates rule;
secret-reveal-once modal; live call feed beside metric cards; collapsible
sync-log viewer; single connection-lifecycle card (connect/reauth/
disconnect/sync-now/last-sync); explanatory empty states; the date-range
pill UI (rebuilt on tenant-timezone boundaries); the production SMS
notification template wording; the atomic `ON CONFLICT ... DO UPDATE`
daily-usage upsert shape.

**Explicitly skipped:** Vapi Squads/per-business KBs (never actually built;
the compiled state-graph + dynamic-variables design supersedes it), the
hardcoded call-center KPI stubs (keep the vocabulary, not the fake numbers).

## 15. Owner decisions (open)

1. Referral $X + qualification rule (+ referred-customer free month?).
2. Approve the per-vertical price card (§1) or launch flat $299.
3. Greeting/disclosure wording per vertical (warmth vs legal-safety).
4. Demo agent: scraped info live unreviewed vs one confirmation step.
5. Default forwarding mode: conditional (safe) vs full (faster aha).
6. 2am escalation fallback: voicemail+SMS (default) vs paid human backup.
7. Sending domain/brand for outreach (needed day 1).
8. Recording retention default (30 vs 90 days) pending BIPA counsel input.
