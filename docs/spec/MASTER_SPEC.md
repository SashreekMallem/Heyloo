# MASTER SPEC — Evaluation & Binding Patches (Fable 5)

The one-view master document. The granular specs are:
- `BACKEND_SPEC.md` — DB (every column/index/constraint/trigger/RLS
  predicate), edge functions, jobs, queues, notifications, auth (2,189 ln)
- `FRONTEND_SPEC.md` — every route/page/component/interaction/state across
  marketing, signup, tenant, admin, partner surfaces (1,401 ln)
- `API_AND_FLOWS.md` — every external API call + 10 end-to-end flows (1,521 ln)

This document is the **evaluation layer above them**: where it conflicts
with a spec, THIS FILE WINS. Build agents read their spec + this file.

## 1. Verdict — can this achieve the voice agency we're building?

| Goal | Verdict |
|---|---|
| Any business live fast, message-first, no integration | ✅ specced end-to-end (inbound resolver → tools → notifications → dashboard) |
| Deep integrations as upsell | ✅ adapter interface + per-adapter webhook table + two-way sync + revocation handling |
| Self-running machine (demo→pay→provision→forward→retain) | ✅ specced incl. saga with compensation, forwarding verification, churn scoring, value emails |
| Per-vertical pricing + margins | ✅ price cards in platform_settings, snapshot versioning, cost_events from real provider costs |
| Margin cockpit + alerts | ✅ views + 9 pages + alert job |
| Provider portability | ✅ canonical template schema + compiler + Twilio-owned numbers |
| In-house referrals ($X admin-set) | ✅ full table set, qualification fn, PayPal batch, fraud flags |
| Outreach without n8n | ✅ admin-driven fetch/personalize/send/classify |
| Compliance blockers (G1–G7) | ✅ disclosure compiler gate, BIPA retention, A2P states, failover job, tool authorization, port-out |
| Security invariants | ✅ RLS matrix on every table + CI probe + fail-closed webhooks + hashed tokens |
| **11 late-identified gaps** | ❌ largely absent from the specs (written before the gap list existed) → **patched in §3, now binding** |
| Restaurant order-taking | ❌ `orders` table exists but **no `create_order` voice tool was specced** → patched §3.0 |

**Overall: buildable to the full vision once §3's patches are applied.**
The three specs are high quality, internally consistent, and honest about
what needs live-docs verification (their `VERIFY:` flags stand).

## 2. Binding DECIDE resolutions

All `DECIDE:` markers across the three specs are resolved as their stated
recommendations, with these made explicit:
email = **Resend** · sender = **Smartlead** (deeper API, client_id
scoping) · slots **pre-subdivided** at generation (30-min default; per-night
motels; 15-min dental option), window **21 days** (30 motels) ·
`demo_sessions`, `provisioning_runs`, `alerts`, `push_subscriptions`,
`churn_scores`, `airtable_sync_state` tables **approved** · provisioning
progress via **realtime broadcast** · price cards in `platform_settings` ·
admin = **one function, internal routing** · AAL2 freshness **15 min** ·
JWT hook ships **single-tenant `limit 1`** (multi-tenant deferred with G26)
· calendar adapter **polling-first** · transcripts outlive audio (pending
counsel) · keep `member`+`admin` tenant roles · analytics = **PostHog** ·
magic link skipped · notification center **derived feed** (+
`memberships.last_seen_notifications_at`) · admin/partner surfaces poll (no
realtime) · demo scrape **shows a 10-second editable confirmation card**
before the call token is issued (owner-decision default: review-first) ·
blog = in-repo MDX · signup draft = signed cookie · forwarding default =
**conditional**.

**Lint reconciliation (T0 vs FRONTEND_STACK):** keep **Biome** at the root
(T0 built and verified it) AND add **ESLint flat config scoped to
`apps/web` only** for Next.js/security/testing-library rules when T5
scaffolds it — the hybrid the research itself endorsed. FRONTEND_STACK.md
§lint is amended accordingly.

## 3. Gap patch pack (BINDING — additions to the specs)

**3.0 `create_order` tool** (restaurant/message-mode commerce): mirrors
`create_booking` — request `{items:[{offering_id?, name, qty, modifiers?}],
fulfillment_type, delivery_address?, customer{...}}`; validates items
against `offerings` (tool-backed catalog, never model-invented), computes
`subtotal/tax/total_cents` from tenant config, idempotency_key
call_id+hash(items), writes `orders`, enqueues confirmation SMS + adapter
push. Delivery orders REQUIRE address capture with read-back and a
**delivery-radius check** (geocode against tenant address; out-of-radius →
polite decline with pickup offer). Radius/geocode: precompute tenant
geocode at settings-save; caller address geocoded via the demo-scraper's
geocoding provider (VERIFY: pick Geocodio/Google at build).

**3.1 `customer_addresses`**: `(id, tenant_id, customer_id, label, street,
city, state, zip, geocode point, delivery_instructions, is_default,
created_at)`; RLS same as `customers`; agent reuses default address on
repeat delivery callers ("still to 42 Oak St?").

**3.2 Phone payments**: `payment_links` table `(id, tenant_id, order_id?,
booking_id?, stripe_checkout_session_id, amount_cents, purpose
'order'|'deposit'|'noshow_fee', status, expires_at)`. New tool
`send_payment_link` (enqueues SMS with a Stripe Checkout/Payment Link;
booking/order marked paid on `checkout.session.completed` with matching
metadata). Motel deposits: agent states policy, sends link, booking held
`scheduled` until paid (tenant-configurable hold window). No card numbers
ever spoken/stored (PCI stance unchanged).

**3.3 Two-way SMS + STOP**: new edge function `/webhooks/twilio-sms`
(inbound SMS on our numbers): STOP/UNSUBSCRIBE → set
`customers.sms_opt_out=true` + confirmation per carrier rules; HELP →
static help reply; anything else → stored in new `messages_inbound` table,
broadcast to tenant channel, surfaced in dashboard call/booking thread +
notification. `messages_outbound` worker checks `sms_opt_out` before every
send. Columns added: `customers.sms_opt_out bool default false`,
`customers.consent jsonb default '{}'` (§3.6).

**3.4 Waitlist**: `waitlist_entries (id, tenant_id, customer_id,
offering_id?, resource_type?, window tstzrange, status
'active'|'notified'|'converted'|'expired', created_at)`. When
`check_availability` returns none, agent offers waitlist; cancellation
trigger matches active entries → SMS "a slot opened Tue 2pm — reply YES"
(reply handled by 3.3; YES auto-books via the same idempotent path).

**3.5 Per-vertical tenant config (enumerated, not ad-hoc)**: typed keys in
`agent_configs.dynamic_variable_overrides` validated per vertical by zod:
dental `insurances_accepted[]`; vet `species_treated[]`,
`emergency_referral {name, phone}`; auto `tow_partner {name,phone}?`,
`vehicle_makes_serviced[]?`; legal `practice_areas[]` (feeds matter-type
enum), `consult_fee_cents?`; motel `deposit_policy`, `rate_table`;
restaurant `delivery_radius_m`, `min_order_cents`; all verticals
`cancellation_policy {window_hours, fee_cents?, text}` — agent states it at
booking AND cancellation. Settings UI (FRONTEND §6.6) gains a per-vertical
"Vertical details" tab rendering these fields.

**3.6 Transactional outbound + consent**: during booking the agent asks
once: "Is it okay to text or call you about this appointment?" → stored
`customers.consent = {sms:bool, call:bool, captured_at, call_id}`. New job
`reminder-scheduler` (hourly): bookings T-24h (config per vertical) with
`consent.call|sms` → enqueue reminder SMS, or (if tenant enables voice
reminders) Retell batch outbound call with voicemail detection; quiet hours
9pm–9am tenant-local enforced. `call_logs.direction='outbound'` becomes
active; outbound calls carry the same disclosure line. TCPA stance: only
transactional, only with captured consent, never marketing, never cold.

**3.7 Identity fallback (different phone)**: reschedule/cancel when caller
number ≠ booking customer: agent may verify with BOTH full name AND
exact appointment date/time; on match, proceed (logged
`verified_by='knowledge'` on the booking audit trail); two failed attempts
→ take-message. Never reads back other PII during verification.

**3.8 `tenants.avg_transaction_value_cents`** (default per vertical from
VERTICAL_RESEARCH: auto 55000, vet 17500, legal 250000, dental 65000,
real_estate 800000, motel 12500, restaurant 4500, generic 10000) — feeds
weekly value email "~$X saved" and the overview stat; tenant-editable.

**3.9 Review requests (optional, default off)**: tenant toggle + template;
`review_request` job: booking `completed` +2h → SMS with the tenant's
review link (`tenants.review_url`); respects `sms_opt_out`; capped one per
customer per 90 days.

**3.10 Frontend deltas**: settings gains Vertical-details tab (3.5) +
reminders/review toggles (3.6/3.9) + review_url + avg-ticket field (3.8);
bookings detail shows payment status + payment-link resend (3.2); messages
thread view per customer (3.3); waitlist page section under bookings (3.4).

## 4. Cross-checks performed

Naming consistent across the three specs (spot-checked: table names, tool
names, template keys, queue names). No contradictions found besides the
lint choice (§2) and the missing order tool (§3.0). The specs' own
completeness self-checks are accepted; their `VERIFY:` items merge into
`docs/VERIFY.md` during builds (CLAUDE.md Rule 1).

## 5. Build-agent directive

T1 adds §3 tables/columns to the schema. T3 adds `create_order`,
`send_payment_link`, `/webhooks/twilio-sms`, waitlist + reminder + review
jobs. T5 adds §3.10. T6 templates include consent ask, cancellation-policy
lines, waitlist offer, identity-fallback flow, per-vertical config
variables. All other content in the three specs stands as written.
