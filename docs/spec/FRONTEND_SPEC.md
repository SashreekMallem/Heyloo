# Heyloo Frontend Specification (T5 build reference)

Granular, route-by-route spec for `apps/web` (Next.js App Router, one app,
route groups) and `apps/docs` (Mintlify). Source docs: `SYSTEM_DESIGN.md`
(architecture/data model/backend contract), `FRONTEND_STACK.md` (stack
decision), `MASTER_PLAN.md` (business decisions), `VERTICAL_RESEARCH.md`
(per-vertical stats used in marketing copy). This is what the T5 build agent
codes against — every page, component, interaction, and state below is a
build requirement, not a suggestion, except lines explicitly marked
`DECIDE:`, which are open calls with a recommendation to build against until
the owner overrides.

Every route below lives under `app/[locale]/...` (`[locale]` scaffolded day
one per `FRONTEND_STACK.md`, English-only content initially — see §0.6). The
`[locale]` segment is omitted from paths in this document for brevity.

---

## 0. Cross-cutting conventions

Read this section first — every page section below assumes it.

### 0.1 Route groups, roles, and guards

| Route group | Path prefix | Role(s) (`app_metadata.role`) | Extra guard |
|---|---|---|---|
| `(marketing)` | `/`, `/pricing`, `/demo`, `/blog`, `/legal/*`, `/[vertical]`, `/signup/*` | none (public) | none |
| `(tenant)` | `/dashboard/*` | `tenant_owner`, `tenant_staff` | `tenant_id` claim present; `tenants.status = 'active'` (else redirected — see 0.2) |
| `(admin)` | `/cockpit/*` | `platform_admin` | **AAL2** (MFA step-up) — see 0.2 |
| `(partner)` | `/portal/*` | `referral_partner` | FTC disclosure acknowledged (else redirected to the gate — see §5) |

Auth model is the one already fixed by `FRONTEND_STACK.md`: `@supabase/ssr`
cookie sessions, no tokens in `localStorage` (closes audit finding #12).
`middleware.ts` reads the session and the same `app_metadata.role`/
`tenant_id`/`aal` JWT claims the backend's Custom Access Token Hook sets —
one claim source for frontend guards and backend RLS, never two definitions
of "who can see this."

**Guard is enforced twice (defense in depth, closes audit finding #12 "no
role-based route guarding"):**
1. `middleware.ts` — matches on path prefix, redirects before any render if
   role/claim is wrong or missing (`/login?next=...` if unauthenticated,
   `/` with a toast if authenticated-but-wrong-role).
2. Each route group's root `layout.tsx` (a server component) re-checks role
   and `tenant_id`/AAL via `createServerClient` before rendering children.
   Middleware can be bypassed by a direct RSC fetch in some edge configs;
   the layout check is the actual backstop and is what CI's role-guard
   Playwright test exercises.

### 0.2 Redirect matrix (what happens when a guard fails)

| Situation | Redirect | Notes |
|---|---|---|
| No session, protected route | `/login?next=<path>` | |
| Tenant session, `tenants.status = 'pending_payment'` | `/signup/plan` (resume checkout) | |
| Tenant session, `tenants.status = 'provisioning'` | `/signup/provisioning` | |
| Tenant session, `tenants.status = 'suspended'` | `/dashboard/suspended` (static notice + support contact, not a redirect loop) | Never bounce a suspended tenant back to login — they still have valid credentials. |
| Admin session, AAL1, no MFA factor enrolled | `/mfa/enroll` (forced, no skip) | |
| Admin session, AAL1, factor enrolled | `/mfa/challenge?next=<path>` | |
| Partner session, FTC disclosure not acknowledged (or acknowledged version stale) | `/portal/disclosure` (blocking) | |
| Wrong role for the route group (e.g., tenant hitting `/cockpit`) | `/` with a toast "You don't have access to that page" | Never a bare 404 — 404 for wrong-role reads as a bug report waiting to happen. |

### 0.3 Data-loading mechanisms — the three patterns, named

Every "Data" row below names one of these three. Do not invent a fourth.

1. **RSC fetch** — a server component calls the Supabase server client
   (`@supabase/ssr` `createServerClient`, RLS-enforced) directly. Used for
   first paint of anything SEO-relevant or above-the-fold on initial load.
   Where the same data also needs client-side refetching, the RSC result is
   dehydrated into a TanStack Query cache via `HydrationBoundary` so the
   client picks up the identical query key with zero refetch-on-mount flash.
2. **TanStack Query (client)** — client components call `useQuery`/
   `useMutation` from `packages/supabase-client` hooks, either straight
   against the Supabase browser client (RLS-enforced, safe for anything a
   signed-in user is allowed to read/write per policy) or against an
   `app/api/**/route.ts` Route Handler for anything needing a server-only
   secret (Stripe, Retell token mint, Twilio) or a computed/aggregated read
   too heavy for a raw client query. Query keys are namespaced
   `['tenant', tenantId, resource, ...params]` / `['admin', resource, ...]`
   / `['partner', partnerId, resource, ...]` — never bare resource names,
   so cache collisions across tenants are structurally impossible even if a
   bug ever tried.
3. **Realtime channel** — a client provider (`packages/realtime`) subscribes
   to the tenant's single private channel (`private-tenant-{tenant_id}`,
   `private: true`, RLS on `realtime.messages`, exactly the SYSTEM_DESIGN
   §2 contract). Broadcast payload is minimal: `{ table, op, id }` — never
   the row itself. The handler calls
   `queryClient.invalidateQueries(['tenant', tenantId, table])`; the
   already-mounted TanStack Query for that resource refetches. **The admin
   cockpit and partner portal do not get a realtime channel** — SYSTEM_DESIGN
   is explicit that broadcast is tenant-scoped only, no global fan-out.
   Cockpit/partner pages instead use TanStack Query with `refetchInterval`
   (default 60s on top-line dashboards) plus a manual refresh button
   everywhere refetch matters (`DECIDE: no realtime for admin/partner v1` —
   rollups are pg_cron-computed on a delay anyway, so sub-minute freshness
   buys nothing; revisit if admins ask for live-er outreach reply feeds).

### 0.4 Mandatory states — loading / empty / error / success

The old app's #1 sin (per `AUDIT_2026-09.md` §2: "most pages render
failures as '0 calls / empty table'") is not allowed to recur. **Every
data-bearing component implements all four states explicitly**, and empty
and error are visually and textually distinct from each other and from a
genuine zero:

- **Loading** — skeleton matching the eventual layout (row skeletons for
  tables, card skeletons for metric rows) for anything with >1 expected
  item; a centered spinner is only acceptable for a single scalar value.
- **Empty** — explanatory copy plus a primary CTA where one exists (e.g.
  "No calls yet — once your number is forwarded, calls land here" +
  "Finish phone setup"). **Distinguish "no data ever" from "no data in the
  selected filter/range"** — these need different copy and the latter needs
  a "clear filters" action, not just blank space.
- **Error** — a retry button, plus the Sentry event id shown in small text
  (`packages/ui`'s `<ErrorState eventId />`) so a support ticket can
  reference it. Never swallow an error into an empty-looking state — that
  is exactly the audit's complaint. A failed background action (e.g. an SMS
  send after a successful booking write) is a **non-blocking warning toast**,
  not a page-level error — the primary action (the booking) still succeeded.
- **Success** — the real content.

`packages/ui`'s `<DataState>` wrapper (see §1) takes a TanStack Query result
and renders exactly one of these four; no page hand-rolls this branching.

### 0.5 Mobile behavior — general rule

Tailwind v4 breakpoints (`sm`/`md`/`lg`/`xl`) throughout; no custom
breakpoint scale. Two different mobile philosophies by surface:

- **Marketing, signup, tenant dashboard, partner portal** are mobile-first —
  business owners run these from a phone, especially phone setup (§6.7) and
  the demo (§4.4). Tables collapse to stacked cards below `sm`; multi-tab
  settings pages collapse tabs into a `Select`-driven switcher below `sm`.
- **Admin cockpit** is desktop-primary by design — nine dense chart/table
  pages do not usefully compress to a phone width. Below `md` the cockpit
  shell renders a persistent "Best viewed on desktop" banner and only a
  reduced read-only summary (top-line metric cards + the alerts feed); the
  nine margin-cockpit pages, Config Lab, and the template editor are
  **not** rendered below `md` — they show the banner in place of content
  rather than a broken cramped layout.

### 0.6 i18n — two different "languages," not one

`next-intl` with `[locale]` governs the **dashboard/marketing UI language**
(EN only at launch; the `[locale]` segment exists so adding a UI locale
later is a content/config change, not a routing rewrite — ES for the UI is
not itself a roadmap item, it's free once someone translates the strings).

This is **completely separate** from the **agent's spoken call language**,
a per-tenant business setting (§6.6 Agent Settings → Language tab) tied to
gap G12 (bilingual agent support). Never conflate the two in code or copy —
a Spanish-speaking dashboard user and an English-only phone agent (or vice
versa) is a normal, expected combination.

### 0.7 Next.js file conventions (apply to every route below, not repeated per page)

Every leaf route segment ships `loading.tsx` (the skeleton per §0.4),
`error.tsx` (client error boundary: reports to Sentry via `@sentry/nextjs`,
renders `<ErrorState>` with a retry that resets the segment), and
`not-found.tsx` where a dynamic `[id]` segment can 404 (call/booking/
customer/tenant/campaign/template detail routes). Marketing routes
additionally export `generateMetadata` (title/description/OG image per
page) — RSC-rendered, ~zero client JS, per the CWV/SEO rationale in
`FRONTEND_STACK.md`.

### 0.8 Analytics convention

Single wrapper `trackEvent(name: string, props?: Record<string,
unknown>)` in `packages/analytics`, called from client components only
(never from RSC — server-side conversion events, e.g. Stripe webhook
firing "subscription_created," are emitted from the edge function, not the
frontend, to avoid double-counting/being blockable by an ad-blocker).
Event names are `snake_case`, `noun_verb` or `domain_action`
(`demo_started`, `booking_rescheduled`, `impersonation_started`). Each page
section below lists its 2–4 highest-value events inline rather than in a
separate master table, so the build agent implements them alongside the
component that fires them.

`DECIDE: analytics provider.` Recommend **PostHog** (self-serve, session
replay is genuinely useful for debugging the demo/signup funnel, autocapture
+ funnels cover the marketing/signup analysis need without a bespoke
warehouse, cheaper than a Segment+Amplitude stack at this scale). `trackEvent`
wraps `posthog.capture` behind the single function so swapping providers
later is a one-file change.

### 0.9 Forms

`react-hook-form` + `zod`, resolver from `@hookform/resolvers/zod`. Schemas
live in `packages/canonical-types/src/schemas/*.ts`, one file per schema,
named exactly as in §2's table — the build agent should not invent
alternate names. Every form uses shadcn's `Form` primitive (`FormField`/
`FormItem`/`FormMessage`) for consistent error rendering. Money fields are
always cents internally (matches the backend's "money in cents" rule) with
a `CentsInput` custom control that displays/edits dollars.

---

## 1. Component library — `packages/ui`

### 1.1 Directory shape

```
packages/ui/src/
  primitives/     shadcn components, generated in place (button, input, ...)
  forms/          <Form> wrapper, <CentsInput>, <PhoneInput> (E.164 mask),
                  <DateRangePicker>, generic <Wizard> step machine
  charts/         thin Recharts wrappers matching the dataviz palette:
                  <TrendChart>, <FunnelChart>, <MarginWaterfall>,
                  <LatencyPercentileChart>, <DriftLineChart>
  custom/         see 1.3 below
  layout/         <AppShell> (tenant/admin/partner variants), <TopBar>,
                  <Sidebar>, <MobileTabBar>, <BrandingProvider>
  theme/          CSS tokens (light/dark per artifact-design rules — this
                  is a real product surface, not an artifact, but the same
                  token discipline applies: tokens on :root, redefined
                  under prefers-color-scheme and [data-theme])
```

### 1.2 shadcn primitives used

`button, input, label, textarea, select, checkbox, radio-group, switch,
dialog, alert-dialog, dropdown-menu, popover, tooltip, tabs, table, card,
badge, avatar, separator, skeleton, sonner, calendar, command, sheet,
accordion, progress, pagination, breadcrumb, navigation-menu, form,
scroll-area, hover-card, collapsible, sidebar, input-otp, slider,
toggle-group, chart`. All Tailwind v4. `Tremor` is explicitly avoided
(unresolved v4 breakage per `FRONTEND_STACK.md`); shadcn's Recharts-based
`chart` primitive is the base for every chart, with `visx` as a documented
escape hatch only if `MarginWaterfall` proves unbuildable on Recharts
composed bars (see §7.1 — expected not to be needed).

### 1.3 Custom components

| Name | Purpose | Key props / state | Used on |
|---|---|---|---|
| `DataState` | Renders loading/empty/error/success from one TanStack Query result (§0.4) | `query`, `empty: {title, description, action?}`, `render: (data) => ReactNode` | everywhere |
| `MetricCard` | Single KPI tile with optional trend delta | `label, value, delta?, format: 'number'\|'currency'\|'percent'\|'duration', loading` | overview, billing, cockpit, portal |
| `DataTable` | Generic table on `@tanstack/react-table`: sort, column filters, server-side pagination, row click, mobile card-collapse | `columns, data, pageCount, onPageChange, filters, onRowClick, emptyState` | calls, bookings, customers, tenants, outreach leads/replies, alert rules |
| `TranscriptViewer` | Turn-by-turn transcript, speaker-colored, timestamped, searchable, clickable turns | `turns: {speaker, text, ts}[], activeTs?, onSeek(ts)` | call detail (tenant + admin) |
| `AudioPlayer` | Recording playback; stereo/dual-channel toggle, waveform, seek, speed | `src, stereoSrc?, duration, onTimeUpdate` | call detail |
| `CallFeedItem` | One row in the live call feed | `call: CallSummary, onClick` | overview |
| `StatusBadge` | Enum → color-coded badge (12 call classes; booking lifecycle; ticket status; tenant status; margin health) | `variant: 'call-class'\|'booking'\|'ticket'\|'tenant'\|'margin', value` | throughout |
| `WizardStepper` | Generic numbered-step header + `<Wizard>` state machine driver | `steps: string[], current, completed[]` | signup, phone setup, config lab |
| `MarginWaterfall` | Waterfall chart (Recharts composed bars, invisible base segments) | `segments: {label, amount, kind: 'add'\|'subtract'\|'total'}[], onSegmentClick` | cockpit margin pages, Config Lab |
| `UsageMeter` | Included-vs-used-vs-overage progress bar, color at 80%/100% | `includedMinutes, usedMinutes, overageMinutes, thresholds` | billing |
| `ManualModeBanner` | Persistent banner when tenant manual mode is on | `since, onDisable` | tenant shell (all pages) |
| `DateRangePills` | Today/7d/30d/custom pill row, tenant-timezone-boundary aware | `value, onChange, tenantTz` | overview, calls, margin pages |
| `ConnectionLifecycleCard` | Single card: connect / reauth / disconnect / sync-now / last-sync (carried over pattern) | `provider, status: 'disconnected'\|'connected'\|'error', lastSyncAt, onConnect/onDisconnect/onSyncNow` | delivery preferences, adapters (Phase 2/3) |
| `EmptyState` / `ErrorState` | Building blocks `DataState` composes | `title, description, action?` / `eventId, onRetry` | via `DataState` |
| `RealtimeIndicator` | Connection dot: connecting/connected/reconnecting/offline | `status` | tenant topbar |
| `CommandPalette` | ⌘K palette (cmdk) | `commands: {label, run}[]` | admin topbar |
| `NotificationCenter` | Bell + unread badge + dropdown/drawer | `items, unreadCount, onOpen` | tenant + admin topbar |
| `BrandingProvider` | Injects tenant CSS vars from `tenants.branding` | `branding: {logoUrl, primary, accent}` | tenant root layout |
| `PriceCard` | Vertical price card reveal | `plan: {base, includedMin, overage}, annual, onToggleAnnual` | signup step 2 |
| `ProvisioningTimeline` | Live saga step list | `steps: {key, label, status}[]` | signup step 5 |
| `CarrierForwardingCard` | Per-carrier forwarding codes + tap-to-dial | `carrier, codes, forwardingNumber` | phone setup |
| `ImpersonationBanner` | Red persistent bar during admin impersonation | `tenantName, adminEmail, expiresAt, editMode, onEnd` | tenant shell (impersonation mode only) |
| `W9StatusBadge` | not_submitted/submitted/verified | `status` | partner portal |
| `FTCDisclosureGate` | Blocking acknowledgment interstitial | `policyVersion, onAcknowledge` | partner portal |
| `SegmentBadge` | VIP/Loyal/Returning/New | `segment` | customers |
| `StateTraceViewer` | List/graph of conversation-graph states visited, clickable → seeks transcript | `trace: {state, enteredAt}[], onSeek` | call detail |
| `FunnelChart` | Sent→opened→replied→qualified→signed-up (or clicks→signups→qualified→paid) | `stages: {label, count}[]` | outreach, refer & earn, partner portal |
| `ReplyFeedItem` | Reply row w/ intent badge + one-click actions | `reply, onAction(action)` | outreach replies |
| `LeadTable` | Leads with dedupe/suppression status | extends `DataTable` | outreach leads |
| `TemplateDiffViewer` | Version-to-version diff of prompt/tools/graph | `before, after` | template editor |
| `SimulationResultsPanel` | Red-team + batch-sim pass/fail before publish | `results: {caseId, pass, note}[], costEstimatePerCall, disclosureIntegrityOk` | template publish gate |
| `AlertRuleRow` | One alert-rule row + edit affordance | `rule, onEdit, onToggle, onTest` | admin alerts |
| `HoursEditor` | Weekly hours + holiday exceptions | `hours, exceptions, onChange` | agent settings |
| `ServiceOfferingEditor` | CRUD list of offerings | `offerings, onChange` | agent settings |
| `FAQEditor` | Q/A list with a byte-size warning past ~3KB (latency-budget note, SYSTEM_DESIGN §5) | `items, onChange, byteSize` | agent settings |
| `BookingCalendar` | List/calendar toggle, month grid (own CSS grid, not a scheduler lib — see §7.2) | `bookings, view, onViewChange, onSelect` | bookings |

---

## 2. Form schemas — `packages/canonical-types/src/schemas/`

| Schema name | File | Key fields | Used by |
|---|---|---|---|
| `signupBusinessTypeSchema` | `signup-business-type.ts` | `business_type` (8-vertical enum + `generic`), `business_name` | Signup step 1 |
| `signupAccountSchema` | `signup-account.ts` | `owner_name, email, password, tos_accepted` | Signup step 3 |
| `demoRequestSchema` | `demo-request.ts` | `business_name, website_url` | `/demo` step 1 |
| `demoEmailCaptureSchema` | `demo-email-capture.ts` | `email` | `/demo` capture form |
| `loginSchema` | `login.ts` | `email, password` | `/login` |
| `resetPasswordRequestSchema` | `reset-password-request.ts` | `email` | `/reset-password` |
| `resetPasswordConfirmSchema` | `reset-password-confirm.ts` | `password, confirm_password` | `/reset-password/confirm` |
| `mfaEnrollSchema` | `mfa-enroll.ts` | `factor_id, code` | `/mfa/enroll` |
| `mfaChallengeSchema` | `mfa-challenge.ts` | `code` | `/mfa/challenge` |
| `agentGreetingSchema` | `agent-greeting.ts` | `persona_name` (disclosure sentence itself is NOT a field — see §6.6) | Agent → Greeting |
| `businessHoursSchema` | `business-hours.ts` | `hours[7]{open,close,closed}, exceptions[]{date,closed,open?,close?}` | Agent → Hours |
| `offeringSchema` | `offering.ts` | `name, duration_minutes, price_cents, resource_id?` | Agent → Services |
| `faqItemSchema` | `faq-item.ts` | `question, answer` | Agent → FAQ |
| `aiInstructionsSchema` | `ai-instructions.ts` | `special_instructions, transfer_number, voicemail_message, manager_name?, manager_phone?, parking_info?, accessibility_notes?, prep_time_minutes?, delivery_radius_miles?, delivery_minimum_cents?, accepted_payment_types[]?` | Agent → AI Instructions |
| `manualModeToggleSchema` | `manual-mode-toggle.ts` | `enabled, acknowledged_consequence: literal(true)` | Agent → Manual Mode |
| `agentLanguageSchema` | `agent-language.ts` | `language` (enum, ES disabled until G12 ships) | Agent → Language |
| `phoneForwardingSetupSchema` | `phone-forwarding-setup.ts` | `carrier, forwarding_mode: 'conditional'\|'full'` | Phone setup |
| `phonePortInRequestSchema` | `phone-port-in.ts` | `current_number, account_number, account_pin, carrier` | Phone setup → port-in |
| `deliveryPreferencesSchema` | `delivery-preferences.ts` | `sms_enabled, email_enabled, notification_email` | Delivery prefs |
| `usageAlertConfigSchema` | `usage-alert-config.ts` | `alert_80_enabled, alert_100_enabled, hard_cap_enabled, hard_cap_minutes?` | Billing |
| `bookingRescheduleSchema` | `booking-reschedule.ts` | `booking_id, new_slot_id` | Bookings |
| `bookingCancelSchema` | `booking-cancel.ts` | `booking_id, reason` | Bookings |
| `customerNoteSchema` | `customer-note.ts` | `customer_id, note` | Customer detail |
| `supportTicketCreateSchema` | `support-ticket-create.ts` | `subject, body, call_id?, booking_id?` | Support |
| `supportTicketReplySchema` | `support-ticket-reply.ts` | `ticket_id, body` | Support detail |
| `referralPayoutMethodSchema` | `referral-payout-method.ts` | `paypal_email` | Refer & earn, Partner portal settings |
| `adminTenantSuspendSchema` | `admin-tenant-suspend.ts` | `tenant_id, reason` | Cockpit tenant detail |
| `adminImpersonateSchema` | `admin-impersonate.ts` | `tenant_id, reason` | Cockpit tenant detail |
| `adminAlertThresholdSchema` | `admin-alert-threshold.ts` | `metric, operator, value, enabled, channel` | Cockpit alerts |
| `adminReferralSettingSchema` | `admin-referral-setting.ts` | `flat_amount_cents, qualification_rule` | Platform settings |
| `platformPricingTableSchema` | `platform-pricing-table.ts` | `vertical, base_cents, included_minutes, overage_cents, effective_at` (writes a NEW `price_version`, never mutates one) | Platform settings |
| `outreachCampaignSchema` | `outreach-campaign.ts` | `name, vertical, sending_domain, daily_send_cap, template_id, respect_suppression: literal(true)` | Outreach campaigns |
| `configLabScenarioSchema` | `config-lab-scenario.ts` | `name, vertical, llm_tier, voice_tier, assumed_volume` | Config Lab |
| `ftcDisclosureAckSchema` | `ftc-disclosure-ack.ts` | `policy_version, acknowledged: literal(true)` | Partner disclosure gate |

`DECIDE: W-9 fields are NOT a schema in this app.` Recommend a hosted
compliant provider (e.g. Track1099/Tipalti-style hosted W-9) rather than
collecting SSN/EIN in our own form — see §5.3.

---

## 3. Marketing — `(marketing)`

Every marketing page is RSC-first, ~zero client JS beyond the demo widget
and any interactive form. `generateMetadata` per page; `generateStaticParams`
for `/[vertical]`.

### 3.1 `/` — Home

- **Guard:** none.
- **Data:** none dynamic — static hero + vertical grid + trust stats (RSC,
  content from `content/marketing/home.ts`).
- **Components:** `MarketingHeader`, hero (missed-call stat rotator across
  verticals), `VerticalGrid` (8 cards linking to `/[vertical]`), "How it
  works" 3-step strip, testimonial placeholder block, pricing teaser card
  linking to `/pricing` ("starting at $299/mo" — **never** a real
  vertical number here, §3.3 owns that line), demo CTA banner linking to
  `/demo`, `MarketingFooter`.
- **Interactions:** vertical card click → `/[vertical]`; "Try a live demo"
  → `/demo`; "Get started" → `/signup`.
- **States:** static content only — no loading/error states needed beyond
  the trust-stat rotator degrading gracefully to a static first stat if JS
  hasn't hydrated.
- **Mobile:** vertical grid 2-col → 1-col; header collapses to a hamburger
  `Sheet`.
- **Analytics:** `home_viewed`, `vertical_card_clicked{vertical}`,
  `demo_cta_clicked`, `signup_cta_clicked{location:'home'}`.

### 3.2 `/[vertical]` — Vertical landing pages (8, one template)

`generateStaticParams` returns the 8 slugs: `auto-repair`, `veterinary`,
`legal-intake`, `dental`, `real-estate`, `motels`, `restaurants`, `generic`.
Content is a static `VerticalContent` record per slug in
`content/marketing/verticals.ts` (not DB-backed — marketing copy is a
content/config concern, not tenant data):

```ts
type VerticalContent = {
  slug: string; displayName: string; icon: string;
  heroStat: string;        // e.g. "Auto shops miss ~38% of calls — ~$135k/yr"
  painStats: string[];     // from VERTICAL_RESEARCH.md's decision matrix
  intakeSummary: string[]; // from SYSTEM_DESIGN §4.3, in plain language
  competitorAnchor: string; // soft comparison line, never a price
};
```

- **Guard:** none. **Data:** static content lookup by `params.vertical`
  (404 via `notFound()` if slug unknown).
- **Components:** hero (vertical name + `heroStat`), pain-stat callout row,
  "What it handles" list from `intakeSummary` (e.g. auto: "vehicle
  year/make/model, symptom, drop-off vs wait, appointment time"), soft
  competitor line (`competitorAnchor` — never the real $299–399 card;
  §1's anti-transparency rule holds here too), pricing teaser (same
  generic "starting at $299/mo" as home), demo CTA prefilled with the
  vertical (`/demo?vertical=<slug>`), signup CTA prefilled
  (`/signup?vertical=<slug>` seeds signup step 1's selection).
- **States:** n/a (static). **Mobile:** single column, stat callouts stack.
- **Analytics:** `vertical_landing_viewed{vertical}`,
  `demo_cta_clicked{vertical}`, `signup_cta_clicked{vertical,
  location:'vertical_landing'}`.

### 3.3 `/pricing`

- **Guard:** none. **Data:** static — the **generic** "starting at $299/mo"
  framing plus the Primary-tier vs Secondary-tier (integration upsell)
  feature comparison from `MASTER_PLAN.md` §1's product-tier decision. **The
  real per-vertical price card is never rendered here** — it is revealed
  only at signup step 2, per SYSTEM_DESIGN §1's explicit "every vertical
  competitor gates real pricing" rationale. Do not let a future edit leak
  the price-card table onto this page.
- **Components:** feature-comparison table (Primary: AI answering, booking
  write to our DB, SMS/email/Airtable delivery, dashboard, no per-call
  penalty vs the $49–99 floor's punitive overage — vs Secondary: direct
  POS/PMS/CRM write-in as upsell), FAQ `Accordion` (billing cadence, what
  counts as a minute, owner-test-call carve-out per G13, cancellation/
  port-out guarantee per G7), signup CTA.
- **States:** static. **Mobile:** comparison table becomes a stacked
  two-card layout (Primary card, Secondary card) instead of a wide table.
- **Analytics:** `pricing_viewed`, `signup_cta_clicked{location:'pricing'}`.

### 3.4 `/demo`

The most interactive marketing surface. Multi-step client flow inside one
route (`app/[locale]/(marketing)/demo/page.tsx` hosting a client
`<DemoFlow>` state machine — no need to split into sub-routes since nothing
here needs to survive a hard refresh mid-flow the way signup does).

**Step 1 — Request form**
- Data: none loaded. Form: `demoRequestSchema` (`business_name,
  website_url`).
- On submit → `POST /api/demo/generate` (Route Handler; server-only
  secrets for the scrape + Claude personalization step never reach the
  client). Response: `{ demo_id }`.

**Step 2 — Scraping progress**
- Data: TanStack Query polling `GET /api/demo/[demo_id]/status` every 1.5s
  while status is one of `scraping | sanitizing | compiling`
  (`refetchInterval`); stops on `ready`/`failed`.
- Components: step checklist ("Reading your website…", "Finding your
  services…", "Sanitizing scraped content…" [G21], "Building your AI
  receptionist…") each with a spinner→checkmark transition.
- States: `failed` → explanatory error ("We couldn't read that site — try
  the URL again or tell us about your business manually") with a manual
  fallback form (name + business type, skips scraping entirely) — the demo
  must never dead-end on a scrape failure.

**Step 3 — Personalized agent reveal**
- Data: RSC-hydrated / TanStack Query fetch of the compiled demo agent
  summary (business name, detected type/vertical, extracted hours/services
  if found).
- `DECIDE: scraped info live unreviewed vs a confirmation step` — this is
  literally SYSTEM_DESIGN §15 owner-decision #4, still open. **Recommend
  building the confirmation step**: an editable summary card ("Here's what
  we found — anything wrong?") with per-field edit, a prominent "Looks
  good, activate my demo" button, and — to keep the "under 60s" speed
  promise if the owner later decides against friction — an auto-advance
  after ~8s of no interaction. This satisfies both the trust need (G21
  sanitized-but-still-scraped content shown to a stranger before it talks)
  and the speed need, and is a pure frontend/copy change to remove later if
  the owner picks the unreviewed path instead.
- Components: editable summary card, "activate" CTA.

**Step 4 — Web-call island + demo phone number + email capture**
- Web-call island: client component using `retell-client-js-sdk`. Call
  token minted server-side via `POST /api/demo/[demo_id]/call-token` (Retell
  secret never reaches the browser, per `FRONTEND_STACK.md`). States:
  `idle → requesting-mic → connecting → active → ended → error`. Live
  transcript optional read-out beneath the call button.
- Demo phone number: displayed with `tel:` tap-to-dial (mobile) / copyable
  text (desktop); disclaimer "try calling it yourself."
- "Email me this demo" capture: form `demoEmailCaptureSchema`. On submit:
  sends an email with the demo link + phone number + a transcript recap if
  a call happened; also inserts into `leads` (`source = 'demo'`) for
  outreach/CRM continuity.
- Persistent CTA: "Sign up with this agent" → `/signup?demo_id=<id>`,
  prefilling step 1's business type/name and carrying `demo_id` through to
  attribution.
- **States:** mic-permission-denied is a first-class error state (common on
  mobile Safari) with a clear "allow microphone access" instruction, not a
  silent failure. Call-token-mint failure → retry + "call the demo number
  instead" fallback so one path failing doesn't kill the whole demo.
- **Mobile:** the primary expected device — tap-to-dial and the web-call
  button both large-target; scrape progress checklist is the same on
  mobile, just full-width.
- **Analytics:** `demo_started`, `demo_scrape_failed`, `demo_agent_revealed`,
  `demo_call_started`, `demo_call_ended{duration}`, `demo_email_captured`,
  `demo_signup_cta_clicked`.

### 3.5 `/blog` and `/blog/[slug]`

`DECIDE: CMS vs in-repo content.` Recommend **in-repo MDX**
(`content/blog/*.mdx`, rendered via RSC) — a solo founder authoring
occasional posts doesn't need a headless CMS's operational overhead;
Mintlify already owns the docs/support-article surface (`FRONTEND_STACK.md`),
so the blog stays a thin, separate content type.

- **Guard:** none. **Data:** RSC read of `content/blog/*.mdx` frontmatter
  for the index, full MDX render for `[slug]`.
- **Components:** post list card, post detail (MDX render + share links),
  RSS route (`app/rss.xml/route.ts`) for SEO completeness.
- **States:** `[slug]` 404s via `not-found.tsx` for an unknown slug.
- **Mobile:** standard responsive prose.
- **Analytics:** `blog_post_viewed{slug}`.

### 3.6 Legal — `/legal/terms`, `/legal/privacy`, `/legal/dpa`

- **Guard:** none. **Data:** static MDX content, each with a visible
  "Last updated" date and a version note.
- **Components:** MDX render with a sticky in-page table of contents for
  long documents.
- Content must include: AI/recording disclosure documentation, the
  guaranteed number port-out clause (G7), and the recording retention
  policy — **recording retention default is pending BIPA counsel input per
  SYSTEM_DESIGN §15 owner-decision #8.** `DECIDE:` render retention as
  "up to 90 days" (the conservative end of the 30–90 range) until counsel
  confirms, rather than hardcoding 30 or 90 into shipped legal copy that
  then needs a visible correction.
- **States:** static. **Mobile:** ToC collapses into a `Sheet`.
- **Analytics:** `legal_page_viewed{page}`.

---

## 4. Signup — `(marketing)/signup`

Six steps, split across distinct routes (not one client-only wizard) so
refresh/back-button/bookmarking behave correctly across a flow that
includes an external redirect (Stripe Checkout) and async provisioning.
Progress before an account exists is carried in a **signed, short-lived
cookie** rather than a throwaway DB table (`DECIDE`, recommended — avoids a
`signup_drafts` table purely for pre-auth state; the cookie holds
`{business_type, business_name, vertical, demo_id?}`, cleared once the real
`tenants` row is created at step 3).

### 4.1 Step 1 — `/signup` (business type)

- **Guard:** none (redirect to `/dashboard` if already authenticated with an
  active tenant). **Data:** none (static vertical list, same 8 + generic as
  §3.2); if `?vertical=` or `?demo_id=` is present, prefill from the query
  param / demo record (RSC fetch of the demo summary).
- **Components:** `WizardStepper` (1 of 6 shown as "Business info"),
  vertical card grid + "Something else" generic option, `business_name`
  input.
- **Form:** `signupBusinessTypeSchema`. On submit → set the signed cookie,
  navigate to `/signup/plan`.
- **States:** standard form validation states.
- **Mobile:** grid 2-col → 1-col.
- **Analytics:** `signup_step_completed{step:1}`.

### 4.2 Step 2 — `/signup/plan` (price reveal)

- **Guard:** signed cookie present (else redirect to `/signup`). **Data:**
  RSC fetch of the current `platformPricingTableSchema`-shaped row for the
  selected vertical from `platform_settings` (public read, price-version
  aware) — the **only** place the real price card is shown pre-signup.
- **Components:** `PriceCard` (base/included-minutes/overage), annual-prepay
  toggle with the discount applied live. `DECIDE: exact annual discount %`
  — SYSTEM_DESIGN §1 gives a 10–15% range, not a fixed number; recommend
  **12%** as a clean default sourced from `platform_settings` (not
  hardcoded in the component) so the owner can tune it without a deploy.
- **Interactions:** "Continue" → `/signup/account`. "Back" → `/signup`
  (cookie preserved, form re-populated).
- **States:** if the vertical's pricing row is missing (shouldn't happen,
  but defensively), fall back to the `generic` tier row rather than a
  blank page.
- **Mobile:** card stacks full-width.
- **Analytics:** `signup_step_completed{step:2, vertical}`,
  `annual_toggle_changed{enabled}`.

### 4.3 Step 3 — `/signup/account`

- **Guard:** signed cookie present. **Data:** none read; on submit, writes:
  1. `auth.signUp` (creates the Supabase user), 2. a Route Handler creates
  the `tenants` row (`status = 'pending_payment'`, vertical, business_name,
  price_version snapshotted from step 2) + the owner `memberships` row,
  3. the signed cookie is cleared.
- **Form:** `signupAccountSchema` (`owner_name, email, password,
  tos_accepted`).
- **Interactions:** "Create account & continue" → server creates the
  Stripe Checkout Session (`POST /api/checkout/session`, tenant_id +
  price_version + annual flag) and redirects to Stripe's hosted page
  (step 4, external — no custom route in this app beyond the redirect).
- **States:** email-already-registered is a specific inline error with a
  "log in instead" link, not a generic failure.
- **Mobile:** standard form.
- **Analytics:** `signup_step_completed{step:3}`, `signup_account_created`.

### 4.4 Step 4 — Stripe Checkout (external)

No page to spec — `success_url` → `/signup/provisioning?session_id=...`,
`cancel_url` → `/signup/plan?cancelled=true` (resumes with the cookie/tenant
row intact, `tenants.status` still `pending_payment`).

### 4.5 Step 5 — `/signup/provisioning`

- **Guard:** authenticated tenant session, `tenants.status` in
  `{pending_payment, provisioning}`.
- **Data:** RSC fetch of current `tenants.status` + saga step log for
  first paint; then **the first use of the tenant's private realtime
  channel** (subscribed as soon as `tenant_id` exists, before the tenant
  ever reaches the dashboard) for live saga updates, with a polling
  fallback (`refetchInterval: 2500`) if the realtime connection hasn't
  reached `connected` within ~3s.
- **Components:** `ProvisioningTimeline` — steps: payment confirmed → agent
  compiled → phone number provisioned → Retell import → billing meter
  created → ready.
- **States:** any step `failed` → error state naming the failed step,
  "we're on it" copy, and a support contact — **never** an indefinite
  spinner. A hard timeout at 90s (still `provisioning`, no failure) shows
  "Still working — we'll email you the moment it's ready" and lets the
  user leave without appearing broken.
- **Interactions:** on `ready`, auto-redirect to
  `/signup/forwarding` after a short celebratory beat.
- **Mobile:** full-width timeline.
- **Analytics:** `provisioning_started`, `provisioning_step_completed{step}`,
  `provisioning_failed{step}`, `provisioning_completed`.

### 4.6 Step 6 — `/signup/forwarding`

This is the **same** phone-setup wizard as the tenant dashboard's
`/dashboard/phone-setup` (§6.7), entered in an "onboarding" mode: no
"skip for now" escape hatch framing, first-run copy ("Let's forward your
business number — this takes about 2 minutes"), and on successful
verification a celebratory "You're live!" screen before redirecting into
`/dashboard` (which itself shows a first-call-pending empty state per
§6.1). See §6.7 for the full component/interaction spec — not duplicated
here.

- **Guard:** authenticated tenant, `tenants.status = 'active'`.
- **Analytics:** `onboarding_forwarding_completed`,
  `onboarding_completed` (fires once, on first arrival at `/dashboard`
  with `tenants.status = 'active'` and no prior `dashboard_viewed` event
  for this tenant).

---

## 5. Tenant dashboard — `(tenant)/dashboard`

Shell (see §9.2) provides: sidebar nav, topbar (branding logo,
`NotificationCenter`, `RealtimeIndicator`, user menu), and a
`ManualModeBanner` slot rendered on **every** dashboard page whenever
`agent_configs.manual_mode = true` — specified once here, not repeated per
page below.

### 6.1 `/dashboard` — Overview

- **Guard:** tenant, active. **Data:**
  - Metric cards (calls today, bookings today, minutes used/included,
    spam-deflected count): **RSC fetch** from the `usage_daily`/rollup view
    for first paint, **TanStack Query** thereafter, invalidated by the
    realtime channel on `call_logs`/`usage_events` writes.
  - Trend chart: **TanStack Query**, params = selected date range, source a
    rollup RPC grouped by tenant-local day (never UTC boundaries — the
    audit's "UTC-only day boundaries roll a Pacific restaurant's 'today' at
    4-5pm local" bug is explicitly not allowed back).
  - Live call feed: **realtime channel** (`call_logs` events) triggers
    refetch of a capped recent-calls list (20).
- **Components:** `MetricCard` ×4, `TrendChart`, `DateRangePills`,
  `CallFeedItem` list, `RealtimeIndicator`, `DataState` wrapping all of the
  above independently (a slow trend chart must not block the feed from
  rendering).
- **Interactions:** date pill click → refetch trend + metrics; feed item
  click → `/dashboard/calls/[id]`; "test call your number" CTA (visible
  until the tenant's first real call) → shows the tenant's live number with
  tap-to-dial.
- **States:** empty state must distinguish "number not yet forwarded" (CTA:
  finish phone setup) from "forwarded, zero calls yet" (CTA: test call) from
  "zero calls in the selected range but calls exist historically" (CTA:
  clear range) — three different empty copies, not one.
- **Mobile:** metric cards 2-col → 1-col below 400px; trend chart simplifies
  to a sparkline; feed unchanged (already a card list).
- **Analytics:** `dashboard_viewed`, `date_range_changed{range}`,
  `call_feed_item_clicked`.

### 6.2 `/dashboard/calls` — Calls list

- **Data:** **TanStack Query**, `call_logs` filtered `tenant_id` (RLS),
  server-side paginated (no hardcoded 50-row cap — the audit flaw), filters:
  classification (12-enum), date range, search (customer phone/name).
- **Components:** `DataTable` (columns: time, customer, classification
  `StatusBadge`, duration, outcome, linked booking), filter toolbar,
  `Pagination`, CSV export button (`DECIDE: include now` — recommend yes,
  cheap via a Route Handler streaming the same filtered query as CSV).
- **Interactions:** row click → `/dashboard/calls/[id]`; filter/pagination
  change → refetch; export → download.
- **States:** "no calls yet" vs "no calls match your filters" (+ clear
  filters action); error with retry.
- **Mobile:** rows collapse to stacked cards (time/customer/classification/
  duration).
- **Analytics:** `calls_list_viewed`, `calls_filtered{classification}`,
  `calls_exported`.

### 6.3 `/dashboard/calls/[id]` — Call detail

- **Data:** **RSC fetch** of the `call_logs` row (transcript, classification,
  `state_trace`, `variable_values`, signed recording URL) — single
  tenant-scoped fetch; **TanStack Query** for the linked booking/customer
  summary card.
- **Components:** `TranscriptViewer`, `AudioPlayer` (stereo toggle using
  `stereo_recording_url`), `StatusBadge` (classification), `StateTraceViewer`,
  linked-booking summary card, "Create support ticket from this call" CTA
  (deep-links into §6.13's ticket form, prefilled `call_id`).
- **Interactions:** transcript search; audio seek/speed; **clicking a
  state-trace node seeks the transcript/audio to that turn's timestamp**
  (`DECIDE: nice-to-have vs core` — recommend implementing it; `state_trace`
  already carries entry timestamps per SYSTEM_DESIGN §4.4, so the cross-link
  is cheap and is exactly the debugging aid the carry-over notes call out).
- **States:** recording status must distinguish **"processing" (archival
  pipeline hasn't completed yet, <10 min per SYSTEM_DESIGN §2)** from **"no
  recording" (by design — e.g., a spam call hung up in <10s never gets
  archived)** — these are different states with different copy, not one
  blank player. `DECIDE:` a bespoke tenant "flag for review" mechanism was
  considered and rejected — reuse the existing support-ticket "create from
  this call" flow instead (one paper-trail entity, not two).
- **Mobile:** transcript/audio stack vertically; a sticky mini
  audio-player bar stays visible while scrolling the transcript.
- **Analytics:** `call_detail_viewed`, `recording_played`,
  `state_trace_node_clicked`, `ticket_created_from_call`.

### 6.4 `/dashboard/bookings` — Bookings

- **Data:** **TanStack Query** on `bookings`, both list and calendar view
  read the same query (grouped by day client-side for the calendar), plus
  the same `availability_slots` table the voice backend reads for the
  reschedule slot-picker (so the dashboard can never offer a slot the phone
  agent would reject — one source of truth for openness).
- **Components:** view-toggle (List/Calendar), `DataTable` (list mode),
  `BookingCalendar` (month/week grid — `DECIDE: build on a scheduler
  library vs a hand-rolled grid`; recommend a **hand-rolled CSS-grid month
  view** over `@tanstack/react-table` for the list and a lightweight custom
  grid for the calendar, not a heavy scheduler like FullCalendar — bookings
  here are appointment-shaped, not drag-resize-heavy, and a heavy scheduler
  risks Tailwind-v4 friction the same way Tremor did for charts), `Sheet`
  detail panel with Confirm/Reschedule/Cancel.
- **Interactions:** booking click → detail `Sheet`; Confirm/Reschedule/
  Cancel are **mutations that also trigger the customer SMS** per
  SYSTEM_DESIGN — success toast reads "Customer notified by SMS," not just
  "Saved"; reschedule opens a slot-picker sourced from `availability_slots`
  (respects the backend's GIST exclusion constraint — the dashboard cannot
  offer a double-book any more than the phone agent can).
- **States:** booking-mutation success with **SMS delivery pending/failed**
  is a distinct **non-blocking warning** toast (the booking itself
  succeeded; SMS may be in A2P pending-verification per G4, or failed) —
  never rolled into a single pass/fail state.
- **Mobile:** below `sm`, view-toggle defaults to List; Calendar degrades to
  a day-by-day agenda rather than a month grid (a full grid is unusable at
  phone width).
- **Analytics:** `bookings_viewed{view}`, `booking_confirmed`,
  `booking_rescheduled`, `booking_cancelled`.

### 6.5 `/dashboard/customers` and `/dashboard/customers/[id]`

- **List data:** **TanStack Query**, `customers` joined to a
  `customer_segments` **view** (`DECIDE: compute segmentation in a DB view
  vs client-side` — recommend a Postgres view/materialized column;
  VIP/Loyal/Returning/New depends on lifetime spend/visit counts that
  belong in the database, not recomputed per page load).
- **List components:** `DataTable` with `SegmentBadge` column, search by
  name/phone.
- **Detail data:** **RSC fetch** of the customer row + related
  calls/bookings/orders history.
- **Detail components:** `SegmentBadge`, history timeline (reusing
  `CallFeedItem` styling + booking rows), contact card, "log a note"
  (`DECIDE: a lightweight `customer_notes` free-text field, not a full
  ticket — support tickets stay reserved for the call/booking paper-trail
  use case specifically, per SYSTEM_DESIGN's carry-over note).
- **States:** standard 4-state; first-time-caller empty history state.
- **Mobile:** list rows → stacked cards; detail history → vertical timeline
  (already mobile-friendly).
- **Analytics:** `customers_viewed`, `customer_detail_viewed{segment}`,
  `customer_note_added`.

### 6.6 `/dashboard/agent` — Agent settings (tabbed, one route per tab)

Nested routes (`/dashboard/agent/greeting`, `/hours`, `/services`, `/faq`,
`/instructions`, `/manual-mode`, `/language`) rather than a single
query-param-tabbed page — each is independently bookmarkable and gets its
own RSC fetch of just the fields it needs. `/dashboard/agent` redirects to
`/dashboard/agent/greeting`. Every tab: **RSC fetch** of `agent_configs`
for `defaultValues`, explicit per-tab **Save** button (`DECIDE: explicit
save vs autosave` — recommend explicit save; these are consequential
business-facing config changes, not draft content, and an accidental
autosave of a half-edited greeting is a real risk), mutation invalidates
both the local query and — via the realtime channel — a second staff
member's open dashboard tab.

- **Greeting & Persona** (`/greeting`): `persona_name` field + a **read-only**
  preview of the full greeting including the mandatory disclosure sentence.
  **The disclosure sentence itself is never an editable field** — it is
  compiler-enforced (SYSTEM_DESIGN §4.5/§7), only `persona_name`
  interpolates into it ("Hi, this is {name}, the AI assistant for
  {business} — this call may be recorded"). A voice-preview button plays a
  short TTS sample. Form: `agentGreetingSchema`.
- **Hours** (`/hours`): `HoursEditor` — weekly hours + holiday exceptions
  list (add/remove exception: date + closed-or-custom-hours). Form:
  `businessHoursSchema`.
- **Services** (`/services`): `ServiceOfferingEditor` — CRUD over
  `offerings` (name, duration, price, resource requirement) via a
  `DataTable` + add/edit `Dialog`. Form: `offeringSchema` per row.
- **FAQ** (`/faq`): `FAQEditor` — Q/A list feeding the agent's static-context
  dynamic variables (or, past a size threshold, a lookup tool per the
  latency budget in SYSTEM_DESIGN §5). Shows a live byte-size indicator and
  a warning banner past ~3KB ("Large FAQs may slow every call turn — we'll
  move this to a lookup tool automatically past this size"). Form:
  `faqItemSchema` per row.
- **AI Instructions** (`/instructions`): `special_instructions` free text,
  `transfer_number`, `voicemail_message`, plus the carried-over rich context
  fields (manager name/phone, parking info, accessibility notes, prep time,
  delivery radius/minimum, accepted payment types). Form:
  `aiInstructionsSchema`.
- **Manual Mode** (`/manual-mode`): toggle + `AlertDialog` consequence
  dialog — **not** a bare switch flip, given real customer-facing impact.
  Copy: "Turning on Manual Mode stops the AI from confirming bookings
  automatically — new orders/bookings will be sent to you by SMS instead."
  Two-step: explain → confirm. Persists via `manualModeToggleSchema`
  (`acknowledged_consequence` must be `true` to submit). Renders the same
  `ManualModeBanner` used shell-wide, here with the disable control inline.
- **Language** (`/language`): dropdown of agent spoken languages — EN
  live, ES shown as "Coming soon" and disabled (gap G12, not yet built).
  Form: `agentLanguageSchema`. **Explicitly not the dashboard UI locale** —
  see §0.6.
- **States (all tabs):** standard 4-state; plus a transitional "changes
  saved — updating your AI, ~30s" state after any save, polling/subscribing
  until `agent_configs.compiled_at` advances past the save timestamp.
- **Mobile:** tabs collapse into a `Select`-driven switcher below `sm`
  (shadcn `Tabs` doesn't scroll well cramped).
- **Analytics:** `agent_settings_saved{tab}`, `manual_mode_toggled{enabled}`.

### 6.7 `/dashboard/phone-setup`

- **Data:** **RSC fetch** of the `phone_numbers` row (Twilio number,
  `forwarding_verified_at`, chosen carrier) + verification test-call status
  (**realtime** channel + polling fallback while a test is in flight).
- **Components:** `WizardStepper` (carrier select → codes → tap-to-dial →
  verify → success), `CarrierForwardingCard` (AT&T/Verizon/T-Mobile/
  other-landline `*72`/`*73`-style codes), an alternate "port your number
  in instead" path (`phonePortInRequestSchema` — current number, account
  number, PIN, carrier; async, days-long, a status timeline rather than a
  spinner).
- **Interactions:** carrier select; tap-to-dial `tel:` link (mobile) /
  copyable code (desktop); default **forwarding mode** on the carrier step
  is `conditional` (`DECIDE:` SYSTEM_DESIGN §15 owner-decision #5 frames
  this exact conditional-vs-full choice as open; recommend **conditional as
  the pre-selected default** with `full` offered as an explicit opt-in
  toggle labeled "forward all calls instead (faster setup, no fallback if
  our AI is briefly down)" — conditional preserves the Retell-outage
  failover path from SYSTEM_DESIGN §8 by default); "test it" button
  triggers a synthetic test call and reports pass/fail with a **specific**
  diagnostic ("we didn't receive the call — check the code was entered
  correctly"), never a generic failure.
- **States:** pending (spinner, ~60s timeout → retry guidance), verified
  (success + "you're live"), failed (carrier-specific troubleshooting),
  port-in-pending (status timeline, days not seconds — visually distinct
  from the seconds-scale verification flow).
- **Mobile:** the primary expected device (owners forward FROM their cell);
  tap-to-dial front and center, codes copyable with a single tap.
- **Analytics:** `phone_setup_started`, `carrier_selected{carrier}`,
  `forwarding_test_result{pass}`, `port_in_requested`.

### 6.8 `/dashboard/delivery`

- **Data:** **RSC fetch** of delivery settings (SMS enabled — tied to A2P
  status, shows a "pending verification" banner per G4 if not yet approved,
  with email fallback explicitly still active — never a silent failure per
  SYSTEM_DESIGN's mandate; email enabled + notification email; Airtable
  connect status).
- **Components:** toggle rows (SMS/email), `ConnectionLifecycleCard` for
  Airtable (connect/reauth/disconnect/sync-now/last-sync), a collapsible
  sync-log viewer showing recent push attempts + conflict warnings (one-way
  push + change-detection per G30).
- **Interactions:** Airtable connect → OAuth popup + `postMessage` with a
  **fixed origin check** (the carried-over pattern, minus the old bug that
  accepted any origin containing "ngrok"/"localhost") → auto-connect if one
  base, picker if many.
- **States:** SMS pending-verification (1–5 business days, non-blocking);
  Airtable disconnected-by-provider (revocation webhook → banner, per the
  carried-over adapter-revocation pattern — never silently fail future
  pushes); sync errors surfaced, not swallowed.
- **Mobile:** stacked settings rows.
- **Analytics:** `delivery_pref_changed{channel}`, `airtable_connected`,
  `airtable_disconnected`.

### 6.9 `/dashboard/billing`

- **Data:** **RSC fetch** of `billing_invoices` + current-period
  `usage_daily` rollup + plan info; Stripe payment-method summary and
  invoice PDFs fetched server-side from Stripe (never stored raw card data).
- **Components:** `UsageMeter` (color at 80%/100%), alert-config controls
  (`usageAlertConfigSchema`), invoice `DataTable` (Stripe-hosted PDF links),
  "Manage payment method" → **Stripe Billing Portal redirect** (`DECIDE:
  custom payment form vs Billing Portal`; recommend the Portal — minimizes
  PCI scope, consistent with the already-fixed Stripe Checkout + Meters
  decision), plan/annual-prepay summary, a small permanent note: "Test
  calls from your registered cell don't count toward usage" (G13 — a trust
  feature, should be visible, not buried).
- **Interactions:** toggle alert config → mutation; "View invoice" → Stripe
  hosted PDF; "Manage payment method" → portal redirect.
- **States:** usage meter renders correctly at **zero usage** ("0 of 300
  minutes used" — never blank); overage is visually distinct (accrued
  overage cost shown); a dunning/payment-failure banner with a clear
  next-step link — billing must never present a falsely healthy state
  (this is the direct fix for the old system's fabricated-billing rot).
- **Mobile:** meter + cards stack; invoice table → stacked list.
- **Analytics:** `billing_viewed`, `usage_alert_config_changed`,
  `payment_portal_opened`, `invoice_viewed`.

### 6.10 `/dashboard/refer`

`DECIDE: relationship to the Partner Portal.` SYSTEM_DESIGN's
`referral_partners`/`referrals`/`referral_payouts` tables back a dedicated
Partner Portal role (§7 below) with W-9/FTC formality — but every tenant
also gets a lighter "refer & earn" surface on their own dashboard.
Recommend: this page reads/writes the **same** referral tables (a tenant
generating a link auto-provisions a `referral_partners` row scoped to their
user), rendered without partner-portal chrome and without a W-9/FTC gate
up front (most tenant referrals stay below the $600/$2k 1099 threshold); if
a tenant's cumulative earnings approach that threshold, a banner appears
prompting W-9 completion, deep-linking into `/portal/w9` (§7.3) even though
they never "became a partner" in any separate sense — one backend, two
front-end weights.

- **Data:** **RSC fetch** of the tenant's referral link + earnings summary
  + clicks/signups/qualified counts.
- **Components:** link display + copy-to-clipboard, `FunnelChart` (clicks→
  signups→qualified→paid), earnings summary card, conditional W-9-threshold
  banner. `DECIDE: share buttons` — recommend copy-link + email/SMS share
  intents only, skip social-platform APIs (low value at this scale).
- **Interactions:** copy link → clipboard + toast.
- **States:** zero-referrals empty state explaining the qualification rule
  ("$X after their 2nd paid month," value read from `platform_settings`,
  never hardcoded copy).
- **Mobile:** cards stack.
- **Analytics:** `referral_link_copied`, `referral_link_shared{channel}`.

### 6.11 `/dashboard/support` and `/dashboard/support/[id]`

- **List data:** **TanStack Query**, `support_tickets` filtered tenant_id,
  joined to `call_id`/`booking_id` for context.
- **List components:** `DataTable` (subject, `StatusBadge`, linked
  call/booking, last updated), "New ticket" (`supportTicketCreateSchema`,
  with `call_id`/`booking_id` prefillable from the deep-links in §6.3/§6.4).
- **Detail data:** thread of **visible-only** notes (internal notes are
  never sent to the tenant client — enforced server-side, not just
  hidden in the UI).
- **Detail components:** thread view, reply form (`supportTicketReplySchema`).
- **States:** standard 4-state; empty ("No support tickets — need help?
  Start one below").
- **Mobile:** list → stacked cards; detail → full-screen `Sheet`.
- **Analytics:** `support_ticket_created{source}`, `support_ticket_replied`.

---

## 6.12 Out of scope for this spec (noted for completeness)

**Tenant API tokens** (SYSTEM_DESIGN §14, explicitly Phase 2/3): no
dedicated settings page in this spec. When built, it is a new tab under
Agent/Delivery settings (hashed tokens, reveal-once modal per the carried-
over UX pattern) — flagged here so the completeness self-check in §11 isn't
read as having missed it.

---

## 7. Admin cockpit — `(admin)/cockpit`

Shell (see §9.3) provides: sidebar (Margin Cockpit submenu with the 9 pages
below, Tenants, Outreach, Templates, Alerts, Settings), topbar
(`CommandPalette` trigger, AAL2 indicator, `ImpersonationBanner` slot shown
only during active impersonation). No realtime channel here — TanStack
Query with `refetchInterval` + manual refresh (§0.3).

### 7.1 Margin cockpit — 9 pages (SYSTEM_DESIGN §11)

**7.1.1 `/cockpit/margin/waterfall`**
- Chart: **waterfall** (`MarginWaterfall`, Recharts composed bars with
  invisible base segments — no native Recharts waterfall type exists, this
  is the documented `visx` escape hatch if composed bars prove insufficient
  for the segment-annotation needs, per `FRONTEND_STACK.md`).
- Data: **TanStack Query** → admin Route Handler → `get_margin_waterfall(period)`
  RPC aggregating `cost_events`, `revenue_events`, `payment_processing_events`,
  `commission_events`, `fixed_cost_allocations`. Period selector
  (month/quarter/custom, default MTD).
- Drill-down: click a segment (e.g. "LLM cost") → `DataTable` below filters
  to the underlying `cost_events` rows for that category/period.

**7.1.2 `/cockpit/margin/customers`**
- Chart: `DataTable` sorted margin% ascending (worst first) + a margin%
  distribution bar chart.
- Data: per-tenant revenue-vs-cost view, joined to a **backend-computed**
  `diagnosis_reason` (e.g. "usage 3× expected for plan," "overage uncapped,"
  "LLM tier mismatch," "excessive tool retries") — read directly, never
  recomputed client-side.
- Drill-down: row click → `/cockpit/margin/customers/[tenantId]`
  (per-call cost-vs-billed for that tenant + a "suggested action" panel:
  upsell tier, LLM downgrade, contact customer).
- Components: `DataTable`, `StatusBadge` (healthy/watch/negative), a
  tooltip surfacing the diagnosis text.

**7.1.3 `/cockpit/margin/calls`**
- Chart: `DataTable` (call, tenant, duration, actual cost, billed amount,
  delta) + a cost-vs-billed scatter for outlier-spotting.
- Data: `cost_events` joined to the usage-ledger computation, filterable by
  tenant/vertical/date.
- Drill-down: click a call → a dedicated **admin, read-only** call-detail
  view (`/cockpit/tenants/[id]/calls/[callId]`) reusing `TranscriptViewer`/
  `AudioPlayer`/`StateTraceViewer` from `packages/ui`, fetched via an
  admin-privileged Route Handler — no impersonation session needed for
  this, since it's pure observability, not acting as the tenant.

**7.1.4 `/cockpit/margin/drift` — provider-repricing drift**
- Chart: line chart of $/min cost over time per provider (voice, LLM,
  telephony) with annotated markers where actual cost deviates from a
  stored `provider_rate_baseline` by more than the configured threshold
  (default 8%, per the alert-rule default in §7.1.9). Drift is computed
  **server-side** (a view/scheduled job), never client math on raw
  `cost_events` — one definition of "drift," not two.
- Drill-down: click a marker → the `cost_events` rows driving that day's
  drift.

**7.1.5 `/cockpit/config-lab`**
- Not a chart page — a non-destructive simulation sandbox. Pick a vertical
  + hypothetical changes (LLM tier, voice tier, assumed volume) → a
  "what-if" RPC recomputes projected margin, rendered as a **before/after
  `MarginWaterfall` pair**. Clearly labeled "simulation only — no changes
  applied."
- `DECIDE: persist named scenarios?` Recommend **yes** — a lightweight
  `config_lab_scenarios` table scoped to `admin_id` (`configLabScenarioSchema`),
  cheap to build, high value for a solo founder iterating pricing over
  weeks rather than one sitting.
- Related but distinct from the **template publish gate**'s simulation
  results (§7.3): Config Lab is a margin/pricing what-if; the publish gate
  is a conversation-quality + per-call-cost red-team/batch-simulation check
  before a new template version reaches real tenants. Do not merge the two
  UIs — different inputs, different stakes.

**7.1.6 `/cockpit/margin/referrals` — Referral P&L**
- Chart: bar/line of referral payouts vs revenue attributed to referred
  tenants over time; per-partner P&L table (clicks→signups→qualified→paid,
  CAC-per-referral vs other channels).
- Data: `referral_partners`, `referrals`, `referral_payouts` joined
  `revenue_events`.
- Drill-down: click a partner → `/cockpit/tenants/../partners/[id]`
  (admin view of that partner's activity, including a status/clawback
  control and any G34 self-referral-fraud warning surfaced inline for
  manual review — never auto-actioned).

**7.1.7 `/cockpit/margin/cac`**
- Chart: bar chart of CAC by channel (outreach, referral, organic/demo)
  over time, with an LTV:CAC line overlay.
- Data: `cac_events`, `pipeline_costs`, joined to signups by attribution
  source.
- Drill-down: click a channel → underlying campaign/lead-level costs (for
  outreach, links into §7.2's funnel view).

**7.1.8 `/cockpit/margin/bottlenecks`**
- Chart: per-tool (availability/booking/customer/message) p50/p95/p99
  latency line chart + error rate, with circuit-breaker trip events
  annotated on the timeline.
- Data: `DECIDE: where do latency metrics live?` Recommend a lightweight
  `tool_call_metrics` rollup table (per-tool, per-hour, p50/p95/p99,
  error_count) written by the `/voice/tools` pipeline, queried directly here
  — not a round-trip to an external APM for the cockpit UI (keeps this page
  fast and self-contained; Sentry remains the deep-tracing/alerting layer).
- Drill-down: click a latency spike → the `webhook_events`/`call_logs` rows
  in that window.

**7.1.9 `/cockpit/alerts` — Alert rules**
- Not a chart — a rules table: price drift >8%, negative margin, usage
  spike 2.5×, concurrency 80%, tool-failure spike, commission>margin,
  payment failures (the exact SYSTEM_DESIGN §11 list). Each row: metric,
  operator, threshold, enabled toggle, notification channel
  (email/SMS/dashboard-only), last-triggered timestamp.
- Components: `AlertRuleRow`, edit `Dialog` (`adminAlertThresholdSchema`), a
  recent-alerts log/feed beneath the rules table, a **"test alert"** action
  per rule (sends a sample notification through the real channel to
  confirm delivery actually works — directly answers the audit's
  "silent failure" theme).
- **Analytics (whole margin cockpit):** `cockpit_page_viewed{page}`,
  `margin_drilldown_clicked{page, segment}`, `config_lab_simulation_run`,
  `alert_rule_edited{metric}`, `alert_test_sent{metric}`.

### 7.2 Tenants management

**`/cockpit/tenants`** (list): `DataTable` — business name, vertical, plan,
status (active/pending_payment/suspended/churned), MRR, margin%,
created_at; filters by vertical/status/plan; search. **Data:** TanStack
Query.

**`/cockpit/tenants/[id]`** (detail): tenant profile (plan, phone numbers,
agent config summary link), usage/margin mini-widgets (`MetricCard`/
`UsageMeter` reused), recent calls (read-only, §7.1.3's admin call view),
billing history.

- **Impersonate:** button → confirmation `Dialog` requiring a `reason`
  field (`adminImpersonateSchema`) — the `admin_actions` audit row is
  written **on the request itself**, before the session is granted, so even
  an aborted attempt is logged. The resulting session is **read-only by
  default**, time-boxed (e.g. 30 min, countdown visible in
  `ImpersonationBanner`), with an explicit "Enable edits" toggle that logs
  a **second** audit entry when flipped (`DECIDE:` this read-only-by-default
  + explicit-edit-toggle split isn't spelled out at this granularity in
  SYSTEM_DESIGN §7/§11; recommended as the safer default given it's an
  audit/compliance-sensitive feature). Renders `ImpersonationBanner` across
  every tenant page for the impersonated session's duration, with an "End
  impersonation" control.
- **Suspend:** button → confirmation `Dialog` (`adminTenantSuspendSchema`,
  reason required) warning explicitly, mirroring the manual-mode
  consequence-dialog pattern: "This stops their AI answering calls
  immediately."
- **Analytics:** `tenant_detail_viewed`, `impersonation_started{tenant_id}`,
  `impersonation_edit_enabled{tenant_id}`, `impersonation_ended`,
  `tenant_suspended{tenant_id}`.

### 7.3 Outreach — `/cockpit/outreach`

- **Overview (default)** `/cockpit/outreach`: `FunnelChart`
  (sent→opened→replied→qualified→signed-up) from `send_events`+`replies`+
  attributed signups; CAC summary card linking to §7.1.7.
- **Campaigns** `/cockpit/outreach/campaigns` (list, CRUD) +
  `/campaigns/[id]` (detail: settings, per-campaign funnel, lead list) +
  `/campaigns/new` (`outreachCampaignSchema` — name, vertical,
  sending_domain [read from `platform_settings`, not hardcoded, since
  SYSTEM_DESIGN §15 owner-decision #7 on the sending domain is still open],
  daily_send_cap, template_id, mandatory suppression-list-respect toggle
  locked `true`).
- **Lead fetch** `/cockpit/outreach/leads`: trigger panel for
  Apollo/Outscraper/Apify fetch jobs by vertical/geography; job status
  (queued/running/done/failed); resulting lead count + dedupe stats against
  `suppression_list`.
- **Reply feed** `/cockpit/outreach/replies`: `ReplyFeedItem` list with
  `ai_intent` filter (interested/not-interested/question/unsubscribe/…),
  one-click actions per intent — **"unsubscribe" must act instantly**
  (adds to `suppression_list` synchronously; CAN-SPAM-critical, not a
  queued job).
- **States:** a persistent **compliance banner** (not just a cockpit
  widget) if the complaint rate approaches the 0.3% auto-pause threshold
  from SYSTEM_DESIGN §11 — this consequence is severe enough to warrant
  shell-level prominence, not a buried metric.
- **Mobile:** cockpit-wide "desktop only" rule applies (§0.5).
- **Analytics:** `outreach_campaign_created`, `lead_fetch_triggered{vertical}`,
  `reply_action_taken{intent, action}`, `suppression_add_manual`.

### 7.4 Templates — `/cockpit/templates`

- **List** `/cockpit/templates`: the 8 vertical templates, current
  published version, last-updated.
- **Editor** `/cockpit/templates/[vertical]`: canonical schema editor
  (system-prompt fragments per state, tool schemas, transitions/
  global_intents). `DECIDE: structured form vs a visual state-graph
  canvas.` Recommend **V1 ships a structured form** — states as an
  editable list with prompt/tools/validation sub-fields, transitions as a
  rule table — rather than a drag-and-drop graph editor; a true visual
  graph canvas is a larger, separable investment worth its own future
  build, not core dashboard scope.
- **Version history:** `TemplateDiffViewer` (unified/side-by-side diff
  between versions), rollback action.
- **Publish gate:** before any new version goes live, `SimulationResultsPanel`
  must show the red-team adversarial CI suite + batch-simulation harness
  results (pass/fail per case, estimated cost-per-simulated-call, and a
  **disclosure-line integrity check**). The disclosure-integrity check is a
  **hard block with no override** (it's compiler-enforced per SYSTEM_DESIGN
  §7 — non-negotiable, not an admin judgment call); other, lower-severity
  simulation warnings may be overridden with a required justification note
  logged to `admin_actions`.
- **Mobile:** desktop-only (§0.5).
- **Analytics:** `template_version_saved{vertical}`,
  `template_publish_attempted{vertical}`,
  `template_publish_blocked{vertical, reason}`,
  `template_published{vertical, version}`.

### 7.5 Platform settings — `/cockpit/settings`

Tabs: **Referral** ($X amount + qualification rule,
`adminReferralSettingSchema`, default suggested $100 after 2nd paid month
per SYSTEM_DESIGN §15 owner-decision #1 — still open, ships as an editable
default not a hardcoded constant), **Pricing tables** (per-vertical base/
included-minutes/overage editor, `platformPricingTableSchema` — editing
here **creates a new `price_version`, never mutates a historical one**,
since tenants snapshot their `price_version` at signup and billing
integrity depends on old versions staying immutable). Alert thresholds are
**not** duplicated here — they live solely at `/cockpit/alerts` (§7.1.9) to
avoid two places defining the same rule.

- **Mobile:** desktop-only (§0.5).
- **Analytics:** `platform_setting_changed{setting}`,
  `pricing_table_version_created{vertical}`.

---

## 8. Partner portal — `(partner)/portal`

Root layout wraps every page in the FTC disclosure gate check (§0.2/§8.4).

### 8.1 `/portal` — Dashboard

- **Data:** **TanStack Query** — personal link, clicks/signups/qualified/
  pending-paid summary, recent activity.
- **Components:** `MetricCard` row, `FunnelChart`, activity list, link
  display + copy button.
- **States:** zero-activity empty state with the qualification rule spelled
  out.
- **Mobile:** cards stack.
- **Analytics:** `partner_dashboard_viewed`, `partner_link_copied`.

### 8.2 `/portal/payouts`

- **Data:** **TanStack Query**, `referral_payouts` table (date, amount,
  method, status), next-payout estimate.
- **Components:** `DataTable`.
- **States:** empty ("No payouts yet — you'll see them here once a referral
  qualifies").
- **Mobile:** stacked list.
- **Analytics:** `partner_payouts_viewed`.

### 8.3 `/portal/w9`

`DECIDE: build a custom W-9 form vs redirect to a hosted compliant
provider.` Recommend **hosted** (e.g. a Track1099/Tipalti-style hosted W-9
flow) — collecting SSN/EIN directly in our own database is a liability this
product does not need to take on. This page shows `W9StatusBadge`
(not_submitted/submitted/verified) + a "Complete W-9" button linking out,
and a read-only confirmation once verified — no SSN/EIN ever touches our
schema or this page's form state.

- **Analytics:** `partner_w9_started`, `partner_w9_status_viewed{status}`.

### 8.4 `/portal/disclosure` — FTC acknowledgment gate

Blocking interstitial on first portal access (and again if the acknowledged
policy version is stale — `ftcDisclosureAckSchema` is versioned, not
one-time-forever). Required disclosure text ("You must disclose you may
earn a commission when sharing your link") + checkbox + timestamp recorded
to `referral_partners.ftc_acknowledged_at`. No skip path.

- **Analytics:** `partner_ftc_disclosure_acknowledged{policy_version}`.

### 8.5 `/portal/settings`

Payout method (`referralPayoutMethodSchema` — `paypal_email`) and
notification preferences.

- **Analytics:** `partner_payout_method_set`.

---

## 9. Shared surfaces

### 9.1 Auth pages

| Route | Purpose | Form/schema | Notes |
|---|---|---|---|
| `/login` | Email+password sign-in | `loginSchema` | Role-based post-login redirect: tenant→`/dashboard`, admin→`/cockpit` (with AAL check per §0.2), partner→`/portal`. |
| `/reset-password` | Request reset email | `resetPasswordRequestSchema` | |
| `/reset-password/confirm` | Set new password (token in URL) | `resetPasswordConfirmSchema` | |
| `/mfa/enroll` | Forced TOTP enrollment for admins | `mfaEnrollSchema` | QR code + `input-otp` confirmation. No skip — an admin without an enrolled factor cannot reach `/cockpit`. |
| `/mfa/challenge` | AAL1→AAL2 step-up | `mfaChallengeSchema` | `input-otp` code entry. |

`DECIDE: magic link?` The prompt itself frames this as open. Recommend
**skipping magic link for V1** across all roles — admin needs MFA anyway
(a magic-link + step-up combination adds real flow complexity for little
benefit), tenant/partner password + reset covers the need, and magic link
is easy to add later purely as a login-page enhancement if forgotten-
password support volume justifies it.

### 9.2 App shell / nav per role

- **Marketing:** header (logo, vertical dropdown, Pricing, Demo CTA, Login,
  Signup CTA) + footer (legal links, social). No sidebar.
- **Tenant:** shadcn `sidebar` block — nav: Overview, Calls, Bookings,
  Customers, Agent, Phone Setup, Delivery, Billing, Refer & Earn, Support.
  Topbar: `BrandingProvider`-styled logo, `NotificationCenter`,
  `RealtimeIndicator`, user menu. `ManualModeBanner` slot below the topbar
  on every page when active. **Mobile:** bottom `MobileTabBar` (Overview /
  Calls / Bookings / Customers / More — the rest collapse into a "More"
  `Sheet`).
- **Admin:** sidebar (Margin Cockpit submenu ×9, Tenants, Outreach,
  Templates, Alerts, Settings). Topbar: `CommandPalette` trigger, AAL2
  indicator, `ImpersonationBanner` slot (impersonation mode only). **Mobile:**
  "Best viewed on desktop" banner + reduced read-only summary only (§0.5) —
  the nine margin pages, Config Lab, and the template editor are not
  rendered below `md`.
- **Partner:** simple sidebar (Dashboard, Payouts, W-9, Settings). FTC gate
  wraps the whole group's root layout (§8.4).

### 9.3 Theming — per-tenant branding

`tenants.branding` jsonb (`{logo_url, primary_color, accent_color}`) is read
by `BrandingProvider`, a server component in the `(tenant)` root layout,
which emits a `<style>` block mapping these onto the same CSS custom
properties shadcn's theme tokens already consume (`--primary`, etc.),
scoped so marketing/admin/partner are never affected by a tenant's brand
colors. Dark/light mode follows standard shadcn `data-theme` conventions
(system default, user-toggleable). A tenant-set brand color that fails a
basic contrast check against the surrounding surface falls back to the
default palette rather than shipping illegible UI — validated at save time
in the (not-yet-specced, Phase 2/3) branding editor, and defensively
re-checked at render time here too.

### 9.4 Toasts / notification center

Ephemeral toasts via `sonner` (mutation success/failure, matching §0.4's
non-blocking-warning pattern for partial failures like SMS-send-after-
successful-booking).

`NotificationCenter` (bell + unread badge + dropdown/drawer): new booking,
usage-alert threshold crossed, SMS pending-verification resolved, adapter
disconnected, support ticket reply. `DECIDE: a dedicated `notifications`
table vs deriving the feed live.` SYSTEM_DESIGN §6 does not list a
notifications table. Recommend **not** adding one for V1 — derive the feed
client-side from the same realtime events + a couple of targeted queries,
with "unread" computed against a `last_seen_notifications_at` timestamp
column on `memberships` (one small column, not a new table/schema surface
the backend spec didn't already authorize). Revisit if the derived-feed
approach proves too limited once built.

### 9.5 Command palette (admin only)

`cmdk`-based, ⌘K. Commands: navigate to any cockpit page; search/jump to a
tenant by name or id; quick actions ("suspend tenant …", "view call by id
…"). Lives in the admin topbar only — not built for tenant/partner
surfaces, where the nav is already shallow enough not to need it.

### 9.6 Realtime connection lifecycle

`TenantRealtimeProvider` wraps the `(tenant)` layout (and, once tenant_id
exists, the signup provisioning step — §4.5). States: `connecting →
connected → reconnecting (exponential backoff: 1s/2s/4s/8s, capped) →
offline` (after N failed attempts). On reaching `offline`, a small
persistent, non-blocking indicator reads "Live updates paused — refresh to
catch up" (`RealtimeIndicator`, shown in the tenant topbar always, colored
by state). **Broadcasts are not durable/replayed** — on reconnect, the
provider invalidates all currently-active tenant-scoped TanStack queries
once, rather than attempting to reconstruct exactly what was missed while
disconnected. Admin and partner surfaces have no realtime provider at all
(§0.3).

---

## 10. Documentation site — `apps/docs` (Mintlify)

Out of per-page detail here (owned by Mintlify's own config, not
`apps/web`), but two frontend-adjacent notes: (1) the support chatbot
referenced in `MASTER_PLAN.md`'s customer lifecycle consumes Mintlify's
auto-generated `llms.txt` + MCP server directly — no custom RAG build, and
no chatbot UI lives in `apps/web` (it's embedded via Mintlify's own widget
or linked out); (2) `/dashboard/support` (§6.11) and the docs site are
deliberately separate surfaces — tickets are the tenant-linked paper trail
tied to specific calls/bookings, docs are the self-serve knowledge base —
do not merge them into one nav item.

---

## 11. Completeness self-check

Cross-referencing every surface named in the assignment:

- **Marketing:** home ✓(§3.1), 8 `/[vertical]` landing pages ✓(§3.2),
  `/pricing` ✓(§3.3), `/demo` full flow incl. scrape progress/personalized
  agent/web-call island/demo number/email capture ✓(§3.4), `/blog` index +
  detail ✓(§3.5), legal ToS/privacy/DPA ✓(§3.6).
- **Signup:** all 6 steps incl. Stripe Checkout redirect and the live
  provisioning-saga screen ✓(§4.1–§4.6).
- **Tenant dashboard:** overview w/ live feed+metrics+trend+date pills
  ✓(§6.1), calls list+detail w/ transcript/recording/classification/state
  trace ✓(§6.2–§6.3), bookings list/calendar w/ confirm/reschedule/cancel→
  SMS ✓(§6.4), customers w/ segments+detail+history ✓(§6.5), agent settings
  — greeting/persona, hours+holidays, services, FAQ, AI instructions,
  transfer number, voicemail message, manual mode+consequence+banner,
  language ✓(§6.6, all 7 tabs), phone setup w/ carrier codes+tap-to-dial+
  verification+port-in ✓(§6.7), delivery prefs SMS/email/Airtable ✓(§6.8),
  billing usage-meter/alerts/invoices/payment method/plan ✓(§6.9),
  refer-and-earn ✓(§6.10), support tickets linked to calls ✓(§6.11).
- **Admin cockpit (AAL2):** all 9 margin-cockpit pages w/ chart type, data
  source, drill-downs ✓(§7.1.1–§7.1.9), tenants list/detail/impersonate-
  with-audit/suspend ✓(§7.2), outreach campaign CRUD/lead fetch/funnel/
  reply feed w/ intent filter+one-click actions/CAC ✓(§7.3), templates
  editor+version history+publish gate w/ simulation results ✓(§7.4),
  platform settings referral $/pricing tables/alert thresholds ✓(§7.5,
  alert thresholds cross-referenced to §7.1.9 rather than duplicated).
- **Partner portal:** dashboard (link/clicks/signups/qualified/pending-
  paid) ✓(§8.1), payout history ✓(§8.2), W-9 status ✓(§8.3), FTC
  disclosure gate ✓(§8.4).
- **Shared:** auth pages (login, reset, MFA enrollment; magic link
  explicitly addressed as `DECIDE`) ✓(§9.1), app shell/nav per role
  ✓(§9.2), theming/branding ✓(§9.3), toasts/notification center ✓(§9.4),
  command palette ✓(§9.5), realtime connection lifecycle ✓(§9.6).
- **Component library:** `packages/ui` structure + every named component
  (MetricCard, DataTable, TranscriptViewer, AudioPlayer, CallFeedItem,
  WizardStepper, MarginWaterfall, UsageMeter, ManualModeBanner) plus the
  additional custom components the surfaces above required ✓(§1).
- **Forms + zod schemas by name:** ✓(§2, one row per schema, file path and
  consuming page named).
- **Analytics events per page:** inlined at the end of every page section
  above rather than in a separate table, per §0.8's rationale.
- **Mandatory loading/empty/error states:** specified per page, with the
  recurring instruction to distinguish "no data ever" from "no data in this
  filter/range" and to never collapse a partial failure (e.g. SMS delivery)
  into the primary action's success/failure state — the direct fix for the
  audit's core complaint.
- **Mobile behavior:** specified per page plus the general split in §0.5
  (mobile-first for marketing/signup/tenant/partner, desktop-primary with
  an explicit reduced view for admin).
- **`DECIDE:` register** (every open call in one place, for a fast owner
  read-through): demo scrape confirmation step (§3.4); signup draft storage
  as a signed cookie (§4); annual discount exact % (§4.2); default
  forwarding mode conditional-vs-full (§6.7); blog as in-repo MDX vs a CMS
  (§3.5); recording-retention copy pending BIPA counsel (§3.6); bookings
  calendar hand-rolled vs a scheduler library (§6.4); customer segmentation
  as a DB view (§6.5); customer notes vs a full ticket (§6.5); tenant
  refer-and-earn sharing the partner backend without partner-portal chrome
  (§6.10); referral share buttons scope (§6.10); Config Lab scenario
  persistence (§7.1.5); bottleneck metrics storage table (§7.1.8);
  impersonation read-only-by-default with an explicit edit toggle (§7.2);
  template editor structured-form-vs-visual-graph (§7.4); template publish
  override scope (§7.4); W-9 hosted vs custom (§8.3); magic link skipped
  for V1 (§9.1); notification center derived-feed vs a dedicated table
  (§9.4); analytics provider (§0.8); admin/partner realtime skipped for V1
  in favor of polling (§0.3); CSV export on the calls list (§6.2); a
  bespoke call "flag for review" rejected in favor of the existing ticket
  flow (§6.3).

No page, component, form, or state named in the assignment is missing from
a section above; every `DECIDE:` carries a concrete recommendation the T5
build agent can implement against without blocking on the owner.

---

## 12. Channels — text conversations, text agent, embeddable widget

Appended by the Cluster S build task (2026-09-11), backing schema in
`docs/spec/BACKEND_SPEC.md` §13. Originally a spec delta with nothing yet
built; **the Messages/Settings pieces below are now built**
(`apps/web/src/app/[locale]/(tenant)/dashboard/messages/**`, the
"Website widget" settings tab), by Cluster W, against the schema that
actually shipped (`text_conversations`/`text_conversation_messages` —
`docs/audit/CHANNELS_REQUESTS.md` item 1's resolution) rather than this
section's original `text_messages`/`status ('ai'|'human'|'closed')`
naming — this section is updated below to describe what was actually
built, not the original spec-only draft.

**§6.6 Settings — new "Channels" tab** (alongside the 7 tabs §6.6 already
names): text agent toggle (`tenants.text_agent_enabled`) + persona editor
(`text_agent_persona`) + quiet-hours picker (`quiet_hours`, same
open/close-time control pattern as the Hours tab, but a single daily
window rather than a weekly schedule); widget toggle
(`tenants.widget_enabled`) + widget settings form (`widget_settings`:
allowed-origins list input, accent color picker, position radio, greeting
text field, voice/chat mode checkboxes) + a read-only "embed this on your
site" panel showing the `<script>` snippet keyed by
`tenants.widget_public_key` with a "regenerate key" action (secret-reveal-
once-style confirmation, same UX posture as `api_tokens`'s one-time reveal,
§6.7-adjacent) that immediately invalidates the old key.

**§6.2/§6.3-adjacent — Messages** (built,
`dashboard/messages/**`/`dashboard/messages/[phone]/**`): the thread view
per customer MASTER_SPEC §3.10 already calls for is `text_conversations`/
`text_conversation_messages`-backed: a conversation list (filter by
channel `sms`/`web_chat`, status `open`/`human`/`closed`, sorted by
`updated_at`) and an open-thread view rendering `text_conversation_
messages` in order (author-tagged bubbles: ai/human/customer) with a reply
box that posts as `author='human'` and, in the same action, flips the
conversation's `status` between `'open'` and `'human'` to take over from
the AI (and a "hand back to AI" action to flip it back — there is no
separate `ai_enabled` field in the shipped schema; `status` alone drives
this). A web-chat thread has no phone number, so the existing
`/dashboard/messages/[phone]` route's param slot is reused with an opaque
`wc:<conversation id>` key (`apps/web/src/lib/messages/text-
conversations.ts`'s `webChatKey`/`parseThreadKey`) rather than adding a
second route. Live-updates via the same `tenant:<tenant_id>` broadcast
channel + TanStack Query refetch model §9.6 already specifies, on both
`text_conversations` (list) and `text_conversation_messages` (open thread)
broadcasts.

**§3.4-adjacent — Demo/marketing widget reuse**: the embeddable widget
(voice via the demo's existing web-call token-minting flow, extended per
`widget_public_key`/`allowed_origins`/`WIDGET_TOKEN_SECRET` — BACKEND_SPEC
§13.2 — plus a new chat mode) is the same component embedded both on a
live tenant's own site (via the Settings-tab script snippet above) and,
unchanged, on `/demo` itself — one implementation, not a fork per
surface.

**Loading/empty/error states**: conversation list — "no data ever" (no
text conversations yet, with a short "texts and web-chat visits will
appear here once enabled" empty state distinct from "no results for this
filter") vs. a filtered-empty state, matching the recurring instruction
elsewhere in this spec (§6.2 et al.) to never collapse those two. Reply-
send failure (e.g. the tenant's `a2p_status` isn't `verified` yet, or the
recipient opted out via STOP) surfaces inline on the reply box, never
silently, and never folded into the thread's own success/failure state —
the same "don't collapse a partial failure into the primary action" rule
§0's rationale already states for SMS delivery elsewhere.
