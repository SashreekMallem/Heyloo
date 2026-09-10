# Launch Status

## Design: world-class UI system + marketing/dashboard/admin restyle (DESIGN-1, 2026-09-10)

Integrated the uncommitted design wave (token system, typography,
`Container`/`Section`/`PageHeader`/`Callout`/`DataList`/`ThemeToggle`,
lucide-only icon system, `UI_PREVIEW_MODE` review route group, and three
rounds of review + repair across marketing/tenant/admin-partner — full
per-cluster detail in `docs/BUILD_NOTES.md`'s `DS`/`Cluster TENANT`/
`Cluster MARKETING`/`ADMIN/PARTNER`/`repair:*` sections) as the
INTEGRATOR: ran every gate, fixed what the gates caught (2 ESLint errors,
1 unused-directive warning, 8 dead literal-emoji values, 3 stray review
scripts), and committed. Round-3 review: **marketing 91/100 (pass)**,
**tenant dashboard 79/100**, **admin/partner cockpit 85/100** — tenant and
admin/partner are a real, substantial improvement over round 2 (round 2
admin/partner was 34/100) but did not clear the pass bar this round;
shipping now rather than holding for a round 4 is a documented scope call,
not a silent gap — see `docs/BUILD_NOTES.md`'s DESIGN-1 section for the
full score table and what was fixed. UI Preview Mode is confirmed
hard-disabled in production (own test, 3 cases, passing) and its temporary
screenshot/smoke scripts were removed from the tree.

**Gates:** all green — `npx biome check --write` (0 errors on touched
paths), `pnpm -w typecheck` (18/18), `pnpm run lint` (0 errors), `pnpm -w
test` (19/19 package test tasks, `apps/web` 238 + `packages/ui` 23 among
them), `apps/web` production build (`next build --webpack`, real Google
Fonts fetch). No emoji remain in `apps/web/src`/`packages/ui/src`; no
internal-jargon customer-facing copy (`tenant` only appears in the
internal `(admin)/cockpit` ops surface or as identifiers/route
paths/DB columns, never as displayed copy on marketing/tenant/partner
surfaces).

**New secrets needed:** none.

**Owner to-do, added by this pass:** none blocking. Non-blocking: a round
4 design pass to close the remaining tenant-dashboard and admin/partner
polish gaps the round-3 review flagged (see `docs/BUILD_NOTES.md`'s
DESIGN-1 section) before either surface is treated as launch-final.

## Vertical wave (WAVE-2, 2026-09-10) — integration pass

Integrated the uncommitted vertical-completeness build wave (engine,
config pipeline, payloads, templates, commissions, onboarding —
per-cluster detail lives in `docs/BUILD_NOTES.md`'s own WAVE-2 section)
as the INTEGRATOR: closed the 3 items the wave's own verifier flagged as
`partial`, ran every gate, and committed. No new architecture, no
redesign of any cluster's work — CLAUDE.md Rule 4.

**Closed this pass** (full detail in `docs/BUILD_NOTES.md`'s WAVE-2
section):
- Root `turbo.json` build-order fix so `registry-consistency.test.ts`'s
  real-template-registry checks actually run in CI, not just when a human
  happens to build packages in the right order first.
- New migration `20260910180000_motel_hold_regen_fix.sql` — closes the
  last of three places a motel deposit hold needed to block room
  re-availability (the other two were already fixed by
  `20260910170000_motel_hold_exclusion.sql`): `fn_regenerate_availability_slots`
  (the nightly roll-forward job / a business-hours edit) now respects an
  active, unexpired hold the same way the GIST exclusion constraint and
  the availability-invalidation trigger already do.
- `createRetellBatchSimulationClient` (`packages/adapters/retell/src/
  tests-api.ts`) — the one piece the batch-simulation harness was waiting
  on. **Not fully closed:** the wrapper's `transcript_snapshot` parser is
  built against the closest officially-documented analogous shape and
  fails loudly on a mismatch, but genuinely needs a live Retell staging
  account run to confirm/correct — no such credential exists in this
  sandbox. Tracked as `docs/VERIFY.md` VERIFY-13, unchanged from the prior
  pass's own honest flag on this exact point.

**Gates:** all green — `biome check --write` (0 errors), `pnpm -w
typecheck` (18/18), `pnpm run lint` (0 errors — 3 pre-existing eslint
errors in `apps/web` found and fixed along the way, none introduced by
this pass), `pnpm -w test` (19/19 package test tasks, 777+230+164+…
tests), `apps/web` production build, `verify-jwt-guard` (41 functions),
and all 45 real migrations + seed applied clean from an empty database in
a throwaway local-Postgres harness. Full detail, including the harness
approach, in `docs/BUILD_NOTES.md`.

**New secrets needed:** none. This pass added no new integration and no
new secret-gated code path — `createRetellBatchSimulationClient` reads the
same `RETELL_API_KEY`/`RETELL_STAGING_RESPONSE_ENGINE_<KEY>` env vars the
batch-simulation harness already expected before this pass.

**Owner to-do, added by this pass (in addition to everything already
listed under "What remains for the owner" below, unchanged):**
1. Once a Retell **staging** account exists (`docs/DEPLOY.md` §1/§4), run
   `pnpm --filter @heyloo/templates run simulate` once, capture one real
   `test_case_job.transcript_snapshot` payload, and confirm/correct
   `packages/adapters/retell/src/tests-api.ts`'s `normalizeTranscriptSnapshot`
   against it (VERIFY-13) — the wrapper fails loudly rather than
   fabricating a pass in the meantime, so this is a correctness-hardening
   step, not a blocking one.
2. Optional, non-blocking: wire the batch-simulation job into
   `.github/workflows/ci.yml` per `docs/audit/FIX_REQUESTS.md`'s sketch,
   gated on a `RETELL_STAGING_API_KEY`-shaped secret being present so it's
   skipped (not red) until item 1 above is done.

## Audit fix wave (FIX-1, 2026-09-10)

Integrated the large parallel audit fix wave (Clusters B-G + the repair
tasks covering realtime/dashboard truthfulness, impersonation, DB-H1 write
RLS, and admin cockpit proxy contract — full per-cluster detail already in
`docs/BUILD_NOTES.md`). This pass's own additional work:

- Fixed `public.fn_enqueue_message_outbound`'s JWT/tenant-identity mismatch:
  both real call sites (`apps/web`'s `api/tenant/bookings/[id]` and
  `api/tenant/messages/[phone]` routes) invoke it through a service-role
  client, whose JWT carries no `app_metadata.tenant_id` — the function's
  own-tenant check always compared against NULL and silently no-op'd, so
  every booking-confirmation/reschedule/cancellation SMS and every Messages
  "reply" send stayed queued forever and never actually went out. Fixed by
  making the function service-role-aware (a `service_role` caller is
  trusted as already tenant-verified upstream, matching CLAUDE.md Rule 2's
  standing convention for every other service-role code path in this
  schema; an `authenticated` caller still gets the strict own-tenant
  match). See `docs/BUILD_NOTES.md`'s FIX-1 section for the full account
  and the local-Postgres verification that exercised all three cases
  (service_role, authenticated+matching tenant, authenticated+mismatched
  tenant).
- Verified every `docs/audit/FIX_REQUESTS.md` bullet filed by the prior
  clusters against the current tree; removed everything confirmed applied,
  kept the genuinely still-open ones (BIPA retention default pending
  counsel, per-tenant usage-alert-prefs pending a product decision, Airtable
  two-way sync, `tenants.canceled_at`/`paused_at`, the decorative
  `outreach_send_queue`, and the admin-cockpit-proxy impersonation
  edit-mode 403 — the last one specifically needs a joint
  `apps/web`+`admin` edge-function auth-model change, out of this pass's
  scope per CLAUDE.md Rule 4).
- All gates green: `biome check --write` (changed paths clean, 0 errors
  repo-wide), `pnpm -w typecheck` (18/18), `pnpm run lint` (0 errors),
  `pnpm -w test` (all packages, incl. `edge-functions`/`ui`/`web` — 563 +
  15 + 134 tests passing), `apps/web` production build, the
  `verify-jwt-guard` CI script, and all 31 real migrations + seed applied
  clean from an empty database in a throwaway local-Postgres harness (no
  Docker/`supabase start` available in this environment — same documented
  constraint as every prior pass; `scripts/ci/rls-cross-tenant-probe.ts`
  and `scripts/ci/cron-queues-check.ts` both need a live GoTrue+PostgREST
  stack via `supabase start`, so neither was runnable here either — both
  remain reviewed-but-unexecuted-in-this-sandbox, same status as the
  Playwright e2e specs noted below).

## Deployed to live project — update 2026-09-10 (WAVE-2 vertical wave)

Applied after commit 0af1ade: 13 new migrations (45 recorded), 41 edge
functions ACTIVE (new: api-intake, api-lead-callback, api-menu-import,
api-team-invite, api-tenant-test-call, job-commission-accrual,
job-lead-callback-retry). Live-verified: 57 tables, RLS on all, 24 cron
jobs (incl. commission accrual, lead-callback retry, motel deposit-hold
expiry), 8 queues, resources.room_type/capacity, orders allergy/delivery
columns, bookings quoted_rate/hold_expiry, referral_partners
rate_bps/commission_base/duration_months, lead_callback_requests +
intake tables present.

Owner secrets still to set (Edge Functions -> Secrets), in addition to the
FIX-1 list below: `INTAKE_ENCRYPTION_KEY` (64-hex random, encrypts dental
intake DOB/insurance at rest) and `ANTHROPIC_MENU_IMPORT_MODEL` (model id
for menu extraction; see .env.example) — plus `ANTHROPIC_API_KEY` when the
Anthropic account exists.

## Deployed to live project — update 2026-09-10 (FIX-1 wave)

Applied over the Management API after commit 380f65b: 10 new migrations
(32 recorded), 34 edge functions ACTIVE (7 new: webhooks-paypal,
job-churn-scoring, job-value-email, job-offboarding, job-retention-sweep,
job-keep-warm, api-payment-link-resend), Vault secrets
`cron_functions_base_url` + `cron_invoke_secret` created. Live-verified:
21 cron jobs scheduled, 8 pgmq queues (4 + 4 DLQ), RLS on all 53 tables,
the 4 admin views are security_invoker with zero anon/authenticated grants,
4 tenant-scoped booking/order write policies present.

Owner must set these edge-function secrets in the dashboard (Edge
Functions -> Secrets) — the build environment is not permitted to write
credentials to the live project:

- `CRON_INVOKE_SECRET` = the value stored in Vault as `cron_invoke_secret`
  (run `select decrypted_secret from vault.decrypted_secrets where
  name='cron_invoke_secret'` in the SQL editor and paste it) — until this
  matches, every cron-invoked job returns 401.
- `ADAPTER_TOKEN_ENCRYPTION_KEY` = any 64-hex random string (used to encrypt
  adapter OAuth tokens at rest; generate with `openssl rand -hex 32`).
- `SB_SECRET_KEY` = the project's `sb_secret_...` key (Settings -> API keys).
- Optional until Airtable delivery is offered: `AIRTABLE_OAUTH_CLIENT_ID`,
  `AIRTABLE_OAUTH_CLIENT_SECRET`, `AIRTABLE_OAUTH_REDIRECT_URI`,
  `AIRTABLE_OAUTH_STATE_SECRET`.

Still to delete in the dashboard: the 14 legacy edge functions and 3 legacy
storage buckets listed above.

## Deployed to live project (2026-09-09)

Live Supabase project: `qulcubtwqsqgqpfgvorn` ("Heyloo", us-east-2, PG 17).
Deployed this session (full record: BUILD_NOTES.md DEPLOY-1):

- 22 migrations applied + recorded (schema wiped by owner first; legacy
  empty schema/users/history removed). 52 tables, **RLS enabled on all**.
- Seed applied (12 platform_settings rows incl. price cards, templates).
- All 27 edge functions deployed ACTIVE (deploy command:
  `npx supabase functions deploy --use-api --import-map
  supabase/functions/deno.json`).
- Auth Custom Access Token hook enabled -> public.custom_access_token_hook.
- 8 function secrets set: CRON_INVOKE_SECRET, PROVISION_INTERNAL_SECRET,
  ADAPTER_CONNECT_STATE_SECRET, OUTREACH_WEBHOOK_SECRET (generated) +
  VOICE_TOOLS_WEBHOOK_URL, RETELL_INBOUND_WEBHOOK_URL,
  WEBHOOKS_TWILIO_SMS_URL, WEBHOOKS_POS_SQUARE_URL (derived).

Owner still to do on the project:
1. Dashboard -> Settings -> API keys: copy the `sb_secret_...` key and add
   it as edge-function secret **SB_SECRET_KEY** (Edge Functions ->
   Secrets). Copy `sb_publishable_...` for the frontend env later.
2. Delete the 14 legacy edge functions (retell-assistant, retell-events,
   retell-tools, retell-manage, retell-numbers, pos-sync, pos-oauth,
   pos-oauth-callback, pos-push, pos-push-square, pos-push-clover,
   square-webhook, clover-webhook, parse-menu) and the 3 legacy storage
   buckets (menus, voice-samples, call-recordings) — deletion is blocked
   from the build environment.
3. Provider accounts + secrets per docs/DEPLOY.md (Retell, Stripe, Twilio,
   Resend, Anthropic, PayPal, Smartlead, Apollo/Outscraper...).
4. Rotate the management access token used for this deployment, and the
   old database password shared during setup.

Snapshot as of this build's last commit (T9, Wave 4 — ops hardening, deploy
guide, E2E pass; see `docs/BUILD_NOTES.md`'s T9 entry for the full account).
Three sections: what's built, what the owner still has to do, and an honest
gaps list compiled from every prior task's own `docs/BUILD_NOTES.md`/
`docs/VERIFY.md` disclosures — nothing here is new information, it's the
consolidated version a launch decision actually needs.

## What's built

| Wave | Task | What it delivered | Tests |
|---|---|---|---|
| 0 | T0 | pnpm/Turborepo monorepo, strict TS, Biome, Vitest, base CI | smoke tests |
| 1 | T1 | Full schema (49 tables), RLS on every table + CI cross-tenant probe, Custom Access Token Hook, seed data (8 verticals) | verified via direct SQL harness (no Docker in that build env — see its own entry) |
| 1 | T2 | Canonical types, `VoiceProvider` interface, Retell adapter, template compiler (disclosure-gate enforced) | 126 (canonical-types) + 95 (adapter-retell) = 221 |
| 1 | T3 | Voice hot path (`/voice-inbound`, `/voice-tools`'s 9 tools, `/voice-events`), all webhook consumers, admin router (2/9 groups), workers, cron jobs | 253 |
| 2 | T4 | Stripe checkout/billing, 6 more admin groups, PayPal payouts, A2P registration, dunning, waitlist auto-book | 300 (cumulative) |
| 2 | T5 | `apps/web` (every FRONTEND_SPEC surface), `packages/ui`, `packages/supabase-client`, realtime provider, 2 Playwright smoke specs | 4 (apps/web unit) + component tests across `packages/ui`/`supabase-client` |
| 2 | T6 | 8 vertical agent templates, red-team adversarial suite, compiler-gate tests | 104 |
| 3 | T8 | Outreach engine (Apollo/Outscraper fetch, Claude personalize, Smartlead send, reply classification), admin outreach panel | 350 (cumulative) |
| 4 | **T9 (this task)** | Sentry wiring (`_shared/sentry.ts` + `logger.ts`, env-gated), `docs/OPS_RUNBOOK.md`, `docs/DEPLOY.md`, CI completion (`e2e`/`repo-hygiene` jobs, clean-build assertion, actionlint-clean), 3 new Playwright specs + auth infrastructure, `scripts/e2e-backend.ts` | 397 (`supabase/functions` cumulative, +20 from this task) |
| — | DESIGN-1 | Design token system + typography (`packages/ui/src/theme`), shared layout/custom components, lucide-only icon system, `UI_PREVIEW_MODE` review route group, full marketing/tenant/admin-partner restyle across 3 review rounds | 238 (`apps/web`) + 23 (`packages/ui`) |

**Not yet done by any task** (real, not oversight): `packages/adapters/
shopmonkey`/`ezyvet`/`google-calendar`/`square` and their webhook/two-way-
sync wiring (Wave 3, T7 — confirmed in progress but uncommitted at the time
this task ran; see below), `admin-support-requests`/`admin-flags` (still
`501`), a `/webhooks-paypal` consumer, a dedicated health-check endpoint.

Current total: **~726 tests passing** across
`supabase/functions` (397) + `packages/canonical-types` (126) +
`packages/adapters/retell` (95) + `packages/templates` (104) +
`apps/web` (4), plus the CI-only `rls-cross-tenant-probe`/`migrations-check`/
`db lint` checks that need a live Postgres (GitHub-hosted runners have
Docker; this and every prior build agent's sandbox did not).

**Concurrent work-in-progress at the time this task ran** (T7, adapters —
explicitly out of this task's scope per its own instructions): `packages/
adapters/square` fails `pnpm --filter @heyloo/adapter-square run typecheck`
today (missing `zod`/`@heyloo/canonical-types` resolution — a mid-edit
state, not a design flaw), and `supabase/functions/webhooks-pos/*` +
`supabase/functions/_shared/providers/square.ts` + `pnpm-lock.yaml` carry
uncommitted changes in this shared working tree. **Root `pnpm run
typecheck`/`lint` are not green as of this commit for that reason** —
confirmed via scoped runs that every file this task actually touched is
clean (`biome check docs .github scripts apps/web/tests
supabase/functions/_shared` → 0 errors; `tsc --noEmit` clean in
`supabase/functions` and `apps/web`; the full `supabase/functions` Vitest
suite — 397/397 — passes). This mirrors the exact situation T4's and T6's
own BUILD_NOTES entries each independently observed and left alone, for the
same reason: editing another task's in-progress files on a shared branch is
out of scope, not this task's bug to fix.

## What remains for the owner

Everything in `docs/DEPLOY.md` §1 (accounts to create) and §4 (live
Retell-sandbox VERIFY confirmations) — no build agent can create accounts,
click through vendor dashboards, or sign legal agreements. In priority
order (matching DEPLOY.md's own lead-time ordering):

1. **Start Twilio A2P brand registration and Smartlead domain warm-up
   today** — both have multi-day/multi-week lead time and should not be
   the last thing blocking launch.
2. **File the Retell support ticket** (`docs/DEPLOY.md` §4.1's seven
   questions) — the highest-risk unconfirmed item in the whole codebase
   (VERIFY-8, the Conversation-Flow wire schema) depends on this.
3. Create every account in `docs/DEPLOY.md` §1, run `scripts/setup-
   stripe.ts`, complete the deploy sequence in §3 (including the cron/queue
   SQL registration in §3.6 — genuinely not wired anywhere in code, a
   real one-time setup step).
4. Run the live-sandbox VERIFY confirmations (§4.2) before the first real
   template publish.
5. Clear the counsel checklist (`docs/DEPLOY.md` §5) — several items block
   product copy (the disclosure line, recording retention window) that's
   compiled into every agent template, so resolve these before, not after,
   onboarding real tenants.
6. Run the go-live smoke checklist (`docs/DEPLOY.md` §6) end to end against
   production before calling it launched.
7. Set up uptime monitoring + a status page (`docs/OPS_RUNBOOK.md` §3-§4)
   and do one dry-run of the backup/restore drill (§5) before the first
   real tenant's data exists to lose.
8. Merge T7's adapter work once it lands, resolve the root-gate red state
   noted above, and decide whether to build the two remaining `501` admin
   groups (Support, Feature flags) and a `/webhooks-paypal` consumer before
   or after initial launch (none of these block a phone call from being
   answered and billed correctly — they're operational-completeness items).

## Known gaps (compiled from every task's own disclosures)

Grouped by how much it matters at launch, not by which task found it —
cross-referenced against `docs/VERIFY.md` and every `docs/BUILD_NOTES.md`
entry's own "Deferred / left for later tasks" section, so nothing here is a
new finding, only a consolidated one.

### Would affect a real call/booking if unresolved

- **VERIFY-8** (Retell Conversation-Flow/Retell-LLM wire field names) — see
  above, the single highest-priority item.
- **VERIFY-1** (Retell webhook signature scheme / which key actually signs
  it) — a wrong assumption here means every inbound Retell webhook fails
  closed (loud, not silent, but still blocks every call).
- **`call_cost` unit/enum** (VERIFY-4) — unconfirmed cents-vs-dollars is a
  real billing-accuracy risk, not cosmetic.
- **Recording retention window** — no hard default shipped in code; an
  explicit open item pending counsel input (`docs/SYSTEM_DESIGN.md` §15).
- **No dedicated health-check endpoint** — `docs/OPS_RUNBOOK.md` §3's
  uptime-monitoring workaround (expect `401` from `/voice-inbound`) is a
  real but imperfect substitute.

### Would affect billing/growth accuracy but not call-answering itself

- **`/webhooks-paypal` consumer doesn't exist** — `job-referral-payouts`'s
  success means "PayPal accepted the batch," not "every partner was
  actually paid"; `referral_payouts.status` never advances past `'sent'`.
- **Apollo credit-to-dollar conversion not implemented** — CAC dashboard
  under-counts true Apollo spend until wired.
- **Smartlead has no distinct spam-complaint webhook event** (per every
  indexed source found) — the CAN-SPAM 0.3% auto-pause rule is fully built
  and unit-tested but cannot fire from a live signal today, only a manual
  admin action.
- **Per-tenant fan-out on template publish** doesn't exist — publishing a
  template update validates + publishes the template itself but does not
  re-publish every already-provisioned tenant's own agent (needs a
  rollout-strategy decision — all-at-once vs. staged/canary — not made
  anywhere yet).
- **`packages/supabase-client/database.types.ts` is hand-maintained**, not
  generated from the live schema — a real drift risk with no CI check
  tying the two together yet.

### Operational completeness (nice-to-have before scaling past pilots)

- `admin-support-requests`/`admin-flags` remain `501` (out of every task's
  named scope so far).
- `worker-adapter-push`'s adapter registry is empty until T7's Shopmonkey/
  ezyVet/Google-Calendar/Square adapters land — every push currently
  dead-letters after 6 attempts (by design, never silently "succeeds").
- Tenant impersonation mints a real magic link when `supabaseAdmin` deps
  are configured, but the exact GoTrue `generate_link` response field
  nesting is unconfirmed against a live call (`_shared/providers/
  supabase-admin.ts` checks both shapes defensively).
- The `_shared/compiler/template-compiler.ts` vs.
  `packages/adapters/retell/src/compiler/*` duplication (Deno/Node
  workspace-package boundary) is tracked maintenance debt, not a
  correctness risk today.
- CI's `e2e` job (this task) only runs the unauthenticated Playwright
  specs; the three authenticated ones (dashboard realtime, forwarding
  wizard, admin AAL2) are real and pass a source-level review but were
  never executed anywhere (no Docker/no browser install in any build
  agent's sandbox) — run them for real, locally or in an expanded CI job,
  before treating them as a release gate. Same for `scripts/e2e-backend.ts`.
- Full Playwright execution has never happened in any build agent's
  environment (`cdn.playwright.dev` is network-blocked in every sandbox
  used across this entire build) — every spec in `apps/web/tests/e2e/` is
  unexecuted-but-reviewed, not proven-passing, until run somewhere with
  browser install + (for the authenticated specs) a local Supabase
  instance.

### Explicitly scoped out, not forgotten

- A dedicated `join_waitlist` voice tool (waitlist requests currently route
  through `take_message`).
- An Instantly outreach adapter (Smartlead is the bound sender; Instantly
  is explicitly rejected with `422` today).
- Real-time in-audio card-number redaction (the payment-link flow avoids
  the issue by design instead — confirm this is an acceptable substitute
  with your PCI assessor, `docs/DEPLOY.md` §5).
- A tenant-facing dental BAA flow (frontend + signed-document record) —
  Retell's own BAA (§1.2) is separate from this and does not substitute for
  it.

## Related documents

- `docs/DEPLOY.md` — accounts, env vars, deploy sequence, VERIFY resolution
  workflow, counsel checklist, go-live smoke checklist.
- `docs/OPS_RUNBOOK.md` — logging conventions, Sentry, uptime monitoring,
  incident/status-page automation, backup/restore drills, break-glass
  continuity.
- `docs/VERIFY.md` — every external-API-shape assumption, by task, with
  confidence level and what to confirm before relying on it.
- `docs/BUILD_NOTES.md` — the full build history, task by task, including
  every deviation from spec and why.
