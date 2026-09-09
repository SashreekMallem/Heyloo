# Frontend Production-Readiness Audit — `apps/web`

Date: 2026-09-09. Scope: `apps/web` and `packages/ui`/`packages/supabase-client`
as used by it, per `docs/spec/FRONTEND_SPEC.md` (authoritative page
inventory), `docs/spec/MASTER_SPEC.md` §3.10, `docs/FRONTEND_STACK.md`,
`docs/SYSTEM_DESIGN.md`. **Audit only — nothing was fixed.**
`supabase/functions` and migrations were read only to verify a page's query
targets a real column/table, never to re-audit backend logic (owned by
`docs/audit/EDGE_AUDIT.md`).

Method: every EXISTS/STUB/MISSING call below is a direct file read, not an
inference from a directory listing; every "hardcoded"/"fabricated" claim is
backed by the exact line; the build/typecheck/lint/test commands were
actually executed (results in §4), not assumed from `LAUNCH_STATUS.md`.

This audit reads `docs/audit/EDGE_AUDIT.md` and `docs/audit/E2E_FLOWS_AUDIT.md`
first and does not re-litigate their findings — B1 (checkout calls a
nonexistent edge function), B2 (provisioning saga never invoked), B3
(realtime topic-name mismatch), B4/H4 (§3.10 deltas + adapter-connect UI
missing) are **cross-referenced, not re-derived**, except where this pass
found something on the `apps/web` side those audits didn't (marked "**new**"
below — most importantly: an unchecked cross-tenant `tenant_id` on the
checkout route, an unused-but-fully-built `verticalDetailsSchema`, three
pages that show fabricated/hardcoded metrics instead of real queries, and a
non-functional impersonation UI).

---

## 1. Page-inventory table (core deliverable)

Legend: **EXISTS** = real implementation, reads/writes real tables/columns.
**PARTIAL** = page exists and is partly real, but a spec-required
interaction/data source is missing or faked. **STUB** = page exists but is
placeholder/decorative (no persistence, or fabricated data, or a
`toast("coming soon")` in place of the real feature). **MISSING** = no file
at all.

### Marketing (`(marketing)`, FRONTEND_SPEC §3)

| Spec page | Status | Path |
|---|---|---|
| `/` Home | EXISTS | `src/app/[locale]/(marketing)/page.tsx` |
| `/[vertical]` ×8 (auto-repair, veterinary, legal-intake, dental, real-estate, motels, restaurants, generic) | EXISTS — `generateStaticParams` returns all 8 slugs exactly | `src/app/[locale]/(marketing)/[vertical]/page.tsx` + `not-found.tsx`, content in `src/content/marketing/verticals.ts` |
| `/pricing` | EXISTS | `src/app/[locale]/(marketing)/pricing/page.tsx` |
| `/demo` (4-step flow: request → scrape progress → reveal → web-call island) | EXISTS | `src/app/[locale]/(marketing)/demo/page.tsx` + `src/components/demo/demo-flow.tsx` |
| `/blog`, `/blog/[slug]` | EXISTS | `.../blog/page.tsx`, `.../blog/[slug]/page.tsx` + `not-found.tsx` |
| `/legal/terms`, `/legal/privacy`, `/legal/dpa` | EXISTS | `.../legal/{terms,privacy,dpa}/page.tsx` |
| `app/rss.xml/route.ts` | EXISTS | `src/app/rss.xml/route.ts` |

### Signup (`(marketing)/signup`, §4)

| Spec step | Status | Path |
|---|---|---|
| Step 1 `/signup` (business type) | EXISTS | `signup/page.tsx` + `components/signup/business-type-form.tsx` |
| Step 2 `/signup/plan` (price reveal) | EXISTS | `signup/plan/page.tsx` + `components/signup/plan-step-client.tsx` |
| Step 3 `/signup/account` | EXISTS | `signup/account/page.tsx` + `components/signup/account-step-client.tsx` |
| Step 4 Stripe Checkout (external) | **BROKEN** (owned by E2E_FLOWS_AUDIT B1; **new**, see Finding H1 below) | `src/app/api/checkout/session/route.ts` |
| Step 5 `/signup/provisioning` | EXISTS as a page, but functionally dead — provisioning never runs (E2E B2) and its realtime subscription uses the same mismatched channel name as the dashboard (E2E B3, independently confirmed §2 below) | `signup/provisioning/page.tsx` + `components/signup/provisioning-client.tsx` |
| Step 6 `/signup/forwarding` | EXISTS — shares `PhoneSetupWizard` with §6.7 exactly as specced | `signup/forwarding/page.tsx` |

### Tenant dashboard (`(tenant)/dashboard`, §6)

| Spec page | Status | Path |
|---|---|---|
| `/dashboard` Overview | **PARTIAL** — real `usage_daily`/`call_logs` queries, but `minutesIncluded` and `spamDeflected` are hardcoded fabricated values, not read from the real plan/classification data that exists (Finding H3) | `dashboard/page.tsx` + `components/tenant/overview-client.tsx` |
| `/dashboard/calls` | EXISTS — real, paginated, filtered, CSV export works and is tenant-scoped | `dashboard/calls/page.tsx` + `components/tenant/calls-list-client.tsx` |
| `/dashboard/calls/[id]` | EXISTS — transcript/audio/state-trace all real, recording-status 3-way state correct | `dashboard/calls/[id]/page.tsx` + `components/tenant/call-detail-client.tsx` |
| `/dashboard/bookings` | **PARTIAL** — Confirm/Cancel wired; **Reschedule has no UI** despite the API fully supporting it (Finding H4); no payment-status/resend; no waitlist section | `dashboard/bookings/page.tsx` |
| `/dashboard/customers`, `/dashboard/customers/[id]` | EXISTS | `dashboard/customers/page.tsx`, `.../[id]/page.tsx` + `components/tenant/customer-detail-client.tsx` |
| Agent → Greeting & Persona | EXISTS | `dashboard/agent/greeting/page.tsx` |
| Agent → Hours | EXISTS | `dashboard/agent/hours/page.tsx` |
| Agent → Services | EXISTS | `dashboard/agent/services/page.tsx` |
| Agent → FAQ | EXISTS | `dashboard/agent/faq/page.tsx` |
| Agent → AI Instructions | **PARTIAL** — 4 of the schema's own fields never rendered (Finding H5) | `dashboard/agent/instructions/page.tsx` |
| Agent → Manual Mode | EXISTS — two-step consequence dialog exactly per spec | `dashboard/agent/manual-mode/page.tsx` |
| Agent → Language | EXISTS (EN live, ES correctly disabled per G12) | `dashboard/agent/language/page.tsx` |
| Agent → **Vertical details** (MASTER_SPEC §3.5/§3.10) | **MISSING** — schema exists (`verticalDetailsSchema`, `packages/canonical-types/src/schemas/vertical-details.ts`, doc-commented "Rendered by the Settings → 'Vertical details' tab"), zero references anywhere in `apps/web` (Finding H2, **new** evidence beyond E2E H4) | none — 7 tabs only in `components/tenant/agent-settings-tabs.tsx` |
| `/dashboard/phone-setup` | EXISTS — carrier codes, tap-to-dial, conditional/full toggle, test-call, port-in timeline, all real | `dashboard/phone-setup/page.tsx` + `components/phone-setup/phone-setup-wizard.tsx` |
| `/dashboard/delivery` | **STUB (Airtable half)** — SMS/email toggles persist for real; Airtable `ConnectionLifecycleCard` connect/disconnect/sync-now are all no-ops/toasts, no OAuth popup, no sync-log viewer (Finding H6) | `dashboard/delivery/page.tsx` |
| `/dashboard/billing` | **PARTIAL** — invoices/portal-redirect real; usage meter hardcodes included minutes (Finding H3); usage-alert toggles are local state only, never persisted (Finding H3); no "View invoice" PDF action | `dashboard/billing/page.tsx` |
| `/dashboard/refer` (Refer & Earn) | **STUB (funnel)** — link/copy real; `FunnelChart` hardcodes all 4 stages to 0 regardless of real referral data; no W-9-threshold banner (Finding H7) | `dashboard/refer/page.tsx` |
| `/dashboard/support`, `/dashboard/support/[id]` | EXISTS | `dashboard/support/page.tsx`, `.../[id]/page.tsx` + `components/tenant/support-reply-form.tsx` |
| Reminders/review toggles, `review_url`, avg-ticket field (MASTER_SPEC §3.10) | **MISSING** — real columns exist (`tenants.review_url`, `.review_request_enabled`, `.voice_reminders_enabled`, `.avg_transaction_value_cents`), zero UI anywhere in `apps/web` | none |
| Messages thread view (§3.3/§3.10) | **MISSING** | none — `messages_inbound` never referenced in `apps/web` |
| Waitlist section (§3.4/§3.10) | **MISSING** | none — `waitlist_entries` never referenced |
| Orders page (§3.0 patch pack) | **MISSING** | none — `orders`/`payment_links` never referenced |
| Adapter-connect UI (Shopmonkey/ezyVet/Google Calendar/Square) | **MISSING** (owned by E2E B4) | none — `api-adapter-connect` never referenced |
| Tenant API tokens | correctly out of scope (spec §6.12 explicitly defers this) | n/a |

### Admin cockpit (`(admin)/cockpit`, §7, AAL2)

| Spec page | Status | Path |
|---|---|---|
| `/cockpit/margin/waterfall` | EXISTS | `cockpit/margin/waterfall/page.tsx` |
| `/cockpit/margin/customers` + `/[tenantId]` | EXISTS | `cockpit/margin/customers/page.tsx` + `[tenantId]/page.tsx` |
| `/cockpit/margin/calls` | EXISTS | `cockpit/margin/calls/page.tsx` |
| `/cockpit/margin/drift` | EXISTS | `cockpit/margin/drift/page.tsx` |
| `/cockpit/config-lab` | EXISTS — real what-if form, correctly separate from the template publish gate | `cockpit/config-lab/page.tsx` |
| `/cockpit/margin/referrals` | EXISTS | `cockpit/margin/referrals/page.tsx` |
| `/cockpit/margin/cac` | EXISTS | `cockpit/margin/cac/page.tsx` |
| `/cockpit/margin/bottlenecks` | EXISTS | `cockpit/margin/bottlenecks/page.tsx` |
| `/cockpit/alerts` | **STUB (edit)** — list/toggle/test wired to real endpoints; rule create/edit is `toast("Rule editor coming soon")`, no `adminAlertThresholdSchema` Dialog exists (Finding M2) | `cockpit/alerts/page.tsx` |
| `/cockpit/tenants` (list) | EXISTS | `cockpit/tenants/page.tsx` |
| `/cockpit/tenants/[id]` (detail) | **PARTIAL** — impersonate/suspend dialogs wired to endpoints; "Recent calls" is a static placeholder string, self-disclosed "pending backend endpoint" (Finding M3); impersonation has no follow-through anywhere in the app (Finding H8) | `cockpit/tenants/[id]/page.tsx` |
| `/cockpit/outreach` (overview) | EXISTS | `cockpit/outreach/page.tsx` |
| `/cockpit/outreach/campaigns`, `/[id]`, `/new` | EXISTS | `cockpit/outreach/campaigns/{page,[id]/page,new/page}.tsx` |
| `/cockpit/outreach/leads` | EXISTS | `cockpit/outreach/leads/page.tsx` |
| `/cockpit/outreach/replies` | EXISTS — one-click actions correctly call a real endpoint and surface a real failure toast when it 501s, not a fake success | `cockpit/outreach/replies/page.tsx` |
| `/cockpit/templates` (list) | EXISTS | `cockpit/templates/page.tsx` |
| `/cockpit/templates/[vertical]` (editor + publish gate) | EXISTS — structured-form editor per the DECIDE, `SimulationResultsPanel` wired | `cockpit/templates/[vertical]/page.tsx` |
| `/cockpit/settings` | **STUB** — every field is seeded with an invented hardcoded default, never loaded from `platform_settings`; both Save actions target endpoints not confirmed to exist (Finding H9) | `cockpit/settings/page.tsx` |
| Admin shell: sidebar, AAL2 indicator, `CommandPalette` | EXISTS | `components/admin/admin-shell-client.tsx` |
| Admin shell: `ImpersonationBanner` | **MISSING** — component built in `packages/ui`, zero imports anywhere in `apps/web` (Finding H8) | none |

### Partner portal (`(partner)/portal`, §8)

| Spec page | Status | Path |
|---|---|---|
| `/portal` Dashboard | **PARTIAL** — signups/qualified/paid real; "Clicks" hardcoded to 0 (no click tracking read) | `portal/page.tsx` |
| `/portal/payouts` | EXISTS | `portal/payouts/page.tsx` + `components/partner/payouts-table-client.tsx` |
| `/portal/w9` | EXISTS | `portal/w9/page.tsx` |
| `/portal/disclosure` (FTC gate) | EXISTS — versioned, blocking, no skip path | `portal/disclosure/page.tsx` + `components/partner/disclosure-gate-client.tsx` |
| `/portal/settings` | EXISTS | `portal/settings/page.tsx` |

### Shared / auth (§9.1)

| Spec page | Status | Path |
|---|---|---|
| `/login` | EXISTS | `src/app/[locale]/login/page.tsx` |
| `/reset-password`, `/reset-password/confirm` | EXISTS | `src/app/[locale]/reset-password/{page,confirm/page}.tsx` |
| `/mfa/enroll` | EXISTS (uses `<img>` for the QR code, not `next/image` — Finding L1) | `src/app/[locale]/mfa/enroll/page.tsx` |
| `/mfa/challenge` | EXISTS | `src/app/[locale]/mfa/challenge/page.tsx` |

**Completeness verdict:** every spec-named route has *a file*, which is
better than a first-pass audit usually finds. But roughly a third of what's
"there" is decorative once you open it: MASTER_SPEC §3.10 (the entire
frontend patch pack — vertical-details, reminders/review, waitlist, orders,
messages, payment-link resend) is **100% missing** from the frontend even
though several of the backing DB columns exist and, in one case
(`verticalDetailsSchema`), the exact schema the tab should render already
exists unused. Layered on top, three separate pages (Overview, Billing,
Refer & Earn) show **fabricated numbers** in place of real queries against
data that does exist — the precise failure mode CLAUDE.md/`AUDIT_2026-09.md`
name as the reason the old system died.

---

## 2. Security

**What's solid:**
- Defense-in-depth is real, not decorative: `middleware.ts` (path-prefix +
  claim check) and each route group's `layout.tsx` (`requireTenantSession`/
  `requireAdminSession`/`requirePartnerSession`, `src/lib/auth/require-*.ts`)
  independently re-derive role from the same `app_metadata` claims
  (`extractClaims`, `packages/supabase-client`) the backend's Custom Access
  Token Hook sets — one claim source, exactly per FRONTEND_SPEC §0.1.
  `requireAdminSession` correctly checks both a verified TOTP factor *and*
  `aal2` before allowing `/cockpit` (`require-admin-session.ts:23-28`).
- No tokens in `localStorage`/`sessionStorage` anywhere in `apps/web/src`
  (grepped) — cookie-session `@supabase/ssr` throughout
  (`lib/supabase/browser.ts`, `server.ts`).
- New publishable/secret key naming used correctly
  (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) — no
  legacy `anon`/`service_role` names anywhere, matching CLAUDE.md Rule 1.3.
- `NEXT_PUBLIC_*` usage is minimal and correct (`lib/env.ts`,
  `app/providers.tsx` for PostHog, both instrumentation files for Sentry) —
  grepped every occurrence; nothing beyond URL/publishable-key/PostHog
  key/Sentry DSN is exposed. `SUPABASE_SECRET_KEY`
  (`lib/supabase/service-role.ts`) is `import "server-only"`-guarded and
  never imported from a file also imported by a `"use client"` file
  (grepped, zero hits).
- Every Route Handler that mutates or proxies (`api/tenant/bookings/[id]`,
  `api/tenant/calls/export`, `api/admin/[...path]`, `api/billing/portal`)
  re-derives `tenant_id`/`platform_admin` from the caller's own session and
  filters every query by it — `bookings/[id]/route.ts:42-47` fetches
  *before* mutating with `.eq("tenant_id", claims.tenant_id)` on both the
  read and the write, not just one.

**H1 (new). `POST /api/checkout/session` trusts a client-supplied
`tenant_id` with no ownership check.**
`src/app/api/checkout/session/route.ts:37-38`: `body.tenant_id` is read
directly off the request JSON and forwarded to the edge function — unlike
every other Route Handler in this app (`bookings/[id]`, `billing/portal`,
`refer/ensure-link`), this one never checks it against `claims.tenant_id`.
Contrast `billing/portal/route.ts:22-23`, which correctly does
`if (!claims.tenant_id) return 403` and uses the *claim's* tenant_id, not a
body field. Today this is masked by E2E_FLOWS_AUDIT's B1 (the function name
is wrong, so the call never reaches anything) — but the code-level defect is
independent of B1 and would let any authenticated user open a Stripe
Checkout Session against an arbitrary `tenant_id` the moment B1 is fixed by
someone copying this route's existing contract forward. **Fix:** validate
`body.tenant_id === claims.tenant_id` (or drop the body field entirely and
use the claim, as `billing/portal` already does) before calling the edge
function.

**M1. Admin AAL2 is enforced by the page layout but not by the API proxy.**
`src/app/api/admin/[...path]/route.ts:25-26` checks `claims.platform_admin`
but not AAL2 — the comment says this is intentional (the downstream edge
function re-checks AAL2), which EDGE_AUDIT confirms is true today
(`admin/handler.ts` requires AAL2). Low risk as shipped, but this proxy has
no defense-in-depth of its own for the AAL2 half of the admin guard the way
it does for the role half — worth a one-line comment-to-test conversion
(assert the edge function's AAL2 check in a contract test) rather than
relying solely on tribal knowledge that the two layers agree.

No other secret-key leakage, RLS-bypass, or auth-gap was found in
`apps/web`'s own code in this pass.

---

## 3. Data layer

**What's solid:**
- TanStack Query + `@supabase/ssr` wiring matches FRONTEND_SPEC §0.3 pattern
  1/2 throughout: RSC fetch for first paint (`dashboard/page.tsx`,
  `customers/[id]/page.tsx`, etc.), client `useQuery`/`useTenantQuery` for
  refetch, query keys consistently namespaced `['tenant', tenantId, ...]` /
  `['admin', resource, ...]` (`lib/hooks/use-tenant-query.ts`,
  `use-admin-query.ts`) — no bare resource-name keys found anywhere.
- Every column read against `call_logs`, `bookings`, `customers`,
  `support_requests`, `tenants`, `agent_configs`, `referral_partners`,
  `referral_links`, `referrals` was checked against
  `supabase/migrations/*.sql` and is real (spot-checked: `customers.segment`/
  `.lifetime_value_cents`, `tenants.avg_transaction_value_cents`/
  `.review_url`/`.voice_reminders_enabled`, `call_logs` has no `customer_id`
  — the customer-detail page correctly joins on `caller_number` instead,
  the only join path the schema actually supports).
- `DataState` (`packages/ui/src/custom/data-state.tsx`) correctly renders
  exactly one of loading/empty/error/success from one query result and is
  used consistently; loading uses row/card skeletons, not a bare spinner,
  for every list.
- Empty-state copy is correctly differentiated per FRONTEND_SPEC §0.4 in
  the pages that were built with real data sources — e.g.
  `overview-client.tsx` distinguishes "number not forwarded" / "forwarded,
  zero calls" / "zero calls in this range" as three separate copies +
  actions, and `calls-list-client.tsx` distinguishes "no calls yet" from
  "no calls match your filters" with a working clear-filters action.

**Confirmed (cross-ref E2E B3), independently re-derived here:** the
realtime channel name in `src/lib/realtime/tenant-realtime-provider.tsx:54`
is `` `private-tenant-${tenantId}` ``; the backend's broadcast trigger and
its RLS policy both agree on `'tenant:' || tenant_id`
(`supabase/migrations/20260907131400_functions_triggers.sql:281-282`,
`20260907131500_rls.sql:457`). These never match, so `invalidateQueries`
never fires from a broadcast for any tenant — every "live" claim in this
audit's §1 table for pages that depend on the realtime channel (Overview's
live feed, the provisioning-progress screen, `RealtimeIndicator` ever
reaching `connected` via a real event) is cosmetic until this one string is
fixed in the frontend file above (or the backend topic is changed to
match — either side, just the same string).

**H2. Overview and Billing show fabricated numbers where a real column
exists.** `components/tenant/overview-client.tsx:74`:
`minutesIncluded: 300` and `spamDeflected: 0` are literal constants, not
queries. `dashboard/billing/page.tsx:67`: `{ used, included: 300 }` — same
hardcoded `300`. The real value is one join away:
`platform_settings.price_card_<vertical>.included_minutes` is exactly what
`v_usage_alerts` (`supabase/migrations/20260907131300_views.sql:44-58`)
already joins against per-tenant, and it's documented as public-readable
(FRONTEND_SPEC §4.2 reads this same table pre-auth for the signup price
card). `spamDeflected` similarly ignores the real
`call_logs.classification = 'spam_robocall'` enum value that already exists
and is already rendered correctly as a `StatusBadge` on the calls list two
files away. **Every tenant on a plan other than exactly 300 minutes/month
sees a wrong usage meter and a permanently-zero "spam deflected" stat** —
this is the literal "fabricated billing" failure mode CLAUDE.md/
`AUDIT_2026-09.md` name as the reason the old system was discarded, now
reproduced in the new one. **Fix:** join `platform_settings` by the
tenant's `vertical`/`price_version` for `included_minutes`; `count(*)` where
`classification = 'spam_robocall'` for the stat.

**H3. Billing's usage-alert toggles are decoration — no persistence path
exists.** `dashboard/billing/page.tsx:50-54` initializes
`{alert_80_enabled: true, alert_100_enabled: true, hard_cap_enabled: false}`
as local `useState` and the `Switch onCheckedChange` handlers only call
`setAlerts(...)` — there is no mutation, no fetch, nothing writing this
anywhere. Confirmed there is no backing column/table for it either (grepped
`supabase/migrations/*.sql` for `alert_80_enabled`/`hard_cap_enabled` —
zero hits; only a platform-wide `usage_alert_thresholds` key exists in
`platform_settings`, which is an admin-wide default, not what
`usageAlertConfigSchema` specs as a per-tenant setting). Toggling either
switch does nothing durable and resets on reload. **Fix:** either add the
per-tenant columns `usageAlertConfigSchema` implies and wire a real
mutation, or (if the platform-wide default is the actual intended design)
remove the interactive switches and show the platform default as read-only
text, per Rule 4 — don't ship a control that silently does nothing.

**H4. Bookings page has no Reschedule action, despite the backend fully
supporting it.** `dashboard/bookings/page.tsx:62` types
`runAction(action: "confirm" | "reschedule" | "cancel")` but the only two
buttons rendered (`:129-132`) call `"confirm"`/`"cancel"` — nothing in the
file ever calls `runAction("reschedule")`, and there is no slot-picker
component anywhere (grepped `reschedule`/`availability_slots` across
`apps/web/src` — the only other hits are the API route and a call
classification enum value). The API route itself
(`api/tenant/bookings/[id]/route.ts:70-80`) correctly implements reschedule
end-to-end, including the `23P01` exclusion-constraint conflict → `409
slot_taken` response FRONTEND_SPEC §6.4 requires. **A tenant owner cannot
reschedule a booking from the dashboard at all today** — the one action
FRONTEND_SPEC calls out as needing to "respect the backend's GIST exclusion
constraint" is the one action with no UI trigger. **Fix:** add the
Reschedule button + a slot-picker `Sheet` sourced from `availability_slots`,
calling the already-working API.

**H5. AI Instructions form omits 4 of its own schema's fields.**
`packages/canonical-types/src/schemas/ai-instructions.ts` defines
`prep_time_minutes`, `delivery_radius_miles`, `delivery_minimum_cents`,
`accepted_payment_types` — all four are absent from
`dashboard/agent/instructions/page.tsx`'s rendered `FormField`s (only
`special_instructions`/`transfer_number`/`voicemail_message`/`manager_name`/
`manager_phone`/`parking_info`/`accessibility_notes` are wired). Restaurant
and delivery-taking verticals have no way to set their own delivery
radius/minimum/prep-time/accepted-payment-types from the dashboard, even
though the schema, the DB column
(`agent_configs.dynamic_variable_overrides`), and the voice-tool read path
(`create_order.ts`, per EDGE_AUDIT L2) all already exist for it. **Fix:**
add the 4 missing `FormField`s (delivery ones conditionally rendered for
delivery-capable verticals, per the schema's own intent).

**H6. Delivery page's Airtable integration is a pure stub.**
`dashboard/delivery/page.tsx:109-115`: `onConnect` is
`() => toast.info("Airtable connect is coming soon.")`, `onDisconnect`/
`onSyncNow` are `() => {}`. FRONTEND_SPEC §6.8 requires an OAuth popup +
`postMessage` flow with a fixed-origin check and a sync-log viewer — none
of that exists; the card renders `status="disconnected"` unconditionally,
never reflecting a real `airtable_sync_state` row. SMS/email toggles on the
same page are real (`agent_configs.dynamic_variable_overrides.delivery`,
correctly persisted). **Fix:** wire the OAuth flow per spec, or explicitly
scope Airtable to a later wave in `docs/BUILD_NOTES.md` rather than leaving
a card that looks connectable but isn't.

**H7. Refer & Earn funnel is hardcoded to zero.**
`dashboard/refer/page.tsx:64-69`: `{label: "Clicks", count: 0}`,
`{"Signups", count: 0}`, `{"Qualified", count: 0}`, `{"Paid", count: 0}` —
all four are literal constants, never a query result, regardless of the
tenant's actual `referrals`/`referral_links` rows. (Contrast the *partner*
portal's `/portal/page.tsx:57-63`, which does compute real
signups/qualified/paid from `referrals` — only "Clicks" is hardcoded there,
because there's no click-tracking table to read; the tenant-side page has
no excuse for the other three.) No W-9-threshold banner exists either (spec
requires one once cumulative earnings approach the 1099 threshold). **Fix:**
query `referrals` filtered by the tenant's own `referral_partners` row, same
pattern as the partner portal page one file away.

**H8. Impersonation has no frontend follow-through anywhere.**
`ImpersonationBanner` (built and exported from `packages/ui/src/custom/`,
exactly matching its FRONTEND_SPEC §1.3 prop contract) has **zero imports**
anywhere in `apps/web` (grepped). `cockpit/tenants/[id]/page.tsx:45-54`'s
"Start impersonation" button only does a `fetch(...).then(toast)` — it
never establishes an impersonated session (no cookie swap, no redirect into
`/dashboard` as the tenant), so there is nothing for a banner to attach to
even if it were imported. None of §7.2's read-only-by-default /
30-minute-countdown / "Enable edits" second-audit-entry behavior exists in
the frontend. **This is a compliance-sensitive feature (own audit trail
requirement, per spec) that is decorative end-to-end on the frontend side**
— worth flagging above the general STUB severity given the audit-logging
stakes FRONTEND_SPEC itself calls out. **Fix:** implement the actual
session-establishment flow (however the backend intends to hand back an
impersonation token) and render `ImpersonationBanner` in the tenant shell
gated on that state.

**H9. Admin Platform Settings page is seeded with invented defaults, not
real data.** `cockpit/settings/page.tsx:22-28`:
`flatAmount = 10000`, `rule = "$100 after their 2nd paid month"`,
`baseCents = 29900`, `includedMinutes = 300`, `overageCents = 40` are all
hardcoded initial `useState` values — there is no `useQuery`/RSC fetch
anywhere on this page that reads the current `platform_settings` row before
showing these as if they were the live values. An admin opening this page
sees numbers that may have nothing to do with the actual configured
pricing/referral rule, and could "Save" a stale default over a real value
without realizing it. Both save handlers additionally point at endpoints
(`admin-platform-settings/referral`, `/pricing`) whose failure path is
labeled "Not available yet — backend endpoint pending," i.e. today this
page cannot actually save anything either. **Fix:** load current values
first (RSC fetch or `useQuery`) and use them as `defaultValues`; never seed
a settings form with a guessed constant.

**M2. Notification center never marks anything read.**
`lib/hooks/use-tenant-notifications.ts` only *reads*
`memberships.last_seen_notifications_at` (grepped — no write anywhere in
`apps/web`); `tenant-shell-client.tsx:56`'s `NotificationCenter onOpen`
prop is `() => {}`. The unread badge can never be cleared by the user —
every booking ever created stays "unread" forever. Also, only `bookings` is
used as a source; FRONTEND_SPEC §9.4 lists 4 more source types
(usage-alert-threshold-crossed, SMS-pending-verification-resolved,
adapter-disconnected, support-ticket-reply) that are never derived. **Fix:**
write `last_seen_notifications_at = now()` on `onOpen`, and add the other
4 derived sources.

---

## 4. Production grade — build/typecheck/lint/test actually run

All four commands were executed for real (`pnpm --filter @heyloo/web run
<script>`), not inferred:

| Command | Result |
|---|---|
| `typecheck` (`tsc -b --pretty`) | **PASS**, zero errors |
| `lint` (`eslint .`) | **PASS**, 0 errors / 3 warnings: (1) `agent/greeting/page.tsx:73` — React Compiler skip on `form.watch()` (informational, not a bug); (2) `mfa/enroll/page.tsx:67` — `@next/next/no-img-element`, a real `next/image` gap (Finding L1); (3) `tests/e2e/support/auth-state.ts:18` — `security/detect-unsafe-regex` |
| `test` (`vitest run`) | **PASS** — but this is **1 test file, 4 tests, total**, in an app with ~85 routes and ~40 client components (Finding M3 below) |
| `build` (`next build --webpack`) | **PASS** — compiles, typechecks, and statically/dynamically generates all 80 app routes with no errors. Two things surfaced by the build itself worth fixing (Findings M4/M5) |

**M3. Test coverage for `apps/web` is effectively zero.**
`src/lib/realtime/tenant-realtime-provider.test.tsx` (4 tests) is the
*only* `*.test.ts(x)` file anywhere under `apps/web/src` (confirmed via
`find`). None of the three auth guards
(`require-tenant-session`/`require-admin-session`/`require-partner-session`),
`middleware.ts`'s redirect matrix, or any Route Handler (`checkout/session`,
`tenant/bookings/[id]`, `admin/[...path]`, `tenant/calls/export`) has a
single test — including the one Route Handler with the tenant-ownership gap
this audit found (Finding H1). A Playwright config and `tests/e2e/` scaffold
exist (per `apps/web/package.json`'s `test:e2e` script) but require a live
Supabase instance to run and were not executed in this pass (out of scope
for a static audit — flagged for whoever owns CI). **Fix:** at minimum, unit
test the 3 auth guards' redirect matrix and the auth checks on every mutating
Route Handler — these are exactly the kind of logic a refactor silently
breaks without a test catching it.

**M4. Marketing pages render dynamically in production despite
`generateStaticParams` + an explicit RSC-first design intent.** Build
output marks `/[locale]`, `/[locale]/[vertical]`, `/[locale]/pricing`,
`/[locale]/demo`, `/[locale]/blog`, `/[locale]/blog/[slug]`,
`/[locale]/legal/*` all "ƒ (Dynamic)" — confirmed on disk: no prerendered
`.html` exists for any of them under `.next/server/app/[locale]/(marketing)/`
(only a `page.js` server-render function), whereas `/en/login`,
`/en/mfa/enroll`, `/en/reset-password` genuinely did prerender to static
`.html` in the same build. `[vertical]/page.tsx` and `[locale]/layout.tsx`
both correctly define `generateStaticParams`, and no page in `(marketing)`
reads `cookies()`/`headers()` (grepped) — the most likely cause is
`src/i18n/routing.ts`'s `localePrefix: "as-needed"` combined with
next-intl's default locale-detection in `middleware.ts`, a documented
next-intl/Next.js interaction (VERIFY against next-intl's current
static-rendering docs per CLAUDE.md Rule 1 — this audit did not have live
doc access to confirm the exact mechanism, only the build-output symptom).
This directly undercuts `FRONTEND_STACK.md`'s stated reason for choosing
RSC marketing pages ("ship ~zero client JS for SEO/CWV") — every marketing
page pays a server round-trip on every request instead. **Fix:** VERIFY
next-intl's static-rendering requirements for a single-locale
`as-needed`/no-prefix setup (likely `localeDetection: false` on the
middleware config, or moving marketing routes outside the locale-negotiating
middleware matcher) and confirm `.html` output reappears for these routes
post-fix.

**M5. Two Sentry/Next.js doc-drift warnings surfaced by the build itself.**
(1) `next build`'s own output: `"Importing withSentryConfig from
@sentry/nextjs is deprecated... Import it from @sentry/nextjs/config
instead"` — `next.config.ts:1` still uses the old import. (2) `"ACTION
REQUIRED: ...the Sentry SDK requires you to export an
onRouterTransitionStart hook from your instrumentation-client.(js|ts)
file"` — `instrumentation-client.ts` doesn't export it, so client-side route
transitions aren't instrumented. Both are exactly the class of drift
CLAUDE.md Rule 1 asks to catch by checking current docs rather than
training-time knowledge; neither is in `docs/VERIFY.md` yet. **Fix:** apply
both per the build's own guidance, then note the change in `VERIFY.md` as
confirmed against Sentry's current Next.js SDK docs.

**L2. `middleware.ts` uses Next.js's deprecated "middleware" convention.**
Build warning: `"The 'middleware' file convention is deprecated. Please use
'proxy' instead."` Works today (matches CLAUDE.md's own comment referring to
it as `middleware.ts`/guard #1 throughout FRONTEND_SPEC §0.1), but Next.js
flags it for removal — worth a tracked follow-up (`npx
@next/codemod@canary middleware-to-proxy .`), not urgent.

No committed build output was found for `apps/web` itself — `.next/`,
`node_modules/`, `*.tsbuildinfo`, `.turbo/` are all correctly gitignored and
`git status --porcelain` is clean; the only tracked `dist/`/build-output
files in the repo are under `legacy/` (out of scope, pre-existing, not part
of `apps/web`'s hygiene).

---

## 5. Leanness

- `next/image` is used correctly everywhere except the one `<img>` in
  `/mfa/enroll` (Finding L1); `next/font` is not explicitly audited further
  here (no obvious raw `<link>`/`@font-face` webfont loading found in a
  targeted grep).
- Every marketing page defines `metadata`/`generateMetadata` (grepped —
  13/13 files under `(marketing)` + signup have one); no page is missing
  SEO metadata.
- `i18n` scaffold (`next-intl`, `[locale]`, EN-only) is present and wired
  exactly per FRONTEND_STACK.md §0.6 — not a placeholder.
- Component reuse is genuinely good: no duplicated `DataTable`/`MetricCard`/
  `StatusBadge` implementations found living in `apps/web` that should be
  in `packages/ui` — every custom component named in FRONTEND_SPEC §1.3 was
  found built once, in `packages/ui`, and imported everywhere it's used.
  `packages/ui/src/custom/impersonation-banner.tsx` is the one built
  component with **zero** call sites anywhere (Finding H8 above) — dead
  code today, but not duplicated code.
- No stray provider SDK imports in `apps/web` (Stripe/Retell/Twilio calls
  are correctly proxied through `callEdgeFunction`/edge functions, never
  imported directly — matches CLAUDE.md Rule 2's provider-isolation
  invariant, verified by grep for `stripe`/`retell`/`twilio` package
  imports outside `retell-client-js-sdk`'s single documented client-island
  use in the demo widget).

---

## Verdict

**Not yet — closer to spec-complete-on-paper than spec-complete-in-practice.**
Every route FRONTEND_SPEC names has a file, which distinguishes this build
from the old repo's audit; the auth/guard architecture, the data layer's
query-key discipline, the `DataState` 4-state pattern, and the CI-clean
build/typecheck/lint are all genuinely solid and worth preserving as-is.

But three separate failure modes recur often enough to call systemic, not
isolated:

1. **MASTER_SPEC §3.10 (the frontend patch pack) is completely unbuilt** —
   confirmed independently of E2E_FLOWS_AUDIT's H4, with the added evidence
   that the Vertical-details tab's own schema already exists, doc-commented
   with the exact tab name it's meant to render, sitting unused. This is the
   single biggest gap between what an owner can configure and what the
   backend already supports.
2. **Fabricated data in place of a one-join real query**, in exactly the
   pattern `AUDIT_2026-09.md` names as the reason the old system was
   discarded: Overview's usage/spam stats, Billing's usage meter, the
   tenant Refer & Earn funnel, and the admin Platform Settings form all show
   invented numbers where a real column or table already exists to read
   instead (Findings H2, H3, H7, H9).
3. **Decorative controls that silently do nothing**: Billing's usage-alert
   toggles, Airtable connect/disconnect/sync-now, the admin alert-rule
   editor, and the entire impersonation flow all render, respond to clicks,
   and show a toast — but persist nothing or lead nowhere (Findings H3, H6,
   H8, M2).

None of this is hard to fix — each has an adjacent, already-correct pattern
in the same file tree to copy (the partner portal's real funnel query sits
one file from the tenant's fake one; `billing/portal`'s correct
claims-based tenant check sits one file from `checkout/session`'s missing
one). But as shipped, an owner logging into `/dashboard` today would see a
usage meter that's wrong for any plan but exactly 300 minutes, a Refer &
Earn page that always reads zero, and no way to reschedule a booking,
configure their own vertical's required fields, see a message thread, or
resend a payment link — the dashboard is not yet the "owner can actually
run the machine" surface the backend audits describe the backend as ready
for.
