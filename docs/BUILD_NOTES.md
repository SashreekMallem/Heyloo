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
