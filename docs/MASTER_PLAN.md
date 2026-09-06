# Heyloo Master Plan — White-Label Voice AI Booking Platform

Successor plan to PRD.MD, reconciling the codebase audit (`docs/AUDIT_2026-09.md`)
with the new business brief: white-label voice answering/booking agent, four
verticals (restaurants, dental, motels, real estate), $299/mo + per-minute
pricing, 70–85% margin, 50 clients → $10k+ MRR, fully self-serve onboarding.

---

## 0. Decisions (resolved)

| Decision | Call | Why |
|---|---|---|
| Voice provider | **Retell AI**, behind a provider-abstraction layer | Free self-serve HIPAA BAA on any plan (Vapi charges ~$3,000/mo flat for HIPAA+ZDR — fatal for the dental vertical); lower realistic all-in cost (~$0.10–0.13/min vs ~$0.13–0.18); smaller headline-vs-reality pricing gap; faster path to a working booking flow. Vapi stays the runner-up for non-HIPAA verticals if ever needed. |
| Provider lock-in | Never again. All voice code goes through a `VoiceProvider` interface | The audit found ~85–90% of current voice code is Vapi wire-format-specific with prompts living only in Vapi's dashboard. PRD.MD literally argues "Why Vapi (Not Retell)" — docs and code must be vendor-neutral this time. |
| Rebuild vs refactor | **Rebuild Layer 1 as new code; keep ~15%** (Supabase scaffolding, customer/phone/SMS plumbing, multi-tenant patterns). Current repo = reference implementation for restaurant rules + Clover/Square quirks | Retrofitting interfaces onto drifted, duplicated `if/else` sprawl across 10+ files costs as much as building clean. |
| Schema naming | `restaurants` → `businesses` (+ `business_type`), `menu_items` → `offerings`, generic `bookings` table alongside `orders` — **now**, while one vertical exists | Cheapest moment in the project's life; every deferred day compounds migration cost. |
| Onboarding | True self-serve: signup → Stripe Checkout (plan) → webhook-confirmed subscription → **automated Retell phone provisioning** → connect integrations. Admin "add business" kept as internal override only | Brief requires "sign up, connect phone, done." Today phone provisioning is 100% manual and onboarding has no payment step. |
| Pricing | $299/mo base + $0.40/min (range $0.35–0.50), metered from **actual provider cost per call** stored per call | Current code bills a fabricated $0.05/min and a $99 base. Margin must be computed, not hoped. |
| Outreach stack (Apollo → Claude → Instantly/Smartlead → n8n) | Separate ops workstream, **not** in this codebase | Orthogonal to product; don't dilute engineering focus. |
| Security | The audit's §7 remediation list executes **first**, before any feature work, on whatever survives into the new architecture | Multiple remotely exploitable holes are live today (unauthenticated tenant data access, password-hash oracle, fake "paid" orders, unauthenticated Clover webhook). |

## 1. Target architecture

### Layer 1 — Generic booking core (vertical-agnostic)

- **Voice provider abstraction** (`VoiceProvider` interface):
  `parseInboundCallRequest`, `parseToolCalls`, `formatToolResult`,
  `verifyWebhookSignature`, `normalizeCallEvent`, `provisionPhoneNumber`,
  `getCallCost`. First implementation: Retell. Canonical internal
  `ToolCall {name, args, callId}` / `ToolResult` shapes — business logic never
  sees provider payloads.
- **Agent config in the database, not a vendor dashboard**: `agent_templates`
  (per vertical: system prompt, tool schemas, voice/model, versioned) +
  `agent_configs` (per tenant: template ref + overrides — business name,
  greeting, hours, transfer number, branding). Agents created/updated via
  Retell's API programmatically; zero dashboard clicking.
- **Booking primitives**: `bookings` (start_at, end_at, resource_id, party_size,
  status lifecycle: scheduled → confirmed → checked_in → completed / no_show /
  cancelled / rescheduled), `resources` (chair/room/table/agent), `availability`
  (working hours + slot rules + conflict checking), `offerings` (generic service
  catalog with duration/price/resource requirements). `orders` remains the
  restaurant specialization.
- **Telephony table stakes** (all missing today): warm transfer to human with
  context summary, voicemail detection + after-hours behavior per business
  hours, customer SMS confirmations, callback capture.
- **Metering & billing**: per-call actual provider cost captured from Retell
  webhooks into `call_logs.cost`; `usage_daily` rollups; invoices generated
  idempotently (unique constraint per tenant+period) from real usage;
  margin = (charged − actual cost), monitored with alerting.
- **Multi-tenancy done right**: Supabase Auth (or custom JWT that RLS can
  actually consume) + enforced RLS as DB backstop; auth **required** on every
  tenant endpoint; hashed API tokens; revocable sessions; webhook signature
  verification that fails closed; webhook event dedup table; idempotency keys
  on all money-touching writes.

### Layer 2 — Vertical adapters

One interface, four implementations, each anchored to a representative platform:

| Vertical | Adapter | Anchor integration (validate API access first) |
|---|---|---|
| Restaurants | `adapters/restaurant` | Square (exists — port), Clover (exists — port); Toast later (API is partner-gated; validate before promising) |
| Dental | `adapters/dental` | Open Dental (open API, self-serve) or NexHealth (aggregator over Dentrix/Eaglesoft) — **requires Retell HIPAA BAA signed** |
| Motels | `adapters/motel` | Cloudbeds (public API + marketplace) |
| Real estate | `adapters/realestate` | Follow Up Boss (open API, simple auth) — lead capture + showing scheduling |

`IntegrationAdapter` interface: `syncCatalog`, `pushBooking/pushOrder`,
`checkAvailability`, `handleWebhook`, `refreshAuth` — one status-mapping table
per adapter into the canonical lifecycle (today three files disagree on status
mappings). Adding integration #5 = one new module, not edits to six files.

## 2. Unit economics (validated by research, Sept 2026)

At 50 clients × 500 min/mo × ($299 + $0.40/min) = **$24,950/mo revenue**:

| Provider | All-in cost/min | Total provider cost | Gross margin |
|---|---|---|---|
| **Retell** | ~$0.115 | ~$3,095 | **~87.6%** |
| Vapi (no HIPAA) | ~$0.15 | ~$4,150 | 83.4% |
| Vapi (+HIPAA/ZDR $3k/mo) | ~$0.15 | ~$7,150 | 71.3% |
| Bland ($499/mo plan) | ~$0.135 | ~$3,874 | 84.5% |
| Self-hosted Pipecat/LiveKit | ~$0.085 | ~$2,300 | ~90.7% (before ops labor) |

Numbers are directional (sourced from third-party 2026 comparisons; primary
pricing pages were unreachable) — **verify on Retell's live pricing page and a
test account before contracts.** Self-hosting is not worth it until roughly
150k–300k min/month (~300–600 clients); revisit then.

Neither Retell nor Vapi provides real white-label/multi-tenant infrastructure —
the thin control plane (client accounts, per-tenant agent config, usage rollups,
branded dashboard) is our build regardless of vendor. That is this repo's job.

Retell operational facts to design around: ~$0.055/min voice infra; BYO-Twilio
removes telephony markup; numbers ~$2/mo; 20 free concurrent lines then $8/line;
KB usage +$0.005/min; per-call cost reporting via API (feeds our metering);
SOC 2 Type I+II, ISO 27001, free HIPAA BAA. Risk noted: seed-funded ($5.1M
raised, $60M ARR Apr 2026) — capital-efficient but could reprice; the provider
abstraction is the hedge.

## 3. Roadmap

**Phase 0 — Stop the bleeding (days):** audit §7 checklist — rotate leaked
Square token + purge log from git history; kill `get_user_for_login` anon
grant; enforce auth on `restaurants`/`pos`; remove all fail-open branches;
rotate seeded admin credential; repo cleanup (~58MB dead weight, broken
workspace ref, gitignore, eslint, minimal CI); `supabase db pull` a real
schema baseline.

**Phase 1 — Layer 1 core (weeks 1–4):** provider abstraction + Retell
implementation; DB-backed agent templates/configs; new schema (businesses,
bookings, resources, availability, offerings) with timestamped, reproducible
migrations; auth/RLS rebuild; metering from actual cost; transfer/voicemail/
after-hours/SMS; automated phone provisioning.

**Phase 2 — Self-serve onboarding + restaurant re-platform (weeks 4–7):**
signup → Stripe Checkout → provision flow; port Square/Clover into
`adapters/restaurant` (fixing tax/fee omission, dedup, idempotency, status
mapping); migrate the existing live client; dashboard de-verticalized
(tenant branding config, role-guarded routes, error states, tokens out of
localStorage or mitigated).

**Phase 3 — Vertical #2 as the adapter-model proof (weeks 7–10):** dental
(sign Retell BAA; Open Dental/NexHealth adapter; booking flow end-to-end).
If adding dental touches Layer 1 significantly, the abstraction is wrong —
fix it before verticals #3/#4.

**Phase 4 — Motels + real estate + scale (weeks 10–14):** Cloudbeds and
Follow Up Boss adapters; per-vertical margin dashboards; alerting/monitoring;
load testing before the 50-client push.

**Parallel ops workstream (not this repo):** Apollo → Claude research →
Instantly/Smartlead → n8n pipeline. Back-of-envelope: at ~2% cold-email
meeting rate and ~25% close, 50 clients ≈ 10k prospects contacted; start the
warm-up now, target ~1,250 sends/week once Phase 2 makes onboarding real.

## 4. What we keep from the current repo

Supabase/Deno edge-function scaffolding; customer lookup + phone
normalization; Twilio SMS plumbing; multi-tenant table patterns; the
Square/Clover API knowledge embedded in `pos/`, `pos-push/`, webhook handlers
(as reference for the restaurant adapter); the dashboard's TanStack
Query/Zustand skeleton. Everything else is superseded by this plan.
