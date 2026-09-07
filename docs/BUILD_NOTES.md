# Build Notes

Running log of what each build agent did, deviations from BUILD_PLAN/
SYSTEM_DESIGN, and anything deferred to a later task. Append, never rewrite,
prior entries.

## T0 — Monorepo foundation (Wave 0)

**What was built**

- pnpm workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`,
  `packages/adapters/*`) + Turborepo (`turbo.json`, current `tasks` schema
  with `$TURBO_DEFAULT$`/`$TURBO_ROOT$` — not the legacy `pipeline` key).
- Root `package.json` (private, `dev`/`build`/`lint`/`lint:fix`/`format`/
  `format:check`/`typecheck`/`test`/`clean` scripts).
- Directory skeleton: `packages/canonical-types` (builds, exports
  `CANONICAL_TYPES_VERSION`, has a passing Vitest smoke test),
  `packages/adapters/README.md` (provider-isolation rule + a table of every
  adapter package planned across T2/T4/T7/T8/T10, so future tasks have one
  place to land in), `packages/ui` and `packages/templates` (placeholder
  packages, same shape as canonical-types, each with a smoke test),
  `apps/README.md` (empty, points to T5), `supabase/config.toml` (stub,
  Postgres major_version 17) + `supabase/migrations/README.md` +
  `supabase/functions/README.md` (both document the rules T1/T3/T4 must
  follow once they land real content).
- `tsconfig.base.json`: strict + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes` + `noPropertyAccessFromIndexSignature` (the
  three flags beyond bare `strict` that current TS guidance recommends for
  new projects), NodeNext module resolution, composite/incremental project
  references. Root `tsconfig.json` wires the three package references.
- Lint/format: **Biome** (`biome.jsonc` — `.jsonc` because `biome.json`
  itself does not allow comments), not ESLint+Prettier. Rationale: this is
  a greenfield monorepo with no existing ESLint plugin ecosystem to
  preserve, and 2026 tooling consensus is that Biome is the simpler default
  for exactly that case (single Rust binary, formatter+linter+import
  organizer in one config, ~10-25x faster than ESLint on this size of
  repo) — ESLint's remaining edge is deep plugin/type-aware-lint maturity
  for large existing codebases, which doesn't apply here. Provider-SDK
  import ban lives in `linter.rules.style.noRestrictedImports` (verified
  against a live `stripe` import: correctly errors), with a TODO comment
  naming the SDK packages to add as each adapter is built (T2/T4/T7/T8/T10)
  — confirmed set (retell-sdk, twilio, stripe, `@paypal/paypal-server-sdk`,
  `@sentry/node`) plus a list of package names still to verify against
  vendor docs before adding (Shopmonkey, ezyVet, Square, Apollo, Smartlead/
  Instantly, Outscraper). The rule is turned off inside
  `packages/adapters/**` via a Biome `overrides` block. Root `lint` script
  calls Biome directly rather than fanning it out through `turbo run lint`
  per package — Turborepo's own guidance recommends this "Root Task"
  pattern for a single fast whole-repo tool like this; a `//#lint` entry
  still exists in `turbo.json` so it can be invoked through turbo (with
  caching) later if that becomes worth it.
- Vitest: root `vitest.config.ts` uses the `projects` field (`workspace`
  files were deprecated in Vitest 3.2, replaced by `projects` — used
  `["packages/*", "apps/*"]` plus an explicit `exclude` for `dist/**` etc.,
  because a package's own compiled `dist/**/*.test.js` would otherwise be
  discovered alongside its `src/**/*.test.ts` source and every test would
  run twice). Wired into turbo via each package's `test` script
  (`vitest run`) and the `test` task in `turbo.json`.
- `.github/workflows/ci.yml`: five jobs — `typecheck`, `lint`, `test`,
  `build` (each: checkout → `pnpm/action-setup@v4` with no `version` input,
  since v4 reads the exact pinned `packageManager` field → `actions/
  setup-node@v7` with `cache: pnpm` → `pnpm install --frozen-lockfile` →
  the corresponding `pnpm run <task>`), plus `migrations-check` (counts
  `*.sql` files in `supabase/migrations/`; 0 today so it emits a notice and
  no-ops — once T1 adds migrations it runs `supabase/setup-cli@v3` and is
  ready for `supabase db lint`/`db diff --linked` to be wired in, gated on
  `SUPABASE_ACCESS_TOKEN`) and `rls-probe` (placeholder job that documents
  the contract T1 must satisfy — two tenants, a JWT with `tenant_id` in
  `app_metadata`, every cross-tenant read/write asserted to return 0 rows/
  be rejected by RLS — and exits 0; there is no database to probe yet).
- `.gitignore` (node_modules, dist, `.turbo`, coverage, `.env*` except
  `.env.example`, `supabase/.temp`, Playwright artifacts, OS/editor cruft).
- `.env.example`: every var named across SYSTEM_DESIGN §2/§3/§7 — Supabase
  (new publishable/secret key names, confirmed live: `sb_publishable_...`/
  `sb_secret_...` replace anon/service_role, deprecated by end of 2026),
  Retell, Twilio (incl. A2P 10DLC brand/campaign SIDs), Stripe (incl.
  Billing Meters event name), PayPal, ElevenLabs, Apollo, Outscraper,
  Smartlead, Instantly, Airtable (partner portal), Sentry, Anthropic
  (outreach personalization/intent classification) — each commented with
  what it's for.
- Root `README.md`: what Heyloo is, the monorepo map, how to run, pointer
  to `docs/`.

**Tool versions chosen, and why**

All verified live against npm/GitHub as of 2026-09-07 (Rule 1) rather than
assumed from training knowledge — several defaults had moved:

| Tool | Version pinned | Note |
|---|---|---|
| Node.js | ≥22 (`engines`), 22 in CI | Node 24 is the current Active LTS and Node 22 is now Maintenance LTS, but 22 is what this build environment actually has installed and was used to verify every command below; `engines` stays a floor, not a ceiling — bumping CI/local to 24 is a trivial follow-up, not a T0 blocker. |
| pnpm | 10.33.0 (`packageManager`, exact) | Matches what was pre-installed and verified in this sandbox; npm's registry shows 12.3.4 as latest. Pinning to what's actually verified beats pinning to whatever's newest and untested here — bump is a one-line follow-up. |
| Turborepo | 2.10.12 | Confirmed latest stable release (2026-08-25) via GitHub releases; `turbo.json` uses the current `tasks`/`$TURBO_DEFAULT$`/`$TURBO_ROOT$` schema (`pipeline` was the old key, long gone). |
| TypeScript | **5.9.3**, deliberately NOT 7.0.2 | 7.0.2 is npm's `latest` tag (the Go-rewrite, "Corsa") but it drops the Strada Compiler API entirely until 7.1 — many downstream tools (bundlers, framework type-checking integrations, potential future `typescript-eslint` use) depend on that API. Picking the newest tag over the pragmatic choice would risk breaking T5 (frontend, likely Next.js-adjacent) and any later wave that needs the compiler API. 5.9.3 is the current latest 5.x line — stable, universally compatible, still fully strict-mode capable. Revisit once 7.1's API story and ecosystem support land. |
| Biome | 2.5.12 | Confirmed latest; `preset: "recommended"` used (the boolean `rules.recommended` field is deprecated as of 2.5 and was verified to still parse but emit a deprecation warning — fixed before committing). |
| Vitest | 5.0.0 | Confirmed latest (released days before this build); `projects` field per current docs. |
| GitHub Actions | `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v4`, `supabase/setup-cli@v3` | Confirmed current major versions. |

**Deferred / left for later tasks**

- Real canonical types (agent state graph, tool contracts, domain model) —
  T2/T1. `packages/canonical-types` only proves the package builds.
- Real adapter packages — T2 onward. `packages/adapters/README.md` has the
  full planned list; do not scaffold ahead of the owning task.
- Real UI components, vertical templates, apps — T5/T6.
- Real migrations, RLS, Custom Access Token Hook, seed data — T1. Once
  that lands, `migrations-check` needs its `supabase db lint`/`diff`
  commands actually wired (flags verified against current docs) and
  `SUPABASE_ACCESS_TOKEN`/project linkage configured as a repo secret.
- `rls-probe` CI job needs its real test wired once T1's schema + RLS
  policies exist (SYSTEM_DESIGN §6/§7, CLAUDE.md Rule 2 — "CI cross-tenant
  probe must stay green").
- Node/CI bump from 22 to 24 (current Active LTS) is a safe, low-priority
  follow-up — not done here to keep this task's verified surface minimal.
- TypeScript 7 revisit once its Compiler API (7.1+) and ecosystem support
  (bundlers, any ESLint-family tool a later wave might add) are confirmed
  compatible — tracked here rather than guessed at.

## T1 — Full schema, RLS, functions/triggers, seed, RLS probe (Wave 1)

**What was built**

- 17 timestamped migrations in `supabase/migrations/` implementing the full
  data model from `docs/spec/BACKEND_SPEC.md` §0-§6 plus every
  `docs/spec/MASTER_SPEC.md` §3 gap-patch-pack addition: `customer_addresses`,
  `payment_links`, `messages_inbound`, `waitlist_entries`,
  `customers.sms_opt_out`/`consent`, `tenants.avg_transaction_value_cents`/
  `review_url`/`review_request_enabled`/`voice_reminders_enabled`/
  `a2p_status`, `bookings.identity_verified_by` (§3.7 identity fallback),
  `memberships.last_seen_notifications_at` (§2), and the six approved
  supporting tables (`demo_sessions`, `provisioning_runs`, `alerts`,
  `push_subscriptions`, `churn_scores`, `airtable_sync_state`). Split by
  domain; see `supabase/migrations/README.md` for the file-by-file map.
- All BACKEND_SPEC §3-§4 Postgres functions + triggers: Custom Access Token
  Hook, availability regeneration (pre-subdivided per vertical — 30-min
  default, dental 15-min via `resources.metadata`, motel per-night, 21-day
  window default / 30-day for motels per MASTER_SPEC §2), usage upsert,
  tenant-scoped realtime broadcast, availability invalidation on booking
  write, waitlist cancellation-notification (§3.4), customer segment
  recompute, referral qualification, cost rollup, customer touch, plus a
  new `fn_default_tenant_avg_ticket` trigger implementing MASTER_SPEC §3.8's
  per-vertical `avg_transaction_value_cents` defaults (auto 55000, vet
  17500, legal 250000, dental 65000, real_estate 800000, motel 12500,
  restaurant 4500, generic 10000).
- Full RLS: every one of the 49 tables has RLS enabled with a policy (the
  BACKEND_SPEC §5 matrix plus reasoned policies for the six new supporting
  tables and the MASTER_SPEC §3 additions — see comments in
  `20260907131500_rls.sql`), `fn_jwt_tenant_id`/`fn_jwt_role`/
  `fn_jwt_is_platform_admin`/`fn_jwt_referral_partner_id` helpers, and a
  `realtime.messages` policy gating the private `tenant:<tenant_id>`
  broadcast channel to that tenant's members (or a platform admin).
- Storage: private `recordings` bucket, no client-facing policy at all
  (signed-URL-only access pattern — `service_role` bypasses RLS by design
  on a Supabase project, so no policy is needed for the archival path
  either).
- Seed data (`supabase/seed/seed.sql`, wired via `supabase/config.toml`
  `[db.seed] sql_paths`): platform_settings price cards for all 8
  verticals (SYSTEM_DESIGN §1) + referral/usage-alert/segment-threshold
  config, and one demo tenant per vertical with resources, offerings, and
  business hours, each with a populated `availability_slots` window via
  `fn_regenerate_availability_slots`. No `auth.users`/`memberships` rows
  are seeded (no real or fake credentials at all) — a local signup/login
  flow or a manual `memberships` insert links a real account to a demo
  tenant.
- `scripts/ci/rls-cross-tenant-probe.ts`: authenticates as a real member of
  two freshly-created tenants (via GoTrue admin-create-user + password
  sign-in against the running Supabase instance, so it exercises the real
  Custom Access Token Hook end to end, not a hand-crafted JWT), seeds one
  row per tenant-scoped table that carries a `tenant_id`-scoped SELECT
  policy, and asserts every cross-tenant filtered read returns 0 rows both
  directions. Dependency-free by design (Node's built-in `fetch` against
  PostgREST/GoTrue HTTP APIs, no `@supabase/supabase-js`) and written in
  erasable-TypeScript syntax so it runs via
  `node --experimental-strip-types` with no build step and no new
  workspace dependency — `scripts/` is T1's exclusive path but the root
  `package.json`/pnpm workspace is not, so adding a dependency there was
  out of scope.
- `.github/workflows/ci.yml`: `migrations-check` now runs `supabase start`
  (applies every migration + seed against a fresh local Postgres in
  Docker) followed by `supabase db lint --fail-on warning`; `rls-probe` now
  runs `supabase start`, exports the local project's connection details
  from `supabase status -o env`, and runs the probe script above. Both
  still no-op cleanly (`::notice::`) when `supabase/migrations/` is empty,
  preserved from T0's placeholder shape.

**Verification performed (no Docker/`supabase start` available in this
environment — CLAUDE.md Rule 1 disclosure)**

This sandbox has no running Docker daemon (`docker ps` fails to reach the
socket), so `supabase start`/`supabase db lint` could not be run directly.
A plain `postgresql-16` server (not a Supabase-platform image) *was*
available, so verification ran as follows instead, which ended up
exercising more than a syntax check:

1. Built a local verification harness: `anon`/`authenticated`/
   `service_role` roles (the last with `BYPASSRLS`, matching a real
   Supabase project), default privilege grants, and minimal stub
   `auth`/`realtime`/`storage` schemas standing in for the tables/functions
   the real Supabase platform provides (`auth.users`, `auth.uid()`,
   `realtime.messages` + `realtime.broadcast_changes()`,
   `storage.buckets`/`storage.objects`) — none of which exist on a bare
   Postgres install. This harness lives only in this session's scratch
   space, never committed.
2. Applied all 17 real migration files verbatim, in order, via
   `psql -v ON_ERROR_STOP=1 -f`, with exactly one accommodation: a
   verification-only trimmed copy of the extensions migration with the
   `pg_cron`/`pgmq`/`pg_net` lines removed, since those three extensions
   are not installable on a bare (non-Supabase-image) Postgres — confirmed
   via `pg_available_extensions` (only `pgcrypto`/`btree_gist`/`uuid-ossp`
   present). Nothing that actually got created (functions, triggers,
   views, tables) references those three extensions' objects directly, so
   this omission doesn't mask anything. **Result: every migration applied
   with zero errors on the first clean pass** (after one real bug fix,
   below).
3. Applied `supabase/seed/seed.sql` verbatim — all 8 demo tenants,
   resources, offerings, and availability-slot generation succeeded.
   Spot-checked: `avg_transaction_value_cents` correctly auto-filled per
   vertical by the new trigger; slot counts matched expectations per
   vertical (e.g. the two-room demo motel produced exactly 62 slots = 2
   resources × 31 days of per-night slots; the 15-min dental chair
   produced far more slots than the 30-min default verticals; the
   restaurant's Monday closure was correctly honored).
4. Functional/regression testing well beyond syntax: the GIST exclusion
   constraint was confirmed to reject both an exact-overlap and a
   partial-overlap confirmed booking on the same resource while allowing
   the identical time slot on a *different* resource (no false positive);
   the idempotency-key unique constraint was confirmed to reject a retried
   booking; the availability-invalidation trigger was confirmed to flip
   the specific booked resource's slot to unavailable on confirm and back
   to available on cancel (an earlier test run that appeared to show this
   failing was traced to the test query not filtering by resource_id, not
   a schema bug — auto_repair's demo tenant has two bays); `fn_upsert_usage_daily`
   and `fn_check_referral_qualification` were called directly and returned
   without error.
5. **RLS was tested directly at the SQL level**, not just "policies exist":
   `SET ROLE authenticated` (never as the table-owning superuser, which
   bypasses RLS regardless of policy — a easy-to-miss invalidation of a
   naive local test) plus `set_config('request.jwt.claims', ...)` shaped
   exactly like the Custom Access Token Hook's output, mirroring what
   PostgREST does per-request. Verified: a tenant-A session reading its
   own `customers`/`offerings` succeeds; the identical filtered read
   against tenant B's id returns 0 rows across `customers`, `offerings`,
   and the `tenants` table itself; a cross-tenant `UPDATE` affects 0 rows;
   a cross-tenant `INSERT` is rejected with
   `new row violates row-level security policy`; a `platform_admin: true`
   session sees both tenants' rows; the `realtime.messages` tenant-channel
   policy was confirmed to filter to only the caller's own `tenant:<id>`
   topic once RLS was actually enabled on the (stub) table — a first pass
   without that ALTER TABLE step showed a false leak, which is a property
   of the stub (a real Supabase project ships `realtime.messages` with RLS
   already enabled by the platform; this migration deliberately only adds
   the policy, matching the documented pattern) and not of the policy
   predicate itself, which the corrected re-test confirmed is correct.
6. `scripts/ci/rls-cross-tenant-probe.ts` was syntax/type-checked by
   actually running it (`node --experimental-strip-types`) — it correctly
   reaches its env-var validation and exits — but was **not** run
   end-to-end against a real GoTrue+PostgREST instance in this
   environment (no Docker). Its logic exercises the identical policies
   verified directly in step 5 above, so the RLS guarantee itself has real
   coverage even though the probe script's own HTTP plumbing is unexercised
   here; the `rls-probe` CI job wired above will run it for real on the
   next push (GitHub-hosted runners ship Docker).

**Two real bugs found and fixed by this verification (not present in the
final committed migrations — both caught before commit):**

1. `fn_touch_customer` (shared trigger on `bookings` and `orders`)
   referenced `new.total_cents` unconditionally in its SQL text even though
   it's only meaningful for `orders` — `bookings` has no such column, and a
   `record`-typed trigger variable's field access is resolved per-row at
   runtime regardless of which branch of the surrounding `CASE` would use
   it, so **every booking insert with a `customer_id` set raised "record
   'new' has no field 'total_cents'"**. Fixed by reading the field via
   `to_jsonb(new)->>'total_cents'` (returns `NULL`, not an error, when the
   row type lacks that key).
2. `custom_access_token_hook`'s `jsonb_set(claims, '{app_metadata,tenant_id}', ...)`
   is a **documented Postgres no-op**, not an insert, whenever an
   intermediate path element (`app_metadata`) doesn't already exist in the
   target — only the final path segment gets created on demand. Confirmed
   directly: `jsonb_set('{"sub":"x"}'::jsonb, '{app_metadata,tenant_id}', '"T1"')`
   returns `{"sub":"x"}` unchanged. GoTrue's real hook payload is expected
   to already carry `app_metadata` (even as `{}`), so this likely wouldn't
   surface against a live Supabase Auth instance — but a silent failure to
   attach tenant scoping is precisely the kind of bug that must not be
   allowed to fail silently at the multi-tenancy boundary, so it's fixed
   defensively: the function now ensures `app_metadata` exists as an
   object before every `jsonb_set` call that writes under it. Verified
   with a claims payload carrying no `app_metadata` key at all.

Also fixed in the same file, found by inspection rather than by the test
run: the BACKEND_SPEC §3.2 `fn_regenerate_availability_slots` sketch's
`hours_exceptions`-closed-day handling had a logic bug — its
`coalesce(<exception row filtered to NOT closed>, business_hours fallback)`
falls through to normal business hours precisely on the days the filter
excludes (i.e. days marked `closed: true`), meaning a holiday closure would
have been silently ignored and slots generated anyway. Fixed by checking
for a closed exception explicitly and short-circuiting to an empty window
set for that day.

**Deviations from the literal spec sketches (design decisions, not bugs)**

- Dependency-ordering: `call_logs` before `booking_core` (bookings.
  source_call_id FKs into it), and `referrals`/`outreach` before `money`
  (commission_events/cac_events FK into referrals/leads) — BACKEND_SPEC's
  own §1.x numbering doesn't match the FK dependency order its own DDL
  requires.
- `custom_access_token_hook` and `fn_broadcast_tenant_update` are marked
  `security definer set search_path = ''` (not in the literal sketch) —
  without it, `supabase_auth_admin`/whatever role fires the broadcast
  trigger would hit RLS on `memberships`/`platform_admins`/
  `referral_partners` (for the hook) as a non-superuser, non-bypassing
  role and silently see zero rows, breaking the hook. This is the pattern
  Supabase's own custom-access-token-hook documentation uses.
- Availability slot subdivision (BACKEND_SPEC §3.2 `DECIDE:`) filled in
  concretely per MASTER_SPEC §2's resolution: 30-min default, motel
  per-night (whole-calendar-day slots, deliberately ignoring
  `business_hours` since front-desk hours aren't room availability), 21-day
  window default / 30-day motel; per-resource override via
  `resources.metadata->>'slot_minutes'` (used for the dental 15-min case).
- `tenant_a2p_status` (BACKEND_SPEC §10.1 `DECIDE:` between a tenants
  column vs. a new table) resolved as a `tenants.a2p_status` column, not a
  new table — MASTER_SPEC §2's list of approved new tables doesn't include
  it, and a single-value per-tenant state machine doesn't need its own
  table identity.
- `fn_touch_customer` is wired only to `bookings`/`orders` (not
  `call_logs`, despite the BACKEND_SPEC §4 trigger-inventory *table*
  listing all three) — `call_logs` has no `customer_id` column, so
  attaching it there would fail at runtime exactly like bug #1 above; the
  doc's own `CREATE TRIGGER` code sample also only gives two triggers, so
  this follows the code over the prose table.
- Added `fn_notify_waitlist_on_cancellation` (not explicitly given as a
  function in BACKEND_SPEC, but required to actually implement MASTER_SPEC
  §3.4's "cancellation trigger matches active entries" behavior — the spec
  describes this trigger's existence without providing its SQL).
- Added `bookings.identity_verified_by` (MASTER_SPEC §3.7 requires logging
  `verified_by='knowledge'` on the booking audit trail; no column for it
  existed in BACKEND_SPEC's `bookings` DDL).
- `push_subscriptions`/`churn_scores`/`airtable_sync_state`/`alerts`/
  `demo_sessions`/`provisioning_runs` RLS policies are new (BACKEND_SPEC's
  §5 matrix predates these tables' introduction later in the same doc) —
  reasoned individually per table, see comments in `20260907131500_rls.sql`.
- `scripts/ci/rls-cross-tenant-probe.ts` is plain-dependency erasable
  TypeScript rather than using `@supabase/supabase-js`, specifically
  because adding a new dependency requires editing the root
  `package.json`/pnpm workspace, which is outside T1's exclusive paths.

**Deferred / left for later tasks**

- Queues (pgmq named queues) and scheduled jobs (pg_cron schedules,
  BACKEND_SPEC §8-§9) — only their *extensions* are created here; T1's
  assigned scope is BACKEND_SPEC §0-§6. T3/T4 own the actual queue/cron
  wiring that consumes this schema.
- `supabase db diff --linked` (schema drift against a real hosted Supabase
  project) needs `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_ID` repo
  secrets that don't exist yet — tracked for `docs/DEPLOY.md`, not wired
  into CI here.
- Segment thresholds (`fn_recompute_customer_segment`) and alert-rule
  numeric constants remain literals, not yet exposed via
  `platform_settings` for admin tuning (BACKEND_SPEC §3.6 `DECIDE:` — real
  usage data should drive this, not a guess).
- Geocoding provider for `customer_addresses.geocode` (Geocodio vs Google)
  is still an open `VERIFY:` per MASTER_SPEC §3.0 — T3/T7's call at build
  time, not a T1 schema concern (the column is provider-agnostic `point`).
- The RLS probe script's HTTP plumbing (GoTrue admin-create-user,
  password sign-in, PostgREST reads) has not been exercised end-to-end
  against a real running Supabase instance in this environment — it will
  get real coverage on the first CI run with Docker available.

## T2 — Canonical types + Retell provider layer (Wave 1)

**What was built**

- `packages/canonical-types` (replacing T0's placeholder): Zod schemas + TS
  types for the canonical `AgentTemplate` (states/transitions/global_intents/
  tools, BACKEND_SPEC §1.3) with structural cross-validation (unique state
  ids/tool names, every `allowed_tools`/transition/global-intent reference
  resolves to a declared state or tool, `single_prompt` requires a non-empty
  `system_prompt`); MASTER_SPEC §3.5's 6 per-vertical
  `dynamic_variable_overrides` schemas (dental/vet/auto/legal/motel/
  restaurant, plus real_estate/generic on the shared base) via
  `dynamicVariableOverridesSchemaForVertical(vertical)`; §3.6's `consent`
  shape; the `VoiceProvider` interface (`ProviderCapabilities` flags,
  `InboundCallContext`/`InboundCallResolution`, `ToolCallRequest`/
  `ToolCallResult`, `CallEndedEvent` + `CanonicalCostBreakdown` with
  `granularity: 'exact'|'estimated'`, agent-lifecycle/phone-import
  input/result types); the 12-class call taxonomy enum
  (`CALL_CLASSIFICATIONS`); request/response schemas for every voice tool in
  BACKEND_SPEC §7.2 plus MASTER_SPEC §3.0 `create_order` (delivery orders
  hard-require `delivery_address`, structurally enforced by a `.check()`)
  and §3.2 `send_payment_link`; a generic `InboundWebhookEnvelope` factory
  for webhook dedup; E.164 (`zE164`/`normalizeToE164`, NANP-only best-effort
  normalization — no libphonenumber dependency, zero-runtime-deps-beyond-zod
  constraint) and money (`zCents`/`zSignedCents`/`centsFromDollars`/
  `formatCentsUSD`/`addCents`) helpers; a generic `VoiceProviderError`
  taxonomy (`SignatureVerificationError`, `PayloadValidationError`,
  `DisclosureGateError`) every adapter is expected to throw. 126 tests across
  9 files, every schema exercised with both valid and invalid fixtures.
- `packages/adapters/retell` (new — T0 had scaffolded no adapter packages
  yet, per its README's "do not scaffold ahead of the owning task" rule):
  `RetellProvider implements VoiceProvider` (`provider.ts`), a dependency-free
  REST client with exponential-backoff retry on 429/5xx and typed,
  non-retryable errors on 4xx (`client.ts`), HMAC webhook-signature
  verification (`signature.ts`, `v={ts},d={hex}` over `raw_body+timestamp`,
  5-minute replay window, `timingSafeEqual` comparison), inbound-call
  resolve/build (`inbound.ts`), tool-call verify+parse+build (`tool-call.ts`,
  G6 caller-number extraction for the `lookup_customer` authorization
  cross-check), `call_ended` webhook verify+parse+cost-normalization
  (`call-events.ts`), agent lifecycle create/update/publish (`agents.ts`,
  the real two-step Retell protocol: create/update the underlying
  conversation-flow-or-retell-llm resource, THEN create/update the agent
  whose `response_engine` references it), Twilio-number import
  (`numbers.ts`), and **the template compiler**
  (`compiler/{conversation-flow,multi-prompt,single-prompt}.ts` +
  `disclosure-gate.ts` + `index.ts`): lowers one canonical `AgentTemplate`
  into Retell's shape per `compile_target`, injects `disclosure_line`
  verbatim into the first turn's text at compile time (start node's
  instruction for `conversation_flow`, starting state's `state_prompt` for
  `multi_prompt`, the very first line of `general_prompt` for
  `single_prompt`), and lowers `global_intents` into Retell's global-node
  mechanism for `conversation_flow` (marking the target node `global_node:
  true` when `reachable_from: "any"`, or adding explicit edges from a scoped
  list) and into universal-reachability edges for `multi_prompt` (no
  separate global-node primitive there) or textual escape instructions for
  `single_prompt` (no graph at all). The disclosure gate is a pure,
  non-throwing structural self-check (`verifyDisclosureGate` /
  `CompiledAgentPayload.disclosureVerified`); the actual HARD refusal to
  call Retell lives at the publish boundary — `createOrUpdateRetellAgent`
  throws `DisclosureGateError` and makes zero HTTP calls when the gate
  failed. 95 tests across 14 files: golden-file snapshot tests (one fixture
  per compile_target — auto/conversation_flow, legal/multi_prompt,
  real_estate/single_prompt, matching SYSTEM_DESIGN §4.1's vertical->engine
  mapping) plus contract tests on hand-built fixture webhook payloads for
  every VERIFY-flagged shape below, plus REST-flow tests against a mocked
  `fetch` for the client/agents/numbers/provider orchestration.
- `docs/VERIFY.md` (new): every assumed Retell wire shape (VERIFY-1 through
  VERIFY-8 — webhook signature scheme, inbound-call/tool-call/call-lifecycle
  webhook envelopes, cost-breakdown fields, agent-lifecycle REST shapes,
  phone-number import, and the Conversation-Flow/Retell-LLM node/edge
  schema itself) with its source (indexed WebSearch snippet vs. the spec
  docs' own prior research), what's confirmed vs. assumed, and what a later
  build agent must verify against a live sandbox before go-live.
  `docs.retellai.com` was confirmed live-blocked
  (`EGRESS_BLOCKED` from `WebFetch`) in this environment per CLAUDE.md
  Rule 1 item 2, so every shape traces to either the already-Rule-1-researched
  spec docs or an indexed WebSearch snippet, never invented from memory.
  VERIFY-8 (the Conversation-Flow/Retell-LLM wire schema itself) is flagged
  as the highest-risk item — this codebase's own internally-consistent
  modeling, structurally sound but with field names T4 must confirm against
  a live sandbox before the first real publish.

**Deviations / gaps found and fixed (Rule 4)**

- Root `vitest.config.ts`'s `projects` glob (`["packages/*", "apps/*"]` at
  the time T2 started, plus `"supabase/functions"` added by a concurrent
  task) did not include `packages/adapters/*` — a real gap, since
  `pnpm-workspace.yaml` already covers that path and a root `vitest run`
  would otherwise silently skip every adapter package's tests. Fixed by
  adding `"packages/adapters/*"` to the glob.
- Discovered (and fixed, in both `packages/canonical-types` and
  `packages/adapters/retell`) a duplicate-test-execution bug inherent to
  this monorepo's shape: each package's `build` script (`tsc -b`) emits
  compiled `.test.js` files into `dist/` alongside `.d.ts` declarations;
  turbo's `test` task runs each package's own `vitest run` with no
  package-local exclude, so `dist/**/*.test.js` gets discovered and run a
  *second* time next to `src/**/*.test.ts` (confirmed directly: 18 files/
  252 tests instead of 9/126 for canonical-types alone). The root
  `vitest.config.ts` already documents this exact failure mode and excludes
  `dist` — but that exclude only applies to a single root-level `vitest
  run`, not to turbo's per-package invocation. Fixed with a small
  package-local `vitest.config.ts` (excluding `dist`/`.turbo`/`coverage`) in
  both of this task's packages, mirroring the root config's own comment and
  exclude list.
- `packages/adapters/retell/package.json` needed `@types/node` (Node
  globals — `fetch`, `Response`, `Buffer`, `node:crypto` — aren't declared
  without it); pinned to `22.20.1` to match the version `supabase/functions`
  (T3) already uses, for consistency.

**Deferred / left for later tasks**

- VERIFY-1 through VERIFY-8 in `docs/VERIFY.md` — every one needs
  confirmation against a live Retell sandbox account before its dependent
  code path (T3's edge functions consuming `RetellProvider`, T4's
  provisioning saga performing the first real agent publish) goes live.
  VERIFY-8 (Conversation-Flow/Retell-LLM wire field names) is the highest
  risk and should be confirmed first.
- `RetellProvider.createOrUpdateAgent`'s update-in-place path (`PATCH
  /update-agent/{id}`) does not yet handle API_AND_FLOWS.md A.1's flagged
  "a flow shared by multiple agents propagates to all of them" /
  "`PATCH /update-conversation-flow/{id}` can 400 on a flow already
  referenced by a published agent version" cases — T4's provisioning saga
  (which owns retries/compensation) must confirm the safe multi-tenant
  update pattern (one flow per tenant vs. one flow per template version
  shared across tenants' agents) against a staging workspace first, per
  that doc's own note.
- `RetellProvider` does not implement `GET /get-call` (nightly
  reconciliation) or `GET /get-concurrency` — both explicitly T3/cockpit
  scope per BUILD_PLAN Wave 1 (T3) and SYSTEM_DESIGN §11, not named among
  T2's required `VoiceProvider` methods. `normalizeCostBreakdown`
  (`call-events.ts`) is exported and reusable by T3's reconciliation job
  once it fetches a `get-call` response, so no duplicate cost-normalization
  logic should be needed there.
- `packages/adapters/twilio` (A2P 10DLC, number search/purchase, Lookup
  API) is explicitly T2-4/T3/T4 per `packages/adapters/README.md`'s table
  but was not built here — T2's assignment text scoped this task to
  `packages/adapters/retell` only ("packages/adapters/retell: the
  RetellProvider..."); Twilio's own adapter is left for whichever of T3/T4
  actually needs to call it first, per the README's existing table.

## T3 — Voice hot path, webhooks, admin, workers, jobs (Wave 1)

**What was built** — every edge function named in the task, under
`supabase/functions/`: `voice-inbound`, `voice-tools` (all 9 tools:
`check_availability`, `create_booking`, `update_booking`, `cancel_booking`,
`lookup_customer`, `take_message`, `send_sms_confirmation`, `create_order`
§3.0, `send_payment_link` §3.2), `voice-events`, `webhooks-stripe`,
`webhooks-twilio-sms` (§3.3 STOP/HELP/inbound), `webhooks-outreach`,
`webhooks-pos` (dispatch shell + Square's real `handleWebhook`),
`api-demo-agent` (two-phase scrape/confirm per MASTER_SPEC's review-first
patch), `api-provision` (7-step saga + `provisioning_runs`),
`forwarding-verify`, `admin` (single-function router; Tenants + Alerts
groups fully implemented, the other seven BACKEND_SPEC §7.7 groups return
an explicit `501` shell rather than a guessed shape), plus queue workers
(`worker-messages-outbound`, `worker-recording-fetch`, `worker-adapter-push`)
and cron jobs (`job-reconciliation`, `job-billing-cycle`,
`job-reminder-scheduler` §3.6 with quiet hours, `job-review-request` §3.9,
`job-retell-health-failover` §8/G5, `job-alert-evaluation` §8 — 3 of its 7
alert rules implemented with real data sources, the other 4 need inputs
this build doesn't have, see below). `supabase/config.toml` gets a
`[functions.*]` `verify_jwt` block for every function, cross-checked
against BACKEND_SPEC §7's table per-function (triple-checked per CLAUDE.md's
explicit warning that the old repo died on this).

**Deno/Node split (how `pnpm run typecheck/lint/test` exercises Deno code)**
— `supabase/functions` has its own `package.json`/`tsconfig.json`/`deno.json`
now (added to `pnpm-workspace.yaml` and the root `vitest.config.ts`
`projects` array). Every function is split into a portable `handler.ts`
(pure business logic, dependency-injected `SqlClient`/fetch functions, zero
Deno globals or `npm:`/`jsr:` specifiers — typechecked by `tsc` and unit
tested by Vitest under Node exactly as it runs in Deno) and a thin Deno
`index.ts` entrypoint (`Deno.serve`, `Deno.env.get`, `EdgeRuntime.waitUntil`,
`npm:postgres`/`npm:zod` specifiers — excluded from
`supabase/functions/tsconfig.json` and never unit tested, since neither
`deno` nor `supabase` CLI is installed in this build environment; reviewed
by hand instead). `_shared/` mirrors this: portable modules at the top
level, Deno-only glue under `_shared/deno/`. Result: 253 tests across 43
files, `tsc --noEmit` clean, `biome check` clean (0 errors — some
`useLiteralKeys` infos deliberately left un-auto-fixed where the "fix"
would remove the bracket notation `noPropertyAccessFromIndexSignature`
requires). Documented what ran since `deno check`/`deno test` couldn't
(commit note; also see the assignment's own allowance for this).

**Provider isolation deviation (documented, not silent)** — CLAUDE.md Rule
2 confines provider-SDK imports to `packages/adapters/*`, but that's a Node
package graph; the Deno Edge Function runtime can't import a pnpm workspace
package without a bundling step this task doesn't add (and T2's concurrent
`packages/adapters/retell` build confirmed this is genuinely a separate,
Node-side boundary, not something to route around). Every provider call
here instead goes through a lean `_shared/providers/<vendor>.ts` module
(Retell, Twilio, Stripe, PayPal, Anthropic, Resend, Square) built on plain
`fetch` — no SDK dependency at all, so none of these trip the
`noRestrictedImports` rule, and they stay off the hot path's dependency
weight. Webhook signature verification (Retell/Twilio/Stripe/Square) is
similarly hand-rolled against each vendor's published algorithm rather than
SDK-based, both for leanness and because it's testable with the standard
Web Crypto API (`crypto.subtle`, no dependency) under both Deno and Node —
see `_shared/retell-signature.ts`/`twilio-signature.ts`/
`stripe-signature.ts`/`providers/square.ts`, each with fixture-vector unit
tests (RFC 4231/2202 HMAC test vectors for the underlying primitives, plus
hand-built valid/tampered/stale/wrong-secret cases per scheme).

**Rule 1 (docs-first)** — every vendor doc site was egress-blocked in this
environment (`WebFetch` returned `EGRESS_BLOCKED` for
`docs.retellai.com`/`supabase.com`/`docs.stripe.com`/`www.twilio.com`);
`WebSearch` (server-side, not blocked) was used instead to pull third-party
summaries for the highest-risk items (Retell/Twilio/Stripe signature
schemes, Supabase `EdgeRuntime.waitUntil`/pgmq). Every item is logged in
`docs/VERIFY.md` with its confidence level and what to re-check before
go-live — most signature schemes landed at "high confidence" (long-stable,
independently-corroborated public contracts, confirmed against real HMAC
test vectors in this build's own tests) while Retell's exact concatenation
order, Square's signature shape, and several REST payload field names stay
explicitly flagged as unconfirmed guesses.

**Schema cross-check against T1's actual migrations (important — read this
before trusting BACKEND_SPEC's prose over the real schema)** — T1's
migrations landed concurrently with this build. Rather than code against
BACKEND_SPEC/MASTER_SPEC's prose and stop there, every table this build
touches was re-checked against the real `supabase/migrations/*.sql` files
once they existed, and several real mismatches were found and fixed (see
`docs/VERIFY.md`'s "Schema/coordination items" section for the full list):
`messages_inbound`'s real column names (`from_e164`/`to_e164`/
`twilio_message_sid`, not the guessed `from_number`/`to_number`/
`provider_message_id`), `tenants.review_request_enabled` (not
`review_requests_enabled`), `provisioning_runs.status` enum value
`succeeded` (not `done`), `customers.consent`/`sms_opt_out` as top-level
columns (not nested under `metadata`), and `demo_sessions`' real shape
(`scraped_summary`/`agent_config_snapshot` jsonb columns and no `status`
enum at all — `api-demo-agent` derives pending-vs-confirmed from whether
`retell_call_token` is set). `create_order`'s delivery-radius check was
upgraded from a stub to actually read `customer_addresses.geocode` (a
native Postgres `point`, confirmed present) for the caller side once that
table's real shape was visible. `tool_health` (needed by the circuit
breaker's stat emission and by one of `job-alert-evaluation`'s rules)
remains a genuine gap — not in T1's migrations and not in MASTER_SPEC §2's
approved-table list either; both call sites degrade gracefully (silently
no-op) rather than throwing, but the table still needs to be added by a
follow-up migration for tool-health telemetry/alerting to actually work.

**MASTER_SPEC §3.7 identity fallback** — implemented in
`update_booking`/`cancel_booking`: when the live caller's number differs
from the booking's own customer number, an optional `verify: {full_name,
appointment_time}` tool argument is checked (case-insensitive name match +
same-UTC-minute time match) before any write; on match,
`bookings.identity_verified_by` is set (`phone_match`/`knowledge`); on
failure, the tool declines without reading back any other customer PII.
The "two failed attempts → take-message" escalation from MASTER_SPEC §3.7
is left as a conversation-flow/prompt-layer policy (the tool itself simply
declines each time; deciding to pivot to `take_message` after N declines is
the compiled template's job, not server-side attempt-counting state) —
noted as a deliberate scope boundary, not an oversight.

**Hot-path discipline (SYSTEM_DESIGN §5)** — `voice-tools/index.ts` wraps
every dispatch in a module-scope `ToolCircuitBreaker` (per-tool rolling
60s window, opens above a 20% error rate, 30s cooldown/half-open retry) and
a hard 1.5s `Promise.race` abort; both paths return the same graceful
`{fallback:true, message}` envelope, never a non-200, matching BACKEND_SPEC
§7.2 exactly. `voice-inbound` does a single indexed read with zero
timezone math at request time (`_shared/business-hours.ts` precomputes the
greeting string from the tenant's IANA timezone + weekly hours +
exceptions, unit tested against DST-relevant fixtures). Every write is
idempotent: `create_booking`/`update_booking` rely on the GIST exclusion
constraint (never check-then-insert) and catch `23P01`/`23505` to return
the race-winner's row; `create_order` mirrors the same pattern against
`orders_idempotency_unique`.

**Deferred / left for later tasks / follow-ups**
- `tool_health` table (see schema section above) — needed for real
  per-tool latency/error telemetry and for `job-alert-evaluation`'s
  `tool_failure_spike` rule to ever fire.
- Seven of `admin`'s nine BACKEND_SPEC §7.7 endpoint groups (margin
  cockpit, Config Lab, Referral P&L, CAC, Templates, Support, Outreach,
  Feature flags) return `501 not_implemented` rather than a guessed
  response shape — Templates in particular needs T2's compiler wired in
  first (agent publish), and the cockpit views need real drill-down query
  design, not a placeholder.
- `worker-adapter-push`'s `ADAPTER_PUSHERS` registry is empty (Wave-3/T7
  scope per `packages/adapters/README.md`) — every push currently dead-
  letters after 6 attempts; this is intentional (never silently succeeds)
  but means no adapter push actually delivers yet.
- Waitlist "YES" auto-book reply (MASTER_SPEC §3.4) is not wired in
  `webhooks-twilio-sms` — a bare "YES" is stored as an ordinary inbound
  message today; matching it to a notified `waitlist_entries` row and
  auto-booking via `create_booking`'s same idempotent path is a follow-up.
- `api-provision`'s `compileTemplate`/`resolvePhoneNumberToProvision`
  dependencies are stand-ins (a direct `agent_templates` row read; an
  empty string that fails loud) — T2's real Retell compiler and a real
  Twilio available-numbers search need wiring in once those are reachable
  from Deno (see the provider-isolation note above).
- `job-retell-health-failover`'s Twilio-number-restoration-on-recovery step
  only clears the incident flag today (see its own docstring) — actually
  re-establishing Retell routing on recovery needs the exact Retell
  phone-import routing mechanism confirmed first (`docs/VERIFY.md`).
- Admin impersonation (`POST /admin-tenants/:id/impersonate`) enforces the
  AAL2 gate and writes the audit-log row, then returns `501` rather than
  minting a real scoped session — the Supabase Auth Admin API mechanism
  for that needs confirming before it's wired in.
- Root `pnpm run lint` currently fails on one pre-existing formatting nit
  in `scripts/ci/rls-cross-tenant-probe.ts` (T1's file, unrelated to this
  task) — left untouched per scope discipline; `biome check
  supabase/functions` (this task's actual surface) is clean.

## T6 — Vertical agent templates + red-team suite (Wave 2)

**What was built** — `packages/templates/` (touched exclusively; no other
path modified except adding `@heyloo/adapter-retell`/`@types/node` as
devDependencies + a package-local `vitest.config.ts` mirroring the pattern
already established in `packages/canonical-types`/`packages/adapters/retell`):

- **Shared building blocks** (`src/shared/`): `disclosure.ts` (the one
  `DISCLOSURE_LINE` constant every template composes `{{business_name}}` +
  `{{assistant_name}}` into, per SYSTEM_DESIGN §14's persona-name salvage);
  `fragments.ts` (SYSTEM_DESIGN §4.5 silence/give-up/escalation/warm-
  transfer/low-confidence rules, §4.3's one-field-at-a-time/digit-by-digit
  rules, and MASTER_SPEC §3.4/§3.5/§3.6/§3.7's waitlist/cancellation-policy/
  consent/identity-fallback fragments — task item 2's "silence/give-up/
  escalation rules... encoded as prompt-fragment constants shared across
  templates"); `tools.ts` (one builder per canonical voice tool, so every
  template gets identical JSON-Schema + `authorization.scope`, which is
  what makes the red-team suite's cross-template invariants — not just
  per-template spot checks — actually hold); `global-intents.ts` and
  `utility-states.ts` (shared `human_request`/`solicitor`/generic-emergency
  targets + the `manage_booking` reschedule/cancel branch, reused by every
  vertical); `system-prompt.ts` (composes a vertical intro with the shared
  fragments).
- **The 8 vertical templates** (`src/verticals/`), each a typed
  `AgentTemplate` conforming to `@heyloo/canonical-types`' `zAgentTemplate`:
  auto repair / dental / motel / restaurant = `conversation_flow`; veterinary
  = `conversation_flow` + a global `emergency` intent (`reachable_from:
  "any"`) targeting a dedicated red-flag-triage-FIRST state sequence; legal
  = `multi_prompt` with the no-advice guardrail + `legal_advice_given`
  extraction appended to literally every state (including the shared
  transfer/solicitor/emergency ones) via a `withLegalGuardrail` map, not
  left to just the system prompt; real estate / generic = `single_prompt`.
  Every template declares all three required global intents
  (`emergency`/`human_request`/`solicitor`), each `reachable_from: "any"`;
  every booking-capable template's `manage_booking` state carries the
  MASTER_SPEC §3.7 identity-fallback rule; every booking/order-capable
  template's system prompt carries the §3.6 consent ask and the
  cancellation-policy read-out; restaurant wires both `create_booking`
  (reservations) and `create_order` (MASTER_SPEC §3.0, with an explicit
  allergy ask + full read-back + delivery-radius-decline handling in
  prompt); motel wires `send_payment_link` for deposits (§3.2) plus the
  `nearest_alternative` no-availability UX; dental's system prompt defers
  DOB/insurance to a secure post-call form link (PHI stays out of the
  transcript).
- **Registry + build artifact** (task item 4): `src/registry.ts` exports
  `TEMPLATE_DEFINITIONS`/`TEMPLATE_REGISTRY` (key/name/version/template);
  `src/scripts/generate-build-artifact.ts` runs as a post-`tsc -b` step
  (wired into `package.json`'s `build` script) and writes
  `dist/templates.build.json` — every template is re-validated against
  `zAgentTemplate` before being written, so the artifact can never contain
  content that wouldn't pass the same gate a real `agent_templates` insert
  applies. This is the seed-script-consumable export the provisioning saga
  needs; no seed script itself was built (out of T6's stated scope — "a
  seed script OR export").
- **Red-team suite** (`src/red-team/`, task item 3): `structural.test.ts`
  asserts every guarantee directly against the canonical `AgentTemplate`
  (disclosure composition, all three global intents present and
  `reachable_from: "any"` on every template, `lookup_customer` scoped
  `caller_number`, `transfer_call` declared with ZERO parameters and
  `tenant_config_only` scope on every template that has it, the legal
  no-advice guardrail present on every legal state, vet triage-FIRST
  ordering, dental PHI deferral, restaurant allergy-ask + dual booking/
  order tools, motel rate discipline, consent/identity-fallback/waitlist
  fragments present wherever their trigger condition applies);
  `compiler-gate.test.ts` covers the one guarantee that genuinely needs the
  T2 compiler — every template compiles with `disclosureVerified: true` for
  its own `compile_target` — via `RetellProvider.compileTemplate` (the
  adapter's public `VoiceProvider` method), never touching the Retell-
  shaped `providerPayload` (CLAUDE.md Rule 2 stays intact: no
  provider-specific shape is imported/narrowed outside `packages/
  adapters/*`); `prompt-lint.ts` statically flags leftover `${...}`
  template-literal syntax or an unrecognized `{{...}}` placeholder across
  every prompt fragment and tool description (the "no template-injection
  sinks" check); `injection-fixtures.ts` is a typed dataset of adversarial
  caller-turn strings + the structural `expectation` each should uphold;
  `README.md` documents how a future task would wire this dataset into
  Retell's batch-simulation API (already flagged `supportsBatchSimulation
  Testing: true` on `RETELL_CAPABILITIES`) as a CI gate — per the task's
  explicit boundary, this package does **not** call Retell itself.

**Gaps found and the decision taken (CLAUDE.md Rule 4 — documented, not
redesigned)**

- **Vertical naming mismatch, T1 vs T2** — T1's real migration
  (`supabase/migrations/20260907130100_tenancy.sql`) constrains
  `tenants.vertical` to `('auto_repair','veterinary','legal','dental',
  'real_estate','motel','restaurant','generic')` (matching BACKEND_SPEC's
  prose and this task's own wording), but `@heyloo/canonical-types`'
  `vertical.ts` (T2, already merged) declares `VERTICALS = ["auto","vet",
  "legal","dental","real_estate","motel","restaurant","generic"]`, and
  `dynamicVariableOverridesSchemaForVertical` switches on those SHORT names
  to pick a vertical's `zAgentTemplate.tools`... `dynamic_variable_overrides`
  Zod schema. Since `zAgentTemplate.vertical` is `zVertical.or(z.string().
  min(1))` (any non-empty string validates), both spellings would pass
  schema validation, but only the short form (`"auto"`/`"vet"`) makes
  `dynamicVariableOverridesSchemaForVertical` resolve to the CORRECT
  per-vertical schema instead of silently falling through to
  `zGenericOverrides`. Decision: every template's `vertical` field uses
  the canonical-types short form (`"auto"`, `"vet"`, ...) — the literal
  contract this task was told to conform to — while file/registry-key
  naming stays close to this task's own wording (`auto-repair.ts` /
  `AUTO_REPAIR_TEMPLATE` / registry key `"auto_repair"`) for
  discoverability. Whichever task wires `TEMPLATE_REGISTRY` into a real
  `agent_templates` seed insert will need to either update T1's check
  constraint to the short names or translate at insert time — flagged here
  rather than silently guessed.
- **No dedicated waitlist tool** — MASTER_SPEC §3.4 describes offering a
  waitlist on `none_available`, and T1 already has a real `waitlist_entries`
  table + a cancellation-trigger notifier (confirmed in T3's own
  `cancel_booking.ts` docstring), but no `join_waitlist` voice tool exists
  in `@heyloo/canonical-types`' `TOOL_NAMES` (only the 9 tools BACKEND_SPEC
  §7.2/MASTER_SPEC §3.0/§3.2 actually specify). Every template's waitlist-
  offer fragment therefore routes the caller's waitlist request through
  `take_message` (with a `"Waitlist request:"`-prefixed message) rather
  than a real `waitlist_entries` insert — flagged as a follow-up worth a
  dedicated tool once volume justifies it, not silently modeled as if a
  real tool existed.
- **Motel rate table / restaurant catalog are dynamic variables, not tool
  calls** — SYSTEM_DESIGN §4.3 says "rate only from the owner-configured
  rate table via tool call" and "items from tool-backed catalog only", but
  there is no `get_rate_table`/`get_menu` tool in the canonical tool set;
  per SYSTEM_DESIGN §5 ("static context... rides in dynamic variables at
  call start — zero tool calls"), both are modeled as `{{rate_table}}`/
  `{{menu_text}}` dynamic variables instead, with an explicit prompt rule
  never to invent a price/item beyond what's given (and, for restaurant,
  `create_order`'s existing server-side item validation as the real
  backstop regardless of what the model says). Noted inline in
  `verticals/motel.ts`'s docstring too.
- **Dynamic-variable coverage gap in `@heyloo/canonical-types`** — the
  templates reference `{{cancellation_policy_text}}`, `{{tow_partner_name}}`
  /`{{tow_partner_phone}}`, `{{species_treated}}`, `{{emergency_referral_
  name}}`/`{{emergency_referral_phone}}`, `{{vehicle_makes_serviced}}`,
  `{{practice_areas}}`, `{{consult_fee_text}}`, `{{deposit_policy_text}}`,
  `{{rate_table}}`, and `{{menu_text}}` — all MASTER_SPEC §3.5 per-vertical
  config or the shared cancellation-policy field — but T2's
  `AgentDynamicVariables` zod schema (`voice-provider.ts`) only enumerates
  the base fields (`business_name`, `assistant_name`, `manager_name`, etc.)
  and does not yet flatten `agent_configs.dynamic_variable_overrides`'
  per-vertical keys into the actual dynamic-variables map sent to Retell.
  This doesn't block authoring templates (Retell's dynamic-variable
  mechanism is just a key/value map; the template layer only needs the
  variable's name), but whichever task wires `/voice/inbound`'s resolver
  end-to-end needs to widen that flattening — flagged rather than silently
  assumed to already work.
- **Root-level `pnpm run typecheck`/`lint`/`test` were NOT fully green at
  the time this task ran** them, but not because of anything in
  `packages/templates/`: this branch had concurrent, uncommitted Wave-2
  work in progress from other tasks touching `supabase/functions/**`
  (`admin/handler.ts`, `_shared/compiler/template-compiler.test.ts`,
  `api-a2p-register`, `webhooks-stripe`) and `packages/ui/**` — a stale
  `UI_PACKAGE_VERSION` test expectation, a raw-SQL tagged-template misuse,
  and a couple of test/implementation mismatches in in-progress A2P/dunning
  logic, all outside this task's exclusive path. Verified in isolation:
  `pnpm --filter @heyloo/templates build|typecheck|test` and `biome check
  packages/templates` are all clean (104 tests passing); `@heyloo/
  canonical-types` and `@heyloo/adapter-retell` also build/typecheck clean
  independently. Per CLAUDE.md Rule 4 (scope discipline), none of the
  other tasks' in-progress files were touched to make the ROOT command
  green — that would mean editing outside this task's exclusive path on a
  shared, actively-being-edited branch.
