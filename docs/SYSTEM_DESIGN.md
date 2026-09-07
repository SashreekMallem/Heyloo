# Heyloo System Design — Production E2E Blueprint

The build spec for the complete redo. Synthesizes seven research streams
(Retell API mapping, Supabase production architecture, self-serve lifecycle,
outreach engine, margin cockpit, provider portability, payment processing)
plus the audit (`AUDIT_2026-09.md`), master plan (`MASTER_PLAN.md`), and
vertical research (`VERTICAL_RESEARCH.md`). Owner decisions baked in:
complete rebuild · Retell behind an abstraction · message-first core primary /
integrations secondary · no n8n · no Supabase Realtime (polling) · in-house
referral program · customer side designed from zero.

---

## 1. Product definition

**Primary tier (any business, live in minutes):** AI agent answers the phone →
converses → booking/order/lead stored in OUR database → delivered to the
business via SMS, email, Airtable sync, and the dashboard. No integration
required. **Secondary tier (upsell/retention):** adapters writing bookings
into the customer's own system (Shopmonkey, ezyVet, Square, Cloudbeds, Clio,
Follow Up Boss…). Verticals steer marketing only; signup is open to all.

**Pricing:** $299/mo base with an explicit included-minutes bucket (e.g.
300 min) + $0.40/min overage. Per-vertical price tiers available (research
supports dental $399–499, legal $499–599 — Smith.ai charges $293 for
human-hybrid; a missed legal intake call is worth $3.2–6.5k). 10–15%
annual-prepay discount on the base fee only. ACH strongly encouraged.

## 2. Architecture overview

```
 Caller ──PSTN──> Twilio number (WE own all numbers in Twilio — never the
                  voice vendor; makes provider switching a same-day config
                  change instead of a 10-day port)
                    │ SIP/import
                    ▼
              Retell agent (per tenant, compiled from our template)
                    │  tool calls / webhooks (HMAC verified)
                    ▼
 ┌─────────────────────── SUPABASE ───────────────────────────┐
 │ Edge functions:                                            │
 │  /voice/inbound     number→tenant→agent+variables resolver │
 │  /voice/tools       booking/availability/customer lookup   │
 │  /voice/events      call_started/ended/analyzed (fast-ack, │
 │                     dedup, queue; pull recording <10 min!) │
 │  /webhooks/stripe   billing sync    /webhooks/pos adapters │
 │  /admin/*           AAL2-gated owner ops                   │
 │ Postgres: RLS everywhere (JWT app_metadata tenant_id via   │
 │  Custom Access Token Hook; CI test queries cross-tenant    │
 │  rows with the public key and asserts zero results)        │
 │ pgmq queue + pg_cron workers (webhook processing, rollups, │
 │  billing, retention sweeps, churn scoring, alerts)         │
 │ Storage: recordings/{tenant}/{call}.mp3, signed URLs       │
 └────────────────────────────────────────────────────────────┘
        │ REST (publishable key, RLS)          │ server-side
        ▼                                      ▼
 Tenant dashboard + Admin cockpit      Stripe · Twilio SMS · email ·
 (polling: per-tenant last_activity    Airtable sync · PayPal Payouts
  check ~10s → refetch; NO websockets) (referrals) · adapters (Layer 2)
```

## 3. Stack decisions (all researched, all final unless owner reopens)

| Concern | Decision | Why |
|---|---|---|
| Voice provider | **Retell**, agent-per-tenant, behind `VoiceProvider` interface | Free self-serve HIPAA BAA; itemized per-call cost (`product_costs[]`); ~87% margin at 50 customers |
| Agent authoring | **Our canonical format** (system prompt + JSON-Schema tools) in our DB, compiled per provider | The one format all 5 providers accept; visual flow builders are mutually untranslatable — only ever compiled artifacts |
| Telephony | **All numbers purchased/owned in Twilio**, imported into Retell | Uniform anti-lock-in policy across every provider evaluated |
| Backend | Supabase (new project): Postgres + Auth + edge functions + pgmq + pg_cron + Storage | Infra ~$150–350/mo @50 tenants, ~$1k @500 — noise vs margins |
| Dashboard updates | **Update-triggered, tenant-scoped Realtime**: DB trigger on tenant writes → minimal broadcast on that tenant's private channel → frontend refetches. No polling; no postgres_changes fan-out | Owner decision: events fire only on update, delivered only to that tenant; RLS on `realtime.messages` scopes channels |
| Payments | **Stripe** (Checkout + Billing Meters: $299 licensed + metered minutes) + **ACH push** | MoR portals cost 40–70% MORE (5%+50¢); refund-fee loss is only ~$15–60/mo; ACH saves ~$560/mo @50 customers. Keep our own usage ledger as source of truth, report into Stripe — lowers future switching cost |
| Sales tax | Compliance tool (Numeral/TaxJar) when nexus accumulates; revisit MoR at ~150–200 customers | 25–26 states tax SaaS; MoR premium not worth it yet |
| Referrals | **In-house**: unique links, flat $X per referral, admin-configurable; PayPal Payouts API ($0.25/payout); 1099-NEC at $2,000/yr threshold; FTC disclosure copy required | Owner decision; no Rewardful/Tolt subscription |
| Outreach | **No n8n.** Admin panel + edge functions pull leads on demand (Apollo API + Outscraper/Apify Maps + state license rolls), push to Smartlead/Instantly API, reply webhooks → Supabase, Claude classifies intents | Owner decision; simpler, fewer moving parts |
| AI (internal) | Claude Haiku 4.5 for research/classification (Batch API), Sonnet for personalization writes; ~$0.02/lead | |
| Voice IDs | Standardize on ElevenLabs voice IDs in canonical config | Portable across Retell/Vapi/Bland as TTS backend |

## 4. Voice layer

- **Inbound flow:** Retell inbound webhook → `/voice/inbound` looks up
  `phone_numbers.tenant_id` → returns tenant's `agent_id` +
  `retell_llm_dynamic_variables` (business name, hours, services, greeting —
  all strings; typed values stringified). Reject unknown numbers.
- **Agent lifecycle:** vertical `agent_templates` (versioned) + per-tenant
  `agent_configs` (overrides) → compiler → Retell create/update/publish via
  API. Zero dashboard clicking. Batch-simulation tests run as a CI gate
  before any template version rolls to live tenants.
- **Tools (custom functions → our edge functions, HMAC-verified):**
  `check_availability`, `create_booking` (idempotency key = call_id+slot),
  `lookup_customer`, `take_message`, `transfer_call` (warm, with context),
  `send_sms_confirmation`. No Cal.com — availability/bookings live in our DB.
- **Events:** `call_started/ended/analyzed` → verify signature → dedup insert
  (`webhook_events` unique on source+event+call_id) → 200 fast-ack → queue.
  **Recording URL expires 10 minutes after webhook** → archive to Storage
  immediately in the background task, never batched. `call_analyzed` fields
  occasionally missing → nightly `GET /get-call` reconciliation job is source
  of truth for booking-critical data.
- **Cost ingestion:** every `product_costs[]` entry → `cost_events` row
  (component, unit price, amount, raw payload). Margin engine runs on actuals.
- **Telephony features:** conditional-forwarding default (their phone rings
  first), voicemail detection per agent, after-hours behavior from business
  hours config, warm transfer to owner's cell, customer SMS confirmations
  (A2P 10DLC registration is a real onboarding step — plan the brand/campaign
  registration flow).
- **Config knobs for margin:** LLM tier per vertical template
  (`fast|balanced|best`), voice tier per vertical, dynamic variables instead
  of per-tenant knowledge bases ($8/mo each after 10 — avoid).
- **Open items (Retell support ticket, before build):** agent-count ceiling,
  API rate limits, exact current `call_cost` schema, publish-endpoint
  reliability, recording storage options.

## 5. Data model (consolidated)

Core: `tenants` (vertical, plan, branding, business_hours, retention policy,
stripe_customer_id, referrer_id) · `memberships` (user↔tenant, role) ·
`platform_admins` · `phone_numbers` (twilio_sid, tenant_id, forwarding
status/verified_at) · `agent_templates` / `agent_configs` ·
`offerings` · `resources` · `availability` · `bookings` (start/end, resource,
status lifecycle, source call) · `orders` (restaurant specialization) ·
`customers` (per tenant) · `call_logs` (provider, duration, transcript,
recording_path, disconnection_reason, latency fields, tool-call stats,
combined_cost) · `messages_outbound` (SMS/email/Airtable delivery log).

Money: `cost_events` · `revenue_events` · `usage_events`/`usage_daily`
(keyed tenant+day+price_version) · `billing_invoices` (unique
tenant+period) · `payment_processing_events` (actual Stripe fees) ·
`commission_events` · `cac_events` · `fixed_cost_allocations` ·
`webhook_events` (dedup).

Referrals: `referral_partners` (user, payout_method, w9_status) ·
`referral_links` (code) · `referrals` (partner, tenant, status,
qualified_at) · `referral_payouts` (amount, period, paypal_batch_id,
1099_ytd_total). Payout amount $X read from `platform_settings`
(admin-editable), snapshotted onto each referral at creation.

Outreach: `leads` (vertical, source, status funnel) · `campaigns` ·
`send_events` · `replies` (ai_intent) · `suppression_list` ·
`pipeline_costs`.

All tenant-scoped tables: RLS keyed on JWT `app_metadata.tenant_id`,
`tenant_id` indexed, `(select auth.jwt())` wrapped, `TO authenticated`.
Numeric money in cents/numeric — never floats. Soft deletes on tenants;
no cascade destruction of financial history.

## 6. Security posture (fixes every audit failure class)

JWT claims via Custom Access Token Hook (server-writable `app_metadata`) ·
RLS on every table verified by CI cross-tenant probe · new
publishable/secret API keys (legacy keys die late 2026) · secret-key edge
functions still explicitly tenant-scope every query · every webhook:
signature first, raw-body verify, dedup insert, replay window · hashed API
tokens · revocable sessions · MFA (AAL2) for admin routes · recordings via
short-lived signed URLs after tenant check · Sentry on edge functions ·
suppression/opt-out honored same-day · fail-closed everywhere (the old code
failed open in five places).

## 7. Customer lifecycle (the self-running machine)

1. **Land & try:** enter business name + website → scrape hours/services →
   personalized demo agent in <60s → web-call widget AND a real number to
   call from their own phone. (No competitor does the full URL→personalized
   live agent flow — differentiation.)
2. **Pay:** card-required Stripe Checkout (converts 31–44% vs ~9% for
   no-card trials) + 14–30 day money-back guarantee instead of a trial.
3. **Provision (saga, idempotent, no humans):** tenant → agent compiled from
   vertical template (pre-seeded from the scrape) → Twilio number bought →
   imported to Retell → billing attached. Retries with backoff; never
   half-provisioned; dead-letter alert only after N automated retries fail.
4. **Forward the phone (the churn minefield):** guided per-carrier wizard
   (Verizon `*71`/`*90-93`, AT&T/T-Mobile `##61#`/`##67#`, VoIP panels,
   Google Voice special-cased), tap-to-dial codes, **automated verification
   test call** with live pass/fail. Default: conditional forwarding
   (safety-net mode) for the first weeks. Alternative: "use our number
   everywhere" or managed port-in.
5. **Aha:** first real handled call → instant push/SMS with transcript
   ("Your AI just booked Sarah for Thursday 2pm").
6. **Retention automation:** weekly value email (calls answered, booked,
   ~$ saved) → monthly after stabilization; nightly churn-risk scoring
   (volume drop vs own baseline, forwarding silently disabled, dashboard
   inactivity) → automated win-back; Stripe Smart Retries + dunning +
   auto-pause/reactivate; self-serve agent editing (hours/services/FAQ,
   instant redeploy) so "the AI said something wrong" is a 1-minute
   self-fix; failed/escalated calls auto-flag with review-&-fix prompt.
7. **Support without humans:** docs-trained chatbot (40–65% tier-1
   deflection once tuned), automated status page wired to monitoring.
   Founder hours: ~3–6/wk @50 customers, ~8–15/wk @200.
8. **Instrument from day one:** days-from-signup-to-first-verified-call and
   forwarding-verification history vs churn.

## 8. Referral program (in-house)

- Anyone signs up as a partner → unique link/code → referred signups
  attributed (code at checkout + cookie fallback).
- **Flat $X per qualified referral** (default suggestion: $100 after the
  referred customer's 2nd paid month — anti-fraud gate), X editable in admin
  settings; optional two-sided (referred customer gets a free month) for
  customer-referrers.
- Monthly payout run: PayPal Payouts API batch ($0.25 each), ledgered in
  `referral_payouts`; W-9 collected at partner signup; auto-1099-NEC when a
  partner crosses $2,000/yr; FTC disclosure copy provided and required.
- Partner portal page: their link, clicks, signups, qualified referrals,
  pending/paid amounts. RLS: partners see only aggregate data about their
  own referrals — never tenant call/booking data.
- Later: reseller/white-label tier (precedent: MyAIFrontDesk wholesales
  ~$55/agent + $0.12/min; partners retail $250–500) — build on same rails.

## 9. Admin panel

**Margin cockpit** (9 pages): waterfall (revenue → provider cost → gross →
commissions/processing/fixed/CAC → net) · per-customer margin table with
negative-margin flags + auto-diagnosis · per-call cost breakdown vs billed ·
cost-per-minute trend with provider-repricing markers · Config Lab (what
would switching model/voice save) · referral P&L · CAC per channel ·
bottleneck view (silence, failed tool calls, error hangups = wasted minutes)
· alert rules. Alerts via pg_cron: price-drift >8%, negative-margin
customer, usage spike 2.5×, concurrency ≥80% of pool, tool-failure spike,
commission>margin, payment failures.

**Margin levers, ranked ($/mo @ 50 customers):** LLM tier per vertical
($375–1,925) · commission structure ($500–1,900) · ACH routing (~$560) ·
voice-tier segmentation ($300–625) · wasted-minute elimination ($150–450) ·
BYO-Twilio SIP ($100–160, later) · Retell volume tier (at ~200+ customers).

**Outreach (no n8n):** campaign CRUD per vertical · "fetch leads" button →
edge function pulls Apollo (Organization plan, ~$150–180/mo) + Outscraper
Maps batches, dedupes against suppression list → Claude personalizes
(~$0.02/lead) → push to Smartlead/Instantly campaign via API → their
webhooks land in `/webhooks/outreach` → funnel view (sourced→sent→replied→
demo→customer), reply feed with Claude-classified intent and one-click
actions, CAC per vertical. **Compliance hard rules:** CAN-SPAM (address,
one-click unsub, same-day suppression), <0.3% complaint rate auto-pause,
4–6 week domain warm-up before first send (start day 1), **never AI-voice
cold calls** (TCPA: $500–1,500/call), no LinkedIn automation. Optional Lob
postcards for non-responders.

## 10. Dashboard (customer side, designed from zero)

Pages: Live activity (calls + bookings feed via polling, transcripts +
recordings inline) · Bookings (confirm/reschedule/cancel → customer SMS) ·
Customers · Agent settings (hours, services, greeting, FAQ, transfer number,
voicemail message — instant redeploy) · Phone setup (forwarding wizard +
verification status) · Delivery preferences (SMS/email/Airtable) · Billing
(usage this month, invoices) · Refer & earn. Tenant branding config
(logo/color). Role-guarded routes, error states everywhere, no tokens in
localStorage without mitigation, clean component library, lint + typecheck +
CI from commit one.

## 11. Build order

- **Week 0:** old-system triage (rotate Square token, kill
  `get_user_for_login`, force auth on `restaurants`/`pos`, remove fail-open
  branches) · new repo scaffold + CI + RLS test harness · **start email
  domain warm-up** · file Retell support questions · Stripe + Twilio + Apollo
  accounts.
- **Weeks 1–4 (Layer 1):** schema + auth/RLS · VoiceProvider + Retell
  adapter + template compiler · booking core (availability, bookings,
  idempotency) · message delivery (SMS/email/Airtable) · call event
  pipeline + recording archival + cost ingestion · basic tenant dashboard
  (polling) · demo-agent generator. Milestone: a stranger books a real
  appointment by phone and the business gets the SMS.
- **Weeks 4–7 (money + Wave 1):** Checkout→provision saga · forwarding
  wizard + verification calls · usage ledger → Stripe Meters · margin
  cockpit v1 (waterfall, per-customer, per-call) · referral program v1 ·
  `adapters/autorepair` (Shopmonkey; verify Tekmetric writes) +
  `adapters/vet` (ezyVet) · migrate the existing restaurant client; retire
  old system. First cold sends (domains now warm).
- **Weeks 7–10:** outreach admin full funnel · retention automation (value
  emails, churn scoring, dunning) · support chatbot · Wave 2 adapter (FUB
  teams-angle or Clio after discovery calls) · alerts live.
- **Weeks 10–14:** Wave 3 (NexHealth + Retell BAA, Square Bookings wedge,
  Cloudbeds) · load tests · per-vertical pricing experiments · scale push
  toward 50 customers.

## 12. Open decisions for the owner

1. Flat $X referral amount and qualification rule (suggested: $100 after
   2nd paid month) + whether referred customers get a free month.
2. Per-vertical pricing now vs. flat $299 launch (research says legal/dental
   bear $499/$399).
3. Included-minutes bucket size (300 min suggested).
4. Demo agent: auto-scraped info goes live unreviewed vs. one confirmation
   step (wrong scraped hours in a demo call burns trust).
5. Default forwarding mode: conditional (safe) vs. full (faster aha).
6. 2am escalation fallback when the owner doesn't pick up: voicemail+SMS
   (default) vs. paid human-backup layer.
7. Brand/domain for sending infrastructure (needed day 1 for warm-up).
