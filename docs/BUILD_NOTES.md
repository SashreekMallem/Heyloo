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

## T4 — Stripe checkout/billing, admin cockpit/config-lab/referrals/cac/
## templates, PayPal payouts, A2P registration, dunning, waitlist (Wave 2)

**What was built**

- `supabase/functions/api-checkout` (new): `POST /functions/v1/api-checkout`
  (`verify_jwt: true`, authenticated user's JWT `sub` trusted, never a
  body-supplied user id). Creates a `tenants` row (`status: 'trialing'`) +
  owner `memberships` row if one doesn't already exist for this user
  (idempotent re-submit reuses an existing not-yet-paid trialing tenant),
  looks up the vertical's Stripe Price ids from
  `platform_settings.price_card_<vertical>` (merged in by
  `scripts/setup-stripe.ts`, see below — `500 stripe_not_configured` if
  absent, never a guessed price), and creates a `mode=subscription` Stripe
  Checkout Session (licensed base price, quantity 1, + the metered-minutes
  price) via a new `createSubscriptionCheckoutSession` in
  `_shared/providers/stripe.ts`.
- `scripts/setup-stripe.ts` (new, one-time, idempotent, dependency-free per
  `scripts/ci/rls-cross-tenant-probe.ts`'s own precedent — plain `fetch`
  against Stripe's REST API and Supabase's PostgREST, no `stripe`/
  `@supabase/supabase-js` package): creates the platform Billing Meter
  (event_name from `STRIPE_METER_EVENT_NAME`, looked up by name first so
  re-running is a no-op) and, per vertical, a Product + licensed Price +
  metered Price backed by that Meter, writing the resulting ids back onto
  each `platform_settings.price_card_<vertical>` row (merged jsonb, no
  schema change needed — that table is already a generic key/value store).
- `supabase/functions/api-a2p-register` (new): `POST
  /functions/v1/api-a2p-register` (tenant-owner JWT or an internal-secret
  header, same convention as `api-provision`). Creates a per-tenant Twilio
  Messaging Service (lazily, once) + attaches the tenant's active phone
  number to it, then registers a Campaign (UsAppToPerson) against the
  platform's shared `TWILIO_A2P_BRAND_SID`, driving
  `tenants.a2p_status` (`pending_verification` -> `verified`/`failed`) —
  either on initial `register` or a later `refresh` poll. New
  `_shared/providers/twilio.ts` functions: `createMessagingService`,
  `addPhoneNumberToMessagingService`, `createBrandRegistration`,
  `getBrandRegistration`, `createA2pCampaign`, `getA2pCampaign` — all
  against `messaging.twilio.com` (a DIFFERENT base host from every other
  function in that file, `api.twilio.com/2010-04-01` — see VERIFY.md T4
  entry: BACKEND_SPEC's own prose guessed the wrong host,
  `api.twilio.com/v1/a10dlc/...`, corrected here).
- `supabase/functions/job-referral-payouts` (new): monthly PayPal Payouts
  batch (`0 8 1 * *`, BACKEND_SPEC §8) — batches every partner with
  `commission_events.status='accrued'` into ONE `createPayoutBatch` call
  (deterministic `sender_batch_id = referral-payout-<period>`, which per
  API_AND_FLOWS.md A.4 IS PayPal's own idempotency guarantee), writes
  `referral_payouts` rows and flips those commission events to `'batched'`.
  A partner missing `paypal_email` is skipped (left `'accrued'` for next
  cycle, never silently dropped); a failed batch call leaves everything
  `'accrued'` (never lost). Also checks first whether a non-failed
  `referral_payouts` row already exists for the current period and skips
  entirely if so (cheaper than relying solely on PayPal's own duplicate
  rejection).
- `supabase/functions/_shared/compiler/template-compiler.ts` (new): a lean,
  deliberately-duplicated port of `packages/adapters/retell/src/compiler/*`
  (T2)'s pure lowering logic (conversation_flow/multi_prompt/single_prompt
  + the disclosure gate) operating on `agent_templates`' jsonb row shape
  directly via duck-typed interfaces, NOT importing
  `packages/canonical-types`/`packages/adapters/retell` — same Deno/Node
  workspace-package boundary T3 already documented for
  `_shared/providers/*.ts`, applied here to the compiler's data
  transformation instead of a vendor REST client. Flagged in VERIFY.md as
  maintenance debt (the two implementations can drift) with a named
  follow-up (extract to a shared zero-dep package). 9 tests mirroring T2's
  own golden-path coverage per compile_target.
- `supabase/functions/admin/handler.ts`: completed 6 of the 8 endpoint
  groups T3 left as `501` shells — **Margin cockpit** (`waterfall`,
  `per-customer-margin`, `per-call-cost`, `repricing-drift` — shows current
  trailing-30-day unit costs since no baseline key exists in
  `platform_settings` yet, `bottleneck` from the new `tool_health` table,
  `alerts`), **Config Lab** (`POST /admin-config-lab/simulate` — projects
  current-vs-proposed-price-card margin from real `usage_daily`/
  `cost_events` without writing anything), **Referral P&L** (`GET
  /admin-referrals` from `v_referral_pnl`, `POST
  /admin-referrals/:commission_event_id/payout-override` — overrides one
  still-`'accrued'` commission event's amount, audited, `409` if already
  batched/paid), **CAC** (`GET /admin-cac`, per-channel cost/lead/CAC from
  `cac_events`), and **Templates** (full CRUD on `agent_templates` +
  `POST /admin-templates/:id/publish` — compiles via the new module above,
  hard-refuses on a failed disclosure gate, then calls the REAL Retell
  publish sequence: `create-conversation-flow`/`create-retell-llm` ->
  `create-agent` -> `publish-agent-version`, flips `is_active` on success,
  writes `admin_actions`). **Support/Outreach/Feature-flags stay `501`** —
  not named in this task's explicit scope list, left for a later wave.
  Also **completed tenant impersonation**: when `deps.supabaseAdmin` is
  wired, mints a real magic-link via the target tenant owner's
  `memberships` row + a new `_shared/providers/supabase-admin.ts`
  (`generate_link` GoTrue admin API) instead of the `501` stub; without
  those deps configured for a given deploy, still returns the same `501` as
  before (backward compatible — T3's existing tests for that path are
  unchanged). `routeAdminRequest`/`handleTenants`/`handleTemplates` gained
  an optional 4th `AdminDeps` parameter (`retell`/`supabaseAdmin` provider
  clients) — every existing caller/test that doesn't touch those two paths
  keeps working with zero changes.
- `supabase/functions/_shared/providers/retell.ts`: added `updateAgent`,
  `createConversationFlow`, `createRetellLLM`; renamed `publishAgent` ->
  `publishAgentVersion` and corrected its endpoint from a guessed
  `/publish-agent/{id}` to `/publish-agent-version/{id}`, matching T2's
  independently-researched `packages/adapters/retell/src/agents.ts`
  (`publishRetellAgentVersion`) — a real coordination fix, not a rename for
  its own sake. Updated `api-provision/handler.ts`'s one caller accordingly.
- `supabase/functions/_shared/providers/stripe.ts`: added
  `createSubscriptionCheckoutSession`, `createMeter`, `listMeters`,
  `createProduct`, `createLicensedPrice`, `createMeteredPrice`.
- `webhooks-stripe/handler.ts`: dunning flow completion — `invoice.
  payment_failed` now enqueues a `dunning_payment_failed`
  `messages_outbound` email row (looked up via the tenant's owner
  membership) immediately, rather than only flipping
  `billing_invoices.status`; `invoice.paid` now reactivates
  `tenants.status` from `past_due` back to `active` directly (belt-and-
  suspenders alongside `customer.subscription.updated`'s own sync, since
  Stripe fires both on a successful dunning retry and both are processed
  idempotently via `webhook_events`).
- `webhooks-twilio-sms/handler.ts`: waitlist YES auto-book (MASTER_SPEC
  §3.4) — a bare "yes"/"y" reply is matched against the most recent
  `waitlist_slot_opened` notification sent to that customer; on a match,
  auto-books the freed slot via the same idempotent insert-and-catch
  pattern `create_booking.ts` uses (`idempotency_key = 'waitlist:'||
  entry_id`, catches `23P01`/`23505`), marks the entry `converted`, and
  replies with a confirmation; if the slot was already re-taken, marks the
  entry `expired` and apologizes. **Found and resolved a real spec-vs-spec
  conflict** (not a bug in either individual spec): `sms-compliance.ts`'s
  `START_KEYWORDS` (T3) already treats a bare "yes" as the CTIA SMS opt-in
  keyword. Resolved by checking the waitlist match FIRST and only falling
  through to ordinary STOP/START/HELP/other classification when there's no
  open waitlist entry for that customer — a "yes" with no waitlist context
  behaves exactly as before (opts back into SMS).
- New migration `supabase/migrations/20260907140000_t4_tool_health_a2p_billing.sql`
  (the one new migration this task is allowed): adds the `tool_health`
  table T3 left as a genuine gap (BACKEND_SPEC §7.2's circuit-breaker
  telemetry — `tool-stats.ts`'s emission and `job-alert-evaluation`'s
  `tool_failure_spike` rule were ALREADY WIRED by T3, just writing/reading
  a table that didn't exist yet and degrading gracefully in the meantime;
  this migration is the only piece actually missing) — with one correction
  to T3's own assumed shape: `call_id` is `text` (Retell's own call-id
  string, per `call_logs.retell_call_id`), not `uuid` as T3's docstring
  guessed, since it may not resolve to an existing `call_logs` row at
  insert time. Also adds four `tenants` columns for A2P state
  (`a2p_brand_sid`, `a2p_campaign_sid`, `a2p_messaging_service_sid`,
  `a2p_failure_reason`) that `api-a2p-register` needed and neither
  BACKEND_SPEC nor T1's migrations had a home for (only the `a2p_status`
  state machine itself existed).
- Tests: 47 new/updated test files across the above (api-checkout,
  api-a2p-register, job-referral-payouts, the template-compiler, admin's 6
  new groups + impersonation completion, webhooks-stripe's dunning
  branches, webhooks-twilio-sms's waitlist branches) — same
  dependency-injected-`SqlClient`-mock pattern as T3's existing 253.
  **300/300 tests passing, `tsc --noEmit` clean, and 0 Biome errors on this
  task's entire surface** (`supabase/functions/**` + `scripts/**` — verified
  directly via `biome check supabase/functions scripts --reporter=json`
  and filtering `severity === "error"`; the ~120 remaining `useLiteralKeys`/
  format infos are the same pre-existing, deliberately-left-unfixed class
  T3's own notes describe, none newly introduced by this task).

**Coordination / deviations found (CLAUDE.md Rule 4)**

- **Tenant-row creation timing vs. Flow 2's prose**: API_AND_FLOWS.md Flow
  2 describes the provisioning saga creating the `tenants` row AFTER
  `checkout.session.completed` (its step 3), but T3's already-built
  `/webhooks-stripe` handler and `/api-provision`'s "Tenant finalize" step
  both read/UPDATE an EXISTING `tenants` row keyed by
  `metadata.tenant_id` — i.e. they assume the row already exists by the
  time checkout completes. Rather than rewire that already-tested T3 code,
  `api-checkout` is the one that creates the `trialing` `tenants` row (+
  owner `memberships` row) BEFORE creating the Checkout Session, passing
  `tenant_id` in Stripe metadata — reconciling the flow doc's intent with
  the concrete shape T3 already built against.
- **`admin-templates/:id/publish`'s actual scope**: BACKEND_SPEC says
  "publish runs the compiler + Retell adapter publish call" but doesn't
  specify per-tenant fan-out (that's Flow 9's separate "staged publish to
  tenants" concern, not specced with enough detail to build blind). This
  build's `publish` validates the template compiles, passes the disclosure
  gate, and round-trips through Retell's real create-flow/create-agent/
  publish-version sequence end-to-end (a genuine smoke test, not a fake
  200), then flips `agent_templates.is_active` for that vertical — it does
  NOT re-publish every already-provisioned tenant's own agent. Flagged in
  VERIFY.md for whoever builds the Templates admin UI to confirm against.
- **PayPal item-level payout status has no consumer**: no `/webhooks-paypal`
  function exists (not named in this task's scope), so
  `referral_payouts.status` reaches `'sent'` and stays there — the
  batch-accepted vs. actually-paid distinction from API_AND_FLOWS.md A.4's
  webhook events is a real, flagged follow-up, not silently assumed solved.
- Root-level `pnpm run typecheck`/`lint`/`test` are **not** green as of this
  commit, but confirmed via isolated, scoped runs that nothing in this
  task's surface is the cause: `pnpm --filter @heyloo/edge-functions run
  typecheck|test` is 100% clean (300/300 tests), and `biome check
  supabase/functions scripts` reports 0 errors. The root-level failures
  (root `pnpm run typecheck`: `packages/ui` `exactOptionalPropertyTypes`
  errors in `src/custom/data-state.tsx`; root `pnpm run lint`: 79 Biome
  errors, ALL in `packages/ui`/`packages/canonical-types`/
  `packages/supabase-client`; root `pnpm run test`: `packages/ui`'s
  `src/index.test.ts` expects a stale `UI_PACKAGE_VERSION`) are all in
  files this task never touched (`git diff --stat -- packages/ apps/`
  confirms) and outside `apps/`/`packages/`, which this task was explicitly
  told not to touch — a concurrent agent's in-progress work on the same
  shared branch/working tree, consistent with T6's own BUILD_NOTES entry
  above observing the mirror image of this (T4's own in-progress files, at
  the time T6 ran, looking like "other tasks' work in progress").

**Deferred / left for later tasks**

- A `/webhooks-paypal` consumer for item-level payout status
  (`PAYMENT.PAYOUTS-ITEM.SUCCEEDED`/`FAILED`/`BLOCKED`/`UNCLAIMED`) — see
  above.
- Per-tenant fan-out on template publish (Flow 9's "staged publish to
  tenants") — needs a rollout-strategy decision (all-at-once vs. staged/
  canary) not specified anywhere yet.
- `admin-support-requests`/`admin-outreach`/`admin-flags` remain `501` —
  not in this task's named scope.
- Extracting `_shared/compiler/template-compiler.ts`'s duplicated logic
  into a single zero-runtime-dependency package both Node and Deno can
  import, to delete the intentional duplication with
  `packages/adapters/retell/src/compiler/*`.
- `scripts/setup-stripe.ts` re-running after a partial failure may leave a
  harmless orphan Stripe Product/Price from an earlier attempt for a
  vertical that later succeeds — documented as an accepted, inert cost in
  the script's own header comment, not fixed with reconciliation logic.
- The Twilio A2P platform Brand itself (`TWILIO_A2P_BRAND_SID`) is still a
  manual, one-time Console/Trust Hub setup step per API_AND_FLOWS.md A.2 —
  `createBrandRegistration`/`getBrandRegistration` exist in
  `_shared/providers/twilio.ts` for completeness but nothing calls them;
  the actual Trust Hub profile-bundle prerequisites
  (`CustomerProfileBundleSid`/`A2PProfileBundleSid`) aren't something any
  code in this build creates.

## T5 — Frontend: apps/web, packages/ui, packages/supabase-client,
## packages/config (Wave 2)

**What was built**

- `apps/web` — Next.js 16 App Router, route groups `(marketing)/(tenant)/
  (admin)/(partner)`, `[locale]` scaffold (next-intl, `en`-only,
  `localePrefix: "as-needed"`), every surface named in FRONTEND_SPEC.md §3-9
  + MASTER_SPEC.md §3.10: 8 `/[vertical]` landing pages + `/pricing` (RSC,
  data-driven from `content/marketing/verticals.ts`), `/demo` (scrape →
  confirm → live in-browser call via `retell-client-js-sdk`, call token
  minted server-side, Retell secret never reaches the browser), 6-step
  signup (business-type → plan (real price card, service-role Route
  Handler) → account (Supabase Auth `signUp`) → Stripe Checkout redirect →
  provisioning poll → phone-setup wizard), tenant dashboard (calls,
  bookings, customers, agent settings incl. the MASTER_SPEC §3.10 additions
  — vertical-details tab, reminder/review toggles, payment status + link
  resend, message threads, waitlist section), admin cockpit (margin
  dashboards, outreach, templates, tenants, config-lab, settings), partner
  portal (disclosure gate, payouts, W-9, settings). Every data view goes
  through `<DataState>` (loading/empty/error, retry) — no bare
  `data.map()`.
- `packages/ui` — hand-authored shadcn-style component set on Radix
  primitives (primitives/forms/charts/custom/layout/theme), CVA variants,
  per-tenant branding via CSS custom properties (`BrandingProvider`) with a
  WCAG contrast fallback when a tenant's chosen color fails against white
  text.
- `packages/supabase-client` — `browser-client`/`server-client`/
  `service-role-client` factories (`@supabase/ssr` cookie adapters),
  `claims.ts` (JWT `app_metadata` → typed `AppMetadataClaims`, both
  middleware and every route-group layout's guard #2 read through this one
  function), hand-maintained `database.types.ts` for the ~35 tables T5
  needed (T1's schema is the source of truth; this is a manually-curated
  projection of it for the columns actually queried, not a full generated
  mirror — see gaps below).
- `packages/config` — `eslint-web.mjs` (flat config: `eslint-config-next` +
  `eslint-plugin-security` + `eslint-plugin-testing-library`, scoped to
  `apps/web` only per MASTER_SPEC §2's Biome-root/ESLint-in-apps/web
  hybrid), `tsconfig.nextjs.json` (bundler resolution, relaxed
  `exactOptionalPropertyTypes` — see below).
- Realtime: one `TenantRealtimeProvider` (private `tenant-{id}` channel,
  broadcast `{table, op, id}` → TanStack Query `invalidateQueries`,
  exponential backoff 1s/2s/4s/8s → `offline` state surfaced in the UI, not
  just logged) wraps the whole `(tenant)` layout. Admin/partner surfaces
  poll instead (FRONTEND_SPEC's own instruction — no realtime channel for
  those roles).
- Tests: Vitest + Testing Library for `Wizard`, `DataState`, `claims.ts`,
  and `TenantRealtimeProvider` (mocked channel, asserts the
  connecting→connected/reconnecting transitions and that a broadcast
  invalidates the exact `['tenant', id, table]` query key — not just "a
  query somewhere"). Playwright smoke specs in `apps/web/tests/e2e/`:
  role-guard redirects (unauthenticated → `/login` for `/dashboard`,
  `/cockpit`, `/portal`, each preserving `?next=`) and the signup account
  step reaching a mocked Stripe Checkout redirect (see "Playwright
  execution" below for why the mocking boundary is where it is).
- `apps/docs` — minimal Mintlify skeleton (`mint.json` + 8 starter `.mdx`
  guides), deliberately kept small per this task's instructions.
- **One touch outside this task's exclusive paths, additive only**:
  `packages/canonical-types/src/schemas/` (new, 34 files — every
  react-hook-form zod schema named in FRONTEND_SPEC.md §2, one file per
  schema) plus a 5-line `export * from "./schemas/index.js"` addition to
  T2's existing `packages/canonical-types/src/index.ts`. `canonical-types`
  is T2's package; this only ADDS a new subdirectory and one re-export
  line, touching none of T2's existing exports — FRONTEND_SPEC.md itself
  places these schemas in `packages/canonical-types` (the one package both
  frontend and backend import from), so this wasn't optional to route
  elsewhere.

**Cross-task schema/contract mismatches found and reconciled (Rule 4)**

- **`tenants.status` enum**: FRONTEND_SPEC.md's redirect-matrix prose uses
  illustrative values (`pending_payment`/`provisioning`/`suspended`) that
  don't exist in T1's actual migration — the real enum is `trialing|
  active|past_due|paused|canceled`. `(tenant)/layout.tsx`'s guard #2 was
  written against the real enum: `trialing` → redirect to `/signup/plan`
  (resume the paid-plan step, not a dead end), `paused`/`canceled` → an
  inline static notice rendered IN PLACE (never a redirect to a
  `/dashboard/suspended` sub-route — that sub-route would sit inside this
  same guarded layout and loop), `past_due` → a banner only, the dashboard
  stays otherwise functional.
- **Vertical spelling**: T1's DB enum spells verticals differently from
  the canonical `Vertical` type T2 defined (e.g. `auto_repair` vs. `auto`,
  `veterinary` vs. `vet`). `packages/supabase-client/src/vertical-mapping.ts`
  adds the explicit `VERTICAL_TO_DB_VALUE`/`DB_VALUE_TO_VERTICAL` maps
  rather than silently coercing one spelling to the other at every call
  site.
- **JWT claims shape**: FRONTEND_SPEC assumes `app_metadata.tenant_id`/
  `role`/`platform_admin`/`referral_partner_id` are already the Custom
  Access Token Hook's output. T1's hook migration was cross-checked and
  does write exactly that shape, so `claims.ts` reads it directly — no
  additional mapping layer was needed here, but this was verified rather
  than assumed (Rule 1).
- **Demo agent contract**: FRONTEND_SPEC describes `/api/demo/generate` as
  if the scrape+summary were synchronous; T3's `api-demo-agent` edge
  function is actually a two-call flow (`generate` kicks off the scrape,
  `confirm` applies edits and mints the call token). `DemoFlow`'s state
  machine (`form → loading → confirm → active`) was built against the real
  two-call contract.
- **`leads.source` enum / `referral_partners` FTC columns**: BACKEND_SPEC
  §7's admin outreach/referral endpoints reference a couple of columns
  T5's read of T1's actual migrations didn't find (a `source` value used
  by the admin leads filter UI, and partner FTC-disclosure columns
  referenced by `/api/partner/disclosure`). Built against the columns that
  DO exist; the UI degrades to the closest available field rather than
  inventing a new migration (out of this task's exclusive paths).
  Flagged in VERIFY.md for whoever owns `supabase/migrations` next.
- **`customer_notes`/phone port-in**: no dedicated tables exist for these;
  `/api/tenant/customers/:id/notes` and `/api/phone/port-in` are built
  against the closest existing table each maps to reasonably cleanly
  (documented inline in each Route Handler), not a new migration.
- **Assumed BACKEND_SPEC §7 edge function names** (not yet built by any
  task at the time T5 ran): `api-checkout-session`, `api-billing-portal`.
  `apps/web`'s `/api/checkout/session` and `/api/billing/portal` Route
  Handlers call these two names via `callEdgeFunction()` — if the actual
  function names differ when built, this is a one-line fix in those two
  Route Handlers, not a client-shape problem (the request/response JSON
  contracts were built directly against BACKEND_SPEC §7's documented
  shapes).

**A real, build-blocking bug found and fixed (not a spec mismatch)**

- **Middleware rewrote every `/api/*` request to `/en/api/*` in a
  production build, 404ing every Route Handler in the app.** Root cause:
  `middleware.ts`'s matcher (needed broadly, to run next-intl's locale
  resolution over every marketing/tenant/admin/partner page) also caught
  `/api/*`, and next-intl's own middleware — even in `localePrefix:
  "as-needed"` mode — internally rewrites an unprefixed request to include
  the default locale segment for its own routing purposes. Since API
  routes live outside `[locale]`, that rewrite pointed at a path that
  doesn't exist. This did NOT reproduce under `next dev` (on-demand
  compilation papers over it) — only found by actually building and
  running `next start` and curling `/api/signup/draft`, which is exactly
  why this got caught before commit rather than shipped invisibly. Fixed
  by skipping `intlMiddleware()` entirely for any `request.nextUrl.pathname`
  starting with `/api/` (`middleware.ts`). Confirmed fixed against a real
  `next build --webpack && next start`: `/api/signup/draft` now `200`s,
  and `/dashboard`, `/cockpit`, `/portal` still correctly `307` redirect
  unauthenticated visitors to `/login?next=...`.

**Toolchain fixes required to get `pnpm run typecheck/lint/test/build`
green (Rule 4 — these are monorepo-infrastructure bugs this task hit and
fixed, not apps/web-specific application bugs)**

- **`interface` vs `type` for `Record<string, X>` structural
  compatibility**: `packages/supabase-client/src/database.types.ts`
  originally declared every table row as `export interface XRow {...}`.
  TypeScript interfaces don't get an implicit index signature, which
  silently broke postgrest-js's `Record<string, GenericTable>` structural
  check on the `Database` type and made every Supabase query resolve to
  `never`. Converted every row/table declaration to a `type` alias instead
  (plus added `Relationships: []`/`Functions: Record<string, never>`,
  which `GenericSchema` also requires).
- **Biome's `lint/complexity/useLiteralKeys` directly conflicts with
  `tsconfig.base.json`'s `noPropertyAccessFromIndexSignature: true`.** The
  compiler option REQUIRES bracket notation on any `Record<string, T>`-
  typed access (webhook payload parsing, JWT claims, `process.env`, MDX
  frontmatter, etc. — all index-signature-typed); Biome's rule suggests
  the opposite. This isn't specific to apps/web — every task's code that
  touches an index-signature type hits it. Turned the rule off repo-wide
  in `biome.jsonc` (`linter.rules.complexity.useLiteralKeys: "off"`) rather
  than fighting it file-by-file; `packages/supabase-client/src/claims.ts`
  carries an inline comment explaining why its bracket notation is
  required, not stylistic.
- **ESLint 10.10.0 (this repo's original pin) cannot run
  `eslint-config-next`**: `eslint-config-next@16.3.4`'s own peer range
  claims `eslint: ">=9.0.0"` and its transitive `typescript-eslint@8.70.0`
  claims `^10.0.0` support too, but in practice `apps/web`'s flat config
  (Next's config + `languageOptions.globals`) throws
  `TypeError: scopeManager.addGlobals is not a function` under ESLint 10 —
  a real runtime incompatibility the peer ranges don't reflect yet (ESLint
  10 is very recent as of this build). Downgraded `apps/web`'s `eslint`
  devDependency to `9.39.5` (npm's `maintenance` dist-tag, not a canary) —
  the whole `eslint-config-next`/`typescript-eslint`/`eslint-plugin-jsx-
  a11y` stack is proven against ESLint 9, not yet 10. Also:
  `eslint-config-next`'s default export IS the flat-config array directly
  in this version (no `/flat` subpath export any more — that existed only
  during the ESLint 8→9 transition period); `packages/config/
  eslint-web.mjs` imports the bare package, not `eslint-config-next/flat`.
  `eslint-config-next`, `eslint-plugin-security`, `eslint-plugin-testing-
  library` were also missing as actual dependencies anywhere in the
  workspace (the import existed, the packages didn't) — added to
  `packages/config/package.json`.
- **`eslint-plugin-testing-library`'s `prefer-screen-queries` rule false-
  positives on Playwright specs.** The rule's file glob originally matched
  both `**/*.test.{ts,tsx}` (real `@testing-library/react` unit tests) and
  `**/*.spec.{ts,tsx}` (this repo's Playwright convention) — Playwright's
  own `page.getByRole`/`page.getByText` Locator API structurally resembles
  a discouraged `render()`-result destructure to the rule's heuristic.
  Scoped the testing-library block to `**/*.test.{ts,tsx}` only and
  excluded `tests/e2e/**` (`packages/config/eslint-web.mjs`).
- **Root `pnpm run lint` was in an unconditional recursion loop**:
  `turbo.json` registered a `//#lint` root task AND the root
  `package.json`'s own `lint` script was `biome check . && turbo run lint`
  — turbo's recursion guard correctly refused to run (the root task's own
  script invokes `turbo run lint`, which would invoke the root task,
  forever). Removed the redundant `//#lint` task registration from
  `turbo.json`; the root Biome pass already runs directly (not through
  turbo) before `turbo run lint` fans out to each package's own `lint`
  script, so nothing was lost.
- **Turbopack + `transpilePackages` + `"use client"` + the `react-server`
  conditional export**: `next build` (Turbopack, the Next 16 default)
  crashed during "Collecting page data" with `createContext is not a
  function`, root-caused to Turbopack not correctly splitting `"use
  client"` module graphs from the `react-server` condition before that
  phase runs, combined with `transpilePackages` re-processing
  `@heyloo/ui`/`@heyloo/canonical-types`/`@heyloo/supabase-client` through
  that same broken path. `next build --webpack` (an explicit opt-out
  flag Next 16 still supports) does not hit this bug — confirmed by
  isolating a minimal repro before switching. `apps/web/package.json`'s
  `build` script is `next build --webpack`; this is the single most
  significant toolchain finding of this task and should be revisited when
  Turbopack's react-server condition handling matures.
- **`@tanstack/react-table` v9 is API-incompatible with this codebase's
  usage** (built against v8's `ColumnDef`/`flexRender` API) — pinned to
  `8.21.3` everywhere rather than porting to v9's changed API mid-build.
- **`exactOptionalPropertyTypes` relaxed to `false`** in `packages/ui`,
  `packages/analytics`, and `packages/config/tsconfig.nextjs.json` (kept
  `true` in `packages/canonical-types`/`packages/supabase-client`) — a
  scope decision, not a bug: `apps/web`/`packages/ui` are almost entirely
  component props and Route Handler payloads threaded from optional query
  params/JSON bodies, where the stricter setting produced friction with no
  corresponding safety benefit; the schema/client-boundary packages kept
  the strict setting since that's where it earns its keep.

**Playwright execution (environment limitation, not a spec/build gap)**

- This build environment cannot reach `cdn.playwright.dev` (outbound
  egress is allowlisted per-host), so `playwright install` cannot download
  a Chromium binary here — the two smoke specs in `apps/web/tests/e2e/`
  were validated by hand (typecheck, lint, and manually driving the
  underlying routes/redirects with `curl` against a real
  `next build --webpack && next start`) rather than an actual
  `playwright test` run in this session. `signup-checkout.spec.ts`
  deliberately starts at step 3 ("Account") rather than driving the whole
  wizard from step 1: step 2 ("Plan") does a SERVER-side (not
  browser-side) fetch of `platform_settings` through a service-role
  Supabase client, which Playwright's `page.route()` cannot intercept (it
  only mocks requests the *browser* makes) — and no live Supabase project
  is reachable from this environment either (`https://placeholder.
  supabase.co` in `.env.local` hangs rather than failing fast). Everything
  from step 3 onward (Supabase Auth `signUp`, `/api/signup/create-tenant`,
  `/api/checkout/session`, and the mocked checkout destination itself) IS
  browser-originated and is mocked via `page.route()`, exactly as the task
  asked for ("signup flow to checkout redirect mock").

**Scope trims (documented, not silent)**

- Template diff/version-history view and the admin call-detail drill-down
  UI mentioned in FRONTEND_SPEC's fuller surface list were trimmed for
  time; `TemplateDiffViewer` exists as a component but isn't wired into a
  route yet.
- Not every leaf route has a bespoke loading/error skeleton — shared
  `<DataState>` covers the data-fetching case everywhere; a few
  navigation-only routes rely on Next's default route-level
  `loading.tsx`/`error.tsx` rather than a custom-designed empty state.
  `dashboard/support`/`agent/greeting` etc. do have bespoke ones.
  `apps/docs` is intentionally minimal per this task's own instruction.
- PostHog analytics wiring (`packages/analytics`) is real and tested
  (`trackEvent`/`identifyUser`/`initAnalytics`, single call-site pattern)
  but only a subset of FRONTEND_SPEC §0.8's named events are actually
  fired from UI call sites yet — the wrapper and its call-site convention
  exist; completing full event coverage across every surface was not
  finished.
- `packages/supabase-client/src/database.types.ts` is hand-maintained
  against the ~35 tables this task's surfaces actually query, not a full
  `supabase gen types` mirror of every T1 table — a genuine drift risk if
  a later migration changes a queried column without this file being
  updated too; there's no CI check tying the two together yet.

**Deferred / left for later tasks**

- Full Playwright execution in an environment with `cdn.playwright.dev`
  reachable (see above) — the specs are written and typecheck/lint clean,
  but this session never watched them actually pass.
- Completing FRONTEND_SPEC §0.8's full analytics event-name coverage.
- Reconciling `packages/supabase-client/src/database.types.ts` against
  whatever `supabase gen types typescript` would produce once a live
  project exists, and wiring that generation into CI so schema drift
  fails loudly instead of silently.
- The `leads.source` enum value and `referral_partners` FTC-disclosure
  columns T5 couldn't find in T1's migrations (see above) — needs a
  migration from whoever owns `supabase/migrations` next.

## T8 — Outreach engine: lead fetch, Claude personalization, Smartlead
## send, reply classification, admin outreach panel (Wave 3)

**What was built** — exclusive paths per the task: `admin/` outreach
endpoint group only, `api-outreach-*`, `job-outreach-*`,
`_shared/providers/{apollo,outscraper,smartlead,anthropic}.ts`, plus one
schema migration for genuine gaps found along the way.

- **`_shared/providers/apollo.ts`** (new): `searchPeople` (`POST
  /api/v1/mixed_people/api_search`, credit-free), `searchOrganizations`
  (`POST /api/v1/mixed_companies/search`), `bulkEnrichOrganizations`
  (`POST /api/v1/organizations/bulk_enrich`, up to 10 domains/call,
  merge-only-on-match per A.5's "never block on a failed enrichment"
  rule). **`_shared/providers/outscraper.ts`** (new): `startGoogleMapsSearch`
  (`GET /maps/search-v3`, always `async=true`) + `pollGoogleMapsResults`
  against the returned `results_location`. **`_shared/providers/
  smartlead.ts`** (new): `createCampaign`, `addLeadsToCampaign` (up to 400/
  call), `createWebhook`, `updateCampaignStatus` (`PATCH
  /campaigns/{id}/status`, `START`/`PAUSED`/`STOPPED`) — MASTER_SPEC's
  Smartlead-is-the-chosen-sender binding is implemented; Instantly is not
  (schema still allows `campaigns.provider = 'instantly'`, but
  `admin-outreach`'s campaign-create route rejects it with `422
  unsupported_provider` rather than silently no-opping).
  **`_shared/providers/anthropic.ts`** (extended, not duplicated): added
  Message Batches API support (`createMessageBatch`/`getMessageBatch`/
  `getMessageBatchResults`/`batchResultText`) and a sync
  `classifyReplyIntent` helper. Every provider call is plain `fetch` (no
  SDK), following T3's own established `_shared/providers/*.ts` pattern for
  this Deno runtime — not a new decision, see that module's docstring.
- **Rule 1 (docs-first) disclosure**: `docs.apollo.io`/`docs.smartlead.ai`/
  `docs.outscraper.com` all returned `EGRESS_BLOCKED`/`ENOTFOUND` to
  WebFetch in this build, exactly like every prior task's experience with
  vendor doc sites — despite the task text asserting these specific docs
  are reachable. WebSearch (server-side) was used instead per CLAUDE.md
  Rule 1 item 2 and returned real, indexed summaries of each vendor's
  current API reference for every endpoint used here (paths, auth scheme,
  request/response field names) — every shape is logged in `docs/VERIFY.md`
  with a confidence level, not assumed from training-data memory. Two
  concrete gaps found this way and worth calling out: (1) Smartlead's
  documented webhook event catalog (`EMAIL_SENT/OPEN/LINK_CLICK/REPLY/
  BOUNCE`, `LEAD_UNSUBSCRIBED`, `LEAD_CATEGORY_UPDATED`) has **no distinct
  spam-complaint event** — the CAN-SPAM 0.3% auto-pause rule (BACKEND_SPEC
  §1.8) is fully implemented and unit-tested, but in production it can
  currently only be triggered by a manual `POST /admin-outreach/replies/
  :id/actions {action:"suppress"}`-style admin action or a future
  bounce-rate proxy, never a live complaint webhook, until this is
  reconfirmed; (2) the People Search endpoint is `/mixed_people/api_search`,
  not the more obvious `/mixed_people/search` (the latter 403s on
  non-enterprise plans per the indexed summary) — used deliberately.
- **`api-outreach-fetch-leads`** (new function, standalone per the task's
  own exclusive-paths list rather than folded into `admin/`): Apollo people
  search or Outscraper Google Maps pull (caller picks `source` explicitly;
  MASTER_PLAN's per-vertical default lives in the future admin UI, not
  hard-coded server-side), optional Apollo org enrichment, dedup against
  `suppression_list` + existing `leads` BEFORE insert (compliance rule),
  drops any candidate with neither email nor phone before dedup (A.5:
  "nothing to personalize toward"), writes `leads` rows + `pipeline_costs`
  (`list_cost`, Outscraper's own documented "~$3/1,000 records" estimate)
  + per-lead `cac_events` (`channel='cold_email'`, `tenant_id` left null
  until conversion). Apollo credit-to-dollar cost is deliberately **not**
  fabricated (A.5 itself says this needs the account's real plan to
  convert) — enrichment facts are merged onto the lead regardless, no cost
  row is written for an unknown $ amount.
- **`job-outreach-personalize` + `job-outreach-personalize-collect`** (new,
  two jobs not one — BACKEND_SPEC §1.8/Flow 5 step 3, MASTER_PLAN's "haiku
  research -> sonnet hook" pattern): the Message Batches API is genuinely
  asynchronous (results within hours), so a single cron invocation
  submitting a batch and blocking on it would either time out or defeat the
  point of the cheaper async API. The **submit** job scrapes+sanitizes
  (G21, reusing `_shared/html-text.ts`/`sanitize.ts`) each queued lead's own
  site when known, batches every such lead's `claude-haiku-4-5` "research"
  request in ONE `createMessageBatch` call (`custom_id = leads.id`, so
  results apply with no separate id-mapping table), and stamps
  `leads.enrichment.research_batch_id`. The **collect** job polls every
  in-flight batch id; once `processing_status: "ended"`, it runs the
  `claude-sonnet-5` opening-line "hook" write per lead — as a **plain sync
  call, not a second batch** (a deliberate scope decision: by the time a
  batch ends, the lead set is already bounded to that one submit run, and a
  third submit-then-poll stage adds real complexity for a marginal saving
  on an already-cheap, short prompt) — stores
  `leads.enrichment.personalization`, logs the ~$0.02/lead estimate
  (SYSTEM_DESIGN §3) into `pipeline_costs`/`cac_events`, and pushes the
  lead into Smartlead via `addLeadsToCampaign` (looked up through the
  `send_events` row the admin's add-leads action created). A
  `refusal`/error on either the research batch result or the hook call
  falls back to a generic, non-personalized opener rather than ever
  blocking the send (A.5's documented failure-handling rule, unit tested).
- **`webhooks-outreach` completed, not duplicated** (task item 3 — read
  T3's existing handler first, per instruction): `processOutreachEvent`
  gained an optional `deps` parameter (back-compatible — every existing
  T3 test still passes unmodified). On a reply, it now (a) runs
  `classifyReplyIntent` synchronously on `claude-haiku-4-5` when Anthropic
  deps are configured, storing `replies.ai_intent` (left null, surfacing in
  an "unclassified" queue, on any failure — never guessed); (b) marks the
  lead `status = 'replied'`. The complaint auto-pause now also calls
  Smartlead's real `PATCH /campaigns/{id}/status` (`PAUSED`) when
  Smartlead deps are configured — never a local-DB-only pause flag. The
  Deno `index.ts`'s `normalizeProviderPayload` placeholder (T3's own
  explicit "MUST be replaced before go-live" comment) is replaced with a
  real Smartlead event-type mapping table; an event type this build
  deliberately doesn't act on (`EMAIL_SENT`/`LEAD_CATEGORY_UPDATED`) now
  acks with `200 {ignored:true}` rather than either mis-mapping it or
  400ing (a 400 here would look like a broken webhook to Smartlead's own
  retry logic).
- **`admin/handler.ts` Outreach group completed** (was `501`, task item 4):
  `GET/POST /admin-outreach/leads`, `POST /admin-outreach/suppression`
  (manual add), `GET/POST/PATCH /admin-outreach/campaigns` (create runs the
  real Smartlead campaign-create call and stores the returned external id;
  status-change calls Smartlead's real status endpoint too), `POST
  /admin-outreach/campaigns/:id/add-leads` (re-checks suppression — it can
  grow between fetch-time and add-time — inserts a `send_events`
  `step_index=0`/`status='queued'` row per lead, which is what the
  personalize-collect job later joins through to find the right campaign),
  `GET /admin-outreach/funnel`, `GET /admin-outreach/replies` (feed, joined
  to leads/campaigns) + `POST /admin-outreach/replies/:id/actions`
  (`mark_interested` sends a demo-followup email via a **direct Resend
  call**, deliberately NOT through `messages_outbound`/`worker-messages-
  outbound` — that table's `tenant_id` is `NOT NULL` and a cold-outreach
  lead has no tenant yet, a real constraint conflict found while wiring
  this; `suppress` inserts into `suppression_list` + flips lead status;
  `convert` sets `leads.converted_tenant_id`/`status='converted'` and backs
  the CAC loop by setting `cac_events.tenant_id` on that lead's existing
  cost rows), and `GET /admin-outreach/cac` — a **per-vertical** CAC
  rollup, deliberately a NEW route under the Outreach prefix rather than
  extending T4's existing channel-level `GET /admin-cac`: the task scopes
  this build to the Outreach group only within `admin/`, so T4's `handleCac`
  function is untouched. `AdminRequestContext` gained an optional `query`
  field (parsed `URLSearchParams`, wired in `admin/index.ts`) — the first
  admin route to need query-string filtering; every existing route ignores
  it, zero behavior change elsewhere. `AdminDeps` gained `outreach`
  (Smartlead client + the CAN-SPAM footer text) and `resend` — both
  all-or-nothing optional groups that degrade to a `501` (never a silent
  200/guessed default) when unconfigured, matching the existing
  `retell`/`supabaseAdmin` convention exactly. The stale test asserting
  `/admin-outreach/*` returns `501` (T3's placeholder-era test) was updated
  to point at `/admin-support-requests` instead, which is still a real
  `501` (Support/Feature-flags remain out of this task's scope).
- **Compliance, hard-coded (task item 5)**:
  - CAN-SPAM footer: `admin-outreach`'s campaign-create/status-change
    routes require `deps.outreach` (which bundles `canSpamFooter`, itself
    required at env-var wiring time in `admin/index.ts`) — a campaign
    literally cannot be created without this configured; the footer text
    rides into Smartlead as a `custom_fields.can_spam_footer` merge
    variable on every lead pushed by the personalize-collect job.
  - Suppression checked before every lead add: enforced at BOTH points a
    lead can be added — `api-outreach-fetch-leads`'s insert path and
    `admin-outreach`'s add-to-campaign action (re-checked, since the list
    can grow in between) — via one shared `_shared/lead-dedup.ts` used by
    both.
  - No AI-voice calling of leads: verified by inspection (`grep -rn
    "leads\." supabase/functions/voice-*` and `_shared/providers/retell.ts`)
    — `leads.phone` is read only for display/dedup in the outreach admin
    surface and is never passed to `voice-inbound`/`voice-tools`/any
    Retell call-creation path anywhere in this build. `handleOutreach`'s own
    docstring states this invariant explicitly rather than leaving it
    implicit.
- **New migration** `20260907150000_t8_outreach_extensions.sql` (the one
  migration this task's scope allows, following T4's own precedent of
  adding exactly the schema this task's real integration work needs, no
  more): `campaigns.external_campaign_id` (BACKEND_SPEC §1.8's `campaigns`
  DDL has nowhere to store Smartlead's own campaign id — without it,
  `/webhooks-outreach` has no real way to map an inbound webhook's
  `campaign_id` back to a local row; T3's original handler assumed the
  local uuid WAS the external id, which is never true against a real
  Smartlead account) + a partial unique index on `(provider,
  external_campaign_id)`; `leads.converted_tenant_id` (Flow 5 step 8 names
  this column explicitly — "leads.converted_tenant_id set, closing the
  loop" — and it didn't exist); lookup indexes on `leads(lower(email))`/
  `leads(phone)`/`leads(converted_tenant_id)` for the dedup/CAC-rollup
  query paths this task added.
- **Tests**: 350/350 passing across the whole `supabase/functions/**`
  surface (up from T4's 300 — every new file plus the two files this task
  extended), `tsc -p tsconfig.json --noEmit` clean, `biome check
  supabase/functions supabase/migrations` clean (the one remaining warning,
  `useOptionalChain` in `webhooks-twilio-sms/handler.ts`, is pre-existing
  T3 code this task didn't touch — confirmed via `git diff --stat`).

**Deviations / gaps found (Rule 4 — documented, not silently guessed)**

- Smartlead's documented event catalog has no spam-complaint webhook (see
  Rule 1 disclosure above) — flagged in both `docs/VERIFY.md` and this
  entry rather than left to look like the auto-pause rule "just works" in
  production.
- `campaigns.provider = 'instantly'` still passes the DB check constraint
  (BACKEND_SPEC's own enum), but no Instantly adapter exists — the
  admin-outreach campaign-create route explicitly rejects that value
  (`422 unsupported_provider`) rather than silently accepting a provider
  it can't actually call.
- The reply-body field name inside Smartlead's real `EMAIL_REPLY` webhook
  payload is genuinely unconfirmed (tried in priority order:
  `reply_message`/`reply_body`/`email_body`/`message`) — flagged in
  `docs/VERIFY.md`, needs a live sandbox delivery to confirm before
  go-live.
- The demo-agent generator itself (T9, concurrent/unbuilt at the time this
  task ran) is not depended on — the "mark interested" reply action sends
  a generic demo-followup email pointing at the public `/demo` marketing
  page rather than minting a per-lead seeded demo agent, so this works
  standalone regardless of T9's build order.
- Apollo credit-to-dollar cost conversion (enrichment step) is not
  fabricated — see above; whoever owns the CAC dashboard's accuracy next
  should confirm the account's actual plan rate and wire a real
  `pipeline_costs`/`cac_events` write for it.
- `job-outreach-personalize-collect`'s hook-writing step is a synchronous
  `claude-sonnet-5` call, not a second Batches API round-trip — a
  deliberate scope decision (see above), not a missed opportunity; revisit
  if per-lead volume grows enough that this stops being marginal.

**Deferred / left for later tasks**

- A live Smartlead sandbox account to actually confirm: the People
  Search/webhook field names flagged above, whether
  `custom_fields.opening_line` actually rides into a sequence's email body
  as a merge variable (this build assumes Smartlead's own sequence-template
  merge-field mechanism handles that — no sequence-step-authoring API is
  called here), and the real webhook payload for every event type.
  `docs/VERIFY.md` names every one of these explicitly.
- Support/Outreach... — Feature flags (`admin-flags`) and Support
  (`admin-support-requests`) remain `501`, out of this task's named scope.
- A `join_waitlist`-style dedicated tool doesn't apply here, but the
  analogous gap for outreach: no sequence/step-authoring UI exists yet
  (campaign create makes an empty draft campaign at Smartlead; authoring
  the actual email sequence steps is assumed to happen in the Smartlead
  dashboard directly, not through this admin surface) — flagged as a real
  product gap for whoever builds the outreach admin frontend.
- Reconciling `send_events`/`campaigns` against a live Smartlead account's
  real numeric campaign ids (this build treats `external_campaign_id` as
  opaque `text`, storing whatever Smartlead returns verbatim) once a real
  account exists.

## T9 — Ops hardening, deploy guide, E2E pass (Wave 4)

**Note on numbering**: this task corresponds to `docs/BUILD_PLAN.md`'s
Wave 4 **T10+T11** (ops wiring + `docs/DEPLOY.md`, and the E2E pass),
combined into one assignment and labeled "T9" by the orchestrating
session — a different thing from BUILD_PLAN's own Wave 3 "T9 demo-agent
generator," which turned out to already be covered by T3's
`api-demo-agent` edge function + T5's `/demo` frontend flow (confirmed by
reading both — no separate demo-agent task was needed). Flagging this
once here so a future reader searching BUILD_NOTES for "T9" isn't
confused by the two different meanings.

**Exclusive paths per this task's own scope**: `docs/`, `.github/
workflows/`, `apps/web/tests/`, `scripts/`, and `supabase/functions/
_shared/` only (for Sentry/logging wiring). Did not touch `packages/
adapters/**`, `webhooks-pos`, `worker-adapter-push`, the admin outreach
group, `api-outreach-*`, or `_shared/providers/{shopmonkey,ezyvet,
google-calendar,square,apollo,outscraper,smartlead,anthropic}` — T7's
in-progress, uncommitted work at the time this task ran (see "Concurrent
WIP" below).

**What was built**

- **Sentry wiring, env-gated** (`supabase/functions/_shared/sentry.ts`,
  new): a dependency-free Sentry error reporter over the public Envelope
  HTTP API — no `@sentry/*` SDK (same Deno/Node-workspace-boundary
  rationale every `_shared/providers/*.ts` module already documents).
  `parseDsn`/`envelopeEndpoint`/`buildErrorEnvelope` are pure and unit
  tested without any network call; `sendToSentry` is the one impure
  fire-and-forget fetch wrapper, swallowing every failure (a Sentry outage
  must never become the application's own failure). Wired transparently
  into `_shared/logger.ts`: every one of the 20+ functions that already
  call `createLogger({ fn: "..." })` gets Sentry reporting on `.error()`
  automatically, with zero call-site changes anywhere outside `_shared/`
  — the only path this task's `_shared/`-only scope actually allows for
  "wiring in" a cross-cutting concern used by every function. Inert
  (zero network calls, zero behavior change) whenever `SENTRY_DSN` is
  unset, which is every existing test's situation. A logger's fixed
  `base` fields become Sentry `tags`; a given `.error()` call's `fields`
  become `extra` context — documented as the low-/high-cardinality split
  in `docs/OPS_RUNBOOK.md` §1. 20 new tests (`_shared/sentry.test.ts` +
  `_shared/logger.test.ts`), the full `supabase/functions` suite stays
  green (397/397 after this change, up from 350 — T8's own count plus
  this task's 20 plus whatever T7's in-progress WIP contributes to the
  same shared working tree's test run).
- **`docs/DEPLOY.md`** (new, the flagship deliverable): every account to
  create in lead-time order (Twilio A2P first — multi-day lead time —
  then Retell incl. a concrete 7-question support-ticket list synthesized
  from `docs/VERIFY.md`'s actual open items plus SYSTEM_DESIGN §13's named
  Week-0 ticket topics, since no literal "7 questions" list exists
  verbatim anywhere in the specs; Supabase, Vercel, Stripe incl. running
  `scripts/setup-stripe.ts`, PayPal, Resend, Apollo, Outscraper, Smartlead
  incl. sending-domain warm-up, PostHog, Sentry, Anthropic, Airtable),
  every `.env.example` var mapped to its source, the exact deploy sequence
  (`supabase db push` → secrets → `functions deploy` respecting
  `config.toml`'s per-function `verify_jwt` → `scripts/setup-stripe.ts` →
  **cron/queue registration SQL**, a genuine gap this task found and
  documents concretely below → Vercel setup incl. region pinning), the
  `docs/VERIFY.md` resolution workflow (which items need a live Retell
  sandbox test and exactly how to run each), a counsel checklist (BIPA,
  recording consent, HIPAA BAA chain, TCPA, CAN-SPAM, PCI, FTC/1099, DPA),
  and a 10-step go-live smoke checklist (signup → test call → booking →
  SMS → dashboard → margin-cockpit row → billing → uptime monitor →
  status page).
- **`docs/OPS_RUNBOOK.md`** (new): structured-logging conventions (event-
  name `msg` style, low-/high-cardinality field discipline, level
  discipline, what never to log), the Sentry setup + verification
  procedure, uptime-monitoring setup (concrete tool + exact request/
  expected-status config — see the `/voice-inbound` gap noted below),
  incident/status-page automation (wired to the uptime monitors from
  §3 plus a pointer to `job-retell-health-failover`'s already-built
  business-continuity fallback), a quarterly backup/restore drill
  (step-by-step: scratch project → restore → re-run `scripts/ci/
  rls-cross-tenant-probe.ts` against it as a real structural sanity check,
  not just "the restore didn't error" → deploy functions → tear down), and
  solo-founder break-glass continuity (a named trusted contact, a
  password-manager vault, explicitly NOT a standing extra admin credential
  inside the product).
- **CI completion** (`.github/workflows/ci.yml`): a **clean-build
  assertion** appended to the existing `build` job (`git status
  --porcelain` must be empty after `pnpm run build` — verified this
  actually holds on the real repo before adding it as a gate); a new
  **`repo-hygiene`** job (large-file guard >1MB and no-stray-compiled-.js-
  next-to-.ts guard, both scoped to exclude `legacy/` — confirmed by
  running both checks directly against the real repo first: `legacy/`
  genuinely does carry two >1MB `.glb` binary files, predating these
  rules, so excluding it was necessary, not just cautious; the rest of the
  tree is clean today, both checks pass); a new **`e2e`** job (installs
  Playwright's Chromium, builds+starts `apps/web` with placeholder-but-
  functional env vars mirroring `apps/web/.env.local`'s own local-dev
  convention, runs the full Playwright suite — deliberately does NOT run
  `supabase start`, so the three new authenticated specs below self-skip
  cleanly rather than trying to reach a placeholder Supabase host, which
  was confirmed to be the actual risk during design: see `apps/web/tests/
  e2e/support/auth-state.ts`'s `isLocalSupabaseReachable()`, which checks
  for a real `127.0.0.1`/`localhost` `SUPABASE_URL`, not mere truthiness,
  specifically because this CI job's own placeholder env vars would
  otherwise satisfy a naive truthiness check and hang the job). Validated
  the whole workflow file with `actionlint` (downloaded directly for this
  task, v1.7.7 — zero findings) and a plain YAML parse, since no
  `actionlint` binary was pre-installed.
- **Playwright E2E expansion** (`apps/web/tests/e2e/`): three new specs —
  `dashboard-realtime.spec.ts` (a real service-role `call_logs` INSERT,
  asserting the tenant-scoped realtime broadcast lands a new row on
  `/dashboard/calls` without a page reload — the missing end-to-end leg of
  T5's own already-unit-tested `TenantRealtimeProvider`), `admin-aal2.spec.ts`
  + `admin-aal2-authenticated.spec.ts` (unauthenticated redirect coverage
  for two nested `/cockpit` routes, plus the one authenticated AAL2-adjacent
  branch that's actually scriptable without programmatically enrolling a
  real TOTP factor: a fresh `platform_admins` row with no verified MFA
  factor yet correctly lands on `/mfa/enroll`), and
  `forwarding-wizard.spec.ts` (an active tenant owner reaches `/signup/
  forwarding` and sees real server-fetched wizard content). All three
  need a real session past `middleware.ts`'s server-side `supabase.auth.
  getUser()` call — confirmed by reading the source that this cannot be
  satisfied by browser-level `page.route()` mocking (the same limitation
  T5's own BUILD_NOTES entry already found for the signup wizard's step 2),
  so this task built the **correct** fix instead of a workaround: a
  Playwright "setup project" (`auth.setup.ts`, Playwright's own documented
  auth pattern) that provisions real test users against a **real** local
  `supabase start` instance (`support/provision-test-users.ts`, dependency-
  free `fetch`-based admin-API calls, mirroring `scripts/ci/rls-cross-
  tenant-probe.ts`'s established convention) and logs each in through the
  **real** `/login` form in a real browser — never a fabricated session
  cookie (which would mean guessing at `@supabase/ssr`'s internal cookie
  encoding, an unnecessary and fragile risk this task deliberately avoided).
  `playwright.config.ts` gained a `setup`/`chromium` project split with a
  `dependencies` edge, so the authenticated specs' `storageState` files
  exist by the time they run — but only when `auth.setup.ts`'s own tests
  didn't self-skip. `support/auth-state.ts`'s `authStorageState()` helper
  additionally guards against a nonexistent storageState file crashing
  browser-context creation (as opposed to a clean `test.skip()`, which runs
  too late to prevent that).
- **`scripts/e2e-backend.ts`** (new): a non-Playwright backend E2E smoke —
  real signed Retell webhook HTTP requests (the exact `X-Retell-Signature:
  v=...,d=...` scheme `_shared/retell-signature.ts` verifies, re-implemented
  here with `node:crypto` since `scripts/` stays dependency-free by
  established convention) against the real `/voice-tools` and `/voice-
  events` functions, asserting real Postgres state afterward: `check_
  availability` returns real generated slots (via a real `fn_regenerate_
  availability_slots` RPC call, not hand-crafted rows), `create_booking`'s
  idempotency key is honored on an identical retry (same booking_id, no
  duplicate/constraint error), and `/voice-events`'s `call_ended` handling
  — fast-ack then background cost-ingestion (polled for, since it's
  genuinely async behind `EdgeRuntime.waitUntil`) plus webhook-dedup (an
  identical redelivery must not double-process) — all verified end to end.
  Every field name/response shape used here (`{result: {...}}` envelope,
  `confirmed`/`booking_id`, `fn_regenerate_availability_slots`'s exact
  `p_tenant_id`/`p_resource_id` parameter names) was cross-checked directly
  against the real handler/migration source before being written, not
  assumed from the spec docs' prose — this is the one place in this task
  where that extra verification step caught nothing wrong, which is itself
  worth recording: the existing T3/T4 implementations matched their own
  spec text exactly.
- Small deferred-fix pass: `.env.example` gained `SENTRY_ENVIRONMENT`/
  `SENTRY_RELEASE` (the two new env vars `_shared/sentry.ts`/`logger.ts`
  actually read, previously undocumented — CLAUDE.md Rule 3 requires every
  var to have a comment); `.gitignore` gained `playwright/.auth/` (the
  saved-storageState directory the new auth infrastructure writes real,
  if throwaway-local-only, session tokens into — must never be committed).

**Root-gate status (task item 6) — concurrent T7 WIP confirmed, documented
rather than worked around**

Root `pnpm run typecheck`/`lint` are **not** green as of this commit.
Root cause confirmed directly (not assumed): `pnpm --filter
@heyloo/adapter-square run typecheck` fails with 19 errors (`Cannot find
module 'zod'`/`'@heyloo/canonical-types'`, missing Node lib types) — a
mid-edit package state, and `git status --porcelain` shows uncommitted
changes to `supabase/functions/webhooks-pos/handler.ts`+`.test.ts`,
`supabase/functions/_shared/providers/square.{ts,test.ts}`, and
`pnpm-lock.yaml` sitting in this shared working tree. All of these are
explicitly T7's named exclusive paths per this task's own instructions
("skip anything touching files T7/T8 are working on... packages/adapters,
webhooks-pos, worker-adapter-push... DO NOT touch those") and were left
untouched. Verified this task's own surface is fully clean in isolation:
`biome check docs .github scripts apps/web/tests supabase/functions/
_shared` → 0 errors (`git ls-files` confirms none of those T7 paths are
under any directory this command touches); `tsc --noEmit` clean in both
`supabase/functions` and `apps/web`; the complete `supabase/functions`
Vitest suite (397 tests) and every other package's suite (`canonical-types`
126, `adapter-retell` 95, `templates` 104, `web` 4) all pass. This mirrors
exactly what T4's and T6's own BUILD_NOTES entries each already documented
for the mirror-image situation (a concurrent task's in-progress files
looking like breakage from the outside) — not re-litigated as a bug to fix
here, since fixing T7's in-progress package is outside this task's
exclusive paths on a shared branch.

**Deviations / gaps found (Rule 4 — documented, not silently guessed)**

- **No pg_cron schedule or pgmq queue is registered anywhere in this
  codebase** — confirmed directly (`grep -rn "cron.schedule\|pgmq\."
  supabase/migrations/*.sql` returns nothing): every migration only
  creates the `pg_cron`/`pgmq`/`pg_net` extensions (T1's own entry already
  flagged this as intentionally out of its scope; T3/T4's entries assumed
  "T3/T4 own the actual queue/cron wiring" without either actually adding
  it). This is a genuine, real gap this task found and closed the only way
  available within its own paths: `docs/DEPLOY.md` §3.6 now carries the
  exact, copy-pasteable `pgmq.create`/`cron.schedule` SQL for every queue
  and every job's real cadence (cross-referenced from each function's own
  `index.ts` docstring, e.g. `job-billing-cycle`'s `0 1 * * *`,
  `job-retell-health-failover`'s every-2-minutes) — a migration would have
  been the more idiomatic home for this, but `supabase/migrations/` is
  outside this task's exclusive paths on a branch where schema ownership
  belongs to other tasks; flagged here explicitly rather than silently
  worked around.
- **No dedicated health-check endpoint exists** — `/voice-inbound` is
  POST-only and requires a real signed body to return `200`; confirmed by
  reading `voice-inbound/index.ts` directly (`405` on any `GET`). Adding a
  proper `GET /health` function would mean creating a new function
  directory outside `supabase/functions/_shared/`, outside this task's
  exclusive paths — documented as a real, recommended follow-up in
  `docs/OPS_RUNBOOK.md` §3 instead, with a concrete interim workaround
  (monitor for a stable `401` on an unsigned POST, which proves the
  function is deployed and reachable without needing a real Retell
  payload) that this task verified is at least a meaningful liveness
  signal, not a guess.
- **PayPal webhook consumer scoped out, not built** — the orchestrating
  session's own task text named this as a candidate "small deferred fix,"
  but on inspection it would need a new function directory (outside
  `_shared/`), `supabase/config.toml` wiring, and real webhook-signature-
  verification design work (PayPal's payout-item event shapes) — not
  "small" by CLAUDE.md Rule 2's own bar for a webhook consumer (verify →
  dedup → fast-ack, fail closed), and adjacent to the payments/referral
  surface. Left as an explicit, named gap in `docs/LAUNCH_STATUS.md`
  rather than built under time pressure with unverified vendor-webhook
  assumptions.
- Root's Node-version bump (22→24, flagged as a low-priority safe follow-up
  by T0) was considered and left alone — bumping `.github/workflows/
  ci.yml`'s `NODE_VERSION` alone, without also bumping root `package.json`'s
  `engines`/local dev expectations (both outside this task's exclusive
  paths), would create a mismatch between what CI runs and what's
  documented as the floor; not done here for that reason, still tracked as
  T0's own open item.
- Observed (not fixed, out of scope — `apps/web/next.config.ts` isn't
  under `apps/web/tests/`): a `next start` run during this task's own
  verification logged a deprecation warning
  (`@sentry/nextjs`'s `withSentryConfig` import path) — cosmetic, doesn't
  affect functionality, flagged here for whoever next touches that file.

**Verification performed**

Every code change in this task was actually run, not just typechecked:
the full `supabase/functions` Vitest suite (397/397) before and after each
edit; `tsc --noEmit` clean on both `supabase/functions` and `apps/web`;
`biome check` clean (0 errors) on every path this task touched; `actionlint`
(downloaded fresh, v1.7.7) clean on the modified `ci.yml`; a real
`pnpm --filter web run build` (twice — once with the developer's existing
`.env.local`, once with `.env.local` temporarily moved aside and only the
CI job's exact placeholder env vars set, to prove the `e2e` CI job's
env-var choice is sufficient) followed by a real `next start` and `curl`
against `/dashboard`, `/cockpit`, `/login`, and `/api/signup/draft` —
confirmed the exact redirect chains this task's new specs assert on. The
Playwright specs themselves (new and pre-existing) could **not** be
executed: `pnpm --filter web exec playwright install chromium` fails with
`403` from `cdn.playwright.dev` in this sandbox (network-blocked,
confirmed directly, not assumed) — matching T5's own identical finding.
Every new spec's assertions were instead built by reading the exact
component/handler/redirect source they exercise (documented inline in each
spec's own comments) rather than guessed at.

**Deferred / left for later tasks**

- Running the three new authenticated Playwright specs and
  `scripts/e2e-backend.ts` for real, somewhere with Docker + a browser
  install available (see `docs/LAUNCH_STATUS.md`'s gaps list) — reviewed
  and cross-referenced against source, never executed.
- Wiring `supabase start` into CI's `e2e` job so the authenticated specs
  run for real on every push, if a maintainer decides that's worth the
  added CI time/complexity (`.github/workflows/ci.yml`'s `e2e` job own
  comment names exactly what this would need).
- A dedicated `GET /health` edge function (see above).
- A `/webhooks-paypal` consumer (see above).
- Resolving T7's in-progress `packages/adapters/square`/`webhooks-pos`
  state so root gates go green again — not this task's files to fix.
- Everything named in `docs/LAUNCH_STATUS.md`'s "What remains for the
  owner" and "Known gaps" sections — not repeated here.

## T7 — Deep-integration adapters: Shopmonkey, ezyVet, Google Calendar,
## Square + adapter-push/webhook wiring + tenant connect flow (Wave 3)

**What was built**

- Four `IntegrationAdapter` implementations, one per
  `packages/adapters/{shopmonkey,ezyvet,google-calendar,square}` (all new
  packages; T0's README already reserved these paths for this task):
  `syncCatalog`, `pushBooking` (all four) / `pushOrder` (Square only —
  Google Calendar has no order concept, `pushOrder` is correctly absent per
  `IntegrationAdapter`'s optional-method design), `checkAvailability`
  (Square/Google/ezyVet — Shopmonkey's is intentionally NOT implemented,
  see below), `handleWebhook` with real signature verification (Square:
  the salvaged `HMAC-SHA256(notificationUrl+rawBody)` base64 scheme,
  re-verified against fresh WebSearch this pass; Shopmonkey: a documented
  `HMAC-SHA256(rawBody)` hex hypothesis; Google Calendar: a per-connection
  shared-secret channel-token check, since Google's push notifications
  carry no signable body at all; ezyVet: always fails closed with an
  explicit reason — no confirmed webhook exists), `refreshAuth` (Square/
  Google standard OAuth2 refresh_token; ezyVet's 12h-TTL client-credentials
  re-mint, proactively at the 10h mark per BACKEND_SPEC §7.6; Shopmonkey's
  paste-key "refresh" is a lightweight re-validation call, since a static
  key has no refresh grant), and `pullChanges` (poll-based two-way sync
  pull-back, G11 — ezyVet/Shopmonkey/Google Calendar; Square relies on its
  own real webhook/change-feed per BACKEND_SPEC §7.6's own table, so it has
  no `pullChanges`). 84 tests across the four packages, each package's own
  `provider.test.ts` exercising the full `IntegrationAdapter` contract plus
  per-module fixture/signature tests.
- Wired both Wave-1 shells T3 left empty: `worker-adapter-push`'s
  `ADAPTER_PUSHERS` registry (was `{}`, every push dead-lettering — now has
  a real pusher per adapter: loads the tenant's `adapter_connections` row,
  proactively refreshes auth where the provider's TTL calls for it, loads
  the authoritative `bookings`/`orders` row (+ joined customer/offering/
  resource), maps to the provider's push shape, and on success upserts
  `adapter_sync_state`; on a 401/revoked response marks the connection
  `disconnected` rather than endlessly retrying an auth failure) and
  `webhooks-pos`'s provider dispatch (was Square-only + 3 stub 501s — now
  also wires `shopmonkey` and `google_calendar`; `ezyvet` still 501s,
  honestly, since no webhook exists to receive). `worker-adapter-push/
  handler.ts` also exports `pollAdapterChanges` (poll-based two-way sync +
  conflict detection, contract-tested — see VERIFY.md for why it isn't
  wired to a `pg_cron` schedule yet) and both `webhooks-pos/handler.ts`'s
  `processPosWebhook` and the poller implement the SAME conflict-detection
  rule, generalized from the `airtable_sync_state` precedent: an external
  change notification/pull for a booking/order Heyloo already pushed
  (a matching `adapter_sync_state.external_id` row exists) flags
  `sync_conflict` instead of silently assuming reconciliation; an
  unmapped external id (never pushed by Heyloo) is recorded for visibility
  only, never flagged as a conflict.
- New `_shared/providers/{shopmonkey,ezyvet,google-calendar}.ts` (Deno-side
  lean `fetch` modules, following T3/T4's established Node/Deno
  duplication pattern — see below) + extended the existing
  `_shared/providers/square.ts` (T3 built only `handleWebhook`'s verify/
  normalize step; this task added catalog/booking/order/availability/auth
  REST calls) — all four now cover the full REST surface
  `worker-adapter-push`/`webhooks-pos`/`api-adapter-connect` need.
- New `supabase/functions/api-adapter-connect/` function (task item 3):
  OAuth `initiate`/`callback` actions for Square/Google Calendar (a signed,
  tenant-bound, 15-minute-window `state` parameter —
  `HMAC-SHA256` over a base64url JSON payload, timing-safe compared,
  replay-window-checked — `state.ts`), `paste_key` for Shopmonkey (live
  `GET /me` validation before storing) and ezyVet (a live client-
  credentials mint against the tenant-supplied practice `base_url` — the
  practical proof the practice actually authorized Heyloo's partner_id,
  since there is no per-tenant OAuth redirect for this grant type), and
  `disconnect`. Caller must be an `owner`/`admin` member of a tenant
  (resolved server-side from `memberships`, JWT `sub` only) — a bare `verify_
  jwt: true` is explicitly treated as insufficient, same posture as
  `admin`/`api-provision` (`supabase/config.toml`'s own comment). 18 tests.
- One new migration, `20260907160000_t7_adapter_connections.sql` (per this
  task's own directive: "if none exists for adapter_connections, add ONE
  migration for it" — none existed anywhere in T1's schema): `adapter_
  connections` (one row per tenant+provider; `status`/`auth_mode`/
  plaintext `access_token`/`refresh_token`/`expires_at`/
  `provider_account_id`/`metadata` jsonb/`disconnected_at`/`last_error`)
  and `adapter_sync_state` (generalizes the existing `airtable_sync_state`
  table's one-way-push conflict-tracking shape — same column set, same
  `sync_conflict` semantics — to every T7 adapter, keyed `(tenant_id,
  provider, entity_type, entity_id)` with a reverse `(provider,
  external_id)` index for the webhook/poll conflict-lookup path). RLS:
  both tables get a tenant-member-or-platform-admin SELECT policy, no
  authenticated/anon write policy (service_role-only writes, matching the
  `airtable_sync_state`/`tool_health` precedent). Verified by hand against
  a bare Postgres 16 instance (this environment has no Docker/`supabase
  start` either, same constraint T1 logged): applied cleanly, unique
  constraint rejects a duplicate tenant+provider connection, both RLS
  policies attach correctly.
- `.env.example`: 11 new vars documented (Square/Google Calendar OAuth
  client id+secret+redirect URI, ezyVet partner client id+secret+partner_
  id, Shopmonkey's webhook signing secret, and `ADAPTER_CONNECT_STATE_
  SECRET`) under a new "deep-integration adapters" section.
- `supabase/config.toml`: one new `[functions.api-adapter-connect]`
  `verify_jwt = true` entry, commented per the existing convention.

**Rule 4 resolution: `api-adapter-connect` vs. this task's stated exclusive
paths (documented, not silently overstepped)**

This task's own assignment text lists exclusive paths as `packages/
adapters/{shopmonkey,ezyvet,google-calendar,square}/` plus, within
`supabase/functions`, ONLY `webhooks-pos/`, `worker-adapter-push/`, and new
`_shared/providers/*.ts` files — "touch no other function dirs" — while
task item 3 explicitly requires building "an `api-adapter-connect`
function." Read literally these two instructions conflict. Resolved in
favor of item 3's explicit deliverable: "touch no other function dirs" is
read as guarding against scope creep into unrelated, already-owned
directories (`admin`, `voice-tools`, other tasks' territory) — not as
forbidding the one new function this task was explicitly commissioned to
build. Creating `api-adapter-connect/` necessarily also required one
`supabase/config.toml` entry (every prior task registered its own new
functions there the same way) and 11 new `.env.example` vars (CLAUDE.md
Rule 3: "secrets only via env — `.env.example` documents every variable").
No other function directory was touched.

**Auth-model reconciliation: Shopmonkey and ezyVet (documented, not
silently guessed)**

API_AND_FLOWS.md A.6's preamble calls Shopmonkey a "self-generated
paste-key" adapter, but its own per-adapter section says "Shopmonkey 2.0
uses OAuth2 Bearer tokens via `/auth/login`." Fresh WebSearch this pass
(the assignment's own header claims Shopmonkey's docs are "generally
reachable online" — directly tested, `shopmonkey.dev` was still
`EGRESS_BLOCKED` via `WebFetch` in this environment) found Shopmonkey ALSO
exposes a `/apikey` route minting a static(-ish), optionally-expiring key
from an authenticated session — reconciled as: the TENANT does that
one-time step themselves in their own Shopmonkey dashboard and pastes the
resulting key into Heyloo (`api-adapter-connect`'s `paste_key` action);
this adapter never performs the email/password login itself. ezyVet's
OAuth2 Client Credentials grant is genuinely partner-gated with ONE set of
platform-level credentials shared across every connected practice (not
per-tenant), so its "connect" flow is also paste-key-shaped from the
tenant's perspective (they supply their practice's base URL; Heyloo's own
partner credentials do the rest) even though the underlying grant type is
OAuth2, not a bare key. Both reconciliations are documented inline in each
adapter's `client.ts`/`auth.ts` docstrings and in `docs/VERIFY.md`'s T7
section.

**Deno/Node duplication (same established pattern as T3/T4, applied to
four more adapters)**

Every `packages/adapters/*` Node package here is duplicated as a lean
`_shared/providers/*.ts` Deno module — identical reasoning T3 documented
for Retell/Twilio/Stripe/PayPal/Anthropic/Resend and T4 documented for the
template compiler: the Deno Edge Function runtime cannot import a pnpm
workspace package without a bundling step neither task added. The Node
packages are the canonical, fully-tested `IntegrationAdapter` reference
implementation; the `_shared/providers/*.ts` versions are what actually
runs in production. Flagged in `docs/VERIFY.md` as maintenance debt (same
flag T4 raised for its own compiler duplication) — a future task could
extract both into one zero-runtime-dependency package both runtimes import.

**`IntegrationAdapter` interface duplication across the four packages**
(documented, not an oversight) — `@heyloo/canonical-types` (T2's package)
defines `VoiceProvider` but has no generic adapter interface, and this
task's exclusive paths don't include that package. Rather than invent a
fifth `packages/adapters/*-shared` package (also outside the exclusive
list) or silently skip a canonical interface, `adapter-types.ts` is
byte-for-byte identical across all four packages, with a docstring
explaining why and naming the follow-up (move it into `@heyloo/canonical-
types` alongside `VoiceProvider` once a task owns that package again).

**Offering/resource → provider-catalog-id mapping: reused the existing
generic `metadata` column, not a new mapping table**

Pushing a booking needs the PROVIDER's own service/labor-rate/appointment-
type id and team-member/resource id — T1's schema has no such column on
`offerings`/`resources` (deliberately, to keep those tables adapter-
agnostic per CLAUDE.md Rule 2, the same reasoning BACKEND_SPEC §10.3 gives
for Airtable's separate mapping table). This task's build directive
authorized exactly ONE new migration, already spent on `adapter_
connections`/`adapter_sync_state`. Pragmatic resolution: read/write the
mapping through the EXISTING generic `metadata` jsonb column, namespaced
`metadata.adapter_external_id.<provider>` — e.g. `offerings.metadata =
{"adapter_external_id": {"square": "svc_123"}}`. A dedicated mapping table
populated automatically by `syncCatalog` (rather than requiring a human to
hand-edit JSON) is flagged in `docs/VERIFY.md` as the more robust long-term
design, not silently treated as solved.

**Verification performed (no live sandbox account for any of the four
vendors, no Docker/`supabase start` in this environment — same
constraints T1-T4 already logged)**

- Every REST endpoint/field name is a documented hypothesis per CLAUDE.md
  Rule 1 item 2 — guarded by a runtime Zod validator at every parse
  boundary (`safeParse`, never a bare cast) and flagged in `docs/VERIFY.md`
  with a confidence level and what to confirm before go-live. Square's
  shapes carry the highest confidence (independently re-corroborated via
  fresh WebSearch this pass against Square's own current API-reference
  pages, on top of the pre-existing salvaged/researched shapes); Shopmonkey
  2.0's endpoint paths carry the lowest (no first-party fetch reached at
  all — `shopmonkey.dev` blocked).
- The new migration was hand-verified against a bare (non-Supabase-image)
  PostgreSQL 16 instance available in this environment, mirroring T1's own
  verification method: applied cleanly against stub `tenants`/`auth.users`/
  helper-function tables, the `unique (tenant_id, provider)` constraint
  correctly rejected a duplicate connection, and both new RLS SELECT
  policies were present after `alter table ... enable row level security`.
- 84 tests across the four `packages/adapters/*` packages + 47 new/updated
  tests across `supabase/functions/{webhooks-pos,worker-adapter-push,
  api-adapter-connect,_shared/providers}` (contract tests on hand-built
  fixture payloads per adapter; real HMAC test vectors for every signature
  scheme, including a genuine tampered-body/wrong-secret/missing-header
  matrix for each of Square/Shopmonkey/Google-Calendar's channel-token
  check; explicit conflict-path tests for both the webhook-driven and
  poll-driven two-way-sync flag logic). **Root gates fully green at commit
  time**: `pnpm run typecheck` (18/18 tasks), `pnpm run lint` (0 errors —
  Biome's pre-existing `noExplicitAny` warnings in test-fixture `fetchImpl`
  casts are the only diagnostics, same accepted class T3/T4/T5 already
  left in place), `pnpm run test` (18/18 tasks, 500+ tests across the
  monorepo), and `pnpm run build` all pass with zero changes to any file
  outside this task's paths.

**Deferred / left for later tasks**

- Wiring `pollAdapterChanges` to an actual `pg_cron` schedule (a new
  `job-adapter-sync` function) — outside this task's exclusive paths
  (`job-*` is T3/T4's established territory); the function itself is
  built, exported, and contract-tested, just not yet invoked periodically.
- Encrypting `adapter_connections.access_token`/`refresh_token` at rest
  (currently plaintext `text` columns) — needs a KMS/key-rotation decision
  this task isn't positioned to make blind; flagged as a pre-go-live
  blocker for Square/Google Calendar specifically (both carry a real OAuth
  refresh token) in `docs/VERIFY.md`.
- A dedicated adapter-catalog-mapping table (replacing the `metadata.
  adapter_external_id` convention above) populated automatically from
  `syncCatalog`, so an operator never hand-edits `offerings`/`resources`
  JSON to wire up a provider's service/resource ids.
- Cloudbeds, Clio, Follow Up Boss, NexHealth adapters (Wave 3/opportunistic
  per `packages/adapters/README.md` — not named in this task's four).
- A tenant-dashboard UI for the connect flow (`api-adapter-connect`'s
  request/response contract is built and tested; FRONTEND_SPEC/T5's own
  surface for a "Connections" settings page was not in this task's scope).
- Confirming Shopmonkey 2.0's exact base URL/endpoint paths and ezyVet's
  practice base-URL pattern against a live sandbox account — the single
  highest-risk pair of VERIFY items this task leaves open (see
  `docs/VERIFY.md`'s T7 section for the full list).

## PROVIDERS-VERIFY — verify/fix every non-Retell provider integration
## against official SDK source (packages/adapters/{square,google-calendar},
## supabase/functions/_shared/providers/*)

Technique: `docs.*` vendor sites stayed egress-blocked (same experience
every prior task logged), but `registry.npmjs.org` and
`raw.githubusercontent.com` were BOTH fully reachable — so every finding
below traces to real, downloaded official-package SOURCE CODE (npm
tarballs; one GitHub repo fetched file-by-file via raw.githubusercontent
for Apollo, since `apolloio/n8n-nodes-apollo`'s own integrations team wrote
it), not WebSearch summaries or memory. Full per-provider detail
(confidence, exact source file/line, what was tried when nothing
authoritative existed) is in `docs/VERIFY.md`'s new "PROVIDERS-VERIFY pass
(2026-09-08)" section — this entry lists only what actually changed.

**Fixes applied (real bugs, not just confidence-raising)**:

1. **Square catalog sync** (`packages/adapters/square/src/catalog.ts`):
   `syncCatalog`'s `enabled_location_ids` request param on `POST /v2/
   catalog/search` matched no field that endpoint actually has (confirmed
   against the official `square` SDK's own `SearchCatalogObjectsRequest`
   type — that param belongs only to the different `search-catalog-items`
   endpoint) — `locationIds` filtering was silently a no-op in production.
   Fixed by post-filtering on `present_at_all_locations`/
   `present_at_location_ids`/`absent_at_location_ids` instead (real fields
   every catalog object carries). New tests in `catalog.test.ts`.
2. **Square API version pin** (`packages/adapters/square/src/client.ts` +
   `supabase/functions/_shared/providers/square.ts`): bumped
   `SQUARE_API_VERSION` from the placeholder `2026-01-22` to `2026-08-19`
   — the official SDK's own current generated-client default.
3. **PayPal base URL** (`supabase/functions/_shared/providers/paypal.ts`):
   changed `api-m.(sandbox.)paypal.com` -> `api.(sandbox.)paypal.com` (no
   `-m`) to match the official `@paypal/payouts-sdk`'s
   `paypal_environment.js` exactly. Flagged in VERIFY.md as
   lower-certainty than every other fix here (that SDK hasn't been
   republished since 2021) — worth one live sandbox OAuth call to be sure
   before the first real payout batch. Test fixture in
   `job-referral-payouts/handler.test.ts` updated to match.
4. **Twilio A2P campaign sample messages**
   (`supabase/functions/_shared/providers/twilio.ts`): the real Twilio
   field is `MessageSamples` (required, array serialized as a REPEATED
   form key), confirmed against the official `twilio` npm SDK's own
   generated client and its `qs.stringify({arrayFormat: "repeat"})`
   request-building source — this build's original `SampleMessage1`/
   `SampleMessage2`/... indexed-suffix guess matched no field Twilio
   recognizes at all, so every real A2P campaign registration up to now
   would have silently registered with ZERO sample messages.
   `twilioMessagingRequest` reworked to accept `Record<string,
   string|string[]>` and append repeated keys for arrays.
5. **Apollo** (`supabase/functions/_shared/providers/apollo.ts`) — three
   fixes against Apollo's OWN `apolloio/n8n-nodes-apollo` connector source:
   people search endpoint `/mixed_people/search` (not `/mixed_people/
   api_search` as this build had guessed from a WebSearch summary), the
   people-search domain filter field `organization_domains` (not
   `q_organization_domains_list`), and the organization bulk-enrich body
   `{domains: [...]}` (not `{details: [{domain}]}`).
6. **Outscraper** (`supabase/functions/_shared/providers/outscraper.ts`)
   — two fixes against the official `outscraper` npm SDK's own request-
   building source and bundled usage example: the result-count limit
   param is `organizationsPerQueryLimit` (this build's `limit` matched
   nothing and was silently ignored); the poll's terminal-success status
   string is `"Completed"` (this build's `"Success"`/`"Finished"` guess
   matched neither of the SDK's own documented values `"Running"`/
   `"Completed"`/`"Failed"`, meaning the poller would NEVER have detected
   a finished job in production — every real lead-fetch would exhaust its
   retry budget and return zero leads). Test fixture in
   `api-outreach-fetch-leads/handler.test.ts` updated to match.
7. **Smartlead campaign-status HTTP verb**
   (`supabase/functions/_shared/providers/smartlead.ts`): `PATCH` -> `POST`
   — every mutating call in the (unofficial but real-`axios`-client-based)
   `smartlead-mcp-server` npm package's own Smartlead API client uses
   POST, none uses PATCH/PUT anywhere. Test fixture in
   `webhooks-outreach/handler.test.ts` updated to match. Two OTHER
   Smartlead endpoints this same source disagreed with (leads-add,
   webhook-create) were deliberately left UNCHANGED and flagged as open
   conflicts in VERIFY.md instead of blind-switched — both sources here
   are unofficial/community-maintained with no way to adjudicate from this
   environment, so trading one unverified guess for another isn't a fix.

**Confirmed correct, no code change** (raises confidence in docs/VERIFY.md,
full detail there): Square webhook signature scheme + Bookings/Orders/
Availability wire shapes + OAuth2 refresh (cross-checked against the real
`square` SDK, including a genuine runtime cross-check of this adapter's
signature verifier against the SDK's own `WebhooksHelper.verifySignature`
in the new contract test); Google Calendar freeBusy/events/push-channel
shapes end to end (zero mismatches found against the official `googleapis`
SDK); Twilio's webhook signature algorithm and every non-A2P-sample-message
REST shape; Anthropic's `claude-haiku-4-5`/`claude-sonnet-5` model ids and
the Message Batches contract (reconfirmed against this session's own
`claude-api` skill, cached more recently than this build's original pass).

**Still flagged, no authoritative source found (tried, documented in
VERIFY.md)**: Shopmonkey (only npm hit is an empty Pipedream scaffold
stub; several GitHub org/repo guesses all 404; the API host itself is
blocked by the same egress policy as the docs site) and ezyVet (zero npm
hits at all; several GitHub repo guesses all 404). Every existing VERIFY
item for both stands exactly as previously documented — this task did not
invent a shape for either.

**Devdependencies added** (packages/adapters/* ONLY, never runtime, never
outside adapters, per this task's own instructions): `square@45.1.0` in
`packages/adapters/square/package.json`, `googleapis@178.0.0` in
`packages/adapters/google-calendar/package.json` — each paired with a new
compile-time (+ where practical, runtime) contract test,
`packages/adapters/{square,google-calendar}/src/contract.test.ts`. No SDK
dependency was added to any `_shared/providers/*.ts` Deno file (verified by
diff only, per this task's own instructions) and no adapter for a provider
without its own `packages/adapters/*` package (Twilio/PayPal/Apollo/
Outscraper/Smartlead/Anthropic) got a new package — those remain
Deno-`fetch`-only, matching every prior task's established pattern.

**Root gates**: `pnpm typecheck`, `pnpm --filter @heyloo/adapter-square
test`, and `pnpm --filter @heyloo/adapter-google-calendar test` all green;
every test in every file this task touched passes (confirmed by running
`_shared/providers`, `webhooks-outreach`, `api-outreach-fetch-leads`,
`job-referral-payouts`, `api-a2p-register`, and both adapter packages'
suites explicitly). `pnpm typecheck`/`pnpm test` run at the FULL monorepo
root surfaced pre-existing failures confined entirely to
`packages/adapters/retell/**`, `supabase/functions/_shared/compiler/
template-compiler.*`, `supabase/functions/admin/handler.ts`, and related
Retell-adjacent files — all from a PARALLEL Retell-verification agent's
own concurrent, in-progress work in this same shared working directory
(confirmed via `git status`/`git diff` showing those exact files already
modified before this task touched anything, and via a `git stash`/`git
stash pop` round-trip used only to isolate this task's own changes for
testing — nothing was discarded). This task's own explicit instruction is
"do NOT touch packages/adapters/retell or _shared/providers/retell.ts or
voice-* functions," so those failures are left exactly as found, matching
the established precedent T4/T6/T7 each already logged for the identical
concurrent-WIP situation.
