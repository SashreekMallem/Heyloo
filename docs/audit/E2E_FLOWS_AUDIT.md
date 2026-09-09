# Cross-Cutting E2E Flows Audit

Audit-only, per `docs/spec/API_AND_FLOWS.md` (10 flows), `docs/spec/MASTER_SPEC.md`
(§1 verdict table, §3 patch pack), `docs/MASTER_PLAN.md`, `docs/SYSTEM_DESIGN.md`
§9, `docs/LAUNCH_STATUS.md`. Scope: the seams between layers (DB → edge
function → frontend → jobs/queues → notifications → dashboard), traced
against the actual code as of this commit, not a re-audit of any single
layer. **Nothing was fixed.**

Method: every finding below was confirmed by reading the actual call site(s)
on both sides of the seam (repo-wide grep + read), not inferred from docs or
from `LAUNCH_STATUS.md`'s own disclosures alone — those are cited only where
independently reconfirmed in code.

---

## Flow-by-flow verdicts

| # | Flow | Verdict | Broken / missing hops |
|---|---|---|---|
| 1 | Signup → checkout → provisioning → forwarding | **BROKEN** | (a) Frontend calls a nonexistent edge function; (b) request/response contracts don't match even if the name were fixed, and two different tenant-creation code paths conflict; (c) nothing in the codebase ever invokes the provisioning saga at all — see Findings B1–B3. |
| 2 | Inbound call → answered → booking → notification → dashboard update | **PARTIAL** | Voice hot path, booking write, cost ingestion, meter events, nightly reconciliation are all wired and consistent. Dashboard realtime updates never fire (topic-name mismatch, Finding B4). SMS/email confirmation fan-out is agent-tool-discretionary, not a write-time guarantee (Finding M1). |
| 3 | Reschedule / cancel | **WIRED** | `update_booking`/`cancel_booking` both call the shared `verifyBookingIdentity` (§3.7 identity fallback) correctly; idempotent cancel-of-already-cancelled is a no-op. Owner-side dashboard reschedule/cancel UI exists under `dashboard/bookings`. No broken hop found. |
| 4 | Message-taking fallback | **WIRED** | Per-tool rolling-window circuit breaker (`_shared/circuit-breaker.ts`) trips into message-taking mode per SYSTEM_DESIGN §5; `take_message` tool exists. Caveat: breaker state is in-process only — see Finding L3 (not confirmed broken, flagged for verification against actual Supabase Edge Function instance topology). |
| 5 | Orders + payment links | **PARTIAL** | `create_order` (§3.0) and `send_payment_link`/`payment_links` (§3.2) are fully built and correctly matched by Stripe metadata in `webhooks-stripe`. No tenant-dashboard surface exists at all for either — no orders page, no payment-link status/resend UI (Finding H4/§3.10). |
| 6 | Billing cycle + usage | **WIRED** | Meter-event emission, `usage_daily` rollup, invoice webhooks, dunning, margin views, and the frontend billing/usage-alert surfaces all present and consistent. |
| 7 | Referral → qualification → payout | **PARTIAL** | Link→signup→qualification→accrual→PayPal-batch-send chain is wired. Payout status never advances past `'sent'`/commission never advances past `'batched'` — no `/webhooks-paypal` consumer exists (Finding H2). Anti-fraud clawback (step 6) has no code path — `charge.refunded`/`charge.dispute.created` aren't handled by `webhooks-stripe` at all (Finding H1). |
| 8 | Outreach: lead → campaign → reply → demo → customer | **WIRED** (with known gaps) | Full admin panel (`(admin)/cockpit/outreach/*`) + fetch/personalize/send/classify functions all present and connected. Known, previously-disclosed gaps reconfirmed: Apollo credit→$ conversion unimplemented, no Smartlead complaint-webhook signal (0.3% auto-pause is manual-only today). |
| 9 | Adapter connect → catalog sync → two-way sync | **BROKEN** | Full adapter code (Shopmonkey/ezyVet/Google Calendar/Square) and a correctly-registered `worker-adapter-push` consumer exist — but no producer ever enqueues a `"booking"` entity to the adapter-push queue, so none of the four adapters' booking-push code paths are ever reached in production (Finding B5). There is also no tenant-facing "Connect `<adapter>`" UI anywhere in `apps/web` — zero frontend references to `api-adapter-connect` (Finding B5, part 2). |
| 10 | Churn / retention loop | **BROKEN** | `churn_scores` table exists (schema-only) with zero producers anywhere. No weekly value-email job. Cancellation only flips `tenants.status='canceled'`; `webhooks-stripe`'s own code comment says offboarding wind-down "is handled by a dedicated job, not inline here" — that job does not exist anywhere in the repo (no port-out trigger, no data-export bundling, no recordings-retention purge reading `tenants.retention_days`) (Finding H3). |

Two flows named in `API_AND_FLOWS.md` Part B but not in the task's 10-item
list were also spot-checked since they bear on the overall verdict:

| Flow (API_AND_FLOWS Part B) | Verdict | Note |
|---|---|---|
| Flow 6 — Retell outage → failover → recovery | WIRED (unverified live) | `job-retell-health-failover` exists end-to-end in code; never exercised against a live Retell account (same caveat as everything else marked VERIFY in the specs). |
| Flow 9 — Template update → CI → staged publish | PARTIAL | CI batch-sim + disclosure gate + publish-to-Retell all wired. Per-tenant fan-out (staged rollout, G35) does not exist — publish only creates a fresh agent/flow and flips `agent_templates.is_active`; no already-provisioned tenant's `agent_configs`/live Retell agent is ever touched (self-disclosed in `LAUNCH_STATUS.md`, reconfirmed in `supabase/functions/admin/handler.ts` around the `publish` route). |

---

## MASTER_SPEC §3 patch-pack verdicts

| Item | Verdict | Note |
|---|---|---|
| §3.0 `create_order` | WIRED (backend) / **missing frontend** | Tool validates against `offerings`, computes tax/total, idempotent, enqueues confirmation + adapter push. No orders page exists anywhere in the tenant dashboard — owner cannot see orders their own agent took. |
| §3.1 `customer_addresses` | WIRED | Used correctly by `create_order.ts` for delivery address reuse. |
| §3.2 Phone payments (`payment_links`, `send_payment_link`) | WIRED (backend) / **missing frontend** | `webhooks-stripe` correctly matches `order_id`/`booking_id` via Checkout metadata and flips status. No booking/order-detail UI shows payment status or a resend action. |
| §3.3 Two-way SMS + STOP | **PARTIAL** | `/webhooks-twilio-sms` handles STOP/HELP/opt-out correctly; `worker-messages-outbound` checks `sms_opt_out` before every send. `messages_inbound` rows are written but (a) have no broadcast trigger (`trg_broadcast_*` covers `call_logs`/`bookings`/`orders`/`support_requests` only — `messages_inbound` is absent from that list) and (b) are never read by any frontend file — no thread view exists anywhere in `apps/web`. |
| §3.4 Waitlist | **PARTIAL** | Table + auto-book-on-cancellation logic exist per T4's own notes; no dedicated `join_waitlist` voice tool (explicitly scoped out, routes through `take_message` per `LAUNCH_STATUS.md`, reconfirmed by grep). No waitlist page section in the dashboard (§3.10). |
| §3.5 Per-vertical tenant config | **PARTIAL** | Only the restaurant vertical has a settings surface (`dashboard/delivery`, reading/writing `dynamic_variable_overrides.delivery`). Every other vertical's typed fields (`insurances_accepted`, `species_treated`/`emergency_referral`, `tow_partner`/`vehicle_makes_serviced`, `practice_areas`/`consult_fee_cents`, `deposit_policy`/`rate_table`, `cancellation_policy`) have zero frontend references anywhere — no "Vertical details" tab exists. |
| §3.6 Consent + reminders | WIRED | `create_booking` captures `customers.consent`; `job-reminder-scheduler` exists and is registered. |
| §3.7 Identity fallback (different phone) | WIRED | Confirmed in both `update_booking.ts` and `cancel_booking.ts` via the shared `verifyBookingIdentity`. |
| §3.8 `avg_transaction_value_cents` | **BROKEN** | Spec requires vertical-specific defaults (auto 55000, vet 17500, legal 250000, dental 65000, real_estate 800000, motel 12500, restaurant 4500, generic 10000). The actual tenant-creation path in production (`apps/web/src/app/api/signup/create-tenant/route.ts:55`) hardcodes `0` for every vertical, and `api-checkout/handler.ts`'s own (unreachable, see Finding B1) tenant-insert doesn't set the column either. No frontend field exists to edit it after the fact. Every tenant's weekly value email will compute "~$0 saved" until someone edits the DB directly. |
| §3.9 Review requests | WIRED (backend) / **missing toggle** | `job-review-request` exists and is capped correctly; no dashboard toggle/`review_url` field exists to turn it on or configure it (§3.10). |
| §3.10 Frontend deltas | **BROKEN** | Every single item this section lists — Vertical-details tab, reminders/review toggles, `review_url`, avg-ticket field, payment status + resend on bookings, messages thread view, waitlist page section — is absent from `apps/web`. This is the single biggest gap between "backend built" and "owner can actually run the machine." |

---

## G1/G2 disclosure line — verified WIRED

Positive confirmation, not a gap: all 8 vertical templates
(`packages/templates/src/verticals/*.ts`) reference the same shared
`DISCLOSURE_LINE` constant; all three compiler lowering targets
(`conversation-flow.ts`, `multi-prompt.ts`, `single-prompt.ts`) prepend it
verbatim to the first turn/state; and `packages/adapters/retell/src/compiler/index.ts`
calls `verifyDisclosureGate` and refuses to compile/publish if the compiled
output doesn't contain it verbatim. `supabase/functions/admin/handler.ts`'s
template-publish route checks `compiled.disclosureVerified` and 422s before
ever calling Retell if it fails. This is a real CI/runtime gate, not just a
convention, matching CLAUDE.md Rule 2 and SYSTEM_DESIGN's requirement.

---

## Findings

### BLOCKER

**B1 — Signup→checkout calls a function that does not exist, with an incompatible contract even if it did.**
`apps/web/src/app/api/checkout/session/route.ts:41` calls
`callEdgeFunction("api-checkout-session", ...)` — no such function is
registered (`supabase/config.toml` only has `[functions.api-checkout]`; the
real directory is `supabase/functions/api-checkout`). The route's own code
comment admits this ("assumes an `api-checkout-session` edge function...
not yet observed... confirm the exact function name"). Even with the name
fixed: the frontend sends `{tenant_id, annual, success_url_base,
cancel_url}` and expects `{url}` back; the real `api-checkout` handler
(`supabase/functions/api-checkout/handler.ts:59-83`, validated by
`CheckoutRequestSchema`) requires `{vertical, business_name, email,
timezone}`, creates its **own** new `tenants` row from scratch, and returns
`{tenant_id, checkout_url}`. This directly conflicts with
`apps/web/src/app/api/signup/create-tenant/route.ts`, which is the route
the actual signup wizard (`account-step-client.tsx`) calls first to create
the `tenants` row itself. Result: **the self-serve web signup flow cannot
complete Stripe Checkout today** — it 404s on the edge function call before
any of the schema mismatches even matter.

**B2 — The provisioning saga is never invoked by anything.**
`supabase/functions/webhooks-stripe/handler.ts:17-32`
(`checkout.session.completed`) only runs `update public.tenants set
status='active', ...` — no fetch, no queue enqueue, nothing that reaches
`supabase/functions/api-provision`. A repo-wide grep for
`api-provision`/`PROVISION_INTERNAL_SECRET` outside the function's own files
turns up nothing. `api-provision/index.ts`'s own header comment documents
the *intended* design ("triggered internally by the Stripe webhook handler
... on checkout.session.completed") but that call was never implemented.
The frontend's provisioning-progress page
(`apps/web/src/app/[locale]/(marketing)/signup/provisioning/page.tsx`)
simply redirects to `/signup/forwarding` the moment `tenants.status ===
'active'`. **Net effect: a tenant marked "active" has no compiled Retell
agent, no purchased/imported Twilio number, and no A2P registration —
provisioning is 100% dead code, independent of B1.**

**B3 — Dashboard realtime never fires (topic-name mismatch).**
The DB broadcast trigger (`fn_broadcast_tenant_update`,
`supabase/migrations/20260907131400_functions_triggers.sql:281-282`) sends
to topic `'tenant:' || tenant_id`; the RLS policy gating `realtime.messages`
(`supabase/migrations/20260907131500_rls.sql:457`) independently agrees on
that same `'tenant:' || tenant_id` string. The frontend, however, subscribes
to `` `private-tenant-${tenantId}` `` (`apps/web/src/lib/realtime/tenant-realtime-provider.tsx:54`).
These are different topic strings; Supabase Realtime requires an exact
match. **No dashboard client ever receives a broadcast for any table
(`call_logs`, `bookings`, `orders`, `support_requests`), for any tenant,
ever.** This breaks Flow 1 step 10 (live booking/call updates) and Flow 2
step 8 (provisioning-progress-via-realtime) identically and completely —
the dashboard only reflects reality on a manual reload/poll, not live.

**B4 — Two-way adapter push is unreachable for bookings (the adapters' actual purpose).**
`supabase/functions/voice-tools/tools/create_booking.ts`,
`update_booking.ts`, and `cancel_booking.ts` contain zero references to the
adapter-push queue. The only producer into `adapter_push_queue` is
`create_order.ts:214`, which enqueues `entity_type: "order"` — consumed only
by Square's order-push branch. `worker-adapter-push/handler.ts`'s
Shopmonkey (`:345`), ezyVet (`:422`), Google Calendar, and Square-booking
(`:262`) branches all gate on `entity_type === "booking"`, a message type
that is **never produced anywhere in the codebase**. All four fully-built,
individually-unit-tested adapters are therefore dead in production for
their primary purpose (pushing a real appointment/booking to the external
system) — the only entity type that ever reaches the queue is restaurant
orders, and only Square handles those. Compounding this, `apps/web`
contains zero references to `api-adapter-connect` anywhere — there is no
"Connect `<adapter>`" UI in the tenant dashboard at all, so Flow 10 has no
entry point either.

### HIGH

**H1 — Referral clawback has no code path.** `webhooks-stripe/handler.ts`'s
`switch` has no case for `charge.refunded` or `charge.dispute.created` (only
`checkout.session.completed`, `customer.subscription.updated/deleted`,
`invoice.paid/payment_failed`, `charge.succeeded`, `payout.paid` are
handled; everything else hits `default: logger.debug(...)`). Flow 4 step 6
(fraud clawback on refund/dispute) and G33's observability for these events
do not exist.

**H2 — Referral payouts never confirm as actually paid.** No
`/webhooks-paypal` consumer exists anywhere in `supabase/functions` (only
`_shared/providers/paypal.ts`, the outbound API client). `job-referral-payouts/handler.ts:148`
inserts `referral_payouts` with `status='sent'` and sets `commission_events.status='batched'`
— neither field can ever advance to `'paid'`/`'failed'` because nothing
consumes `PAYMENT.PAYOUTSBATCH.SUCCESS` / item-level webhooks. (Previously
disclosed in `LAUNCH_STATUS.md`; reconfirmed here by code.)

**H3 — Churn/retention loop is schema-only.** `churn_scores`
(`supabase/migrations/20260907131200_supporting_tables.sql:77`) has zero
producers anywhere in `supabase/functions`. No weekly value-email job
exists. `webhooks-stripe`'s `customer.subscription.deleted` handler sets
`status='canceled'` with a comment that offboarding "is handled by a
dedicated job, not inline here" — no such job exists: no port-out trigger,
no data-export bundling job, no recordings-retention purge job reading
`tenants.retention_days`. G7 (guaranteed port-out) and the BIPA-aware
retention wind-down (Flow 8 steps 2-5) have no implementation at all beyond
the bare status flip.

**H4 — MASTER_SPEC §3.10 (frontend deltas) is essentially unbuilt.** See the
patch-pack table above — every named item (vertical-details tab,
reminder/review toggles, `review_url`/avg-ticket field, payment-link
status+resend, messages thread view, waitlist section) is absent from
`apps/web`, and there is additionally no orders page at all. The backend for
§3.0-§3.9 is real and tested; none of it is ownable/observable from the
dashboard.

### MEDIUM

**M1 — Notification fan-out is agent-discretionary, not write-guaranteed.**
`create_booking.ts` enqueues nothing itself; SMS confirmation only happens
if the LLM separately decides to invoke `send_sms_confirmation` as its own
tool call. `API_AND_FLOWS.md` Flow 1 step 11 describes fan-out as "fired
from the write in step 6/8" (i.e., a server-side guarantee) — the
implementation makes it contingent on model/template behavior instead. A
template regression or an unusual conversation path could silently suppress
every booking confirmation with no server-side backstop.

**M2 — Template publish has no per-tenant fan-out (Flow 9 / G35).**
`supabase/functions/admin/handler.ts`'s `publish` route creates a brand-new
Retell agent/flow and flips `agent_templates.is_active`; it never updates
any already-provisioned tenant's `agent_configs.template_version` or
re-publishes their live agent. Already self-disclosed in
`LAUNCH_STATUS.md`; reconfirmed by reading the route.

**M3 — §3.8 avg-transaction-value defaults are never applied.** The real,
reachable tenant-creation path (`apps/web/src/app/api/signup/create-tenant/route.ts:55`)
hardcodes `avg_transaction_value_cents: 0` for every vertical, ignoring the
per-vertical defaults MASTER_SPEC §3.8 specifies. Combined with H4 (no
frontend field to edit it), every tenant's weekly value email and overview
stat will show "~$0 saved" indefinitely.

### LOW (already disclosed elsewhere, reconfirmed in code — carried forward for completeness)

- **L1** — Apollo credit→dollar conversion not implemented; CAC dashboard
  under-counts true spend (`LAUNCH_STATUS.md`, reconfirmed: no such
  conversion logic found in outreach functions).
- **L2** — No distinct Smartlead spam-complaint webhook event exists per any
  indexed source; the CAN-SPAM 0.3% auto-pause is fully unit-tested but only
  triggerable by a manual admin action today, not a live signal.
- **L3** — The per-tool circuit breaker (`_shared/circuit-breaker.ts`) is
  correctly implemented but holds its rolling window in a single
  function-instance's memory; under Supabase Edge Functions' actual
  multi-instance scaling this may not reflect a true global per-tenant error
  rate. Not confirmed broken — flagged as a VERIFY item against real
  instance topology, consistent with the specs' own VERIFY discipline.
- **L4** — `admin-support-requests`/`admin-flags` remain `501`; no dedicated
  health-check endpoint exists; pg_cron/pgmq queue registration is a manual
  one-time SQL step (`docs/DEPLOY.md` §3.6) not encoded in any migration —
  legitimate operational setup steps, not code bugs, but each is a real gap
  between "deployed" and "actually running" until done.
- **L5** — `join_waitlist` voice tool doesn't exist (waitlist requests route
  through `take_message` instead), consistent with `LAUNCH_STATUS.md`'s own
  disclosure.

---

## Bottom-line verdict

**Not yet.** A real business cannot go from signup to a working, billed,
observable AI receptionist through this system today, for two independent
and each individually fatal reasons that sit right at the front door:

1. **Checkout is unreachable** — the frontend calls an edge function that
   doesn't exist, with a request/response contract that wouldn't match even
   if it did, alongside a second, conflicting tenant-creation code path
   (B1).
2. **Even bypassing #1 by creating a `tenants` row directly, provisioning
   never runs** — nothing in the repository ever calls the fully-built
   `api-provision` saga, so no tenant would ever get a live Retell agent or
   a phone number (B2).

Layered on top of that: the dashboard's realtime "it just updates" promise
is dead for every tenant and every table (B3), the deep-integration
adapters — a full wave of real, tested work (Shopmonkey/ezyVet/Google
Calendar/Square) — never actually receive a booking to push in production
(B4), and the owner-facing controls for a large fraction of the built
backend (orders, payment links, messages, waitlist, per-vertical settings,
churn/retention) simply don't exist in the dashboard (H3/H4).

None of this reflects poorly on any single layer in isolation — voice
hot-path handling, the booking/billing core, the template compiler and its
disclosure gate, the outreach engine, and the individual adapter
implementations are each well-built and well-tested on their own terms
(726 passing tests per `LAUNCH_STATUS.md`, independently plausible from what
was read here). The gap is entirely at the seams: different build tasks
each built their own half of a contract — a function name, a request
shape, a channel topic, a queue message type, a "someone else wires this
next" comment — and no task closed the loop by wiring its part to what the
adjacent task actually shipped. That is exactly the class of defect a
per-layer audit cannot see and this cross-cutting pass was asked to find.
