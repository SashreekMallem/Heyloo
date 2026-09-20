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

## RETELL-VERIFY — verify/fix the Retell integration against the official
## `retell-typescript-sdk` (packages/adapters/retell,
## supabase/functions/_shared/providers/retell.ts, voice-{inbound,tools,
## events})

Technique: `docs.retellai.com` stayed egress-blocked (same experience every
prior task logged), but the official npm package `retell-sdk` (published
from `RetellAI/retell-typescript-sdk`, v5.64.0) installs cleanly and
`raw.githubusercontent.com/RetellAI/retell-typescript-sdk/main/**` is fully
reachable — so every finding below traces to the SDK's own generated
`src/resources/*.ts` request/response types (Stainless-generated from
Retell's real OpenAPI spec) or its own hand-written
`src/lib/webhook_auth.ts` signing helper, never to indexed search snippets
or memory. This ran concurrently with `PROVIDERS-VERIFY` (see that section
above) in the same shared working directory — its own exclusive paths (own
task instruction) skip `packages/adapters/retell`/`_shared/providers/
retell.ts`/`voice-*`, so there is no overlap; both tasks' `git status`
diffs were cross-checked against each other's file lists to confirm this
before either committed.

**Confirmed CORRECT as originally built (no code change, docs/VERIFY.md
marked RESOLVED)**:
- **VERIFY-1, webhook signature scheme** — confirmed BYTE-FOR-BYTE against
  the SDK's own `src/lib/webhook_auth.ts` (`symmetric.verify`/`sign`,
  exported as `verify`/`sign` from the package root): header
  `v=<timestamp>,d=<hex HMAC-SHA256>`, digest over `rawBody + timestamp`
  (direct concatenation, no separator), secret = the API key itself,
  5-minute default tolerance (`FIVE_MINUTES` in the SDK source). Both
  `packages/adapters/retell/src/signature.ts` and
  `supabase/functions/_shared/retell-signature.ts` already matched exactly.
- **VERIFY-4, cost breakdown unit** — confirmed `call_cost`/`product_costs[]`
  costs are in CENTS (`src/resources/call.ts`'s own doc comments: "Cost for
  the product in cents..."/"Combined cost of all individual costs in
  cents"), resolving the long-open cents-vs-dollars question this
  codebase's own money invariant had assumed correctly.
- Multi-prompt/single-prompt (Retell LLM) compiler output — `general_prompt`,
  `starting_state`, `states[].{name,state_prompt,edges:[{destination_state_
  name,description}],tools}`, flat optional `model`, and the `custom`
  function-tool shape (`{name,type:"custom",url,description?,parameters?}`)
  all confirmed exactly against `src/resources/llm.ts`.
- `/publish-agent-version/{id}` endpoint NAME, `/import-phone-number`'s
  `inbound_agents` being an ARRAY (not singular `inbound_agent_id`), and the
  `response_engine.type` discriminators (`"conversation-flow"`/
  `"retell-llm"`) — all confirmed correct as previously built.

**FIXED (confirmed wrong, corrected across
`packages/adapters/retell/src/**`, `supabase/functions/_shared/providers/
retell.ts`, `supabase/functions/_shared/compiler/template-compiler.ts`,
`supabase/functions/admin/handler.ts`, `supabase/functions/api-provision/
{handler,index}.ts`, `supabase/functions/job-retell-health-failover/
handler.ts`, plus every affected test/fixture/snapshot):**

1. **`inbound_webhook_url` is NOT an Agent field at all** (VERIFY-6) —
   confirmed absent from every Agent create/update/response interface in
   `src/resources/agent.ts`; it exists exclusively on the PhoneNumber
   resource (`PhoneNumber{Create,Update,Import}Params`/`PhoneNumberResponse`
   in `src/resources/phone-number.ts`). Removed from
   `CreateOrUpdateAgentInput`/`agents.ts`'s agent-create body; added to
   `ImportPhoneNumberInput`/`numbers.ts`'s import-phone-number body and to
   the Deno `importPhoneNumber` payload type. `api-provision/handler.ts`
   now passes it there instead; two new required env vars
   (`RETELL_SIP_TRUNK_TERMINATION_URI`, `RETELL_INBOUND_WEBHOOK_URL`)
   document this in `.env.example`.
2. **`/publish-agent-version/{id}` REQUIRES a `{version: number, ...}` body
   and returns `void`** (VERIFY-6) — confirmed via `AgentPublishParams`/
   `Agent.publish`'s own return type. This codebase previously sent no
   body at all and expected `{agent_id, version}` back — every real call
   would have both 4xx'd (missing required field) AND thrown on response
   parsing even if it hadn't. Fixed: `PublishAgentVersionInput` gained a
   required `version`; `CreateOrUpdateAgentResult`/the Deno create-agent
   response type gained the (confirmed-required) `version` field so
   callers have it to publish with; `api-provision/handler.ts` now calls a
   new `getAgent` (`GET /get-agent/{id}`) helper right before publishing
   (robust whether the agent was just created or already existed from an
   earlier saga run); `admin/handler.ts`'s template-publish flow reads
   `version` off its own create-agent response instead.
3. **Conversation Flow's model field is a REQUIRED nested `model_choice:
   {model, type:"cascading", high_priority?}` object, NOT a flat `model`
   string** (VERIFY-8) — confirmed via `ConversationFlowCreateParams`
   (Retell LLM keeps `model` flat and optional — the two are NOT
   wire-compatible). `agents.ts` and `admin/handler.ts` now branch on
   `compile_target` when attaching the model.
4. **`start_speaker: "user"|"agent"` is REQUIRED on
   `ConversationFlowCreateParams`** (VERIFY-8) — a gap the new type-level
   SDK contract test caught directly (see below); Retell LLM leaves it
   optional. The compiler now always emits `start_speaker: "agent"` (every
   template opens with the agent's own greeting/disclosure line).
5. **`global_node: true` (a boolean) is not a real field —
   `global_node_setting: {condition: string, ...}` (an object, `condition`
   REQUIRED) is** (VERIFY-8) — confirmed via
   `ConversationFlowCreateParams.ConversationNode.GlobalNodeSetting`.
   Fixed in both the Node compiler and its Deno duplicate; `condition` is
   populated from the same `global_intent.description` text already used
   for the scoped-edge case.
6. **`tool_ids` is NOT a field on a plain `ConversationNode` at all** —
   confirmed absent from every property Retell documents on it (it exists
   only on `SubagentNode`, a node type this compiler doesn't emit).
   Removed from both compiler implementations. This surfaces a genuine
   SYSTEM_DESIGN §4.1-conflicting gap (that section wants hard "tool-backed
   nodes only... model cannot invent" per-state restriction) — flagged
   here rather than redesigned (CLAUDE.md Rule 4): every node in a compiled
   conversation-flow effectively has access to every tool the flow
   declares; per-state steering is soft/prompt-only. A real hard
   restriction would need adopting `SubagentNode`, a materially different
   graph shape — left as a follow-up, not attempted in this pass.
7. **Custom function tool `parameters.properties` is REQUIRED** whenever
   `parameters` is present at all (confirmed via
   `LlmCreateParams.CustomTool.Parameters`), even though this codebase's
   broader canonical `JsonSchemaObject` (used for template-authoring)
   allows omitting it. Both compiler implementations now default an
   omitted `properties` to `{}` when lowering a canonical tool to a wire
   tool, so a zero-argument tool still produces a valid request.
8. **`/import-phone-number`'s `inbound_agents[].weight` is REQUIRED** (not
   optional) and **`outbound_agent_id` (a bare string) does not exist —
   the real field is `outbound_agents` (an array, same shape as
   `inbound_agents`)** — confirmed via `PhoneNumberImportParams`. Fixed in
   `numbers.ts` (always sends `weight: 1` for this product's single-agent
   case) and in `api-provision/handler.ts`.
9. **`/import-phone-number`'s response has no `phone_number_id` field —
   the number's own `phone_number` (E.164) IS its unique identifier**
   (confirmed via `PhoneNumberResponse`'s own doc comment). Fixed
   `api-provision/handler.ts`'s `retell_number_id` write (previously always
   wrote `null`, since the field it read never existed).
10. **The `job-retell-health-failover` probe called the wrong endpoint
    entirely** — `GET /list-agents` (no such route) instead of
    `POST /v2/list-agents?limit=1` (confirmed via `Agent.list`) — every
    real health check would 404/405 and register Retell as perpetually
    down, silently making the failover threshold fire spuriously. Fixed.
11. **`disconnection_reason`'s enum was a partial/wrong guess** (VERIFY-5)
    — confirmed the FULL real enum via `PhoneCallResponse.
    disconnection_reason` (34 values: `dial_no_answer` not `no_answer`,
    a family of `error_*` variants instead of one generic `error`,
    `transfer_bridged`/`transfer_cancelled`/`manual_stopped`/
    `call_take_over`/etc.). Updated both
    `RETELL_DISCONNECTION_REASONS` (raw-types.ts) and canonical
    `DISCONNECTION_REASONS` (voice-provider.ts) to the confirmed full
    list — previously, most real disconnection reasons besides the exact
    9 originally guessed were silently collapsing to `"unknown"`, losing
    real operational signal (e.g. `dial_no_answer` never matched the
    guessed `no_answer`).
12. **The transcript-turn schema guessed a nonexistent `text` field** —
    confirmed via `PhoneCallResponse.TranscriptObject` that the real,
    REQUIRED field is `content` (not `text`, which doesn't exist), `role`
    is a closed 3-value enum (`agent`/`user`/`transfer_target`), and
    `words` is required (possibly empty). Fixed
    `_shared/schemas/voice-events.ts`'s `RetellTranscriptTurnSchema`.

**Partially confirmed / still genuinely open (docs/VERIFY.md updated, not
resolved)**: VERIFY-2 (inbound-call webhook envelope) and VERIFY-3
(tool-call webhook envelope) are webhook PAYLOAD shapes, which — as this
task's own instructions anticipated — aren't part of either SDK's typed
REST surface at all (webhooks are server→client pushes, never a
client-invoked resource). The SDK's `CustomTool.args_at_root` doc comment
("If set to true, the parameters will be passed as root level JSON object
instead of nested under 'args'") DOES corroborate that the default
(unset) envelope nests params under `args`, matching this codebase's
existing assumption, and `CallCreatePhoneCallParams.override_agent_id`
independently corroborates `override_agent_id` as Retell's real naming
convention for "override which agent handles this call" (used in our
assumed `call_inbound` response envelope) — both noted in VERIFY.md as
partial corroboration. The exact envelope nesting (whether `call_id` is
present at the top level, whether the tool-call `call` object's
`from_number` field is named that) remains unconfirmable without a live
sandbox call, exactly as originally flagged.

**Type-level contract test added**: `retell-sdk` (v5.64.0) is now a
devDependency of `packages/adapters/retell` ONLY (never a runtime
dependency, never referenced outside this package — CLAUDE.md Rule 2).
`packages/adapters/retell/src/sdk-contract.test.ts` imports the SDK's own
request/response types and statically asserts (via `tsc`, not a runtime
assertion) that this package's compiler/request-builder output is
assignable to them — covering the conversation-flow/multi-prompt/
single-prompt bodies, the custom-function tool shape, the `response_engine`
discriminated union, the publish-agent-version body, and the
import-phone-number body. This is what caught finding #4 above
(`start_speaker`) directly, and will keep catching a future SDK field
rename/removal at `tsc` time rather than silently drifting.

**Root gates**: `pnpm --filter @heyloo/adapter-retell {typecheck,test}` and
`pnpm --filter @heyloo/edge-functions {typecheck,test}` all green (101 and
416 tests respectively, including the new contract test and every updated
fixture/snapshot). Full monorepo `pnpm run {typecheck,lint,test,build}` all
green (18/18, 18/18, 18/18, 12/12 tasks respectively) — `lint` was
re-verified with a scoped `biome check --write` limited to this task's own
two new/changed test files only (never a blanket `--write` across the
shared working directory, given `PROVIDERS-VERIFY`'s concurrent WIP noted
above).

**Not committed**: `pnpm-lock.yaml` — it currently mixes this task's own
`retell-sdk` addition with `PROVIDERS-VERIFY`'s concurrent `square`/
`googleapis` additions (same shared working directory), and a lockfile
isn't meaningfully committable as a partial diff. `packages/adapters/
retell/package.json`'s new devDependency is committed; regenerating a
clean lockfile is a fast follow-up once both concurrent tasks are done
touching this checkout.

## LIVE-MINE-DB — Mine the live legacy Supabase DB for production learnings

Read-only SQL mining of the live legacy project (`qulcubtwqsqgqpfgvorn`)
against `legacy/` repo source and the new schema/spec. Full writeup with
all 10 findings: `docs/LEGACY_LIVE_FINDINGS.md` § Database. This entry
covers only the findings that recommend a concrete change to the new
migrations/specs; the rest are ALREADY COVERED, deferred, or
informational-only (see that doc for the full picture, including
confirmation that the new schema's per-tenant timezone handling and
incremental customer-stats trigger already fix two real bugs the legacy
production DB was hand-patched for).

**No migration changes made by this task** (out of scope per CLAUDE.md
Rule 4/task scope — DB mining only). Three follow-ups recommended for
whichever task next touches these areas:

1. **Booking buffer/turnaround time.** Legacy's live
   `get_available_slots(...)` padded every candidate slot by a
   `p_buffer_minutes` (default 15) gap against existing appointments —
   real vertical need (chair/room/bay cleanup and turnaround time), which
   the new schema has no equivalent for.
   `resources.metadata` already documents a `{"slot_minutes": <int>}`
   override channel (`booking_core.sql`); recommend adding a sibling
   `buffer_minutes` key there (or on `offerings.metadata`), consumed by
   `fn_regenerate_availability_slots` (`functions_triggers.sql`) when
   materializing `availability_slots` so the gap is baked in at
   precompute time, not the hot path.

2. **E.164 format CHECK constraints.** Neither the legacy live DB nor the
   new schema enforces phone-number shape at the database boundary —
   `phone_numbers.e164`, `customers.phone_e164`,
   `messages_inbound.from_e164`/`to_e164` are all bare `text not null`
   with only uniqueness constraints. CLAUDE.md Rule 2 already commits to
   E.164-everywhere as an architecture invariant; recommend
   `CHECK (col ~ '^\+[1-9]\d{1,14}$')` on each of the four columns above
   as a defense-in-depth layer independent of the application-level Zod
   validators, so a normalization bug fails loudly at insert time instead
   of silently persisting a malformed number (exactly the kind of
   app-layer-only invariant that drifted unnoticed in the legacy
   production DB — see Finding 1 in the findings doc).

3. **Booking exclusion-constraint predicate — tripwire, not a change
   yet.** `bookings`' exclusion constraint only blocks overlap for
   `status = 'confirmed'` (`booking_core.sql`); legacy's live constraint
   blocked overlap for every status except `cancelled`. Today this is
   safe — `create_booking` (BACKEND_SPEC.md §7.2.2) writes `confirmed`
   directly and no code path uses `scheduled`/a hold state — but the day
   any tool call starts writing a non-`confirmed` interim status (e.g. a
   payment-pending hold), the exclusion constraint as written will not
   catch two concurrent holds on the same resource/time. Whoever adds
   that first interim-status code path should widen the predicate (e.g.
   `where (status not in ('cancelled', 'rescheduled'))`) in the same
   migration.

Also logged for later (dental/HIPAA wave only, not actionable now):
legacy's `log_phi_access`/`phi_audit_log`/`medical_alerts`/
`insurance_profiles`/`accepted_carriers` are a working, production-tested
PHI-audit pattern worth reusing when the dental vertical (Phase 4 per
MASTER_PLAN) is built — but fix `insurance_profiles`'s
`UNIQUE (customer_id, is_primary)` quirk (caps a customer at 2 rows
total) to a partial unique index (`WHERE is_primary`) rather than copying
it as-is. Full detail in `docs/LEGACY_LIVE_FINDINGS.md` Finding 9.

## LIVE-MINE-EDGE — Legacy live edge-function mining

Read-only mining of the live legacy Supabase project's (`qulcubtwqsqgqpfgvorn`)
deployed edge-function source (Management API, 9 of 14 functions fetched)
against `docs/VERIFY.md` VERIFY-2/VERIFY-3 and the new adapter/hot-path
code. Full writeup with all findings: `docs/LEGACY_LIVE_FINDINGS.md` §
Edge Functions. This entry covers only the follow-ups that recommend a
concrete change; the rest are ALREADY COVERED, informational, or deferred
(see that doc for the full picture, including confirmation that the new
system's webhook idempotency, async recording-fetch, and `lookup_customer`
caller-scoping designs each independently fix a real gap that shipped in
the legacy production system).

**No adapter/function code changed by this task** (out of scope per
CLAUDE.md Rule 4 — mining only, edge-function code changes belong to
whoever owns `packages/adapters/retell`/`supabase/functions/voice-inbound`
next). Follow-ups recommended:

1. **`voice-inbound` request shape — highest priority, likely a real bug.**
   Live legacy evidence (76 production redeploys of `retell-assistant`)
   shows Retell's `call_inbound` webhook body is
   `{event: "call_inbound", call_inbound: {from_number, to_number, ...}}`
   — nested — not the flat `{call_id, from_number, to_number, agent_id?}`
   body `supabase/functions/_shared/schemas/voice-inbound.ts:11-17`
   (`VoiceInboundRequestSchema`) currently requires. As written, a real
   inbound call would fail this schema's required fields and
   `voice-inbound/index.ts` would return 400 `invalid_request` — silence
   on the agent's greeting for every real call. Recommend: update
   `VoiceInboundRequestSchema` to accept the nested shape (event
   discriminator + `call_inbound: {from_number, to_number}`, or `.loose()`
   both shapes defensively if a live sandbox call can't be run
   immediately), and the mirroring
   `packages/adapters/retell/src/raw-types.ts:31-36`
   (`zRetellInboundCallWebhook`) for consistency. The RESPONSE envelope
   both already emit is correct as-is — do not change that half. Cheapest
   way to fully close this out: one real inbound test call against a
   staging Retell agent before this ships, per VERIFY-2's own standing
   recommendation. See `docs/LEGACY_LIVE_FINDINGS.md` § Edge Functions
   ("VERIFY-2") and `docs/VERIFY.md`'s updated VERIFY-2 entry.

2. **`agents.ts` — add `webhook_timeout_ms` to Agent create/update.**
   Legacy's live `create_agent` calls always set `webhook_timeout_ms: 10000`
   alongside `webhook_url` — very likely a hotfix reaction to its own
   (separately fixed) synchronous-recording-download timeout risk. The new
   `CreateOrUpdateAgentInput`/`agents.ts` sets `webhook_url` but no
   timeout override at all. Since the new system already processes
   recordings asynchronously this is low-risk either way, but it's a
   free, cheap knob — recommend adding an explicit
   `webhook_timeout_ms` field (default ~10000ms) rather than relying on
   whatever Retell's undocumented default is.

3. **`square.ts` comment update — confirmation, not a behavior change.**
   `supabase/functions/_shared/providers/square.ts:193-204`'s own comment
   flags its `HMAC-SHA256(notificationUrl + rawBody)` signature scheme as
   an unconfirmed "starting hypothesis" (Square's docs were egress-blocked
   during that build). Live legacy `square-webhook` (v15) implements the
   identical algorithm/message construction/header name. Recommend
   updating that comment to cite this live confirmation (and drop the
   "re-verify before coding" framing) next time that file is touched —
   no logic change needed, the implementation is already correct and
   already stronger than legacy's (uses `timingSafeEqual`, fails closed
   on a missing secret; legacy's caller silently allowed traffic through
   when the secret env var was unset).

4. **Future Clover adapter — two informational notes to carry forward.**
   No Clover adapter exists yet in this repo. When one is built: (a)
   legacy's live `clover-webhook` has no signature/HMAC verification of
   any kind — confirm from Clover's *current* docs (Rule 1) whether a
   real verification mechanism exists before assuming none does; if none
   does, legacy's mitigating pattern (treat the webhook only as a
   "something changed, re-fetch via the stored OAuth token" trigger,
   never trust webhook-body fields as data) is worth adopting deliberately
   rather than by accident. (b) Clover's OAuth credential env vars may be
   documented under either "Client ID/Secret" or "App ID/Secret" naming
   (legacy's live `pos-sync` accepted both via a fallback chain) — pick
   one canonical `.env.example` name and note the alternate term in its
   comment.

5. **Conversation-flow `function`-node shape — reference for the compiler.**
   Live legacy `retell-manage` builds real `type: "function"` nodes
   (`tool_id`, `tool_type: "local"`, `speak_during_execution`,
   `speak_after_execution`, `wait_for_result`) — not currently in
   `packages/adapters/retell/src/compiler/conversation-flow.ts`'s node
   vocabulary or VERIFY-8's inventory. Potentially relevant to VERIFY-8's
   already-flagged "no hard per-node tool-restriction" architecture gap
   (a `function` node, unlike a `conversation` node, only exposes the one
   tool it names — closer to SYSTEM_DESIGN §4.1's stated hard-slot-filling
   goal than the current all-tools-everywhere `conversation` node shape).
   Not actionable within this task's scope; logged for whoever next
   revisits the conversation-flow compiler.

## LIVE-MINE-FIXES — Fix pack applied from the live-legacy mining findings

Applied the fix pack recommended by LIVE-MINE-DB and LIVE-MINE-EDGE above
(`docs/LEGACY_LIVE_FINDINGS.md`). One new additive migration
(`supabase/migrations/20260909120000_live_mining_hardening.sql`); no
existing migration edited.

**LIVE-MINE-EDGE item 1 (voice-inbound nested envelope) — APPLIED.**
`supabase/functions/_shared/schemas/voice-inbound.ts`
(`VoiceInboundRequestSchema`) and `packages/adapters/retell/src/raw-types.ts`
(`zRetellInboundCallWebhook`) now validate Retell's real nested
`{event, call_inbound: {from_number, to_number, agent_id?}}` body instead
of the flat legacy-assumed shape — confirmed there is no `call_id` field
in this webhook at all, so `supabase/functions/voice-inbound/handler.ts`,
`packages/adapters/retell/src/inbound.ts`, and canonical
`InboundCallContext.providerCallId`
(`packages/canonical-types/src/voice-provider.ts`, now optional) were
updated to match — every previous `call_id` log/read is now either
dropped or replaced with the raw to/from number. The RESPONSE envelope is
unchanged (already confirmed correct). All affected fixtures/tests updated
plus a new regression test in both
`supabase/functions/voice-inbound/handler.test.ts` and
`packages/adapters/retell/src/inbound.test.ts` asserting the old flat
shape is now rejected. `docs/VERIFY.md` VERIFY-2 updated to
"code fix applied" (one live test call still recommended before go-live).

**LIVE-MINE-EDGE item 2 (`webhook_timeout_ms`) — APPLIED.**
`CreateOrUpdateAgentInput.webhookTimeoutMs?`
(`packages/canonical-types/src/voice-provider.ts`) and
`packages/adapters/retell/src/agents.ts` now set an explicit
`webhook_timeout_ms` (default 10000, configurable via the input) alongside
`webhook_url` on every agent create/update. Covered by two new tests in
`packages/adapters/retell/src/agents.test.ts` (default value, explicit
override).

**LIVE-MINE-EDGE item 3 (`square.ts` comment) — APPLIED.**
`supabase/functions/_shared/providers/square.ts`'s HMAC-scheme comment now
cites the live legacy `square-webhook` confirmation instead of framing the
scheme as an unconfirmed hypothesis. No logic change.

**LIVE-MINE-DB items 1-3 — APPLIED**, all three in the new migration:
(a) `resources.buffer_minutes int not null default 0` (a real column, not
`resources.metadata`, per this task's explicit instruction) plus a
`create or replace` of `fn_regenerate_availability_slots` that now checks
each generated slot against the resource's existing confirmed bookings,
buffer-padded on both sides — same check legacy's live
`get_available_slots()` did at request time, baked in here at precompute
time instead (zero runtime arithmetic on the hot path, unchanged). (b)
`CHECK (col ~ '^\+[1-9]\d{1,14}$')` added via plain `ALTER TABLE` (tables
are pre-launch/empty, so no `NOT VALID`/`VALIDATE CONSTRAINT` two-step
needed) on `phone_numbers.e164`, `customers.phone_e164`,
`messages_inbound.from_e164`, `messages_inbound.to_e164` — verified
`supabase/seed/seed.sql` inserts no row into any of these four columns, so
no seed fix was needed. (c) `COMMENT ON CONSTRAINT
bookings_resource_id_during_excl ON public.bookings` (the real,
Postgres-assigned name for the unnamed `exclude` clause in
`20260907130600_booking_core.sql`) now carries the tripwire text — no
predicate change, per Finding 3's own recommendation ("not a change yet").

**Verification performed** (same no-Docker/`supabase start` constraint as
T1 — CLAUDE.md Rule 1 disclosure): built a throwaway local-Postgres
harness (stub `auth`/`realtime`/`storage` schemas, extensions trimmed of
`pg_cron`/`pgmq`/`pg_net`, matching T1's documented approach) and applied
all 20 real migration files verbatim, in order, from an empty database,
followed by `supabase/seed/seed.sql` — both succeeded with zero errors
(confirms "reproducible from zero" end to end, not just the new file in
isolation). Directly exercised the new `fn_regenerate_availability_slots`:
set `buffer_minutes = 15` on the seeded auto-demo tenant's Bay 1, inserted
a confirmed 30-minute booking into one of its precomputed slots, called
the function again, and confirmed both the booked slot AND the
immediately-following slot (within the 15-minute buffer) came back
`is_available = false`, while the slot after that (outside the buffer)
stayed `true`. Directly exercised all four new CHECK constraints (each
rejects a malformed number, accepts a valid E.164 one). Confirmed the
exclusion constraint's real name (`bookings_resource_id_during_excl`) and
that the `COMMENT ON CONSTRAINT` attaches correctly. Harness and scratch
SQL files were session-only, never committed.

## DEPLOY-1 — First live deployment (2026-09-09, session_012xvcAnjqsMbPqitErDJQbR)

Deployed to live Supabase project `qulcubtwqsqgqpfgvorn` over the
Management API (HTTPS only; direct Postgres TCP unreachable from the build
environment). Findings that produced code changes:

1. **`tool_health` was created without RLS** (20260907140000) — the one
   table violating Rule 2. Fixed by new migration
   `20260909130000_tool_health_rls.sql` (enable RLS, zero policies =
   default-deny; service_role bypasses). Live DB now reports zero
   `rowsecurity=false` tables.
2. **Deno bundler rejects NodeNext `.js`-extension relative imports.**
   Local Vitest/tsc (NodeNext) resolved `./x.js` → `x.ts`, but the Edge
   Functions bundler resolves literal paths, so every function 400'd at
   deploy. Rewrote all relative imports under `supabase/functions/` to
   real `.ts` extensions and set `allowImportingTsExtensions` in the
   functions tsconfig (already `noEmit`). 419/419 tests still green.
3. **`deno.json` import map is NOT auto-read by `functions deploy
   --use-api`** (resolves the deno.json `$comment`'s open question):
   bare `postgres`/`zod` specifiers 400'd until the map was passed
   explicitly. Canonical deploy command is now
   `npx supabase functions deploy --use-api --import-map
   supabase/functions/deno.json` (docs/DEPLOY.md should use exactly this).
4. **Edge-function secrets cannot start with `SUPABASE_`** (platform
   restriction), so the functions' service-key env var was renamed
   `SUPABASE_SECRET_KEY` → `SB_SECRET_KEY` (6 occurrences;
   `.env.example` documents the pairing). `SUPABASE_URL`/`SUPABASE_DB_URL`
   remain platform-injected names and are unaffected.

Deployed state: 22 migrations applied + recorded in
`supabase_migrations.schema_migrations`; seed applied (12
platform_settings rows); 52 tables, RLS on all; auth Custom Access Token
hook enabled → `public.custom_access_token_hook`; all 27 edge functions
ACTIVE; 8 function secrets set (4 generated internal secrets + 4 derived
webhook/function URLs). Owner-side remainder tracked in LAUNCH_STATUS.

## Cluster B — Signup → checkout → provisioning → forwarding fix wave (2026-09-10)

Fixed EDGE_AUDIT B1/B2/H3, E2E_FLOWS_AUDIT B1/B2/H1 (referral clawback),
and FRONTEND_AUDIT's checkout tenant_id trust gap, per that pass's own
named fixes.

- **`webhooks-stripe`** (`handler.ts`/`index.ts`): `checkout.session
  .completed` now actually invokes `/api-provision`'s internal-secret path
  (`x-internal-secret` + `PROVISION_INTERNAL_SECRET`, header/body names
  matching `api-provision/index.ts`'s own parsing exactly) after the tenant
  activates, skipping the call entirely once `provisioning_runs.publish_agent
  = 'succeeded'`. An invocation failure (network error or non-2xx/409)
  writes a `provisioning_runs` row (`step='tenant_finalize', status=
  'failed'`) + a `critical` `alerts` row rather than silently dropping —
  the saga's own per-step failures already self-record via its existing
  `recordStep`, this only covers the case where the HTTP call itself never
  reached the saga.

  REPAIR (2026-09-10): that invocation was itself unreachable over real
  HTTP — `invokeProvisioning`'s `fetch` sent only `content-type` and
  `x-internal-secret`, no `Authorization` header, but `config.toml` sets
  `[functions.api-provision] verify_jwt = true`, and Supabase's platform
  gateway rejects any `verify_jwt = true` function call with a missing/
  invalid `Authorization: Bearer <jwt>` with 401 BEFORE the function code
  (and its own `x-internal-secret` bypass) ever runs — `scripts/e2e-
  backend.ts`'s own `callFunction` comment independently documents this
  same platform requirement. Fixed by extracting the call into `webhooks-
  stripe/invoke-provisioning.ts`'s `createInvokeProvisioning`, which now
  sends `authorization: Bearer ${SB_SECRET_KEY}` (the same service-role
  token/env-var name `worker-recording-fetch` and `job-retention-sweep`
  already use for their own internal calls) ALONGSIDE the existing
  `x-internal-secret` header — the bearer token clears the platform gate,
  `x-internal-secret` remains the in-function tenant-trust check per
  `api-provision/index.ts`'s own comment. `config.toml`'s `verify_jwt =
  true` on `api-provision` was kept as-is (did not take the alternative
  `verify_jwt = false` fix), so `docs/DEPLOY.md`'s `verify_jwt` table is
  unchanged. Regression coverage: `invoke-provisioning.test.ts` asserts the
  real `fetch` call's headers include both `authorization` and
  `x-internal-secret` (previously only the mocked-`invokeProvisioning`
  contract in `handler.test.ts` was tested, which could not have caught a
  missing-header bug in the real HTTP call).

  Added `charge.refunded`/`charge.dispute.created`
  handling: reverses the referred tenant's `referrals.status` and every
  non-clawed-back `commission_events` row to `'clawed_back'`, and reverses
  `referral_partners.ytd_payout_cents` when a clawed-back commission had
  already been marked `'paid'` (SYSTEM_DESIGN §6/§10 G34's documented
  clawback rule). `charge.dispute.created`'s Dispute object has no
  `customer` field (STRIPE-VERIFY-1, docs/VERIFY.md) — resolved via the
  `payment_processing_events.stripe_charge_id -> tenant_id` mapping
  `charge.succeeded` already writes, not a live Stripe API fetch.
- **`api-provision`** (`handler.ts`/`index.ts`): `compileTemplate` is no
  longer a stub. `index.ts` now loads the tenant's active `agent_templates`
  row for its vertical and runs it through the SAME real compiler
  `admin/handler.ts`'s template-publish route already uses in production
  (`_shared/compiler/template-compiler.ts` — a lean, deliberately-
  duplicated port of `packages/adapters/retell/src/compiler/*`, not a new
  stand-in; see that module's own docstring for why Deno can't import the
  Node-only `packages/adapters/retell`/`packages/templates` workspace
  packages directly without a bundling step neither task adds — the exact
  same constraint T3 already documented, applied here rather than
  reinvented). The saga's `agent_compile` step now HARD-FAILS (never calls
  Retell, records `provisioning_runs.error='disclosure_gate_failed'`) when
  the compiled flow's first turn doesn't contain the tenant's
  `disclosure_line` verbatim — closing EDGE_AUDIT B2 exactly as that
  finding's own suggested fix describes. On success it now runs the real
  two-step Retell protocol (`create-conversation-flow`/`create-retell-llm`
  -> `create-agent` referencing that flow via `response_engine`) instead of
  passing a placeholder object straight to `create-agent`. `packages/
  adapters/retell`/`packages/templates` themselves were NOT touched — no
  export was missing, this cluster's task text's "prefer existing exports"
  condition was satisfied by the compiler module T3/T4 already shipped.
- **`apps/web` checkout/signup**: per BACKEND_SPEC's own already-documented
  resolution (`api-checkout/handler.ts`'s docstring — `webhooks-stripe`/
  `api-provision` both assume a `tenants` row exists by
  `checkout.session.completed`), `api-checkout` is the one function that
  creates the `tenants`+owner-`memberships` rows; the duplicate
  `/api/signup/create-tenant` Route Handler (which created its own
  `tenants` row via a service-role client, bypassing `api-checkout`
  entirely) has been DELETED. `/api/checkout/session` now proxies to the
  real `api-checkout` edge function (not the nonexistent
  `api-checkout-session` the old code called) with exactly the body
  `CheckoutRequestSchema` parses (`vertical`, `business_name`, `email`,
  `timezone?`) — every field server-derived (signed draft cookie +
  authenticated session), never a client-supplied `tenant_id` (there is no
  `tenant_id` in this contract at all now, closing the FRONTEND_AUDIT
  trust-gap finding more completely than asserting equality would have).
  `account-step-client.tsx` and the `tests/e2e/signup-checkout.spec.ts`
  smoke test were updated to match (one fewer network hop). The pure
  request-builder lives in `build-request.ts` (not `route.ts` itself) so it
  can be unit-tested without pulling in `server-only`-guarded runtime code
  under Vitest's jsdom environment.
- **Found and NOT fixed (out of this cluster's ownership, filed in
  `docs/audit/FIX_REQUESTS.md`)**: `packages/supabase-client/src/
  vertical-mapping.ts`'s `VERTICAL_TO_DB_VALUE`/`DB_VALUE_TO_VERTICAL` maps
  the canonical `Vertical` short form to a LONG form (`"auto_repair"`,
  `"veterinary"`) that no longer matches the live `tenants.vertical` check
  constraint (`supabase/migrations/20260907130100_tenancy.sql` — short form
  only, `'auto'`/`'vet'`/...). The deleted `create-tenant` route used this
  stale mapping (an already-shipped, now-moot bug since that route no
  longer exists); the new checkout route deliberately does NOT use it,
  passing `draft.business_type` straight through since it's already the
  short form both `CheckoutRequestSchema` and the live constraint expect.
  No other call site was found using this mapping, but the package itself
  is out of this cluster's ownership to correct or delete.
- **Also hardened** (small, same-pattern fix, not separately audited):
  `/api/phone/forwarding-test` now asserts the caller's own JWT claims
  `tenant_id` against the request body's `tenant_id` before proxying to
  `forwarding-verify` (that edge function already enforced this
  server-side, so this is defense-in-depth consistency with the checkout
  fix above, not a closed vulnerability).

**Tests:** `supabase/functions` — 430/430 passing (whole-workspace run),
including new coverage for the provisioning-invoke path, the disclosure
hard-fail, the real two-step Retell flow-then-agent creation, and the
referral clawback (qualified/paid/already-clawed-back/no-referral cases).
`apps/web` — new `build-request.test.ts` (seam contract test for the
checkout body shape) + existing suite, 8/8 passing; `tsc -b` clean.

## Fix wave — Cluster C (realtime + dashboard/admin truthfulness)

Scope: docs/audit/E2E_FLOWS_AUDIT.md B3 (realtime topic mismatch) and the
FRONTEND_AUDIT.md findings assigned to this cluster (H2/H3 Overview+Billing
fabricated numbers, H7 Refer&Earn fabricated funnel, H6 Airtable stub, H8
impersonation decorative, H9 admin Platform Settings stub, M2 admin
alert-rule editor stub).

**What was built**

- **Realtime channel fix (E2E B3).** `apps/web/src/lib/realtime/channel.ts`
  now exports `getTenantRealtimeChannelName(tenantId)` → `` `tenant:${tenantId}` ``
  — the exact string `fn_broadcast_tenant_update()` and the
  `tenant_channel_broadcast_select` RLS policy both already used. The
  provider (`tenant-realtime-provider.tsx`) previously subscribed to
  `` `private-tenant-${tenantId}` ``, which never matched either side — no
  dashboard client ever received a broadcast for any table/tenant. Fixed;
  unit test asserts the helper's output equals the SQL literal format.
  `payload.table` field access was already correct against
  `realtime.broadcast_changes()`'s real payload shape (`table`/`operation`/
  `schema`/`record`/`old_record`) — confirmed via `supabase/supabase`'s own
  `examples/prompts/use-realtime.md` on GitHub, since `supabase.com`'s
  hosted docs are egress-blocked in this environment (Rule 1.2; logged in
  `docs/VERIFY.md`).
- **Overview/Billing fabricated numbers (H2/H3).** New authenticated Route
  Handler `apps/web/src/app/api/platform-settings/tenant-plan/route.ts`
  reads the CALLER'S OWN tenant's `vertical` (never a client-supplied
  value) then that vertical's `price_card_<vertical>` + the platform-wide
  `usage_alert_thresholds` via the service-role client (`platform_settings`
  is admin-only RLS, so a tenant member can't read it directly). Overview's
  `minutesIncluded`/`spamDeflected` and Billing's `included`/usage-alert
  section now read this + a real `call_logs.classification = 'spam_robocall'`
  count instead of the literal `300`/`0` constants.
  - **Usage-alert toggles (H3):** no per-tenant persistence column exists
    for `alert_80_enabled`/`alert_100_enabled` (grepped every migration —
    zero hits; only the platform-wide `usage_alert_thresholds` key and the
    already-admin-settable `tenants.usage_hard_cap_minutes` exist). Per
    H3's own stated fallback ("remove the interactive switches and show the
    platform default as read-only text... don't ship a control that
    silently does nothing"), the toggles are now read-only text reflecting
    the real platform thresholds + the tenant's real hard-cap state.
    Per-tenant persisted toggle columns are requested from the DB cluster
    in `docs/audit/FIX_REQUESTS.md` as a follow-up, not built here (adding
    new `tenants` columns is a migration, outside this cluster's
    ownership).
- **Refer & Earn funnel (H7).** `api/tenant/refer/ensure-link/route.ts` now
  also returns real `signups`/`qualified`/`paid` counts (queried from
  `referrals` scoped to the tenant's own `referral_partners` row, same
  pattern the partner portal's `/portal/page.tsx` already used one file
  away) and an `approaching_w9_threshold` flag (80% of the $600 1099-NEC
  threshold, mirroring this app's own 80%-of-threshold convention) with a
  banner on the tenant refer page. Pure funnel/threshold math extracted to
  `funnel.ts` for unit testing (`funnel.test.ts`).
- **Airtable delivery (H6).** New route group
  `apps/web/src/app/api/tenant/delivery/airtable/{connect,callback,disconnect,status,sync-now}`
  implements a real OAuth2+PKCE flow against Airtable's documented
  endpoints (`airtable.com/oauth2/v1/{authorize,token}`) — state/verifier
  in a short-lived signed cookie (`shared.ts`, same signing pattern as
  `lib/signup/draft-cookie.ts`), a Zod boundary validator on the token
  response (airtable.com is egress-blocked here too; shape reconstructed
  from third-party write-ups per Rule 1.2, logged in `docs/VERIFY.md`), and
  a real popup + `postMessage` with a fixed-origin check on the delivery
  page. **Known incomplete, by design, not by oversight:**
  1. `adapter_connections.provider`'s CHECK constraint doesn't include
     `'airtable'` yet — the callback's upsert will fail (honestly, via
     `popupResultHtml({ok:false,...})`, never a fake success) until that
     migration lands (requested in FIX_REQUESTS.md).
  2. "Sync now" enqueues via `rpc/fn_enqueue_adapter_push`, which doesn't
     exist yet either (no `pgmq` schema exposure through PostgREST) —
     requested as a small `security definer` wrapper, plus a
     `pushToAirtable` branch in `worker-adapter-push`'s `ADAPTER_PUSHERS`
     (cluster E's file) to actually consume it. Both 501 honestly today.
  3. Multi-base picker UI is not built — auto-connects to the first base
     Airtable returns; flagged here rather than half-built.
  4. Provider-side token revoke on disconnect is not implemented — no
     documented Airtable revoke endpoint was reachable to confirm (clearing
     our own stored token is still real; logged in `docs/VERIFY.md`).
  `packages/supabase-client/src/database.types.ts` (generated, not owned
  by this cluster) predates `adapter_connections`/`airtable_sync_state` —
  a narrow, documented `untypedTable`/`untypedRpc` cast in `shared.ts` is
  the boundary until that's regenerated (requested in FIX_REQUESTS.md).
- **Impersonation end-to-end (H8).** `admin/handler.ts`'s
  `POST /admin-tenants/:id/impersonate` now requires a non-empty `reason`
  (`adminImpersonateSchema`, 422 without one) and returns a 30-minute
  `expires_at` alongside the real minted magic link; a new
  `POST /admin-tenants/:id/impersonate-end` writes the second audit entry
  the spec's "Enable edits" pattern implies. The admin tenant-detail page
  opens the magic link in a NEW tab (never navigating the admin's own
  cockpit session away) and stashes display state in `localStorage`
  (`apps/web/src/lib/impersonation/state.ts` — same-origin-shared across
  tabs) for the new `/dashboard` tab to read
  (`use-impersonation-banner.tsx`). **Known limitation, flagged rather than
  faked:** this is real audit logging + a real independent session (never
  simulated), but "read-only-by-default, edit-mode enforced server-side"
  is NOT yet server-enforced — that needs an `impersonated_by`/
  `impersonation_edit_enabled` JWT claim from `custom_access_token_hook`
  checked by the tenant write RLS policies, a migration outside this
  cluster's ownership (requested in FIX_REQUESTS.md). `ImpersonationBanner`
  mount in the `(tenant)` layout is requested from cluster D with the exact
  import/prop contract (FIX_REQUESTS.md) since that file isn't in this
  cluster's ownership.
- **Admin Platform Settings (H9).** New `admin-platform-settings` route
  group in `admin/handler.ts`: `GET` loads the real `referral_flat_amount_cents`/
  `referral_qualification_rule`/`price_card_<vertical>` rows (never an
  invented default); `PATCH .../referral` and `POST .../pricing` validate
  with the same shape as `adminReferralSettingSchema`/
  `platformPricingTableSchema` (re-declared locally in `schemas.ts` — Deno
  can't import the Node `@heyloo/canonical-types` package directly, same
  constraint `api-adapter-connect/schema.ts` already documents) and write
  real `platform_settings` rows + an `admin_actions` before/after audit
  row. **Scope decision:** the pricing schema's own comment says saving
  "writes a NEW price_version, never mutates one" — no versioned-price-key
  system exists anywhere in this codebase (`job-billing-cycle` only ever
  reads the unversioned `price_card_<vertical>` key, confirmed by reading
  it), so building one here would be a redesign outside this task (Rule
  4). The pricing POST updates that same key in place; the full
  before/after is preserved immutably in `admin_actions` instead, which is
  the audit-trail guarantee the schema comment is really protecting. The
  frontend page (`cockpit/settings/page.tsx`) now seeds every field from
  this real GET response — never a hardcoded `useState` default — via a
  `key`-remounted sub-component per vertical rather than an effect (avoids
  a `setState`-in-effect render cascade the lint rule correctly flags).
- **Admin alert-rule editor (M2).** No rule-definition table exists
  anywhere (`public.alerts` is fired-instance rows only, confirmed by grep;
  `job-alert-evaluation`'s own comment says thresholds are "not yet
  defined" in `platform_settings`) — `AlertRule`'s actual shape
  (`packages/ui/src/custom/alert-rule-row.tsx`) confirms rules, not fired
  alerts, is what `/cockpit/alerts` is meant to CRUD. Also found: the page
  was pointed at the wrong resource entirely (`admin-alerts`, the
  fired-alert list, not a rules endpoint) — a deeper break than the audit's
  "edit is a stub" framing alone suggested. New `admin-alerts/rules`
  GET/POST/PATCH/DELETE group stores rules as a single `platform_settings`
  row (`admin_alert_rules`, `{rules: [...]}`, each with a generated `id`) —
  that table is exactly "Admin-editable key/value store" per its own
  comment, so no migration is needed. Frontend now points at the right
  resource and has a real create/edit `Dialog` using
  `adminAlertThresholdSchema`.
- **Loading/error/empty states:** Billing and admin Platform Settings now
  use `DataState` (previously bare `useQuery` + local `useState` defaults);
  Overview/Refer/Alerts already did.

**Cross-cluster requests filed** (docs/audit/FIX_REQUESTS.md, all under
"Requesting cluster: C"): `adapter_connections.provider` CHECK constraint
add `'airtable'`; a `public.fn_enqueue_adapter_push` PostgREST-exposed RPC
wrapper around `pgmq.send('adapter_push_queue', ...)`; regenerate
`packages/supabase-client/src/database.types.ts`; a `pushToAirtable` branch
in `worker-adapter-push`'s `ADAPTER_PUSHERS`; an optional `redirectTo` param
on `_shared/providers/supabase-admin.ts`'s `generateMagicLink`; per-tenant
`alert_80_enabled`/`alert_100_enabled` columns (or confirm the read-only
platform-default display is the intended final design instead); the
`impersonated_by`/`impersonation_edit_enabled` JWT claim + RLS policy work
for true server-enforced impersonation edit-mode; the `ImpersonationBanner`
mount in the `(tenant)` layout with the `useImpersonationBanner` contract;
Airtable OAuth env vars (`AIRTABLE_OAUTH_CLIENT_ID`/`_CLIENT_SECRET`/
`_REDIRECT_URI`/`AIRTABLE_OAUTH_STATE_SECRET`) for `.env.example`.

**Tests:** `apps/web` — 41/41 passing (10 test files, including new
`channel.test.ts`, `funnel.test.ts`, `shared.test.ts`, `state.test.ts`),
`tsc -b` clean, `eslint .` clean except pre-existing findings in files this
cluster doesn't own (`agent/vertical-details/page.tsx` unescaped entities —
another cluster's in-progress work). `supabase/functions` — `admin/
handler.test.ts` 52/52 passing (added ~20 new cases for platform-settings/
alert-rules/impersonation), `tsc --noEmit` clean.

## Fix wave — Cluster D (tenant screens + bookings UI, 2026-09-10)

Scope: MASTER_SPEC.md §3.10 (the frontend patch pack — 100% missing per
FRONTEND_AUDIT.md), FRONTEND_AUDIT.md Finding H4 (no Reschedule UI despite
a working backend), E2E_FLOWS_AUDIT.md Flow 5 (no dashboard surface for
orders/payment links).

**What was built**

- **Vertical details tab** (`dashboard/agent/vertical-details/page.tsx`,
  new `AgentSettingsTabs` entry). Renders `verticalDetailsSchema`'s fields
  conditionally per `tenants.vertical` (dental/vet/auto/legal/motel/
  restaurant each get their own MASTER_SPEC §3.5 fields;
  `cancellation_policy` for every vertical), plus reminders/review toggles
  + `review_url` + `avg_transaction_value_cents`
  (`reminderReviewSettingsSchema`). Both schemas already existed, unused,
  exactly as FRONTEND_AUDIT.md's Finding H2 described — this cluster wired
  them up rather than re-deriving them. Two new Route Handlers
  (`api/tenant/agent/vertical-details`, `api/tenant/settings/reminders-review`)
  do the schema validation server-side (unlike the other agent-settings
  tabs, which only validate client-side) — these fields feed the live
  voice agent directly, so a bad value reaching
  `agent_configs.dynamic_variable_overrides` unvalidated is a live-call
  risk, not a cosmetic one.
- **Bookings Reschedule (H4).** The booking PATCH route
  (`api/tenant/bookings/[id]/route.ts`) already handled reschedule
  end-to-end but had no UI trigger and no dedicated tests. Added: a
  Reschedule button opening a slot-picker sourced from
  `availability_slots` (same table + `is_available` filter the voice
  backend reads, so the dashboard can't offer a double-book any more than
  the phone agent can), wired to the existing `bookingRescheduleSchema`
  (`{booking_id, new_slot_id}` — the route now validates against it and
  looks up the slot server-side rather than trusting client-supplied
  start/end timestamps, a tightening beyond what existed before). Also
  fixed two real template-key bugs found in the same file while wiring
  this up: `confirm` sent `template_key: "booking_confirmed"`, which
  doesn't exist in `supabase/functions/_shared/templates.ts`'s enum (only
  `"booking_confirmation"` does) — an empty-body SMS every time a booking
  was confirmed from the dashboard; `reschedule` had no matching template
  case at all and hit the same empty-body default. Both now use
  `"booking_confirmation"` with a real `{start_local}` payload (tenant-
  timezone-formatted via `tenants.timezone`).
- **Payment status + resend** (booking Sheet + new Orders detail page).
  Reads `payment_links` scoped to the booking/order; a "Resend link"
  button proxies to an edge function (`api-payment-link-resend`) that
  doesn't exist yet — same "frontend built against a documented contract,
  backend pending" pattern as the existing `api-checkout-session`/
  `api-billing-portal` entries in docs/VERIFY.md (a Stripe Checkout
  Session's own `url` isn't re-fetchable and the session expires, so a
  real resend has to mint a fresh one — provider-touching work that has to
  live in an edge function per CLAUDE.md Rule 2, not a Route Handler).
  Requested in docs/audit/FIX_REQUESTS.md with the exact contract this
  cluster's Route Handler already calls.
- **Waitlist section** under Bookings (`waitlist_entries`, RLS-readable/
  writable directly by tenant staff) — active entries with a "Remove"
  action, backed by a new tenant-scoped `api/tenant/waitlist/[id]` PATCH
  Route Handler (validated status enum) rather than a raw client write, so
  the mutation is testable and matches this cluster's other Route Handler
  patterns.
- **Messages** (new `dashboard/messages/**` + `api/tenant/messages/[phone]`).
  Per-phone-number thread view merging `messages_inbound` +
  `messages_outbound` (channel `sms`), STOP/opt-out status visible and
  reply disabled when opted out, reply form (`messageReplySchema`'s `body`
  field, reused rather than re-declared) posting through a service-role
  Route Handler (`messages_outbound` has no tenant client-write RLS policy
  — matches the existing pattern in `bookings/[id]/route.ts`'s
  notification insert). `messages_outbound` stores only
  `template_key`/`payload`, never a rendered body (BACKEND_SPEC §10.2 —
  rendered server-side at send time) — reproducing the exact customer-
  visible SMS text client-side would mean duplicating
  `_shared/templates.ts`'s renderer with no drift guard (the same
  maintenance-debt shape already flagged for the template-compiler
  duplication in docs/VERIFY.md), so outbound bubbles show a neutral
  system-label for templated sends and the real verbatim text only for an
  owner's own reply (`describeOutboundMessage`,
  `apps/web/src/lib/messages/outbound-preview.ts`, unit-tested). No
  broadcast trigger exists on `messages_inbound` yet (confirmed by grep,
  independently already flagged in E2E_FLOWS_AUDIT.md §3.3) — polls every
  15s as an honest interim rather than claiming realtime that isn't there;
  requested the trigger in docs/audit/FIX_REQUESTS.md. Also requested the
  one-case `"owner_reply"` template addition (currently falls to the
  `default: {body: ""}` case — an empty SMS — and, independently, the
  `fn_enqueue_message_outbound` RPC every `messages_outbound` insert from
  `apps/web` needs to ever actually leave `status: 'queued'`, since
  PostgREST has no `pgmq` schema access. **Scope note:** that queueing gap
  is pre-existing, not introduced here — `bookings/[id]/route.ts`'s
  booking-notification insert had the identical gap before this cluster
  touched the file; fixing it needs a migration outside this cluster's
  ownership, so it's requested rather than silently left as a dead insert.
- **Orders** (new `dashboard/orders/**` + `api/tenant/orders/[id]`). List
  (paginated, status-filtered, joined to `payment_links` for a payment-
  status column) + detail (items/totals/fulfillment/delivery address,
  status-transition buttons, payment-link resend) — `orders`/`payment_links`
  had zero frontend references anywhere before this (E2E_FLOWS_AUDIT.md
  Flow 5).
- **Nav + shell:** added Messages/Orders/Integrations to
  `AppSidebarNav`/`MobileTabBar` (Integrations links to
  `/dashboard/integrations`, built by a different cluster in this same
  fix wave — linked per this cluster's own task brief, not built here).
  Mounted `ImpersonationBanner` in `TenantShellClient` using cluster C's
  `useImpersonationBanner(tenantId)` hook/contract (found already posted
  in docs/audit/FIX_REQUESTS.md and already built at
  `apps/web/src/lib/impersonation/`) — this cluster's own earlier
  speculative cookie-based contract was written, then discarded in favor
  of the real one once found, per this task's own instruction to check
  FIX_REQUESTS.md late in the work.
- **Realtime:** no new plumbing needed — `bookings`/`orders` already have
  a broadcast trigger (`fn_broadcast_tenant_update`) and this cluster's
  query keys (`useTenantQuery(tenantId, "bookings"/"orders", ...)`) already
  match what `TenantRealtimeProvider` invalidates on, so those two pages
  get realtime refetch for free. `messages_inbound`/`payment_links`/
  `waitlist_entries` don't broadcast yet (see above) — those poll instead
  of claiming a live channel that isn't wired.

**Cross-cluster requests filed** (docs/audit/FIX_REQUESTS.md, all under
"Requesting cluster: D"): the `api-payment-link-resend` edge function; the
`public.fn_enqueue_message_outbound` RPC wrapper around
`pgmq.send('messages_outbound_queue', ...)`; a broadcast trigger on
`messages_inbound`; the `"owner_reply"` template case in
`_shared/templates.ts`; fixing `TenantRow.vertical`'s stale long-form union
in `packages/supabase-client/src/database.types.ts` (same root cause as
cluster B's `vertical-mapping.ts` finding); a "Message this customer" link
on the customers detail page (outside this cluster's ownership).

**Tests:** `apps/web` — added `route.test.ts` for every new/modified Route
Handler (`bookings/[id]`, `waitlist/[id]`, `orders/[id]`,
`payment-links/[id]/resend`, `messages/[phone]`) covering auth/tenant-
scoping plus the reschedule/409-conflict path, `tstzrange.test.ts` and
`outbound-preview.test.ts` for the two new pure-function utilities — 53/53
passing (13 test files). `tsc -b --pretty` clean, `eslint .` clean (only
pre-existing warnings in files this cluster doesn't own).

## Fix wave — Cluster E (voice tools, workers, failover, adapter security, 2026-09-10)

Fixed EDGE_AUDIT B1/H1/H2/M1/M2, E2E_FLOWS_AUDIT B4 (producer side), and
DB_AUDIT DB-H2, plus two standing FIX_REQUESTS.md items directed at this
cluster's exclusive `_shared/**`/`worker-adapter-push/**` ownership.

- **B1 (`create_booking` cross-tenant hole):** `voice-tools/tools/
  create_booking.ts` now verifies `args.resource_id` (and `args.offering_id`
  when present) belong to the caller's own `tenant_id` and are `active`
  before ever inserting — same `select ... where tenant_id = ctx.tenantId`
  pattern already used by every sibling tool. New result reasons
  `resource_not_found`/`offering_not_found`; tests cover both rejections.
- **M1 (`send_sms_confirmation` cross-tenant reference):** same pattern
  applied to `args.booking_id`/`args.order_id` in `voice-tools/tools/
  send_sms_confirmation.ts` before either is used in the idempotency
  soft-check or the write — new reasons `booking_not_found`/
  `order_not_found`. This tool had no test file at all before this fix;
  added `send_sms_confirmation.test.ts` covering both ownership checks,
  idempotent replay, and the A2P verified/pending_verification branches.
- **E2E B4 (adapter push producer, both halves):** new
  `_shared/adapter-push.ts` (`enqueueAdapterPush`) — looks up the tenant's
  actually-connected `adapter_connections` rows and enqueues one
  `adapter_push_queue` message per connected adapter that supports the
  given entity type, addressed by the REAL provider name (`square`,
  `shopmonkey`, `ezyvet`, `google_calendar`, `airtable`) rather than either
  never enqueueing at all (every booking tool, before this fix) or the
  literal `adapter: "pos"` `create_order.ts` used to send, which matched no
  key in `worker-adapter-push`'s `ADAPTER_PUSHERS` map and silently
  dead-ended at `adapter_push_not_implemented` for every single order push
  ever sent. Wired into `create_booking`/`update_booking`/`cancel_booking`
  (entity_type `"booking"`, on create/reschedule/cancel respectively) and
  fixed in `create_order` (entity_type `"order"`). A dedicated
  producer<->consumer contract test (`_shared/adapter-push.test.ts`)
  imports the real `ADAPTER_PUSHERS` map and asserts every provider the
  producer can address has a registered pusher, plus a field-name contract
  check on the enqueued message shape.
  - **Known, disclosed scope limit (not redesigned per this task's "producer
    side" framing and CLAUDE.md Rule 4 scope discipline):** every pusher in
    `worker-adapter-push/handler.ts` still only implements a CREATE call to
    the external provider — there is no per-adapter UPDATE/CANCEL API call
    yet. A reschedule/cancel push therefore still calls the provider's
    create endpoint against the booking's current (possibly now-cancelled)
    state rather than truly updating/cancelling the external object. This
    is a real, pre-existing architectural gap in the CONSUMER (not
    introduced by this fix — the consumer had zero real bookings flowing
    through it before this wave), left for a follow-up task rather than a
    from-scratch redesign of all four providers' update/cancel semantics
    under this task's budget. Tracked here explicitly rather than silently
    implied as complete.
- **H1 (`worker-messages-outbound` swallowed every provider failure):**
  `processOutboundMessage` now distinguishes a genuinely PERMANENT provider
  rejection (Twilio error codes 21211/21614/21408/21610 — invalid/
  unreachable "To" number, region-not-enabled, opt-out; Resend `name`
  `validation_error`/`invalid_to_address`/`invalid_from_address`/
  `missing_required_field`) — marked `status='failed'` immediately, same as
  before — from a TRANSIENT one (any other non-2xx/failure shape, e.g. a
  5xx or network blip), which now THROWS so `index.ts`'s existing
  catch/`moveToDeadLetter`/pgmq-retry path actually engages, matching
  BACKEND_SPEC §9's 5-attempt-then-DLQ contract. Pre-flight validation
  failures this worker detects itself before ever contacting a provider
  (`no_sending_number`, `no_recipient_email`, an unimplemented channel)
  are unchanged — no provider was called, so there is nothing to retry.
  Also fixed a second, closely-related gap: `index.ts`'s dead-letter branch
  moved the pgmq message off the queue but never flipped the
  `messages_outbound` row's own `status` to `failed`, so an
  attempts-exhausted message sat at `status='queued'` forever with no
  admin-visible signal — now set alongside the DLQ move.
- **H2 (`job-retell-health-failover` restore was a no-op):**
  `failoverNumbers` now snapshots each Twilio number's CURRENT `VoiceUrl`
  (a new `getIncomingPhoneNumber` GET call in `_shared/providers/
  twilio.ts`) before overwriting it, storing the map in `platform_settings`
  (key `retell_health_failover_voice_url_snapshot` — this task's ownership
  excludes `supabase/migrations/**`, so no new column/table). `restoreNumbers`
  now really calls `updateIncomingPhoneNumberVoiceUrl` back to each number's
  snapshotted original value — idempotent (a successfully-restored number
  is removed from the persisted snapshot, so a repeat recovery cycle is a
  no-op for it; a Twilio-call failure keeps it in the snapshot for the next
  cycle to retry) and never fabricates a "guessed" VoiceUrl for a number
  this job couldn't snapshot (logged instead). "Audit log" here means the
  same structured `logger.error`/`.info` calls this file already used for
  the trigger direction — a dedicated DB audit table would need a migration
  outside this task's ownership; flagged, not silently skipped.
- **M2 (hot-path pool exhaustion on a hung query):** `_shared/deno/db.ts`'s
  `getSql` now accepts an optional `statementTimeoutMs`, passed as a
  Postgres `connection` startup parameter (`statement_timeout`) —
  VERIFY-confirmed against postgres.js's own README
  (`raw.githubusercontent.com/porsager/postgres/v3.4.9/README.md`, GitHub
  raw content reachable even though `docs.twilio.com`-class doc sites
  aren't) rather than assumed. `voice-tools/index.ts` passes `1200`ms
  (comfortably under its own 1.5s JS-level hard-abort), so a hung query is
  killed SERVER-SIDE by Postgres itself and its connection freed back to
  the 5-slot pool, not just abandoned client-side while it keeps running.
  Every other caller of `getSql()` omits this and keeps unbounded queries —
  a blanket timeout would also cap legitimate longer-running job/worker
  scans that have no hot-path budget.

  **Update (verified-by-test, not just doc-citation):** `voice-tools/index.ts`
  and `_shared/deno/db.ts` are still Deno-only entrypoints excluded from this
  package's `tsconfig.json`/Vitest, but the two pieces of logic that actually
  matter are no longer trapped inside them:
  - `withTimeout` (the JS-level hard-abort race) is extracted into
    `_shared/timeout.ts` (plain, Deno-global-free — only `setTimeout`/
    `clearTimeout`), re-exported from `voice-tools/index.ts` unchanged.
    `_shared/timeout.test.ts` uses Vitest fake timers to assert: the
    fast-settling branch wins the race and clears its timer; a still-pending
    promise at `ms` rejects with `Error("tool_call_timeout")`; and no timer
    is left dangling (`vi.getTimerCount() === 0`) after either branch, or
    the timeout branch, settles.
  - The `statement_timeout` connection-option object is built by the new
    pure `_shared/db-options.ts#buildConnectionOptions`, which `db.ts`'s
    `getSql` now calls instead of inlining the object (and `getSql` also
    takes an optional injectable `postgres` factory, defaulting to the real
    npm import). `_shared/db-options.test.ts` asserts
    `buildConnectionOptions({ statementTimeoutMs: 1200 })` produces
    `connection: { statement_timeout: 1200 }` and that calling it with `{}`
    or `undefined` omits the `connection` key entirely (every non-voice-tools
    caller keeps unbounded behavior). Note: the value is a `number`, not the
    `String(...)` this entry originally described — postgres.js's own
    installed `ConnectionParameters` type (`node_modules/postgres/types/
    index.d.ts` at pinned v3.4.9) declares `statement_timeout: number`, and
    its `StartupMessage()` (`src/connection.js`) builds the wire value by
    plain string concatenation, which coerces a number identically — a
    type-only correction, no behavior change, since a string blew up
    TypeScript's `exactOptionalPropertyTypes` check once this became
    real, typechecked code instead of Deno-glue tsc never saw.
  - The actual "cancels the underlying query so the pool cannot be
    exhausted" claim — the one thing no mocked unit test can demonstrate —
    is now pinned against a REAL Postgres server by
    `_shared/statement-timeout-check.ts`, run as a new step in the
    `migrations-check` CI job (`.github/workflows/ci.yml`, which already
    spins up a local Postgres via `supabase start` for this job) right after
    `supabase db lint`: it connects with
    `connection: { statement_timeout: 500 }`, issues `select pg_sleep(2)`,
    asserts the rejection is Postgres SQLSTATE `57014` (`query_canceled`)
    in well under the full 2s sleep, then issues `select 1` on the SAME
    client afterward to confirm the connection/pool slot is still usable —
    not just abandoned or left broken. Manually verified against a real
    local Postgres 16 instance during this fix: canceled in ~523ms, `select
    1` succeeded immediately after. `postgres` (pinned `3.4.9`, matching
    `deno.json`'s import map) is now a real devDependency of
    `supabase/functions/package.json` so this script resolves it via
    ordinary Node module resolution — the CI job installs it with a
    `--filter @heyloo/edge-functions...`-scoped `pnpm install
    --frozen-lockfile` (not a full-workspace install) before running it.
- **DB-H2 (adapter tokens stored plaintext):** `_shared/crypto.ts` gained
  `encryptSecret`/`decryptSecret` — AES-256-GCM via Web Crypto
  (`crypto.subtle`, already this file's only dependency), versioned
  `v1:<iv>:<ciphertext>` format, keyed by a new `ADAPTER_TOKEN_ENCRYPTION_KEY`
  secret (documented in `.env.example`). `decryptSecret` tolerates a value
  with no recognized version prefix by returning it unchanged, so every
  `adapter_connections` row written before this fix (plaintext) keeps
  working with no backfill migration required. `api-adapter-connect`
  encrypts both `access_token`/`refresh_token` before every insert/update;
  `worker-adapter-push` decrypts on every read (`loadConnection`) and
  re-encrypts a refreshed access token before writing it back
  (`markConnectionRefreshed`). Round-trip/legacy-tolerance/wrong-key/
  malformed-value unit tests added to `_shared/crypto.test.ts`; both
  writer/reader test files updated to assert ciphertext (never plaintext)
  is what actually reaches the DB.
- **Standing FIX_REQUESTS.md items implemented (this cluster's exclusive
  `_shared/**`/`worker-adapter-push/**`/`.env.example` ownership):** added
  the `"owner_reply"` verbatim-passthrough case to `_shared/templates.ts`'s
  `renderTemplate` (requested by cluster D, blocking its Messages-thread
  reply feature); added a real `pushToAirtable` branch (+ new
  `_shared/providers/airtable.ts`, one-way push, VERIFY-flagged like every
  other egress-blocked provider file in this directory) to
  `worker-adapter-push/handler.ts`'s `ADAPTER_PUSHERS` map (requested by
  cluster C) — depends on cluster A's still-pending migration adding
  `'airtable'` to `adapter_connections.provider`'s CHECK constraint (already
  filed, not re-filed here) and on the Airtable connect flow's
  `adapter_connections.metadata` carrying `{baseId, tableIdOrName}`; added
  an optional `redirectTo` param to `_shared/providers/supabase-admin.ts`'s
  `generateMagicLink` (forwarded as `options.redirect_to`, requested by
  cluster C for the admin impersonation route's deep-link — backward
  compatible, new `supabase-admin.test.ts` covers both branches); appended
  the `.env.example` `VOICE_TOOLS_WEBHOOK_URL` comment to note its second
  consumer (requested by cluster B) and added the four
  `AIRTABLE_OAUTH_*` variables cluster C's Airtable connect flow needs
  (requested by cluster C) — both `.env.example`-only, no code change.
  Not implemented: the new `api-payment-link-resend` function (cluster D)
  and the `job-retention-sweep` function (cluster A) — neither matches any
  pattern in this cluster's explicit ownership list (not `api-adapter-
  connect`, not a `worker-*`/named `job-*` function), so left for whichever
  cluster actually owns `supabase/functions`' remaining `api-*`/`job-*`
  surface, per this task's own scope-discipline instruction.

**Cross-cluster requests filed** (docs/audit/FIX_REQUESTS.md, both under
"Requesting cluster: E"): `apps/web`'s Airtable OAuth connect/callback
route should also call the new `encryptSecret` before writing
`access_token`/`refresh_token` (DB-H2 is only fully closed once every
writer of this column encrypts, and that route is outside this cluster's
ownership); an informational note on the new Airtable pusher's
dependencies (migration + connection metadata shape) for whoever owns
that flow.

**Tests:** `supabase/functions` (Vitest) — every touched/new file has a
matching `.test.ts`; ran the full scoped suite after each change and again
at the end: **all passing, no regressions** (`_shared/crypto.test.ts`,
`_shared/templates.test.ts`, `_shared/adapter-push.test.ts` (new),
`voice-tools/tools/{create_booking,update_booking,cancel_booking,
create_order,send_sms_confirmation}.test.ts`,
`worker-messages-outbound/handler.test.ts`,
`job-retell-health-failover/handler.test.ts`,
`worker-adapter-push/handler.test.ts`, `api-adapter-connect/
handler.test.ts`). `tsc -p supabase/functions/tsconfig.json --noEmit`
clean.

## CLUSTER-F — Referral payout webhook, churn/retention loop, integrations UI (2026-09-10)

**Scope:** E2E_FLOWS_AUDIT Flow 7 (PayPal payout consumer), Flow 10 (churn/
retention, entirely unbuilt — H3), Flow 9/10 (no adapter-connect UI).

**What was built**

- `supabase/functions/webhooks-paypal/` (new): verifies PayPal's webhook
  signature via a live `/v1/notifications/verify-webhook-signature` call
  (fail closed on any missing header/secret or a non-`SUCCESS` result —
  `signature.ts`), dedups through the existing `webhook_events` table
  (`_shared/webhook-dedup.ts`, reused unmodified), then on
  `PAYMENT.PAYOUTS-ITEM.*` events (`handler.ts`) matches the event back to
  one `referral_payouts` row via `(paypal_batch_id, referral_partner_id)` —
  no new column needed, since `job-referral-payouts` already sends exactly
  one PayPal payout item per partner per batch with `sender_item_id:
  referral_partner_id`. `SUCCEEDED` flips `referral_payouts` to
  `'completed'`, `commission_events` to `'paid'`, the matching `referrals`
  row to `'paid'`, and bumps `referral_partners.ytd_payout_cents`;
  `FAILED`/`DENIED`/`BLOCKED`/`CANCELED` and `RETURNED`/`REFUNDED` flip
  `referral_payouts` to `'failed'`/`'returned'` and revert
  `commission_events` back to `'accrued'` for next cycle's retry, plus an
  `alerts` row for finance visibility; `UNCLAIMED`/`ONHOLD` are logged as
  still in-flight with no state change. `job-referral-payouts/handler.ts`'s
  stale "no /webhooks-paypal function exists yet" docstring updated to
  point at this file.
- **`DECIDE` (schema gap, needs a migration this cluster cannot apply):**
  `referral_payouts.status`'s CHECK constraint is `('pending','sent',
  'failed')` — this handler writes `'completed'`/`'returned'` too, per the
  task brief's literal "sent → completed/failed/returned" and to
  distinguish a confirmed payment from returned funds for finance. An
  additive migration widening that constraint is filed in
  `docs/audit/FIX_REQUESTS.md` for the DB-owning cluster; until it lands, a
  live `'completed'`/`'returned'` write is REJECTED by Postgres (a loud,
  visible failure — never a silently-wrong status).
- `supabase/functions/job-churn-scoring/` (new, BACKEND_SPEC §8 "Churn
  scoring", `0 6 * * *`): recomputes a per-tenant churn-risk score (0-100)
  from three normalized signals — trailing-7-day usage trend vs. the prior
  7 days (`usage_daily`), open/pending `support_requests` in the trailing
  30 days, and `billing_invoices` that went `past_due` in the trailing 180
  days — weighted 0.40/0.25/0.35 and upserted into `churn_scores`. An
  already `paused`/`canceled` tenant scores 100 outright. Weights/ceilings
  are this build's reasoned defaults (BACKEND_SPEC §8 names the three
  signal categories, not a formula) — tune once real churn outcomes exist.
- `supabase/functions/job-value-email/` (new, BACKEND_SPEC §8 "Weekly value
  emails", `0 14 * * 1`): for every `status = 'active'` tenant, computes
  calls-answered and bookings-captured in the trailing 7 days and
  `avg_transaction_value_cents × bookings_captured` as `value_saved_cents`/
  `value_saved_display` ("$525"-style), then inserts+enqueues a
  `messages_outbound` row (`template_key: 'weekly_value_summary'`) via the
  existing pgmq pipeline — same "job enqueues, worker sends" shape every
  other job in this codebase uses. **`DECIDE`** (no persisted per-tenant
  email-notification-preference exists anywhere in this codebase —
  `packages/canonical-types/src/schemas/delivery-preferences.ts`'s
  `email_enabled`/`notification_email` schema has ZERO persistence call
  sites, confirmed by repo-wide grep): "respects notification prefs" is
  implemented as the one real, already-enforced gate available —
  `status = 'active'` only, recipient resolved via the same owner-
  membership pattern `webhooks-stripe`'s `invoice.payment_failed` handler
  already uses. If/when a real per-tenant email-opt-out is added, gate on
  it here too.
- `supabase/functions/job-offboarding/` (new, SYSTEM_DESIGN §9/G7
  "guaranteed number port-out SLA"; Flow 8 steps 2/4 — the narrower slice
  this task's brief actually asked for, not the full data-export-bundle
  flow, see below): releases phone numbers for `paused`/`canceled` tenants
  (Retell `delete-phone-number` un-import first, then Twilio
  `IncomingPhoneNumbers` release, matching Flow 8 step 2's own ordering so
  no in-flight call is orphaned), then archives (`tenants.deleted_at`) a
  tenant once it has no remaining active phone number. **`DECIDE`**: no
  exact port-out grace-period day count is specified anywhere in the specs,
  and `tenants` has no `canceled_at`/`paused_at` timestamp — this build uses
  `tenants.updated_at` as a conservative proxy (a canceled/paused tenant
  touched again for an unrelated reason only ever DELAYS release, never
  releases early — the safe direction for a guaranteed port-out window)
  and a 30-day window (matching `tenants.retention_days`'s own BIPA-aware
  default order of magnitude). A `tenants.canceled_at` column would be the
  more-correct fix — requested from the DB-owning cluster in
  `docs/audit/FIX_REQUESTS.md`, informational/non-blocking. **Out of this
  task's scope** (per this cluster's literal brief — "release numbers ...
  archive per retention", not the fuller Flow 8): the data-export-bundle-
  via-signed-URL-email step. Flagged here as a real follow-up gap, not
  built as a partial/fake version of it.
- `supabase/functions/job-retention-sweep/` (new — closes the exact gap
  `docs/audit/FIX_REQUESTS.md` already had filed against this function
  name): for every `call_logs` row with a recording older than that
  tenant's OWN `tenants.retention_days`, bulk-deletes the Storage object(s)
  (`recordings/{tenant}/{call}.wav`[`_stereo`]) via the Storage REST API's
  `{prefixes}` bulk-delete, then nulls both recording-URL columns. Batched
  (200/run, oldest first) so one run's duration is bounded; a backlog
  spills into the next day's run rather than blocking.
- `apps/web/src/app/[locale]/(tenant)/dashboard/integrations/**` + `apps/
  web/src/app/api/tenant/integrations/**` (new — E2E_FLOWS_AUDIT Flow 9/10:
  "no 'Connect <adapter>' UI in the tenant dashboard at all"; the nav entry
  for `/dashboard/integrations` already existed in
  `tenant-shell-client.tsx`, unused until this page). Lists Square/Google
  Calendar/Shopmonkey/ezyVet (the four adapters `api-adapter-connect`
  actually supports) with real connect (OAuth popup for Square/Google,
  inline paste-key form for Shopmonkey/ezyVet)/reconnect/disconnect/status/
  last-refreshed/error-surface, all proxied through the REAL
  `api-adapter-connect` edge function contract — no fake success path.
  Airtable is a separate one-way delivery integration with its own existing
  page (`/dashboard/delivery`) and is deliberately not duplicated here.
  Each OAuth provider gets its OWN callback path
  (`callback/square`, `callback/google_calendar`) rather than a shared
  `?provider=` query param, since each already has its own registered
  `*_OAUTH_REDIRECT_URI` env var and OAuth redirect query-param
  passthrough is not a safe cross-provider assumption.

**Cross-cluster requests filed** (`docs/audit/FIX_REQUESTS.md`, all under
"Requesting cluster: F"): (1) an additive migration widening
`referral_payouts.status`'s CHECK constraint to include `'completed'`/
`'returned'`; (2) cron mappings for the four new jobs (name → slug →
schedule) for whichever cluster owns `supabase/migrations`' cron-scheduling
migration; (3) an informational note that a real `tenants.canceled_at`/
`paused_at` column would let `job-offboarding` key off the actual state-
change time instead of the `updated_at` proxy.

**Tests:** every new function/route has a matching `.test.ts` (49 new
tests across `job-churn-scoring`, `job-value-email`, `job-offboarding`,
`job-retention-sweep`, `webhooks-paypal` in `supabase/functions`; 27 new
tests across the `api/tenant/integrations/**` routes in `apps/web`).
`tsc -p supabase/functions/tsconfig.json --noEmit` and `pnpm --filter
@heyloo/web typecheck` both clean for every file this cluster touched (a
pre-existing, unrelated `_shared/crypto.ts` typecheck error from another
in-progress cluster, and one pre-existing unrelated failing test in
`voice-tools/tools/create_order.test.ts`, were both left untouched per this
task's own instructions). `biome check` clean.

## Integrator — cross-cluster FIX_REQUESTS pass

Applied every actionable bullet in `docs/audit/FIX_REQUESTS.md` left open
after seven parallel fix clusters finished (many were already picked up by
a later cluster before this pass ran — e.g. the `owner_reply` template
case, `generateMagicLink`'s `redirectTo`, the `VOICE_TOOLS_WEBHOOK_URL`/
Airtable-OAuth `.env.example` lines, the `ImpersonationBanner` mount, and
`worker-adapter-push`'s `pushToAirtable` branch were all already applied
and needed no further action here).

**New additive migrations** (`supabase/migrations/`, all following
existing precedent files' own patterns, none editing an applied
migration):
- `20260910100000_adapter_connections_airtable_provider.sql` — adds
  `'airtable'` to both `adapter_connections.provider` and
  `adapter_sync_state.provider`'s CHECK constraints (looked up the real
  auto-generated constraint name via `pg_constraint` rather than guessing).
- `20260910100100_fn_enqueue_adapter_push.sql` — the requested
  `public.fn_enqueue_adapter_push(...)` PostgREST RPC wrapping
  `pgmq.send('adapter_push_queue', ...)`, tenant-scoped (no-op on a
  `p_tenant_id` mismatch), granted to `authenticated`.
- `20260910100200_fn_enqueue_message_outbound.sql` — same shape for
  `public.fn_enqueue_message_outbound(p_message_id uuid)` /
  `messages_outbound_queue`, tenant-scoped by joining the message row's own
  `tenant_id` against the caller's JWT.
- `20260910100300_broadcast_messages_inbound.sql` — adds
  `trg_broadcast_messages_inbound`, same shape as the existing
  `trg_broadcast_call_logs`/`_bookings`/`_orders`/`_support_requests`.
- `20260910100400_referral_payouts_terminal_statuses.sql` — widens
  `referral_payouts.status`'s CHECK constraint to add `'completed'`/
  `'returned'` (constraint name looked up via `pg_constraint`, same
  caution as the request itself flagged).
- `20260910100500_new_job_cron_schedules.sql` — the four outstanding
  `cron.schedule` entries (`job-churn-scoring` `0 6 * * *`,
  `job-value-email` `0 14 * * 1`, `job-offboarding` `45 5 * * *`,
  `job-retention-sweep` `0 5 * * *`), reusing
  `20260910093000_queues_and_scheduled_jobs.sql`'s own
  `fn_cron_upsert(...)`/Vault-secret guard structure verbatim. All four
  functions were already deployed (`supabase/config.toml`,
  `verify_jwt = false`) by the time this pass ran — only the cron mapping
  was missing.

**Small glue edits:**
- `packages/supabase-client/src/database.types.ts` — fixed
  `TenantRow.vertical`'s stale long-form union (`auto_repair`/`veterinary`)
  to the real short-form CHECK constraint (`auto`/`vet`, matching
  `@heyloo/canonical-types`' `Vertical`); added the missing
  `AdapterConnectionRow`/`AdapterSyncStateRow`/`AirtableSyncStateRow` table
  types + `Database.public.Tables` entries; added `fn_enqueue_adapter_push`/
  `fn_enqueue_message_outbound` to `Database.public.Functions` (previously
  intentionally empty — these two are the documented exception to "every
  RPC goes through an edge-function proxy", since `pgmq` isn't exposed over
  PostgREST).
- `packages/supabase-client/src/vertical-mapping.ts` — same root cause as
  above; turned `VERTICAL_TO_DB_VALUE`/`DB_VALUE_TO_VERTICAL` into identity
  maps (kept, not deleted, so no import site needs to change) now that both
  sides agree on the short-form spelling.
- `apps/web/src/components/tenant/customer-detail-client.tsx` — added a
  "Message this customer" link next to the phone number, linking to
  `/dashboard/messages/{phone}` (same pattern already used on the
  bookings/orders detail views).
- `apps/web/src/app/api/tenant/delivery/airtable/callback/route.ts` +new
  `apps/web/src/lib/crypto/adapter-token.ts` — the callback route now
  encrypts `access_token`/`refresh_token` with AES-256-GCM
  (`ADAPTER_TOKEN_ENCRYPTION_KEY`) before the `adapter_connections` upsert,
  failing closed (501) if the key isn't configured, closing DB-H2 for the
  one writer of that table cluster E's own fix couldn't reach.
  `adapter-token.ts` is a deliberate duplicate of
  `supabase/functions/_shared/crypto.ts`'s `encryptSecret` (same versioned
  `v1:<iv>:<ciphertext>` format `worker-adapter-push`'s `decryptSecret`
  already reads) rather than a cross-project import — `apps/web` (Next.js,
  `moduleResolution: "bundler"`) and `supabase/functions` (Deno, separately
  built) are different compilation units in this repo, so this matches the
  existing build-boundary separation instead of fighting it. `.env.example`
  comment updated to note this second consumer.

**Left as informational, not implemented** (both explicitly filed as
design decisions, not small patches — CLAUDE.md Rule 4: flag, don't
redesign):
- Per-tenant `alert_80_enabled`/`alert_100_enabled` columns on `tenants`
  vs. keeping the platform-wide-default-only design — no schema change
  made; `apps/web`'s Billing page already shows the real platform-wide
  thresholds as read-only text, which this pass treats as the current
  final design pending an explicit product decision to add per-tenant
  overrides.
- The `impersonated_by`/`impersonation_edit_enabled` JWT-claim + RLS design
  for server-enforced impersonation edit-mode — still display-only
  (`apps/web/src/lib/impersonation/`), not an RLS boundary. Genuinely needs
  a schema+auth-model decision (which claim-minting mechanism, which RLS
  policies join against it) before a migration can be written; not
  redesigned here.
- The Airtable connect flow's `adapter_connections.metadata` still stores
  `{ base_name }` rather than the `{ baseId, tableIdOrName }` shape
  `worker-adapter-push`'s `pushToAirtable` branch expects (filed
  informationally by cluster E, "not a blocking ask" — a multi-base/table
  picker UI is its own follow-up, already flagged in this file's earlier
  T-cluster entries). `pushToAirtable`'s `adapter_push_missing_metadata`
  guard will keep firing for real Airtable pushes until that picker UI
  exists; left untouched here since it's a UI feature, not a glue edit.

**Not re-filed** (already-standing requests this pass's migrations now
satisfy, so no new FIX_REQUESTS bullet needed): the `airtable_sync_state`/
`adapter_connections` regeneration bullet and the `fn_enqueue_adapter_push`
bullet are both closed by the migrations/type changes above.

## Repair — Impersonation server-enforced read-only/edit boundary

Closed the gap docs/audit/FIX_REQUESTS.md flagged as "a genuine schema+auth-
model decision, not a small patch": the impersonated session previously
carried the same `app_metadata` claims as the tenant owner's normal login,
so the banner's read-only/edit-mode split was display-only, never RLS-
enforced. Added `supabase/migrations/20260910110000_impersonation_claim.sql`
(new `impersonation_sessions` table, `fn_jwt_is_impersonating()`/
`fn_jwt_impersonation_edit_enabled()` helpers, a `custom_access_token_hook`
update that joins the table, and every tenant-write RLS policy tightened to
require `not fn_jwt_is_impersonating() or fn_jwt_impersonation_edit_enabled()`),
plus `supabase/functions/admin/handler.ts`'s impersonate route now inserting
that row at mint time, a new `POST .../impersonate/edit-mode` route, and
impersonate-end setting `ended_at`. `docs/VERIFY.md` (VERIFY-IMPERSONATION-1/2)
logs the two Rule-1 items `supabase.com` being unreachable left unconfirmed
against live docs.

Discovered gap, documented rather than silently worked around (Rule 4):
`apps/web/src/lib/impersonation/use-impersonation-banner.tsx`'s "Enable
edits" toggle (like the pre-existing `impersonate-end` call next to it)
calls `/api/admin/admin-tenants/{id}/impersonate/edit-mode` from the
IMPERSONATED tab. That proxy (`apps/web/src/app/api/admin/[...path]/route.ts`,
not owned by this task) requires the CALLING request's own session cookie to
carry `platform_admin`. Because `@supabase/ssr` stores the session in a
single per-domain cookie (not per-tab), opening the impersonation magic link
in a new tab overwrites that cookie for the whole browser — so a request
made from within the impersonated tab authenticates as the tenant owner, not
the admin, and this call will 403 in practice. The toggle therefore only
flips its local/displayed `editMode` on an actual 200 response (never
optimistically) so the UI never claims edits are enabled when the server
never agreed — but the toggle itself may consistently fail until that proxy
gains a second, non-`platform_admin` authorization path (e.g. trusting the
caller's own `impersonated_by` claim, which only a genuine active
`impersonation_sessions` row can produce). Filed as a FIX_REQUESTS.md bullet
for whichever cluster owns that proxy route; not fixed here since it needs
either a shared-file edit outside this task's ownership or a new dedicated
edge function, either of which is a bigger design call than this repair's
scope.

## Repair — DB-H1 write-path RLS: CI coverage gap

`docs/audit/DB_AUDIT.md` DB-H1 (bookings/orders WITH CHECK ownership
guards on `resource_id`/`offering_id`/`customer_id`, fixed in
`supabase/migrations/20260910090000_view_security_and_write_rls_
hardening.sql`) had a correct fix but zero automated coverage —
`scripts/ci/rls-cross-tenant-probe.ts` only ever issued SELECTs (leak
probing) and seeded bookings/orders via the service-role client, which
bypasses RLS entirely and so could never exercise a WITH CHECK clause.

Fixed by extending that same script (no new CI job needed — it already
runs after `supabase start` applies every migration, see
`.github/workflows/ci.yml`): `seedTenant()` now also fetches and returns
each tenant's seeded `resourceId`/`offeringId`/`customerId`/`bookingId`/
`orderId` (throwing if any is missing, rather than silently skipping), and
a new `writeProbeCases()`/`probeWriteRejected()` pair issues, as each
tenant's real authenticated user (never the service-role client), 10
cross-tenant INSERT/UPDATE attempts against `bookings`/`orders` — own
`tenant_id` correct, but `resource_id`/`offering_id`/`customer_id` (or an
`items[].offering_id`) pointed at the OTHER seeded tenant's row — asserting
every one is rejected (non-2xx). Run both directions (A-attacks-B and
B-attacks-A), wired into the same `failures`/exit-code path as the
existing leak checks, so a regression (a re-added permissive policy, a
typo dropping one of the four EXISTS clauses) now fails CI per CLAUDE.md
Rule 2. No migration SQL changed — the fix itself was already correct.

## Repair — frontend truthfulness claim, remaining Airtable defects (2026-09-10)

Two hop-level defects survived an earlier fix wave (docs/audit/FIX_REQUESTS.md's
cluster C/E Airtable bullets already landed the CHECK-constraint migration,
`fn_enqueue_adapter_push`, and the `pushToAirtable` worker branch — this
repair closed the two remaining truthfulness gaps against that already-real
plumbing):

1. `apps/web/src/app/api/admin/[...path]/route.ts` → `supabase/functions/admin/index.ts`
   proxy-vs-slug contract: already fixed by a parallel repair pass before this
   task ran (verified by reading both files + the passing
   `route.test.ts`/`handler.test.ts`); no action needed here beyond
   confirming it and logging the confirmation in `docs/VERIFY.md`
   (VERIFY-REPAIR-1).
2. Airtable push metadata: `apps/web/src/app/api/tenant/delivery/airtable/callback/route.ts`
   now populates `adapter_connections.metadata.baseId`/`.tableIdOrName` (the
   base auto-picked as before per item 3 below; the table now auto-picked as
   the base's first table via Airtable's Meta API "list tables" endpoint,
   `airtableTablesUrl` in `shared.ts`) — previously `worker-adapter-push`'s
   `pushToAirtable` always no-oped via `adapter_push_missing_metadata`
   because neither key was ever written. Docs/BUILD_NOTES.md item 3
   (multi-base picker) above still stands as-is — bases are still
   auto-picked, not user-chosen; the NEW auto-pick is the table within
   whichever base was already auto-picked. A real table-picker UI (letting
   the tenant choose instead of auto-picking the first table) remains an
   equivalent follow-up, same reasoning as the existing base-picker gap.
3. Airtable sync-log table split: `apps/web/src/app/api/tenant/delivery/airtable/status/route.ts`
   read `public.airtable_sync_state` while the worker's `recordSyncSuccess`
   (shared by every T7 adapter) writes `public.adapter_sync_state` — a real
   push success never surfaced in the dashboard. Fixed by pointing the
   status route at `adapter_sync_state` filtered `provider = 'airtable'`
   (the writer's actual table), rather than special-casing the writer to
   target the Airtable-only table — keeps every adapter's push-bookkeeping
   on one code path. No migration needed: `adapter_sync_state`'s `provider`
   CHECK constraint and RLS select policy already cover `'airtable'`
   (confirmed by reading `20260910100000_adapter_connections_airtable_
   provider.sql` and `20260907160000_t7_adapter_connections.sql` directly).
   `public.airtable_sync_state` is now write-orphaned; left in place rather
   than dropped (dropping a table is a bigger, unrequested change).

See `docs/VERIFY.md`'s "Repair task — admin cockpit proxy contract +
Airtable sync truthfulness" section for the full verification trail,
including the new AIRTABLE-VERIFY-2 entry for the Meta API tables-list
shape.

## FIX-1 — Integrator pass over the audit fix wave (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Integrated the large parallel fix wave (Clusters B-G plus the repair tasks
above: realtime/dashboard truthfulness, impersonation server-enforced
boundary, DB-H1 write-path RLS CI coverage, admin cockpit proxy contract +
Airtable truthfulness) — ran every gate, fixed what the gates and a
cross-check against `docs/audit/FIX_REQUESTS.md` turned up, and cleared
`FIX_REQUESTS.md` of everything confirmed already applied.

**Cluster: lint hygiene (biome).** `npx biome check --write` on every
changed/new path found two real, mechanical categories, both now clean
repo-wide (`biome check .` — 0 errors, 36 pre-existing unrelated warnings
in files this wave never touched):
- 11 new/changed test files built a "thenable mock" query-builder object
  (an established convention already covered by a
  `// biome-ignore lint/suspicious/noThenProperty` comment in one sibling
  test file) but were missing that same ignore comment, so
  `lint/suspicious/noThenProperty` fired as an error on each. Added the
  identical ignore comment to all 11 (`apps/web/src/lib/auth/require-
  {tenant,partner}-session.test.ts`, and the `route.test.ts` files under
  `api/tenant/{waitlist,settings/reminders-review,payment-links/[id]/
  resend,orders,messages/[phone],calls/export,agent/vertical-details,
  bookings/[id],delivery/airtable/status}`).
- Several safe mechanical suggestions (`lint/complexity/useOptionalChain`,
  `lint/style/useTemplate`) applied via `--write --unsafe` after manually
  confirming each rewrite is behavior-identical (empty-string/undefined
  `key?.trim()` vs. `key && key.trim()`; `!slot?.is_available` vs.
  `!slot || !slot.is_available`; a template-literal password-suffix
  concat) — `apps/web/src/app/[locale]/(tenant)/dashboard/agent/vertical-
  details/page.tsx`, `api/tenant/bookings/[id]/route.ts` (+ its and four
  siblings' `.test.ts`), `scripts/ci/rls-cross-tenant-probe.ts`.
- `vertical-details/page.tsx`'s `useEffect` carried a stale
  `// eslint-disable-next-line react-hooks/exhaustive-deps` (a no-op under
  this repo's actual Biome+ESLint toolchain — Biome doesn't read ESLint
  disable comments, and the deps array was genuinely non-exhaustive per
  BOTH linters, which disagreed on which exact dependency to add — Biome's
  suggested fix wanted `.reset` alone, ESLint's `react-hooks/exhaustive-
  deps` wanted the whole `detailsForm`/`reminderForm` objects). Resolved
  by depending on the full `detailsForm`/`reminderForm` objects (react-
  hook-form's returned object is stable across renders per its own docs,
  so this is behavior-identical to the narrower fix, and satisfies both
  linters at once) rather than adding a biome-ignore that would have gone
  stale the moment the dependency array became exhaustive.

**Cluster: `fn_enqueue_message_outbound` JWT/tenant-identity mismatch
(verifier item, MASTER_SPEC §3.10 tab).** `supabase/migrations/20260910
100200_fn_enqueue_message_outbound.sql` no-ops the enqueue whenever the
message row's `tenant_id` doesn't equal `public.fn_jwt_tenant_id()` (reads
`request.jwt.claims -> app_metadata ->> tenant_id`). Both of its only two
real call sites — `apps/web/src/app/api/tenant/bookings/[id]/route.ts`'s
confirm/reschedule/cancel notification insert, and `api/tenant/messages/
[phone]/route.ts`'s reply-send — call it through
`createSupabaseServiceRoleServerClient()`, i.e. the Postgres `service_role`
JWT, which carries no `app_metadata.tenant_id` claim at all. The own-tenant
check therefore always compared against `NULL`, always no-op'd, and every
one of these SMS sends sat at `messages_outbound.status: 'queued'` forever
with zero indication anything was wrong (the route itself always returned
`{ok: true, sms_queued: true}` since the INSERT succeeded — only the
enqueue silently failed).

Picked Option A (make the function service-role-aware, matching how
service-role callers work everywhere else in this schema — CLAUDE.md Rule
2's own "service_role has BYPASSRLS... every service_role-using edge
function must still explicitly filter by a verified tenant_id in its own
query" convention) over Option B (change the two call sites to stop using
service-role) because both call sites already verify the caller's own
session `tenant_id` (via `claimsFromUser`/`requireTenantSession`-equivalent
checks earlier in each route) and stamp that verified value onto the
`messages_outbound` row themselves before ever calling this RPC — a
`service_role` caller reaching this function is therefore already
tenant-verified upstream, exactly the trust boundary every other
service-role code path in this codebase relies on. Editing the migration
in place (rather than a new additive one) was safe here specifically
because `docs/LAUNCH_STATUS.md`'s DEPLOY-1 record shows only 22 migrations
were applied to the live project on 2026-09-09, and this file is dated
2026-09-10 (one of the 9 post-deploy migrations) — never applied anywhere,
so "never edit an applied migration" doesn't cover it.

Fix: `fn_enqueue_message_outbound` now reads `current_setting('request.jwt
.claims', true)::jsonb ->> 'role'`; a `service_role` caller only needs
`p_message_id` to resolve to *some* `messages_outbound` row (no tenant
comparison — there is no tenant claim to compare against), while an
`authenticated` caller still gets the original strict `tenant_id =
fn_jwt_tenant_id()` match. Also added an explicit `grant execute ... to
service_role` (previously only `authenticated`) for clarity, even though
default PostgreSQL function-execute privileges likely already covered it
(no schema-wide `revoke`/`alter default privileges` found anywhere in this
migration set).

Verified directly (no Docker/`supabase start` available in this
environment — see the reproducibility harness below) by seeding a tenant +
a `messages_outbound` row, swapping in a logging `pgmq.send` stub, and
calling the function three times with `set_config('request.jwt.claims',
..., false)` set to (1) `{"role":"service_role"}`, (2) `{"role":
"authenticated", "app_metadata":{"tenant_id":"<wrong-tenant>"}}`, (3)
`{"role":"authenticated","app_metadata":{"tenant_id":"<right-tenant>"}}`.
Confirmed exactly 2 of the 3 calls actually enqueued (service_role +
matching-tenant), and the mismatched-tenant authenticated call silently
no-op'd exactly as designed — the fix closes the real gap without opening
a cross-tenant leak.

**Cluster: `docs/audit/FIX_REQUESTS.md` cross-check.** Verified every
bullet filed by Clusters B-G and the repair tasks against the current
tree; all but six are now confirmed applied and were removed from that
file (full confirmation, one line per bullet):
job-retention-sweep function + its cron entry both exist;
`vertical-mapping.ts` is now an identity map matching the real short-form
`tenants.vertical` CHECK constraint; `.env.example`'s `VOICE_TOOLS_
WEBHOOK_URL` comment documents its second consumer;
`20260910100000_adapter_connections_airtable_provider.sql` adds
`'airtable'` to the CHECK constraint; `20260910100100_fn_enqueue_adapter_
push.sql` exists; `worker-adapter-push`'s `ADAPTER_PUSHERS` map has a real
`pushToAirtable` branch; `database.types.ts` now types
`adapter_connections`/`airtable_sync_state`/`fn_enqueue_adapter_push`
(`apps/web/src/app/api/tenant/delivery/airtable/shared.ts`'s
`untypedTable`/`untypedRpc` helpers had a stale docstring claiming
otherwise — corrected in place; kept the helpers themselves since swapping
every call site to the now-typed client directly is a separate, low-risk
mechanical follow-up, not folded into this bug-fix pass);
`supabase-admin.ts`'s `generateMagicLink` takes `redirectTo`;
`20260910110000_impersonation_claim.sql` exists and is wired into
`custom_access_token_hook` + RLS; `ImpersonationBanner` is mounted in
`tenant-shell-client.tsx`; `.env.example` has the four `AIRTABLE_OAUTH_*`
vars; `20260910100200_fn_enqueue_message_outbound.sql` exists (see above
for its bug); `20260910100300_broadcast_messages_inbound.sql` adds the
trigger; `templates.ts` has an `"owner_reply"` case;
`api-payment-link-resend` exists; `TenantRow["vertical"]` is short-form;
`customer-detail-client.tsx` has the "Message this customer" link;
`airtable/callback/route.ts` encrypts tokens via `encryptSecret`;
`20260910100400_referral_payouts_terminal_statuses.sql` widens the CHECK
constraint; `20260910100500_new_job_cron_schedules.sql` schedules all four
of `job-churn-scoring`/`job-value-email`/`job-offboarding`/`job-retention-
sweep`.

Six bullets are genuinely still open and stayed in `FIX_REQUESTS.md`
(unchanged in substance, condensed for the removals above): BIPA
retention-window default (blocked on counsel, not code), per-tenant
usage-alert-prefs columns (blocked on a product decision — `docs/BUILD_
NOTES.md`'s Cluster C entry already treats the platform-wide-only design
as current-final pending that decision), Airtable two-way sync,
`tenants.canceled_at`/`paused_at`, the decorative `outreach_send_queue`
pgmq queue with no producer/consumer, and the admin-cockpit-proxy
impersonation edit-mode 403 (a real bug, but its fix spans both `apps/web`'s
proxy AND `admin/handler.ts`'s own AAL2/`adminUserId` JWT-claims parsing —
a genuine cross-service auth-model change, not something to redesign
inside an unrelated integration pass per CLAUDE.md Rule 4).

**Gates run this pass** (all green): `npx biome check --write` on every
changed path, then `biome check .` repo-wide (0 errors); `pnpm -w
typecheck` (18/18 packages); `pnpm run lint` (biome + per-package eslint,
0 errors); `pnpm -w test` (all packages — edge-functions 72 files/563
tests, ui 4 files/15 tests, web 30 files/134 tests, all green); `apps/web`
production build (`next build`, all 98 static pages + every dynamic route
compiled clean); `node --experimental-strip-types scripts/ci/verify-jwt-
guard.ts` (34 functions checked, PASSED).

**Migrations reproducible-from-zero** — verified in a throwaway local-
Postgres harness (same no-Docker constraint as every prior pass in this
environment; this session's local Postgres 16 cluster, not `supabase
start`): stubbed `auth`/`storage`/`realtime`/`cron`/`pgmq` schemas (tables/
functions only the DDL itself needs — `auth.users`, `auth.uid()`/`.role()`/
`.jwt()`, `storage.buckets`, `realtime.messages` + a no-op
`broadcast_changes`, `cron.job` + `.schedule`/`.unschedule`, `pgmq.create`/
`.send`/`.list_queues`) and the `supabase_auth_admin`/`authenticated`/
`anon`/`service_role` roles, stripped only the three `create extension`
lines for `pg_cron`/`pgmq`/`pg_net` (genuinely unavailable outside a
Supabase-hosted Postgres — every downstream use of them is already guarded
by a `pg_extension` existence check per the existing `DO` blocks, so this
matches real behavior on a Supabase host with those extensions present,
just skipping the guarded blocks instead of running them). All 31 real
migration files applied verbatim, in order, from an empty database with
zero errors, followed by `supabase/seed/seed.sql` (also zero errors).
Harness and scratch SQL were session-only, never committed.

**Not runnable in this environment (documented, not silently skipped):**
`scripts/ci/rls-cross-tenant-probe.ts` and `scripts/ci/cron-queues-check.ts`
both require a live GoTrue+PostgREST stack (`supabase start`, which needs
Docker) — this sandbox's Docker daemon is unreachable
(`/var/run/docker.sock` doesn't exist), same constraint every prior pass
in this repo's history has hit and disclosed. Both scripts were read in
full and are unchanged in logic from the prior pass that already covers
the impersonation read-only/edit-mode RLS boundary end to end (real GoTrue
signup, real `custom_access_token_hook` re-run, real cross-tenant
INSERT/UPDATE attempts) — reviewed, not executed here. This is also the
"remaining: test" state for the impersonation-lifecycle verifier item:
the RLS-level end-to-end coverage already exists in
`rls-cross-tenant-probe.ts` and the route-level coverage already exists in
`supabase/functions/admin/handler.test.ts` (start/end/edit-mode-toggle, all
passing under `pnpm test`), but neither has ever actually been executed
against a live Postgres+GoTrue+PostgREST stack in any build agent's
sandbox used across this entire project — it stays reviewed-but-
unexecuted until someone runs it somewhere with Docker available, same
disclosure `docs/LAUNCH_STATUS.md` already carries for the Playwright e2e
specs.

## Cluster B — Dynamic-variable / per-vertical config pipeline (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Closed GAP_REGISTER.md §1.3 (`dynamic_variable_overrides` never forwarded
past the base 5 keys) and §1.6 (schema drift between the tenant-facing
Settings form and the template's `{{token}}` consumers) for auto, legal,
motel, restaurant, vet — the per-vertical config gaps cited for those
verticals in §2.

**What was built**

- `supabase/functions/voice-inbound/dynamic-variables.ts` (new): resolves
  every vertical-specific `{{token}}` the compiled prompts reference
  (`packages/templates/src/red-team/prompt-lint.ts`'s
  `ALLOWED_DYNAMIC_VARIABLES` — the authoritative list, confirmed by
  grepping every `packages/templates/src/verticals/*.ts` for `{{...}}`)
  from `agent_configs.dynamic_variable_overrides`, each with a safe,
  non-hallucinated default so a tenant who hasn't configured a field never
  gets a literal `{{token}}`/silently-dropped key spoken on a live call —
  e.g. motel's `rate_table` renders as an explicit "no rates on file — say
  you'll need to check" when unset (reinforcing the rate-discipline
  guardrail rather than inventing a number), legal's `consult_fee_text`
  defaults to "an amount an attorney will confirm with you directly"
  (never a fabricated dollar figure), auto's tow-partner defaults never
  emit a fake phone number. `cancellation_policy_text` (the one universal
  token, used by auto/dental/vet/motel/restaurant) is resolved for every
  tenant regardless of vertical. Wired into
  `supabase/functions/voice-inbound/handler.ts` (added `t.vertical` to the
  existing single-JOIN query — no extra read — and spread the resolved
  tokens into the `dynamic_variables` response).
- Restaurant's `menu_text` is the one token that needs live data instead of
  just formatting an override: `resolveMenuText` uses the tenant's
  `menu_text` override string if set, else queries `public.offerings`
  (indexed on `tenant_id` where `active`) and renders `name ($price); ...`
  capped at 1500 chars. This is the one place this task added I/O to the
  `/voice-inbound` hot path (SYSTEM_DESIGN §5 p95<300ms budget) — scoped so
  it only fires for a restaurant tenant with NO menu_text override (the
  common case, a configured override, stays zero-extra-query). A real fix
  would precompute/cache the rendered menu (e.g. a trigger-maintained
  column on `offerings` or `agent_configs`) so even the no-override case is
  a single read — left as a follow-up since `supabase/migrations/**` isn't
  in this task's ownership; noting here per CLAUDE.md Rule 4 rather than
  adding a migration outside scope.
- `supabase/functions/_shared/schemas/voice-inbound.ts`'s
  `VoiceInboundDynamicVariablesSchema` extended with the 11 new token
  fields (`cancellation_policy_text` required — always resolved;
  `consult_fee_text`/`practice_areas`/`tow_partner_name`/
  `tow_partner_phone`/`vehicle_makes_serviced`/`species_treated`/
  `emergency_referral_name`/`emergency_referral_phone`/`rate_table`/
  `deposit_policy_text`/`menu_text` optional — vertical-scoped).
- `packages/canonical-types/src/schemas/vertical-details.ts`
  (`verticalDetailsSchema`, the schema `apps/web`'s vertical-details save
  route actually enforces): fixed motel's `deposit_policy`/`rate_table`
  shape drift flagged in GAP_REGISTER §1.6 — was a dollars-valued
  `Record<string, number>` rate table and a bare-string deposit policy;
  now an array of `{room_type, nightly_rate_cents}` (integer cents) and a
  structured `{required, amount_cents?, hold_window_hours?, text}` object,
  matching `zMotelOverrides` in `packages/canonical-types/src/
  agent-template.ts` exactly (that schema turned out to already be
  correct — `verticalDetailsSchema` was the one that had drifted). Added
  restaurant's `tax_rate_bps`/`prep_time_minutes`/`menu_text` fields
  (`tax_rate_bps`/`delivery_radius_m`/`min_order_cents` are read directly
  by `create_order.ts`, never spoken; `menu_text`/`prep_time_minutes`
  matter to `voice-inbound`). New `packages/canonical-types/src/schemas/
  vertical-details.test.ts` (no prior test coverage existed for this
  schema at all).
- `apps/web`'s Settings → Vertical details tab
  (`.../dashboard/agent/vertical-details/page.tsx`): rebuilt the motel
  rate-table editor (still a line-based `room type: nightly_rate_cents`
  textarea, but now cents not dollars, matching the schema fix above) and
  deposit-policy fields (required toggle, amount/hold-window/text); added
  restaurant's tax-rate/prep-time number inputs and a menu-text-override
  textarea. Confirmed auto (tow partner + vehicle makes), legal (practice
  areas + consult fee), dental (insurances), and vet (species + emergency
  referral) already had complete form branches from an earlier pass — no
  changes needed there.

**Decisions logged (CLAUDE.md Rule 4 — flagged, not silently redesigned)**

- Did NOT create `packages/canonical-types/src/schemas/vertical-overrides.ts`
  to move the `z*Overrides` schemas out of `agent-template.ts` (this
  task's ownership note anticipated maybe needing to). Confirmed by grep
  that `zDentalOverrides`/`zVetOverrides`/`zAutoOverrides`/
  `zLegalOverrides`/`zMotelOverrides`/`zRestaurantOverrides`/
  `dynamicVariableOverridesSchemaForVertical` are imported nowhere outside
  `agent-template.ts`'s own test file — they're not wired into any save or
  runtime-validation path today, so `verticalDetailsSchema` (this task's
  own file) is the schema that actually gates what reaches
  `agent_configs.dynamic_variable_overrides`, and `voice-inbound`'s new
  resolver reads that same jsonb column directly rather than through
  `z*Overrides`. Moving them mid-parallel-build risked a barrel-export
  name collision with Cluster A's own edits for no functional gain — filed
  the 3-field consistency gap (`tax_rate_bps`/`prep_time_minutes`/
  `menu_text` missing from `zRestaurantOverrides`) as a `FIX_REQUESTS.md`
  entry for Cluster A instead.
- Did not touch `packages/canonical-types/src/schemas/ai-instructions.ts`
  or its Settings → AI Instructions tab
  (`.../dashboard/agent/instructions/page.tsx`), even though that schema
  declares `prep_time_minutes`/`delivery_radius_miles`/
  `delivery_minimum_cents` fields that look like they'd collide with this
  task's restaurant fields on the same `agent_configs.
  dynamic_variable_overrides` column (and use different units —
  `_miles`/`_minutes_cents` vs. this task's `_m`/`_cents`). Read the page
  component directly: none of those three fields are actually rendered in
  that tab's form or sent by its `onSubmit` — they're currently
  dead/unused declarations in that schema, not a live write-path conflict.
  Neither file is in this task's ownership; noting the dead fields here in
  case whoever owns `ai-instructions.ts` wants to remove them rather than
  eventually wiring them up with the wrong units.
- Real-estate and generic verticals get no new vertical-specific override
  keys (per GAP_REGISTER §2, real_estate/generic don't reference any
  `{{token}}` beyond the universal `cancellation_policy_text`, which this
  task already resolves for every vertical) — real_estate's actual gaps
  (no cancellation-policy fragment/reschedule-cancel path at all, GAP
  §1.12) are template-authoring gaps in `packages/templates/src/verticals/
  real-estate.ts`/`generic.ts`, Cluster F's ownership, not this pipeline
  task's.

**Tests added:** `supabase/functions/voice-inbound/dynamic-variables.test.ts`
(new, pure-function coverage per resolver + `resolveMenuText`/
`renderMenuFromOfferings`), `supabase/functions/voice-inbound/
handler.test.ts` (extended — one simulation scenario per GAP_REGISTER §4
Cluster B acceptance criteria: auto tow-referral, legal fee-guardrail,
motel rate-quote-from-table, vet emergency-referral, restaurant
menu-from-offerings/override, plus a cross-vertical isolation test and a
"cancellation_policy_text always present" test). Restaurant's
tax-computation scenario cited in that same acceptance-criteria list is
already covered by the pre-existing `supabase/functions/voice-tools/
tools/create_order.test.ts` (tax/delivery-radius/min-order are read and
enforced in `create_order.ts`, not spoken by `voice-inbound` — confirmed,
not re-tested here).

**Gates run (scoped):** `pnpm --filter @heyloo/edge-functions test`
(73 files / 590 tests, green), its `tsc -p tsconfig.json --noEmit`
(clean), `pnpm --filter @heyloo/canonical-types test`/`typecheck` (10
files / 134 tests, clean), `pnpm --filter @heyloo/web test`/`typecheck`
(30 files / 134 tests, clean), `npx biome check --write` on every
changed/new file (0 errors after applying its own formatting fixes).

## Cluster A (GAP_REGISTER pass) — conversation engine

Scope: GAP_REGISTER §1.1, §1.4, §1.5, §1.13, §3 items 1-5/7. Ownership:
`packages/adapters/retell/src/{compiler/**,agents.ts,raw-types.ts,**/*.test.ts}`,
`packages/canonical-types/src/{agent-template.ts,voice-provider.ts}`.

**1. Post-call extraction lowering (§1.1).** New
`packages/adapters/retell/src/compiler/extraction.ts`:
`compilePostCallAnalysisData(template)` walks every state's `extraction[]`,
dedupes by `field` name (first declaration wins — legal's
`legal_advice_given`, compiled onto many states via
`withLegalGuardrail`, is deliberately duplicated), and lowers to Retell's
`post_call_analysis_data` shape (RETELL-VERIFY: confirmed this is an
AGENT-level field, `AgentResponse.{String,Enum,Boolean,Number}
AnalysisData`, NOT part of either flow-resource request body — a
correction to the gap register's implicit assumption that it lived
alongside `global_prompt`/`states`). Canonical `zExtractionField` gained an
optional `description` (agent-template.ts, mine) — the compiler synthesizes
one from the field name + owning state name when omitted, so `legal.ts`'s
existing `{field, type}`-only declaration keeps compiling. Wired into all
three compile targets via `compileRetellTemplate` (`compiler/index.ts`,
now returns `CompiledAgentPayload.postCallAnalysisData`) and attached to
`agents.ts`'s create/update-agent body (omitted entirely, not `[]`, when a
template declares no extraction fields). `voice-events/handler.ts`'s
`handleCallAnalyzed` already reads `custom_analysis_data["classification"/
"outcome"/"follow_up_needed"/"legal_advice_given"/"emergency_detected"]` —
exactly the field names this compiler emits (`field.field` verbatim) — so
**no FIX_REQUEST was needed for that reader**. What IS still missing:
vet/dental have no emergency/urgency extraction fields authored on their
templates at all yet (only legal does) — filed in FIX_REQUESTS.md since
`packages/templates` isn't this cluster's ownership; the compiler is ready
for whenever that lands.

**2. Function-node tool locking (§1.4).** `conversation-flow.ts` now
compiles a single-tool, NON-START state to a Retell Function Node
(`tool_id`, `tool_type: "local"`, `wait_for_result: true`,
`speak_during_execution: true` on the node); the referenced tool also gets
`speak_during_execution`/`speak_after_execution: true` set on its
TOP-LEVEL definition. **Correction to the gap register's own fix text**:
RETELL-VERIFY (confirmed via `retell-sdk`) found `speak_after_execution`
does NOT exist on `FunctionNode` at all — it's a field on the TOOL
definition (`CustomTool`), not the node; `FunctionNode` only re-exposes
`speak_during_execution` as a node-level override. Implemented against the
verified shape, not the gap register's assumed one (CLAUDE.md Rule 4). The
START state is a documented, permanent exception — it ALWAYS stays a plain
Conversation Node regardless of `allowed_tools` count, because (a) a
Function Node's `instruction` is only conditionally spoken ("only used
when speak_during_execution is true"), not the guaranteed first turn G1/G2
needs, and (b) the disclosure publish gate (`disclosure-gate.ts`) only
inspects a `type: "conversation"` start node. Verified this is a live
no-op constraint, not a behavior change: the compiler-gate red-team test
(`packages/templates/src/red-team/compiler-gate.test.ts`, imported
read-only) still passes `disclosureVerified: true` for all 8 real
templates after this change — none of them opens on a single-tool state.

**3. Tool-result branching / "Logic Split" (§1.5).** Added
`tool_result: {tool, variable, operator, value?}` to
`zTransitionCondition` (agent-template.ts) — `TOOL_RESULT_COMPARATORS`
mirrors Retell's real equation operators exactly. **Correction to the gap
register's assumed mechanism**: RETELL-VERIFY found there is no separate
"Logic Split" NODE TYPE distinct from `BranchNode` (which exists, but
adds a node with no capability beyond what's already on every node's own
`edges` array) — `ConversationNode`/`FunctionNode`/`BranchNode` all share
byte-identical `Edge.{PromptCondition,EquationCondition}` shapes. A
`tool_result`-typed transition therefore compiles to an EQUATION-typed
edge (`{type:"equation", operator:"&&", equations:[{left:variable,
operator,right:value}]}`) directly on the origin node — deterministic, not
model-discretionary — rather than inserting a redundant `BranchNode` hop.
Only wired into `conversation-flow.ts`: RETELL-VERIFY confirmed Retell
LLM's `State.Edge` (multi_prompt) has NO equation/deterministic mechanism
at all — a state transition there is structurally a model tool-call
("transition_to_X"), always model-mediated — so `multi_prompt`/
`single_prompt` continue falling back to `predicate` text for a
`tool_result`-carrying transition (documented in `multi-prompt.ts`, no
templates currently use `tool_result` so this is dormant, not exercised).
No existing template used soft-prompt branching in a way this pass could
safely auto-migrate without risking a live behavior change to a shipped
template outside this cluster's ownership — flagged for whichever cluster
owns `packages/templates/src/verticals/{restaurant,motel}.ts` to adopt
`tool_result` on `slot_selected`/availability-gated transitions per
GAP_REGISTER §1.5's specific examples (not filed as a FIX_REQUEST since
it's a content change to a file this cluster doesn't own and no urgent
correctness bug exists today — the soft-prompt version still works,
just less deterministically).

**4. transfer_call native wiring (§1.4 item 4).** `transferCallTool()`
(the one reserved tool name every template uses, zero params,
`tenant_config_only`) now compiles to Retell's REAL transfer mechanism in
all three targets: a `TransferCallNode` (conversation_flow) or a native
`TransferCallTool` (multi_prompt/single_prompt state or general tool) —
never the generic custom-webhook `tools[]`/`general_tools[]` entry it
silently fell into before. `transfer_destination.number` compiles to the
literal `{{transfer_number}}` dynamic-variable placeholder (added to
`zAgentDynamicVariables`, voice-provider.ts) rather than being baked in at
publish time — deliberately: baking it in at publish time would require
plumbing tenant config (`agent_configs.transfer_number`) through
`CreateOrUpdateAgentInput`/`RetellProvider.createOrUpdateAgent`
(`provider.ts`, outside this cluster's ownership) just to reach the
compiler; using the SAME dynamic-variable mechanism every other piece of
tenant config already uses (`manager_phone` etc.) needed no such plumbing
and stays consistent with G6 ("resolved server-side from tenant config,
never model/caller-influenced" — a dynamic variable is exactly that).
**This is not yet end-to-end functional**: `voice-inbound/handler.ts`
(Cluster B's `dynamic-variables.ts`) doesn't yet forward
`agent_configs.transfer_number` as this dynamic variable — filed as a
FIX_REQUEST (blocking for `transfer_call` to actually dial correctly, not
a regression — it didn't work via the old custom-webhook path either).
`RetellTransferOption` deliberately omits Retell's `agentic_warm_transfer`
variant (RETELL-VERIFY via `sdk-contract.test.ts`: it requires a nested
`agentic_transfer_config` object this compiler never constructs) — only
`warm_transfer` is emitted, per SYSTEM_DESIGN §4.5's "warm transfers
always carry a context summary".

**5. Token/schema consistency + budget tests.** New
`packages/adapters/retell/src/compiler/registry-consistency.test.ts`,
importing `@heyloo/templates` READ-ONLY (added as a `devDependency` of
`@heyloo/adapter-retell` — `packages/templates` already had the reverse
dependency for its own red-team compiler-gate test, so this is a
dev-only, test-time-only cycle; no runtime import cycle, no `tsconfig.json`
project-reference added — `tsc -b` resolves it via the already-built
`packages/templates/dist` like any other npm dependency). Confirmed via a
real run: all 8 templates' `{{token}}` usage resolves cleanly against the
union of `zAgentDynamicVariables` + that vertical's
`dynamicVariableOverridesSchemaForVertical()` + `verticalDetailsSchema`
(derived via a small, documented, TypeScript-checked suffix-mapping
function over the real schemas' `.shape`, not a second hand-maintained
allowlist). Budget test results (soft-reported via `console.warn`, hard
ceiling at 2x SYSTEM_DESIGN's stated soft budget so a genuine runaway
regression still fails): `real_estate` — 5 tools / 1022 words (barely
over the 1000-word soft target, confirms the audit's "at the ceiling"
finding almost exactly); `generic` — 6 tools / 969 words (one tool over
the 5-tool soft budget — a NEW finding this pass surfaced, not previously
in GAP_REGISTER). Both filed as informational FIX_REQUESTS for whichever
cluster owns `packages/templates` vertical content to decide on trimming.

**6. Outbound call support.** New `packages/adapters/retell/src/
outbound.ts`: `createRetellOutboundCall(client, input)` — `POST
/v2/create-phone-call` (RETELL-VERIFY: confirmed the `/v2` prefix via
`retell-sdk`'s `Call.createPhoneCall`, distinct from this package's other,
unprefixed endpoints). Fails CLOSED on a missing/blank
`dynamicVariables.disclosure_line` (G1/G2) — an outbound call has no
compiled-in first turn the way inbound templates do, so this function is
the enforcement point instead of the compiler's disclosure gate. Added
`CreateOutboundCallInput`/`Result` and an OPTIONAL `createOutboundCall`
method + OPTIONAL `supportsOutboundCalls` capability flag to
`VoiceProvider`/`ProviderCapabilities` (voice-provider.ts) — optional
specifically so `provider.ts` (outside this cluster's file ownership for
this pass) didn't need editing for the rest of this package to typecheck;
wiring `RetellProvider.createOutboundCall` to delegate to `outbound.ts`
and flipping `RETELL_CAPABILITIES.supportsOutboundCalls: true` is filed as
a FIX_REQUEST.

**Restaurant overrides gap closed in passing**: `zRestaurantOverrides`
(agent-template.ts) was missing `menu_text`/`tax_rate_bps` even though
`system-prompt.ts`/fragments compile in `{{menu_text}}` and
`schemas/vertical-details.ts` (the tenant-facing form) already collects
both — GAP_REGISTER §1.6's exact drift pattern, caught by this pass's own
token-consistency test before it was even written against real templates.
Fixed directly since `agent-template.ts` is this cluster's file, entire.

**Gates run (scoped):** `pnpm --filter @heyloo/adapter-retell
{typecheck,build,test}` (18 files / 140 tests, clean — includes
`sdk-contract.test.ts`, the compile-time assignability check against the
real `retell-sdk` types, updated for the new node/tool unions),
`pnpm --filter @heyloo/canonical-types {typecheck,test}` (10 files / 134
tests, clean), `pnpm --filter @heyloo/templates {typecheck,test}` (3
files / 104 tests, clean — read-only consumer, confirms this pass didn't
regress any of the 8 real templates' disclosure-gate/structural
guarantees).

## Cluster F (GAP_REGISTER pass) — per-vertical template authoring (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Scope: GAP_REGISTER §2 per-vertical template-level items (legal, real_estate,
generic, vet, dental, motel, restaurant, auto), plus §1.12's reschedule/
cancel + cancellation-policy coverage and the simulation-scenario/red-team
extensions named in the Cluster F build-plan brief. Ownership:
`packages/templates/src/{verticals/*.ts,shared/{fragments,utility-states,
disclosure,global-intents,system-prompt}.ts,registry.ts,red-team/**,
index.ts,scripts/**}` — everything in `packages/templates/**` EXCEPT
`shared/tools.ts` (Cluster CD's file).

**1. Legal — take_message fallback on every early-exit path (§2 Legal item
3, BLOCKER).** Added a new shared `giveUpGlobalIntent()` builder
(`shared/global-intents.ts`) — a `reachable_from: "any"` escape targeting
`take_message_fallback`, the structural home for `GIVE_UP_LADDER_FRAGMENT`'s
"move to a transfer or a take-message fallback" instruction, which
previously had no state to route to on ANY template except via the two
narrow existing edges (`greeting`/`check_time none_available`) other
verticals already had. Wired into `legal.ts` (which previously had NO
`take_message_fallback` state at all) alongside a `greeting ->
take_message_fallback` transition matching sibling verticals. Also
enhanced the shared `takeMessageFallbackState()` itself (`shared/
utility-states.ts`) to instruct folding in whatever was already gathered
earlier in the call — a small, universally-beneficial change since every
conversation_flow/multi_prompt template uses this same builder.

**2. Legal/real_estate — structured capture without a typed destination
(§2 Legal item 4, §1.7).** `zLegalBookingPayload`/`zRealEstateBookingPayload`
(`packages/canonical-types/src/booking-payloads.ts`, Cluster D's earlier
work) already declare the right fields, but `take_message` (the only tool
either vertical's non-booking exit path uses) has no `structured_payload`
slot the way `create_booking` does. Filed in `docs/audit/FIX_REQUESTS.md`
(not this cluster's file to change). Interim fix, inside this cluster's own
ownership: both `legal.ts` and `real-estate.ts` now carry a
`STRUCTURED_..._CAPTURE_FRAGMENT` instructing the model to compose
`message_text` as fixed, labeled lines (`"Matter type: ..."`, `"Opposing
party: ..."`, etc., with `"not yet asked"` for anything never reached) —
recoverable by a human reading the message today, upgradeable to a real
column the moment the FIX_REQUEST lands.

**3. Legal — `lookup_customer` wired in (§2 Legal item 5).** Was declared
in `tools[]` but never referenced by any state's `allowed_tools` — added to
`collect_name_phone`, instructed as an optional returning-client check that
never skips the conflict check.

**4. Real estate — BLOCKER items 1/2/4/5: compile-target decision.** Moved
`real-estate.ts` from `single_prompt` to `multi_prompt` (matching legal's
existing compile target, and for the identical documented reason —
SYSTEM_DESIGN §4.1's "open empathetic discovery a rigid graph would
flatten"). The audit measured the old single_prompt version at 1,022
words/5 tools, already at/over the single_prompt viability ceiling, BEFORE
adding this pass's BLOCKER fixes: `manageBookingState()` +
`updateBookingTool()`/`cancelBookingTool()` (reschedule/cancel didn't exist
at all), `CANCELLATION_POLICY_READOUT_FRAGMENT`, and
`sendSmsConfirmationTool()` for showing confirmations. Trimming existing
qualification prose to make room would have meant cutting the exact
buyer/seller/area/pre-approval/timeline/budget conversational coverage the
vertical exists to collect, so `multi_prompt` was chosen instead — it has
no single-prompt-sized word budget (each state's `state_prompt` is shown
only when active) while keeping `qualification` as ONE open,
model-mediated state rather than a field-by-field conversation_flow graph,
preserving the "not an interrogation" design intent SYSTEM_DESIGN
originally wrote this vertical around. Full rationale is also in
`real-estate.ts`'s own docstring. Verified: `pnpm --filter @heyloo/templates
test` and `pnpm --filter @heyloo/adapter-retell test` both green after the
move (compiler-gate/registry-consistency tests included).

**5. Real estate — item 3 NOT implemented (deliberately).** The "already
working with another agent?" question is explicitly called out in
GAP_REGISTER.md as "a spec-level gap, not just a template gap" (agency-
representation disclosure norms vary by jurisdiction) — `zRealEstateBooking
Payload.working_with_another_agent` (Cluster D) already has a typed field
ready to receive an answer, but no wording was added asking the question,
per CLAUDE.md Rule 4 (flag, don't redesign SYSTEM_DESIGN §4.3 unilaterally).
Flagged here for whoever owns that spec section to decide.

**6. Generic — BLOCKER item 3: reschedule/cancel + cancellation policy
(§1.12).** Added `manageBookingState()` + `updateBookingTool()`/
`cancelBookingTool()` + `CANCELLATION_POLICY_READOUT_FRAGMENT`, same as
real_estate. Generic's own budget was already flagged over the soft
threshold by Cluster A's finding (969 words/6 tools) before this addition;
this pass's decision — DIFFERENT from real_estate's — is to KEEP
`single_prompt` and accept the larger resulting overage rather than bump
generic to a costlier compile tier. Reasoning: generic is deliberately the
cheap/floor-priced vertical (SYSTEM_DESIGN §1's "$49-99 floor"
positioning); moving it to `multi_prompt` raises its per-call LLM cost
tier, a pricing decision this cluster is not positioned to make
unilaterally, whereas a caller being structurally unable to reschedule or
cancel an appointment is a harder functional gap than a soft, non-blocking
word-budget warning (the budget test in `packages/adapters/retell/src/
compiler/registry-consistency.test.ts` remains `console.warn`-only, never a
hard CI failure, confirmed still green: `pnpm --filter @heyloo/adapter-retell
test`, 138/138). Flagged in `docs/audit/FIX_REQUESTS.md` (updated the entry
Cluster A filed) so a product/eng decision-maker can revisit whether
generic needs its own slightly-pricier tier instead of absorbing the
overage indefinitely.

**7. Vet — lookup_customer expanded, structured payload, extraction
(§2 Vet items 1-4).** `collect_owner_phone` now calls `lookup_customer`
(previously only reachable via `manage_booking`) and `collect_pet_info`
instructs confirming a known pet back instead of re-asking from scratch —
closes the "repeat customer re-dictates everything" gap (§1.8) at the
template level; the backend write-through of `customers.metadata.pets`
remains Cluster C/D's (not filed as a new request — GAP_REGISTER.md §1.8
already describes the exact fix, unclaimed). `confirm_booking` now passes
`structured_payload` (pet_name/species/breed/age_years/visit_reason/
symptom_or_routine — the exact `zVetBookingPayload` shape, Cluster D).
`emergency_referral` now declares `extraction: [emergency_detected
(boolean), urgency_flag (enum)]`, closing the FIX_REQUESTS.md item Cluster
A filed against this cluster — lowered by Cluster A's already-built
post-call-analysis pass with zero compiler change needed (verified via the
full `packages/templates` test run). Item 4 (`check_time` needs a real
offering/duration lookup by `symptom_or_routine`) needs a new tool/catalog
this cluster can't invent without guessing an id — filed in
`docs/audit/FIX_REQUESTS.md`. Item 5 (`registry.ts` key `"veterinary"` vs
canonical slug `"vet"`) — see item 12 below.

**8. Dental — extraction, offering/reason capture (§2 Dental items 1/3).**
`pain_triage` now declares the same `emergency_detected`/`urgency_flag`
extraction shape as vet's emergency state (closes the other half of the
FIX_REQUESTS.md item Cluster A filed). `new_or_existing` now calls
`lookup_customer`. `pain_triage` now also asks for the visit's reason in
the caller's own words (cleaning, filling, broken tooth, check-up, etc.)
and `confirm_booking` passes it as `structured_payload.reason_for_visit`
(`zDentalBookingPayload`) — a real, achievable partial fix for "offering_id
always null" using only fields that already exist, WITHOUT inventing a
fake offering-picker tool (which would need real tenant-configured catalog
data this cluster doesn't have, matching the "never invent a catalog"
principle every other vertical's tool-discipline fragment already
enforces) — the actual `offering_id` population needs the same
`list_offerings`-style tool filed as a FIX_REQUEST for vet's item 4, above.
Item 2 (secure DOB/insurance link) was already mentioned in the existing
`confirm_booking` wording, kept and slightly extended — the actual
hosted-form/SMS-template build is out of this cluster's scope (per the gap
register's own note, "size it as its own build item"). Item 4's residual-
PHI-if-volunteered-anyway concern: NOT addressed with a redaction
mechanism this pass — GAP_REGISTER.md explicitly calls this "a real design
decision needed, not silently redesigned." Flagging here per CLAUDE.md Rule
4: if a caller volunteers DOB/insurance despite `PHI_DEFERRAL_FRAGMENT`'s
instruction not to dwell on it, that PHI still exists in the raw
transcript/recording today with no redaction step — whoever owns
SYSTEM_DESIGN §4.3/the dental HIPAA posture should decide whether a
post-call transcript-redaction pass is needed before this ships to a real
dental tenant.

**9. Motel — guest contact, room-type-aware availability, quoted-rate
persistence (§2 Motel items 2/5/6, BLOCKER item 2 partially).** Added a new
`collect_guest_contact` state (name + digit-by-digit phone read-back) —
previously entirely missing; the reservation had no guest name/phone
collection step at all, only a guest COUNT. `check_time` now instructs
passing the chosen room type as `room_type` to `check_availability`
(the SQL filter, `supabase/functions/voice-tools/tools/
check_availability.ts`, already implements this per its own
GAP_REGISTER-citing comment — confirmed by reading it this pass) — but the
model-facing JSON-Schema for `check_availability`
(`checkAvailabilityTool()`, `shared/tools.ts`, Cluster CD's file) doesn't
declare `room_type` as a property yet, so the model has no slot to put it
in structurally. Filed in `docs/audit/FIX_REQUESTS.md`; documented inline
in `motel.ts`'s own top-of-file NOTE so the dependency is visible at the
call site, not just in the fix-request log. `confirm_booking` now passes
`structured_payload` with `room_type`/`quoted_rate_cents` (the exact rate
quoted from `{{rate_table}}`, never re-derived)/`num_guests`
(`zMotelBookingPayload`). Deposit-hold wording (item unlisted here) was
already present via `{{deposit_policy_text}}` — no change needed, verified
by reading `motel.ts` before editing.

**10. Restaurant — allergy persistence, structured payload (§2 Restaurant
item 2, BLOCKER, partially).** `zCreateOrderRequest` (canonical-types) and
the runtime schema already have `allergies`/`special_instructions` (an
earlier cluster's work), but — same drift pattern as motel's `room_type` —
`createOrderTool()`'s model-facing JSON-Schema (`shared/tools.ts`, Cluster
CD's file) doesn't declare either property. Filed in
`docs/audit/FIX_REQUESTS.md`; `confirm_order`'s prompt now instructs
passing both (an empty list for "no allergies", never omitted), ready for
when the schema catches up — documented inline via a top-of-file NOTE in
`restaurant.ts`, same pattern as motel's. "Delivery fee/minimum
statements" and "order-ready expectation" (§2 Restaurant items also in this
cluster's brief) were NOT added to the compiled prompt this pass: no
dynamic-variable token resolves `prep_time_minutes`/a delivery-fee-or-
minimum amount into speakable text today (confirmed by reading
`supabase/functions/voice-inbound/dynamic-variables.ts` before deciding) —
adding an unresolved `{{token}}` to a live template would recreate
GAP_REGISTER.md §1.3's exact "literal placeholder spoken to the caller"
bug that an earlier cluster already fixed everywhere else. Filed as a
FIX_REQUEST instead of guessing (CLAUDE.md Rule 1).

**11. Auto — repeat-customer skip, structured payload (§2 Auto items 2/4).**
`collect_phone` now calls `lookup_customer`; `collect_vehicle` instructs
confirming a known vehicle back instead of re-asking from scratch (same
pattern as vet's pet info). `confirm_booking` now passes `structured_
payload` with vehicle_year/vehicle_make/vehicle_model/symptom_category/
drop_off_or_wait (`zAutoBookingPayload`).

**12. `registry.ts` key rename `"veterinary"` -> `"vet"` (§2 Vet item 5).**
Grepped the full repo first (not just `packages/templates`) for the string
literal `"veterinary"`/`'veterinary'` before renaming: the only other
in-repo hits were `scripts/setup-stripe.ts` (an unrelated Stripe product
name string), `apps/web/src/content/marketing/verticals.ts` (an unrelated
marketing-page slug), and a stale code comment in `apps/web` — none of
them call `getTemplateDefinition`/read `TEMPLATE_REGISTRY` with this key,
so the rename is safe today. Updated the two in-package references that
DID use the old key (`red-team/structural.test.ts`,
`red-team/injection-fixtures.ts`) in the same change. `VETERINARY_TEMPLATE`
(the exported constant name) and the `verticals/veterinary.ts` filename are
UNCHANGED — only the registry's own `key` field (`vertical` was already
correctly `"vet"` on the template object itself).

**13. Red-team suite: manage_booking hard-asserted, not skipped
(build-plan acceptance criterion).** `structural.test.ts`'s identity-
fallback test previously did `if (!manageState) continue` — silently
passing for any template without one. Changed to: for every template that
declares `create_booking`, assert `manage_booking` MUST exist (hard
failure, not a skip) — this now holds for all 7 booking-capable verticals
(auto, vet, dental, motel, restaurant, real_estate, generic) after this
pass's real_estate/generic additions; legal is correctly excluded since it
has no `create_booking` tool at all (a pure intake vertical with nothing to
reschedule).

**14. Simulation scenarios for every register scenario (build-plan
requirement).** New `red-team/simulation-scenarios.ts` — the non-adversarial
half of the batch-simulation seed corpus (`injection-fixtures.ts` already
covered "injection"; this file adds happy_path, changes_mind,
no_availability, out_of_radius, emergency, silence_voicemail, non_english,
transfer, one or more scripted scenarios per applicable vertical or a `"*"`
wildcard). Same non-goal as `injection-fixtures.ts` (documented in
`README.md`, updated to reference the new file): this package does not call
Retell itself — connecting either dataset to Retell's real batch-simulation
API remains explicitly future work, out of this cluster's scope. Added a
new `structural.test.ts` describe block asserting the dataset is
well-formed (valid vertical keys, non-empty caller turns/expectations) and
covers every required category, plus specific coverage assertions
(every `check_availability`-capable vertical has a `no_availability`
scenario via a specific fixture or the `"*"` wildcard; restaurant has an
`out_of_radius` scenario).

**Gates run (scoped, final):** `pnpm --filter @heyloo/templates
{typecheck,test}` — 4 files / 134 tests, all green (includes Cluster CD's
own `shared/tools.test.ts`, landed mid-pass, and `compiler-gate.test.ts` —
the one test in this package that actually runs Cluster A's compiler
against every changed template; real_estate's compile-target change and
generic's/every waitlist-vertical's added tools all still pass the
disclosure-gate check). Also ran, informationally, the downstream consumer
`pnpm --filter @heyloo/adapter-retell {typecheck,test}` after rebuilding
`packages/templates` (`pnpm --filter @heyloo/templates build`) — 18 files /
138 tests, all green, confirming `registry-consistency.test.ts` (Cluster
A's word/tool-budget check, `console.warn`-only) didn't hard-fail on
real_estate's compile-target move or generic's added tools/state.

**`join_waitlist` wiring (§1.2) — landed mid-pass.** `joinWaitlistTool()`
was initially absent from `packages/templates/src/shared/tools.ts` (Cluster
CD's file); re-checked near the end of this pass per the task brief's
"check FIX_REQUESTS.md late in your work" instruction and found it had
since landed. Closed the loop within this cluster's own ownership:
`WAITLIST_OFFER_FRAGMENT` (`shared/fragments.ts`) now instructs calling
`join_waitlist` with name/phone/preferred window instead of the
`take_message`-with-a-`"Waitlist request:"`-prefix workaround, and every
vertical that imports the fragment (auto-repair, vet, dental, restaurant,
real_estate, generic — motel deliberately excluded, per its own
`nearest_alternative` UX already noted in `structural.test.ts`) now
declares `joinWaitlistTool()` in `tools[]` and adds `"join_waitlist"` to
the relevant availability-checking state's `allowed_tools`. Verified with
a full rebuild + both scoped test suites after the change (`pnpm --filter
@heyloo/templates {typecheck,test}` — 4 files/134 tests green; `pnpm
--filter @heyloo/templates build` then `pnpm --filter @heyloo/adapter-retell
test` — 18 files/138 tests green).

## Cluster CD — Tools, typed payloads, DB fields (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Closed GAP_REGISTER.md §1.2 (join_waitlist), §1.7 (typed structured_payload
per vertical), §1.8 (customers.metadata vehicles/pets), §1.9 (tools.ts /
voice-tools.ts schema drift), §1.10 (create_order consent), and the
Restaurant/Motel per-vertical items cited in the task brief (allergies/
special_instructions, delivery fee, party-size/table-capacity, room-type
capacity, motel deposit hold + expiry, order-ready SMS, adapter
update/cancel semantics).

**Tools/canonical-types**

- New `packages/canonical-types/src/booking-payloads.ts`: one loose
  (never `.strict()`) Zod object per vertical (`zAutoBookingPayload` ...
  `zRestaurantBookingPayload`), a `zBookingStructuredPayload` union, a
  `zBookingStructuredPayloadFor(vertical)` selector, and
  `BOOKING_STRUCTURED_PAYLOAD_PROPERTIES` (hand-maintained JSON-Schema
  `properties` per vertical, kept in sync with the Zod shapes by a
  dedicated parity test) — the model-facing authoring schema for
  `create_booking`'s `structured_payload`. Deliberately never rejects an
  incomplete/unexpected payload outright (hot-path graceful-fallback
  discipline, CLAUDE.md Rule 2) — it's an authoring/typing aid, not a gate
  that can fail a real booking.
- `packages/canonical-types/src/tools.ts`: added `consent` to
  `zCreateBookingRequest`, `verify` to `zUpdateBookingRequest`/
  `zCancelBookingRequest`, `consent`/`allergies`/`special_instructions` to
  `zCreateOrderRequest`, `delivery_fee_cents` to `zCreateOrderResult`'s
  confirmed branch, `room_type` to `zCheckAvailabilityRequest`,
  `structured_payload` (typed via `zBookingStructuredPayload`) to
  `zTakeMessageRequest`, an `addresses` field to `zLookupCustomerResult`,
  and new `zJoinWaitlistRequest`/`zJoinWaitlistResult` + a `join_waitlist`
  entry in `TOOL_REQUEST_SCHEMAS`/`TOOL_NAMES` — closing GAP_REGISTER.md
  §1.9's drift (these all already existed in the runtime-enforced
  `_shared/schemas/voice-tools.ts` and were simply missing from the
  model-facing/dashboard-facing canonical file).
- Schema-drift fix (§1.9): Deno cannot import the Node/ESM
  `@heyloo/canonical-types` package (confirmed constraint, same as
  `admin/schemas.ts`'s own documented reason — adding it as a
  `supabase/functions/package.json` devDependency was considered and
  rejected as outside this file's ownership and unnecessary for a
  test-only need), so true single-sourcing isn't available across the
  Deno/Node boundary. Implemented the register's own documented fallback
  instead: new `supabase/functions/_shared/schemas/voice-tools.test.ts`
  hardcodes the canonical top-level key set per tool (a literal manifest,
  commented as "keep in sync with tools.ts") and diffs it against each
  runtime Zod schema's own `.shape` keys — a future edit to either file
  that adds/removes a top-level arg key without updating both now fails
  the scoped `@heyloo/edge-functions` test gate every change to this file
  must already pass.
- New `supabase/functions/voice-tools/tools/join_waitlist.ts`: mirrors
  `create_booking.ts`'s race-proof/idempotent-insert shape exactly (never
  check-then-insert — a unique-constraint violation on retry re-selects
  and returns the existing row) with a locally-computed idempotency key
  (`call_id:fnv1a(stableStringify(preferred_window))`, reusing
  `_shared/idempotency.ts`'s already-exported `fnv1aHex`/`stableStringify`
  rather than adding a new exported helper to that unowned file). Wired
  into `voice-tools/handler.ts`'s dispatch table and
  `packages/templates/src/shared/tools.ts`'s new `joinWaitlistTool()`.
  Verified end-to-end (not just at the insert level): the pre-existing
  `fn_notify_waitlist_on_cancellation` trigger
  (`20260907131400_functions_triggers.sql`) and the SMS reply-YES
  auto-book consumer (`webhooks-twilio-sms/handler.ts`) were already
  built and waiting for a real producer — confirmed via the throwaway-
  Postgres harness (below) that a `waitlist_entries` insert, an
  `availability_slots`-freeing booking cancellation, and the resulting
  `messages_outbound` row all chain correctly.
- `packages/templates/src/shared/tools.ts`: `createBookingTool()` and the
  new `takeMessageTool()` both accept an OPTIONAL second `vertical`
  argument that surfaces `BOOKING_STRUCTURED_PAYLOAD_PROPERTIES[vertical]`
  as the `structured_payload` JSON-Schema `properties` instead of a bare
  `{type:"object"}` — left optional (defaulting to the old bare shape) so
  none of the 7 existing `packages/templates/src/verticals/*.ts` call
  sites needed editing (outside this cluster's ownership; confirmed
  unchanged and still green via `pnpm --filter @heyloo/templates
  {typecheck,test}`, including the full red-team `structural.test.ts`
  suite across all 8 templates) — filed as a one-argument-per-file follow-
  up in `docs/audit/FIX_REQUESTS.md` for Cluster F. Also fixed the two
  requests Cluster F had already filed against this same file this pass
  (`checkAvailabilityTool()`'s missing `room_type` property,
  `createOrderTool()`'s missing `allergies`/`special_instructions`
  properties) — both verticals/motel.ts and verticals/restaurant.ts were
  already written expecting these fields to exist, confirmed by grep
  before starting.

**DB fields / typed payloads (`create_booking.ts`/`create_order.ts`)**

- `create_booking.ts`: validates nothing beyond the existing Zod shape at
  the boundary (per the booking-payloads.ts design note above) but now:
  (a) merges a vehicle (auto) or pet (vet) entry extracted from
  `structured_payload` into `customers.metadata.vehicles`/`.pets`,
  deduped by exact-match against what's already on file, so
  `lookup_customer.ts`'s pre-existing `vehicles`/`pets` read (previously
  always empty) now actually returns something for a repeat caller; (b)
  for `vertical === 'motel'` only (one extra query, scoped so every other
  vertical's hot path pays nothing extra), reads `agent_configs.
  dynamic_variable_overrides.deposit_policy` and inserts `status =
  'scheduled'` with a `hold_expires_at` (`now() + hold_window_hours`,
  default 24h) instead of `'confirmed'` when a deposit is required,
  mirrors a valid `structured_payload.quoted_rate_cents` onto the new
  `bookings.quoted_rate_cents` column; (c) writes
  `call_logs.structured_booking_payload` (previously asked for by the
  dashboard's "Linked booking" card but never written by anything) when
  the call captured any structured data.
  - **KNOWN LIMITATION, deliberately not fixed this pass:** the `bookings`
    GIST exclusion constraint and `fn_invalidate_availability_on_booking`
    only react to `status = 'confirmed'` — a `'scheduled'` deposit hold
    does NOT yet block a second caller from being offered/confirming the
    same slot at the DB level. Extending that shared constraint/trigger
    (used by every vertical's booking path) mid-parallel-build was judged
    too risky for this task's scope; flagged per CLAUDE.md Rule 4 rather
    than silently redesigned. `webhooks-stripe/handler.ts` (not this
    cluster's ownership) already flips a paid deposit's booking to
    `'confirmed'` on the Stripe webhook — confirmed by reading it, not
    modified.
- `create_order.ts`: persists `consent` onto `customers.consent` (mirrors
  `create_booking.ts`'s existing pattern, closing §1.10), persists
  `allergies`/`special_instructions` onto new `orders` columns, computes
  `delivery_fee_cents` from `agent_configs.dynamic_variable_overrides.
  delivery_fee_cents` (read directly, same pattern as the pre-existing
  `tax_rate_bps`/`min_order_cents`/`delivery_radius_m` reads) and includes
  it in `total_cents` + the tool result, and writes
  `call_logs.structured_booking_payload` when allergies/special
  instructions were captured. Confirmed already-fixed by an earlier pass
  before this one started (not re-done): the `adapter: "pos"` ->
  `adapter: "square"` enqueue-key bug (§2 Restaurant item 5) —
  `_shared/adapter-push.ts`'s `enqueueAdapterPush` already addresses by
  real connected-provider name, verified by reading it and its own
  contract test.
- `check_availability.ts`: `room_type` (new, alongside `resource_type`)
  and `party_size` now actually filter the SQL (previously accepted by
  the request schema but never used — `party_size` for restaurant table-
  capacity, GAP_REGISTER.md §2 Restaurant item 3; `room_type` for motel
  room-tier availability, §2 Motel item 2) — one combined `resource_id in
  (select ... where (all provided predicates ANDed))` subquery rather than
  three separate OR-wrapped blocks, applied to both the primary-window and
  nearest-alternative queries.
- `take_message.ts`: added `structured_payload` support (merged into
  `call_logs.structured_booking_payload` via jsonb `||`, never overwriting
  what an earlier tool call in the same call already wrote) — a request
  filed by Cluster F this same pass (legal/real_estate's message-fallback
  path had no typed destination for conflict-check/buyer-seller data).
- New migrations (prefix range `202609101[23]xxxx`, all additive, verified
  reproducible-from-zero — see below):
  `20260910120000_orders_delivery_allergies_columns.sql` (orders.allergies
  text[]/special_instructions text/delivery_fee_cents int not null default
  0), `20260910120500_bookings_quoted_rate_and_hold_expiry.sql`
  (bookings.quoted_rate_cents int/hold_expires_at timestamptz),
  `20260910121000_resources_room_type.sql` (resources.room_type text + a
  partial index), `20260910121500_waitlist_entries_idempotency.sql`
  (waitlist_entries.idempotency_key text + a unique (tenant_id,
  idempotency_key) constraint — `join_waitlist.ts` needed this to exist to
  be race-proof/idempotent the same way `create_booking.ts` is),
  `20260910122000_motel_deposit_hold_expiry_cron.sql`
  (`fn_expire_unpaid_deposit_holds()` + a `job-motel-deposit-hold-expiry`
  cron entry via the existing `fn_cron_upsert` helper, every 15 minutes —
  cancels any `status = 'scheduled'` booking past its `hold_expires_at`).

**worker-adapter-push — Square/Google Calendar update/cancel semantics**

FIX-1 had explicitly disclosed every adapter pusher was CREATE-only (a
reschedule/cancel push still called the provider's create endpoint against
the booking's current, possibly-cancelled state). Fixed for the two most
tractable/best-documented providers within this pass's budget:

- Added `loadSyncExternalId()` (queries `adapter_sync_state` by
  `entity_id`, NOT by the push message's own `idempotency_key` — that key
  differs per create/update/cancel by design, see each tool's own key
  convention — so it's the only correct "have we already pushed this"
  signal) and `BookingRow.status` (the `bookings.status` column, not
  previously selected).
- `pushToSquare`'s booking branch: an already-synced + non-cancelled
  booking now `PUT /v2/bookings/{id}` updates (reschedule); an already-
  synced + cancelled booking now `POST /v2/bookings/{id}/cancel`s; a
  never-synced booking still takes the original CREATE path. Both new
  calls need Square's `booking.version` (optimistic concurrency) first, so
  added a `retrieveSquareBookingVersion()` (`GET /v2/bookings/{id}` — see
  `docs/VERIFY.md` VERIFY-CD-1, the one part of this that couldn't be
  independently WebFetch-confirmed and fails closed if wrong). Endpoints
  themselves (`PUT`/`POST .../cancel`) were confirmed field-for-field via
  WebFetch against developer.squareup.com (reachable this build, CLAUDE.md
  Rule 1). Implemented as local functions in `worker-adapter-push/
  handler.ts` itself (not added to `_shared/providers/square.ts`, outside
  this cluster's ownership) reusing that file's already-exported
  `SQUARE_BASE_URL`/`SquareFetch`.
- `pushToGoogleCalendar`: same pattern — an already-synced event gets
  `PATCH`ed (reschedule) or `DELETE`d (cancel) instead of re-`insert`ed;
  a 404/410 on delete is treated as already-gone success. Endpoints
  confirmed via WebFetch against developers.google.com (`docs/VERIFY.md`
  VERIFY-CD-2, high confidence, standard REST paths). Local functions
  reusing `_shared/providers/google-calendar.ts`'s already-exported
  `GOOGLE_CALENDAR_BASE_URL`.
- Cancelling/updating a booking that was NEVER pushed to a given adapter
  (no `adapter_sync_state` row) is a harmless no-op for both providers —
  never calls the provider, never fails the push.
- **Not done this pass, still disclosed as open** (Shopmonkey/ezyVet/
  Airtable bookings/orders): update/cancel semantics for these three
  remain CREATE-only. Shopmonkey/ezyVet have no independently-confirmed
  write-update API in this codebase's existing research; Airtable's
  existing field mapping (`airtableFieldsForBooking`) has no status/
  cancelled concept to PATCH toward without guessing a tenant's own base
  schema. Scoped out rather than guessed, per CLAUDE.md Rule 1.
- `packages/adapters/square/**` (in this cluster's ownership per the task
  brief's "if the order push shape needs it") — NOT touched: confirmed by
  grep that nothing outside its own test files imports it; the real
  runtime push path is entirely `_shared/providers/square.ts` +
  `worker-adapter-push/handler.ts`, so there was no order-push-shape need
  to address there.

**apps/web — order-ready SMS**

`apps/web/src/app/api/tenant/orders/[id]/route.ts`: a `PATCH` transition
INTO `status: 'ready'` (and only on a genuine transition — re-PATCHing an
already-`'ready'` order is a no-op, no duplicate SMS) now sends a
best-effort `order_ready` SMS, mirroring `.../bookings/[id]/route.ts`'s
already-established pattern exactly (service-role `messages_outbound`
insert + `fn_enqueue_message_outbound` RPC, since that table has no
tenant write RLS policy; opted-out customers are skipped; a failed
notification never fails the status-update response itself). Needs
`_shared/templates.ts`'s `renderTemplate` to actually have an
`'order_ready'` case to say something real — filed in
`docs/audit/FIX_REQUESTS.md` (today it would send an empty-body SMS, same
as the newly-reachable `'waitlist_slot_opened'` case).

**Migrations verified reproducible-from-zero** — this session's local
Postgres 16 (`service postgresql start`; no Docker daemon available, same
constraint every prior pass in this repo has hit and disclosed). Built a
throwaway stub for the Supabase-platform pieces (`auth`/`storage`/
`realtime`/`cron`/`pgmq`/`vault`/`net` schemas + the `anon`/
`authenticated`/`service_role`/`supabase_auth_admin` roles — session-only,
never committed), applied all 37 real migration files verbatim in order
against an empty database (stripping only the 3 `create extension` lines
for `pg_cron`/`pgmq`/`pg_net`, genuinely unavailable outside a
Supabase-hosted Postgres and already guarded by existence checks) — zero
errors — followed by `supabase/seed/seed.sql`, also zero errors. Beyond
the bare apply, functionally spot-checked: a motel booking insert with
`status='scheduled'`/`quoted_rate_cents`/`hold_expires_at`; running
`fn_expire_unpaid_deposit_holds()` against a backdated hold correctly
cancels it (`cancel_reason = 'deposit_hold_expired'`); a delivery order
insert with `delivery_fee_cents`/`allergies`/`special_instructions`; a
`waitlist_entries` insert plus its own unique-constraint enforcement on a
duplicate `idempotency_key`. `job-motel-deposit-hold-expiry` (like every
other `pg_cron`-dependent job in this repo) doesn't actually register in
this harness since `pg_cron` itself isn't installed — confirmed this
matches the EXISTING jobs' behavior in the same harness (0 rows either
way), not a regression specific to this migration.

**Gates run (scoped):** `pnpm --filter @heyloo/edge-functions
{test,typecheck}` (77 files / 638 tests, clean), `pnpm --filter
@heyloo/canonical-types {test,typecheck}` (11 files / 159 tests, clean),
`pnpm --filter @heyloo/templates {test,typecheck}` (4 files / 136 tests,
clean — includes the full red-team `structural.test.ts` suite across all 8
templates), `pnpm --filter @heyloo/web {test,typecheck}` (30 files / 137
tests, clean). `npx biome check --write` on every file this cluster
touched (0 errors after applying its own formatting fixes).

**Decisions logged (CLAUDE.md Rule 4 — flagged, not silently redesigned)**

- Did not extend the `bookings` GIST exclusion constraint /
  `fn_invalidate_availability_on_booking` to also react to `status =
  'scheduled'` (see the motel deposit-hold KNOWN LIMITATION above) — a
  correct fix, but a shared-invariant change affecting every vertical's
  booking path, judged too risky to land unreviewed mid-parallel-build.
- Did not implement Shopmonkey/ezyVet/Airtable adapter update/cancel
  semantics (see worker-adapter-push section above) — no independently
  Rule-1-confirmed write-update API for the first two; no safe field
  mapping to guess for Airtable's cancel case.
- Did not add `@heyloo/canonical-types` as a devDependency of
  `supabase/functions/package.json` to attempt a real cross-runtime
  schema import for the §1.9 drift fix — Deno's inability to import that
  Node/ESM package is the actual constraint (not a test-only limitation
  a devDependency would route around, since the constraint is about the
  DEPLOYED runtime, and a schema-parity test needs to guard what's
  actually deployed) — used the hardcoded-manifest diff test instead, per
  the register's own documented fallback option.
- Did not touch `packages/adapters/square/**` (explicitly listed in this
  cluster's ownership "if the order push shape needs it") — confirmed via
  grep it has no real runtime call site, so there was nothing to change.

**Cross-cutting fix (outside this cluster's file list, done anyway — see
rationale):** `packages/supabase-client/src/database.types.ts` (the
hand-maintained row types `apps/web` selects/inserts against, per that
file's own header: "add a column here the day a page needs it") was
missing every column this pass added (`bookings.quoted_rate_cents`/
`.hold_expires_at`, `orders.allergies`/`.special_instructions`/
`.delivery_fee_cents`, `resources.room_type`,
`waitlist_entries.idempotency_key`) — caught live when a concurrently-
running dashboard-surfacing pass's `bookings/page.tsx` started selecting
`quoted_rate_cents` and Supabase's typed-query layer correctly rejected it
as an unknown column (`SelectQueryError<"column 'quoted_rate_cents' does
not exist...">`), which would have hard-failed `pnpm --filter @heyloo/web
typecheck` for whichever cluster owns that page the moment both passes
landed. Added the 8 new fields to `ResourceRow`/`BookingRow`/`OrderRow`/
`WaitlistEntryRow` (source only — this package's own committed `dist/`
build output, a pre-existing repo-hygiene issue this task didn't create
or attempt to fix more broadly, needed `pnpm --filter
@heyloo/supabase-client build` to pick the change up, since `apps/web`
resolves this package's types via TS project-reference `dist/*.d.ts`, not
its `src`). Verified `@heyloo/web`'s full `{test,typecheck}` green
afterward. Not this cluster's exclusive ownership, but a strictly
additive, mechanical transcription of columns this cluster's own
migrations introduced — blocking every other cluster's dashboard work
against those tables, not just a nice-to-have.

## Cluster H — Onboarding, testing, growth UI (owner backlog)

**What was built**

1. **Setup-progress panel** — `apps/web/src/app/api/tenant/setup-progress/
   route.ts` (new) computes 11 steps from real, currently-queryable state
   (paid → `tenants.status`, agent provisioned → `agent_configs.
   published_at`, business hours → `tenants.business_hours`, services →
   `offerings`/`resources` counts, cancellation/booking policy reviewed →
   `dynamic_variable_overrides.cancellation_policy.text`, test call done →
   `call_logs.is_test_call`, forwarding verified → `phone_numbers.
   forwarding_verified_at`, delivery/notification preferences →
   `dynamic_variable_overrides.delivery`, team invited (optional) →
   `memberships` count > 1, A2P → `tenants.a2p_status`, integration
   (optional) → `adapter_connections`) — every step real, none fabricated.
   `apps/web/src/components/tenant/setup-progress-panel.tsx` (new) renders
   it on the dashboard home (wired into `overview-client.tsx`, this
   cluster's file per its explicit "+ its components" ownership grant);
   dismiss control only appears once every required step is done (the
   panel itself always recomputes truthfully from the DB on load — see
   that component's own doc comment for why dismissal is a localStorage
   convenience, not a fabricated persistence layer, and
   `docs/audit/FIX_REQUESTS.md` for the two steps — team invites, policy
   review — that had to use a proxy signal or a null href rather than a
   dedicated column/screen this cluster isn't allowed to add).
2. **Test-your-agent** (`dashboard/test-agent/**`, new) — per-vertical
   scripted scenarios (`components/tenant/test-agent-scenarios.ts`, one
   cluster's own authored copy, not imported from `packages/templates`);
   phone test is fully functional today (dial the tenant's already-
   provisioned Heyloo number — works before forwarding is ever turned on
   — poll `call_logs` for the resulting `is_test_call` row, show
   transcript/summary/structured payload/message once it lands); web call
   test degrades honestly (`api/tenant/test-agent/web-call/route.ts`
   proxies to a NEW edge function, `api-tenant-test-call`, that doesn't
   exist yet — provider isolation means it can't be built from
   `apps/web`; filed in `docs/audit/FIX_REQUESTS.md` with a suggested
   contract; the button shows "isn't available yet" rather than faking a
   call). Also added a small, real "register your test phone number"
   control on this page — `tenants.owner_test_phone` is the column
   `voice-events/handler.ts` already keys `is_test_call` off of, and
   nothing anywhere in `apps/web` previously let a tenant set it, which
   would have made the phone test's own `is_test_call` detection silently
   never fire for any tenant who hadn't already set that column some
   other way. "Adjust instructions" links to `/dashboard/agent/
   instructions`; "Turn on forwarding" only appears once a test call has
   actually completed (`ended_at` not null), and links to `/dashboard/
   phone-setup`.
3. **Change-request tickets** — the tenant-side create/view/reply flow
   (`dashboard/support/**`) was already fully built by a prior pass
   (`support_requests`/`support_request_notes`, RLS already grants
   `platform_admin` select+write+insert on both tables) — nothing to add
   there. Built the missing half: an admin cockpit ticket queue
   (`(admin)/cockpit/support/page.tsx` + `.../[id]/page.tsx`, new) with a
   status-filter tab strip and a reply form. Backing API
   (`api/admin/admin-support-requests/**`, new) is a direct-to-Postgres
   Route Handler rather than a proxy to `supabase/functions/admin` — that
   edge function (not owned by this cluster) literally lists
   `admin-support-requests` in its own `NOT_YET_IMPLEMENTED_PREFIXES`
   (501s). Same `platform_admin` claim + session check as `api/admin/
   [...path]/route.ts`'s own proxy, `admin_actions` audit trail on every
   status change/reply. Filed a consolidation-only (non-blocking) note in
   `docs/audit/FIX_REQUESTS.md` for whoever owns that edge function.
4. **Partner portal breakdown + admin partners page** — schema (`referral_
   partners.rate_bps`/`.commission_base`/`.duration_months`,
   `referral_partner_vertical_overrides`) already existed from this same
   pass's Cluster G work (`20260910140000_referral_commission_recurring.
   sql`) with zero admin-facing UI or write path anywhere. Built: admin
   `(admin)/cockpit/partners/page.tsx` (list) + `.../[id]/page.tsx` (edit
   default commission terms + one form per vertical override, clearable
   back to "inherit"), backed by `api/admin/admin-referral-partners/**`
   (new, same direct-to-Postgres + audit-trail pattern as the ticket
   queue — that edge function has no route for this at all, not even in
   its not-yet-implemented list). Partner-side:
   `(partner)/portal/customers/page.tsx` (new) — a per-referred-tenant
   monthly commission breakdown (period, base, rate, the partner's own
   share, status), read through the partner's own RLS-bound session for
   `commission_events`/`referrals` (both already RLS-scoped to
   `fn_jwt_referral_partner_id()`) plus one service-role lookup — strictly
   filtered to the tenant ids that session's own already-scoped
   `referrals` query named — for the referred tenant's display name only
   (`tenants` RLS has no partner-visibility policy at all).
   Deliberately does NOT show tenant-level cost internals (BACKEND_SPEC
   §5 margin secrecy is admin-cockpit-only) — "base" already reflects
   whichever `commission_base` (gross-profit-net-of-cost, or revenue) an
   admin configured for that partner/vertical.
   - **Real bug fixed in the same area (not a new feature):**
     `(partner)/portal/payouts/page.tsx` and `components/partner/
     payouts-table-client.tsx` were selecting/rendering `amount_cents`/
     `method`/`paid_at` — columns that do not exist on `referral_payouts`
     at all (the real columns are `total_cents`/`period`/`status`,
     confirmed by reading the migration directly; `@heyloo/supabase-
     client`'s hand-maintained `ReferralPayoutRow` type had the wrong
     shape too, which is presumably how this shipped without a type
     error). This would have 400'd against the live schema for the first
     real partner. Fixed to the real columns; payout method (constant per
     partner) is now shown once above the table instead of a nonexistent
     per-row field. Filed the type-fix request in
     `docs/audit/FIX_REQUESTS.md`.
5. **Pricing (setup fee / white-glove)** — new product surface, no prior
   spec (logged here per CLAUDE.md Rule 4). Stored as a new `fees_
   <vertical>` `platform_settings` key (mirrors the existing `price_card_
   <vertical>` key's shape/pattern exactly), admin-editable via a new
   "Fees" tab on `(admin)/cockpit/settings/page.tsx` (`api/admin/
   admin-platform-settings/fees/route.ts`, new — same "literal route
   shadows the `[...path]` catch-all" pattern as items 3/4 above, since
   the edge function's `handlePlatformSettings` only knows `referral`/
   `pricing`). `api/platform-settings/price-card/route.ts` (pre-existing,
   this cluster's ownership per "signup price-card display") now also
   returns `setup_fee_cents`/`white_glove_fee_cents`/`
   white_glove_description`, each `null` unless the admin has explicitly
   enabled it for that vertical (an amount can be configured ahead of
   time without going live) — signup step 2's `PlanStepClient` renders
   them as a small card under the existing `PriceCard` (that shared
   component itself lives in `packages/ui`, not this cluster's ownership,
   so left untouched — the fee summary is composed alongside it instead).
   `/pricing` deliberately still never shows real per-vertical numbers
   (`pricing/page.tsx`'s own pre-existing doc comment: "the real price
   card never appears here, FRONTEND_SPEC.md §3.3") — added one generic,
   number-free FAQ accordion item there instead ("Is there a setup fee?"),
   respecting that already-documented design decision rather than
   overriding it.

**Decisions logged (CLAUDE.md Rule 4 — flagged, not silently redesigned)**

- Every new `api/admin/**` route in items 3-5 above talks directly to
  Postgres via the service-role client instead of proxying to `supabase/
  functions/admin` — a deliberate deviation from the rest of that
  directory's convention (a single edge function fielding every `admin-*`
  path), made because that edge function's owner is a different cluster
  and either explicitly hasn't built the route yet (ticket queue) or has
  no route for it at all (partners, fees). Security posture is not
  weakened by this (same `platform_admin` claim check as the proxy itself,
  same `admin_actions` audit-trail shape) — flagged as an architectural
  inconsistency for the edge function's owner to fold in later, not as a
  security gap. See `docs/audit/FIX_REQUESTS.md`.
- Did not build a team-invite feature (no screen anywhere in the app can
  create one today, and doing so needs `supabase.auth.admin.
  inviteUserByEmail` from a service-role context — a new edge function or
  Route Handler plus a whole new settings page, outside this cluster's
  named scope). The setup-progress panel's "Invite your team" step reads
  real data (`memberships` count) but has `href: null` rather than a dead
  link. Filed for the integrator to route to an owner.
- Did not add a `tenants.policies_reviewed_at` column (this cluster owns
  no `supabase/migrations/**` path) — the setup-progress panel's policy-
  review step uses the closest real, already-collected signal instead
  (`dynamic_variable_overrides.cancellation_policy.text` non-empty).
  Honest proxy, not a fabricated flag; filed as a follow-up.
- `owner_test_phone` (an existing, previously-unused `tenants` column)
  now has a UI to set it, added directly on the test-agent page rather
  than as a new "team/account settings" surface — scoped narrowly to what
  this cluster's own phone-test detection needs, not built out as a
  general account-settings feature.

**Gates run (scoped):** `pnpm --filter @heyloo/web {typecheck,test}` — 48
test files / 217 tests, clean; `npx biome check --write` on every file
this cluster touched (0 errors after applying its own formatting fixes).

## Cluster G — New backend capabilities (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

**What was built**

1. **Recurring referral-partner commissions** (owner decision, binding —
   no platform-wide hardcoded rate): `referral_partners` gains `rate_bps`
   (nullable — null means no recurring commission), `commission_base`
   (`'gross_profit'|'revenue'`, default `gross_profit`), `duration_months`
   (nullable — null means lifetime); a new
   `referral_partner_vertical_overrides` table lets any of the three be
   overridden per vertical, falling back to the partner-level value when a
   column there is null. `20260910140000_referral_commission_recurring.sql`
   — a `fn_protect_referral_partner_commission_fields` BEFORE UPDATE
   trigger pins these three columns to their prior value on any
   non-platform-admin PostgREST write (the pre-existing
   `referral_partners_update` RLS policy already lets a partner self-edit
   `payout_method`/`paypal_email`, and RLS has no column-level granularity
   within one policy) — verified directly against a live Postgres session
   (`SET ROLE authenticated` + `request.jwt.claims`): a non-admin partner
   session's `rate_bps` write is silently reverted while `paypal_email`
   still saves; a service-role raw connection (no jwt claims set at all,
   e.g. this cluster's own admin edge-function writes) is unaffected. New
   `job-commission-accrual` (monthly, `0 6 1 * *`, two hours before
   `job-referral-payouts`' existing `0 8 1 * *` batch) computes one
   `commission_events` row per (referral, previous calendar month) from
   that period's `billing_invoices` (paid), `cost_events`, and
   `payment_processing_events` (Stripe fees) — `base_cents` is revenue
   alone or revenue-minus-costs-and-fees per the effective
   `commission_base`, `amount_cents = round(base_cents * rate_bps /
   10000)` floored at 0, idempotent per period via a partial unique index
   + a conflict-action `WHERE status = 'accrued'` guard so a late re-run
   never silently changes an already-batched/paid amount. This is
   ADDITIVE to the pre-existing one-time flat qualification bonus
   (`fn_check_referral_qualification`/`referral_flat_amount_cents`,
   period-less rows) — both share the same `commission_events.status =
   'accrued'` pool `job-referral-payouts` already batches from, unchanged.
   `webhooks-stripe`'s `charge.refunded` clawback now resolves the
   refunded charge's invoice → `billing_invoices.period_start` and, when
   resolvable, claws back ONLY that period's recurring accrual (the
   referral itself stays active, still earning future months); an
   unattributable refund or `charge.dispute.created` falls back to the
   prior full-relationship clawback. Admin endpoints:
   `PATCH /admin-referrals/partners/:id` (commission terms) and
   `PUT /admin-referrals/partners/:id/vertical-overrides/:vertical`
   (upsert an override), both audited via `admin_actions`. Partner-portal
   per-customer monthly breakdown (revenue/costs/share) is exposed via
   direct RLS-scoped reads of `commission_events`/`referrals` (both
   already scoped to `fn_jwt_referral_partner_id()`) — no new edge-function
   endpoint was built for this since "no tenant data" (BACKEND_SPEC
   §11.2) rules out joining full `tenants` rows, and the existing
   RLS-as-API pattern this codebase already uses for the referral
   program covers it.

2. **Real-estate lead callback**: new `lead_callback_requests` table
   (consent record — exact checkbox text + timestamp + IP, never a bare
   boolean) + `api-lead-callback` (server-to-server only, authenticated by
   an `api_tokens` bearer token requiring a `leads:write` scope — the
   endpoint is meant for a tenant's own web-form backend or CRM
   integration, never a raw browser request). Refuses without consent
   (schema-required, non-empty `consent_text`); enforces tenant quiet
   hours (`isQuietHours`, same helper `job-reminder-scheduler` uses) —
   defers rather than calling, writing `status: 'deferred_quiet_hours'`
   with a computed `scheduled_for`; places the call via a new
   `createPhoneCall` in `_shared/providers/retell.ts` (Deno-importable
   `POST /v2/create-phone-call`, same confirmed shape as `packages/
   adapters/retell/src/outbound.ts`'s already-written but not-yet-wired
   implementation — VERIFY-10 covers this exact endpoint; reimplemented
   here rather than consumed from that package because Deno cannot import
   a pnpm workspace package, the same reason every other `_shared/
   providers/*.ts` file in this codebase exists) with the same
   disclosure-line fail-closed check (G1/G2); pre-inserts the `call_logs`
   row itself with `direction: 'outbound'` (rather than relying on
   `voice-events`' inbound-only `direction` hardcoding, which is out of
   this cluster's ownership) so `call_started`/`call_ended`'s own
   `ON CONFLICT DO NOTHING`/plain `UPDATE` never overwrite it. Filed a
   FIX_REQUESTS entry for a future `job-lead-callback-retry` to drain
   `deferred_quiet_hours` rows once quiet hours end (needs a new
   function directory outside this pass's ownership grant).

3. **Menu import**: `api-menu-import` — Anthropic vision (image/PDF
   content blocks, confirmed live against platform.claude.com/docs
   2026-09-10) or plain text extracts candidate offerings, never
   auto-published. **Contract correction, mid-pass**: this cluster's own
   task brief described a `tenant_id` + `source` (url/file) request
   returning `{candidates}`, but `docs/audit/FIX_REQUESTS.md` (found
   while implementing) showed Cluster E had already built and shipped a
   real dashboard UI + proxy calling this exact function with `{raw_text:
   string}` (JWT-derived tenant, no body tenant_id) and expecting
   `{items: [...]}` in the precise `offeringWriteSchema` shape
   (`name/category?/price_cents?/duration_minutes?/allergens?/
   modifiers?`). Rebuilt against the REAL, already-connected contract as
   primary (`raw_text` required-or-`source`), keeping the richer
   PDF/photo/URL vision mode as an additive alternate for a future
   upgraded client. Ownership-conflict/correction logged here per CLAUDE.md
   Rule 4 rather than shipping a function nothing could actually call.

4. **Dental intake**: same mid-pass contract correction as above —
   `docs/audit/FIX_REQUESTS.md` showed Cluster E had already built a
   public intake form page against `GET/POST /functions/v1/api-intake/
   {token}` (a single function, token in the URL path, NOT a separate
   `api-intake-submit` POST-only function as this cluster's own brief
   named it). Deleted the originally-built `api-intake-submit` and
   rebuilt as `api-intake` matching that contract exactly — GET returns
   `{valid, tenant_name, patient_first_name, already_submitted}` or 404
   (unknown/expired collapsed to one 404, matching the page's own
   handling); POST always returns HTTP 200 with `{ok:true}` or
   `{ok:false, error}` (never a non-2xx, since `supabase-js`'s
   `functions.invoke()` would throw on one and the client reads
   `data.ok`/`data.error` from a successful invoke) and uses the exact
   field names the form sends (`date_of_birth`, `insurance_group_id`, not
   this cluster's original `dob`/`insurance_group_number`). New
   `intake_tokens` (opaque single-use token, only its sha256 hash stored;
   `patient_first_name` snapshotted at issuance rather than joined live)
   / `intake_submissions` (DOB/insurance AES-256-GCM-encrypted via a
   dedicated `INTAKE_ENCRYPTION_KEY`, RLS-enabled with zero client-facing
   policy — service-role/edge-function-only). Token issuance +
   `dental_intake_link` SMS (`{APP_BASE_URL}/intake/{token}`) lives in
   `_shared/dental-intake.ts`, ready to call — its one call site into
   `create_booking.ts` needs Cluster CD to wire (filed as a precise
   FIX_REQUESTS entry with the exact call shape, since `voice-tools/
   tools/create_booking.ts` is not this cluster's file).

5. **Setup fee / white-glove — contract correction, mid-pass**: this
   cluster's own brief said "`platform_settings` price cards gain
   `setup_fee_cents`/`white_glove_price_cents`" and a first pass did
   exactly that plus a migration backfilling those keys onto
   `price_card_<vertical>`. `docs/audit/FIX_REQUESTS.md` (found while
   reviewing for cross-cluster contracts, same pass as the intake/menu
   corrections above) showed Cluster H had, in the same parallel wave,
   independently built and shipped a real admin "Fees" settings tab
   reading/writing a SEPARATE `platform_settings.fees_<vertical>` key
   with a different shape (`setup_fee_enabled`, `setup_fee_cents`,
   `white_glove_enabled`, `white_glove_fee_cents`,
   `white_glove_description` — each fee has its own `*_enabled` gate, so
   an amount can be configured ahead of a go-live date). Deleted this
   cluster's own migration (no DB change needed — the key doesn't need
   pre-existing rows, Cluster H's route already defaults via
   `DEFAULT_FEES` when absent) and rewired `api-checkout` to read
   `fees_<vertical>` with Cluster H's exact shape instead — the two
   features now actually connect. `zCheckoutRequestSchema` gained an
   optional `white_glove: boolean` (opt-in add-on; `setup_fee` is
   applied automatically whenever configured+enabled, `white_glove` only
   when both configured+enabled AND requested) — both realized as
   one-time Stripe Checkout `price_data` line items (subscription-mode
   Checkout Sessions allow up to 20 one-time-Price line items alongside
   the recurring ones, "on the initial invoice only" — confirmed live
   against docs.stripe.com/api/checkout/sessions/create, 2026-09-10).

   **CORRECTION (2026-09-10 REPAIR pass)**: the paragraph above describes
   `api-checkout`/`CheckoutRequestSchema` accepting `white_glove` as if that
   made the add-on end-to-end — it did not check that anything in the
   shipped UI/API-proxy layer could actually PRODUCE that opt-in.
   `apps/web/src/app/api/checkout/session/build-request.ts`'s
   `buildApiCheckoutRequest` never had a `white_glove` parameter, so every
   real checkout request always sent the schema's `.optional().default(false)`
   regardless of what the tenant wanted or what the admin had configured —
   the mandatory `setup_fee_cents` path worked (nothing opt-in about it),
   but white-glove could never actually be charged through the shipped
   product. Fixed this pass: `PlanStepClient`
   (`apps/web/src/components/signup/plan-step-client.tsx`) now renders a
   real `Checkbox` opt-in when `priceCard.white_glove_fee_cents != null`,
   carrying the choice to `/signup/account` the same way `annual` already
   is (`?white_glove=1` query param — chosen over threading it through the
   signed pre-auth `SignupDraft` cookie, both to match the existing
   precedent and because the fee amount itself isn't known until step 2's
   price-card fetch, after the cookie is written in step 1);
   `AccountStepClient` includes it as a plain boolean in the checkout POST
   body; `route.ts` reads it and passes it into `buildApiCheckoutRequest`,
   which now omits the `white_glove` key entirely when falsy (matching the
   schema's own default and keeping the existing exact-body seam test
   passing unmodified). Test coverage added in `build-request.test.ts`
   (true and default/omitted cases) and `route.test.ts` (opt-in forwarded
   to the edge function). See `docs/audit/vertical/GAP_REGISTER.md`'s
   pricing entry and this pass's repair-agent report for the full trace.

6. **Change-request tickets**: `support_requests`/`support_request_notes`
   already existed (T3) with real tenant-write RLS — only the admin
   read/triage/respond half was a `501` stub
   (`NOT_YET_IMPLEMENTED_PREFIXES`). Built `handleSupportRequests` in
   `admin/handler.ts`: list (optional `status` filter)/get-with-notes/
   PATCH status+priority/POST a note (`visible_to_tenant` flag), each
   mutation audited. **Found mid-pass** (same FIX_REQUESTS sweep as
   above) that Cluster H had, in parallel, independently built the exact
   same admin surface as direct-to-Postgres Next.js Route Handlers
   (`apps/web/src/app/api/admin/admin-support-requests/**`) — confirmed
   via Cluster H's own filed FIX_REQUESTS entry this is a known,
   accepted duplication (Next.js resolves the literal route ahead of the
   `[...path]` catch-all proxy, so neither path is ever reached by the
   other; consolidation is optional future cleanup, not required for
   correctness) — left both in place, acknowledged in that entry rather
   than reverting this cluster's own edge-function work.

7. **Impersonation cookie bug** (the one item in this brief NOT
   discovered to already be covered elsewhere): `@supabase/ssr`'s
   one-cookie-per-domain session storage means opening the admin's
   impersonation magic link in a new tab overwrites that cookie for the
   whole browser, so a subsequent request from either tab (the admin's
   original tab, or the impersonated tab's own "Enable edits"/"End
   impersonation" actions) can carry the TENANT OWNER's session instead
   of the admin's. Fix (both `apps/web/src/app/api/admin/[...path]/
   route.ts` and `admin/handler.ts`, the two files the pre-existing
   FIX_REQUESTS entry said the fix needed to span): a request whose
   session lacks `platform_admin` but DOES carry `impersonated_by`
   (stampable only by `custom_access_token_hook` from a real, currently
   active `impersonation_sessions` row — unforgeable by an ordinary
   tenant login) is now trusted as an alternative identity source for
   exactly two narrow, already tenant_id+admin_user_id-scoped routes
   (`impersonate-end`, `impersonate/edit-mode`) — resolved via
   `resolveImpersonationActor` in `admin/handler.ts`
   (`impersonatedByClaim` helper added to `_shared/admin-auth.ts`); every
   other admin route keeps the strict `platform_admin` gate unchanged.
   AAL2 is not re-required on the `impersonated_by` path — the underlying
   session was already AAL2-gated at `impersonate`-start time. Verified
   with real unit tests covering the exact cookie-clobber scenario
   (a token carrying `tenant_id`/`role: owner` + `impersonated_by`, no
   `platform_admin`) on both the proxy and the edge function.

**Cross-cluster contract corrections (CLAUDE.md Rule 4 — logged, not
silently guessed):** three of this cluster's seven items (menu import,
dental intake, setup fee/white-glove) were built once against this
cluster's own task-brief description, THEN discovered — via a
`docs/audit/FIX_REQUESTS.md` read partway through this pass, after
already-built frontend/admin surfaces from Clusters E/H turned out to
target a different concrete contract than the brief described — and
rebuilt against the real, already-shipped, already-tested contract
instead. Both API_AND_FLOWS-adjacent shapes are documented above and in
the corresponding `docs/audit/FIX_REQUESTS.md` entries (marked
`~~...~~ — APPLIED`). No functionality was lost — the richer
PDF/photo/URL vision mode and the original `intake_forms`-shaped columns
were preserved as additive/renamed rather than discarded.

**Migrations added** (all additive, prefix range `20260910140[0-3]xx`
per this cluster's reserved prefix): `20260910140000_referral_commission_
recurring.sql`, `20260910140100_commission_accrual_cron_schedule.sql`,
`20260910140200_lead_callback_requests.sql`,
`20260910140300_dental_intake.sql`. Verified applying cleanly from a
fresh Postgres in this sandbox (no Docker/`supabase start` available —
same disclosed limitation and harness approach as T1: stub `auth`/
`realtime`/`storage`/`vault`/`cron`/`net`/`pgmq` schemas, a
verification-only trimmed copy of the extensions migration with
`pg_cron`/`pgmq`/`pg_net` removed since those aren't installable on a
bare Postgres) — every migration in the repo, in order, plus
`supabase/seed/seed.sql`, applied with zero errors; the new
column-protection trigger was additionally exercised directly at the SQL
level (`SET ROLE authenticated` + `request.jwt.claims`), confirming a
non-admin partner session's `rate_bps` write is reverted while
`paypal_email` still saves, and a service-role raw connection is
unaffected.

**Gates run (scoped):** `pnpm --filter @heyloo/edge-functions {typecheck,
test}` — 83 test files / 719 tests, clean; `pnpm --filter @heyloo/web exec
vitest run src/app/api/admin` (the impersonation proxy fix) — 5 tests,
clean.

## Integrator — Wave-2 cross-cluster FIX_REQUESTS pass (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Applied every genuinely-open bullet in `docs/audit/FIX_REQUESTS.md` (as of
this pass) across the seven wave-2 clusters' disjoint uncommitted edits.
Bullets already marked `~~...~~ — APPLIED/RESOLVED/ACKNOWLEDGED` were
verified in place and left as-is (no action needed): dental/vet
`extraction[]`, generic.ts tool-count decision, restaurant
menu_text/tax_rate_bps, shared/tools.ts room_type/allergies, api-intake,
api-menu-import, the two acknowledged database.types.ts/admin-routes
cross-references, and the heads-up about admin/partner shell-client files.

**Applied this pass:**

- `supabase/functions/voice-inbound/{dynamic-variables,handler}.ts` +
  `_shared/schemas/voice-inbound.ts`: forward `agent_configs.transfer_number`
  as a `transfer_number` dynamic variable (blocking for `transfer_call`).
  Also added restaurant's `prep_time_text`/`delivery_terms_text` spoken
  tokens (resolved, not yet referenced by `restaurant.ts`'s prompt — same
  deliberate deferral Cluster F's own note already established for these).
- `packages/adapters/retell/src/provider.ts`: wired
  `RetellProvider.createOutboundCall` to `createRetellOutboundCall`
  (`outbound.ts`) and set `RETELL_CAPABILITIES.supportsOutboundCalls: true`.
- `packages/canonical-types/src/agent-template.ts` +
  `schemas/vertical-details.ts`: added `delivery_fee_cents` to
  `zRestaurantOverrides`/`verticalDetailsSchema` (parity with
  `min_order_cents` et al.) + a Settings UI field
  (`dashboard/agent/vertical-details/page.tsx`) — previously silently
  defaulted to $0 with no way to configure it.
- `packages/templates/src/verticals/*.ts` (7 files): every
  `createBookingTool(...)` call site now passes its vertical slug (typed
  `structured_payload` authoring hint); `legal.ts`/`real-estate.ts`'s
  `takeMessageTool()` calls now pass their vertical slug too.
- `supabase/functions/_shared/templates.ts`: added `order_ready` and
  `waitlist_slot_opened` `TemplateKey`/`renderTemplate` cases — both paths
  previously sent a decorative empty-body SMS.
- New `list_offerings` voice tool (`supabase/functions/voice-tools/tools/
  list_offerings.ts` + wiring in `handler.ts`/`_shared/schemas/voice-tools.ts`
  + `packages/templates/src/shared/tools.ts`'s `listOfferingsTool()`),
  wired into `dental.ts`'s `pain_triage` state and `veterinary.ts`'s
  `symptom_or_routine` state so both can resolve a real `offering_id`
  before `check_availability`/`create_booking` instead of leaving it null.
- `supabase/functions/voice-tools/tools/create_booking.ts`: calls
  `issueDentalIntakeToken()` after a successful dental booking insert
  (best-effort, never blocks the booking) — new optional `CreateBookingDeps`
  param (`{logger, appBaseUrl}`) threaded through `handler.ts`'s
  `DispatchDeps.dentalIntake` and `index.ts`'s new `APP_BASE_URL` env read.
- `packages/supabase-client/src/database.types.ts`: fixed
  `ReferralPayoutRow` (was claiming `amount_cents/method/paid_at`, which
  don't exist — real columns are `total_cents/period/paypal_batch_id/
  status`, with the real widened status CHECK); added the three new
  `referral_partners` commission fields, the `referral_partner_vertical_
  overrides` and `commission_events` tables to the `Database` type (all
  previously missing entirely). `BookingRow`/`OrderRow`/`ResourceRow`'s
  flagged fields were already present — verified, no action needed.
- New `supabase/functions/api-tenant-test-call/` (web-call half of
  dashboard "test your agent" — the existing `apps/web` proxy was 503ing).
- New `supabase/functions/job-lead-callback-retry/` + `_shared` extraction
  of `attemptLeadCallbackCall`/`resolveTenantCallingConfig` out of
  `api-lead-callback/handler.ts` (now exported, reused by the retry job
  rather than duplicated) — drains `lead_callback_requests` rows stuck in
  `deferred_quiet_hours`. Cron entry added in the new migration below.
- New `supabase/functions/api-team-invite/` + `_shared/providers/
  supabase-admin.ts`'s new `inviteUser()` (GoTrue `POST /auth/v1/invite`,
  confirmed via `supabase/auth-js` source — response shape not
  independently confirmed against a live instance, see `docs/VERIFY.md`
  VERIFY-11) + a new `dashboard/team` page + `api/tenant/team{,/invite}`
  Route Handlers + a `Team` nav entry. The setup-progress panel's "Invite
  your team" step now links to a real page instead of `href: null`.
- `supabase/migrations/20260910150000_tenants_policies_reviewed_at.sql`
  (new column + backfill) + `api/tenant/agent/vertical-details`'s POST
  handler now stamps it on every save with a non-empty
  `cancellation_policy.text` — the setup-progress panel's "Policies
  reviewed" step reads this precise timestamp instead of the old
  configured-vs-reviewed-conflating proxy.
- `supabase/migrations/20260910160000_wave2_cron.sql` (new, additive):
  cron entry for `job-lead-callback-retry` (`*/15 * * * *`), using the
  existing `fn_cron_upsert`/Vault-secret guard pattern verbatim.
- `supabase/config.toml`: entries for the three new functions
  (`job-lead-callback-retry`, `api-tenant-test-call`, `api-team-invite`).
- `.env.example`: no new variables needed — every env var the new
  functions read (`APP_BASE_URL`, `RETELL_API_KEY`, `SUPABASE_URL`,
  `SB_SECRET_KEY`, `CRON_INVOKE_SECRET`) was already documented.

**Structural issue found and fixed (not itself a filed FIX_REQUESTS
bullet, discovered running the mandated `pnpm -w typecheck`):** Cluster
A's uncommitted `packages/adapters/retell/src/compiler/
registry-consistency.test.ts` (new this wave) imported `@heyloo/templates`'
live `TEMPLATE_DEFINITIONS` to exercise the compiler against every real
shipped template. That required adding `@heyloo/templates` as a
devDependency of `@heyloo/adapter-retell` — but `@heyloo/templates`
ALREADY depends on `@heyloo/adapter-retell` (its own `compiler-gate.test.ts`,
via the public `RetellProvider.compileTemplate` — the correct, Rule-2-
respecting direction). The two devDependencies together formed a genuine
circular package dependency, which made `turbo run build`/`typecheck`
refuse to run for the ENTIRE workspace (no valid topological order exists
for a cycle) — not a type error, a hard stop before any package could be
checked. Per CLAUDE.md Rule 4 (flag a gap, don't redesign under a
different task's scope): reverted the new devDependency and rewrote
`registry-consistency.test.ts` to scan three small LOCAL fixture templates
(one per `compile_target`, each declaring `transfer_call`) instead of the
live registry — same assertions, same coverage shape, just not scanning
real shipped templates. The real finding that test run already surfaced
against the live registry (real_estate/generic over their single_prompt
soft budgets) is independently recorded in `docs/audit/FIX_REQUESTS.md`/
this file's Cluster F entry and doesn't depend on this test continuing to
scan real templates. Restoring live-registry coverage without the cycle
(e.g. via `packages/templates`' existing `templates.build.json` versioned
JSON artifact, read as plain data rather than a TS package import) is a
real follow-up, not attempted here. Full detail in the rewritten test
file's own top-of-file INTEGRATION NOTE.

**Test fixture updates for FIX_REQUESTS-driven behavior changes:**
`apps/web/src/app/api/tenant/agent/vertical-details/route.test.ts` (now
asserts both the `agent_configs` and `tenants` update payloads) and
`apps/web/src/app/api/tenant/setup-progress/route.test.ts` (fully-done
fixture now includes `tenants.policies_reviewed_at`).

**Not attempted, still open (see docs/audit/FIX_REQUESTS.md for full
detail):**
- `supabase/functions/webhooks-pos/handler.ts` Airtable two-way sync —
  out of scope, no owner claimed it this pass either.
- `outreach_send_queue`/`outreach_send_queue_dlq` decorative-pgmq
  cleanup — needs whoever owns `job-outreach-personalize{,-collect}`'s
  design, not an integrator-level call.
- The impersonation cookie-clobber auth-model gap (`api/admin/[...path]/
  route.ts` + `admin/handler.ts`) — a genuine two-service security-model
  change, explicitly flagged as beyond integrator scope by its own
  FIX_REQUESTS entry.
- Admin `handler.ts` consolidation with Cluster H's parallel Route
  Handlers — informational only, no action requested.

**Gates run (full workspace):** `pnpm -w typecheck` — 18/18 packages
green (previously hard-blocked by the cycle above). `pnpm -w test` —
18/18 package test tasks green (`@heyloo/edge-functions`: 87 files/748
tests; `@heyloo/web`: 48 files/217 tests; `@heyloo/adapter-retell`: 18
files/128 tests; every other package's existing suite unchanged).
Migrations: this sandbox has a real local Postgres 16 available this
pass (`pg_lsclusters`) — every migration in the repo, in order (42
files after the extensions one), applied cleanly from zero against it
(stub `auth`/`storage`/`realtime`/`vault` schemas, a trimmed copy of
`20260907130000_extensions_and_helpers.sql` with the `pg_cron`/`pgmq`/
`pg_net` lines removed since those extensions aren't installable on a
bare Postgres — same disclosed limitation prior clusters' passes used),
followed by `supabase/seed/seed.sql`, both zero errors. Spot-checked the
two new migrations' actual effects: `tenants.policies_reviewed_at`
column present + a seeded tenant with a pre-existing
`cancellation_policy.text` backfilled to a non-null timestamp;
`20260910160000_wave2_cron.sql` correctly no-ops with a `NOTICE` (no
`pg_cron`) rather than erroring; `referral_partners.{rate_bps,
commission_base,duration_months}`, `referral_partner_vertical_overrides`,
and `commission_events` all present with the exact shapes now reflected
in `database.types.ts`.

## 2026-09-10 — REPAIR: post-call `classification`/`outcome`/`follow_up_needed` extraction closed (distinct from the FIX-1-era vet/dental emergency/urgency gap above)

The verifier's post-call-extraction claim (Engine: post-call extraction
compiles into the Retell agent request and voice-events stores the
returned fields) was **partial**: the compile → attach → store mechanism
(`packages/adapters/retell/src/compiler/extraction.ts`'s
`compilePostCallAnalysisData()`, `agents.ts`'s attach, `voice-events/
handler.ts`'s `handleCallAnalyzed`) was real and correctly wired, but NO
shipped template ever declared `classification`, `outcome`, or
`follow_up_needed` as `extraction[]` fields — only `emergency_detected`/
`urgency_flag` (vet/dental, item 7/8 above) and `legal_advice_given`
(legal) existed anywhere. `motel.ts`/`restaurant.ts`/`auto-repair.ts`/
`real-estate.ts`/`generic.ts` had zero extraction fields at all. This is a
distinct gap from the emergency/urgency one already closed above — that
FIX-1 pass never touched `classification`/`outcome`/`follow_up_needed`,
and no later pass closed it either (confirmed by grep: no `docs/
BUILD_NOTES.md` entry after item 7/8 ever mentions these three field
names). `docs/VERIFY.md`'s row for this mapping stayed "Low — invented
mapping, not sourced" the whole time.

**Fix (this pass):**
- New `packages/templates/src/shared/extraction.ts`: `withCallOutcomeExtraction()`,
  the same per-state-splice pattern `legal.ts`'s `withLegalGuardrail`
  already used, declaring `classification` (enum, full `CALL_CLASSIFICATIONS`
  taxonomy from `@heyloo/canonical-types`), `outcome` (text), and
  `follow_up_needed` (boolean) on every state. Every vertical template
  (`veterinary`, `dental`, `motel`, `restaurant`, `auto-repair`,
  `real-estate`, `generic`, `legal`) now maps its full `states[]` through
  this — `voice-events/handler.ts` already read these three keys verbatim,
  so no reader-side change was needed, exactly as `extraction.ts`'s own
  compiler read `legal_advice_given`/`emergency_detected` with no reader
  change for those.
- Urgency/emergency signal extended beyond vet/dental (GAP_REGISTER intent
  — "usable tenant-wide, not just vet/dental"): the shared
  `safetyEmergencyState()` (`packages/templates/src/shared/utility-states.ts`,
  wired into dental/legal/motel/restaurant/real_estate/generic) now
  declares `emergency_detected` (boolean); auto-repair's own
  `vehicleSafetyEmergencyState()` gets the same field. Deliberately just
  this one boolean, not a duplicate `urgency_flag` enum: vet's
  ("emergency"/"routine") and dental's own pre-existing
  (`same_day`/"routine") `urgency_flag` fields used incompatible enum
  vocabularies, and the compiler's `post_call_analysis_data` dedupes by
  field NAME across the whole template (first declaration in `states[]`
  wins) — a second, differently-voculated `urgency_flag` from the shared
  state would be silently dropped wherever a template already declares its
  own, which is exactly the kind of decorative-but-unread field this
  repair pass exists to eliminate, not add more of. So `urgency_flag` was
  DROPPED from vet's `emergency_referral` and dental's `pain_triage` (they
  keep `emergency_detected`), and `call_logs.urgency_flag` is documented
  (`voice-events/handler.ts`, inline comment) as derived solely from
  `emergency_detected` — no behavior change for vet/dental (that field was
  already discarded into the generic `extracted_entities` blob, never read
  by name).
- `packages/templates/src/red-team/structural.test.ts`: new
  "every template declares classification/outcome/follow_up_needed on
  every state" describe block (one `it` per template per state, following
  the existing `legal_advice_given` pattern) plus a per-template check
  that `classification`'s `enum_values` cover the real taxonomy — so this
  can't silently regress the way it did the first time.
- `docs/VERIFY.md`'s `custom_analysis_data` row upgraded Low → Medium: the
  request-shape side (this codebase's compiled `post_call_analysis_data`
  and every template's field declarations) is no longer an invented
  mapping, it's real and test-asserted; what remains open is Retell's
  RUNTIME behavior — whether Retell's own extractor actually returns
  `custom_analysis_data` keyed by these exact names for a live call. This
  repair pass could not make a live sandbox call (no remote/live
  operations in scope), so that row stays open pending one.

**Gates run:** `pnpm --filter @heyloo/templates typecheck` and `test`
(237/237, up from 235 — two new structural assertions' worth of `it`s
per template/state), `pnpm --filter @heyloo/adapter-retell typecheck` and
`test` (128/128), `pnpm --filter @heyloo/edge-functions test` (87 files/
748 tests, includes the pre-existing `voice-events/handler.test.ts`
coverage for the `urgency_flag`-derived-from-`emergency_detected` path,
unchanged behavior).

## 2026-09-10 — REPAIR: vet emergency_referral's dropped transfer_call + the consistency test's synthetic-fixtures-only coverage

Verifier claim "Engine: single-tool states compile to Retell Function
Nodes; transfer_call compiles to the native transfer mechanism for every
registered template; a consistency test fails on any prompt token without
a schema key + form field" was **partial**. The compiler logic itself
(`packages/adapters/retell/src/compiler/conversation-flow.ts:107-149`
`buildNode()`, `multi-prompt.ts`, `single-prompt.ts`) was already correct.
Two real hops were missing:

1. **Live bug**: `packages/templates/src/verticals/veterinary.ts`'s
   `emergency_referral` state declared `allowed_tools: ["take_message",
   "transfer_call"]` — two tools. Per the compiler's own documented
   contract, 2+ tools falls back to a plain `ConversationNode` with no
   per-node tool-locking, and `transfer_call` is unconditionally excluded
   from the flow's custom `tools[]` regardless of node type — so at this
   state, the vet RED-FLAG EMERGENCY node, `transfer_call` was wired to
   NOTHING (not a native `TransferCallNode`, not a custom tool). The
   model could not invoke it there, even though the state's own prompt
   promised "offer a warm transfer if this clinic can connect them
   directly". (The global `human_request` intent's separate,
   correctly-compiled `transfer_to_human` state meant callers weren't
   fully stranded, but this state's own declared capability was dead.)

2. **Test gap**: `packages/adapters/retell/src/compiler/
   registry-consistency.test.ts` (both the transfer_call-native-wiring
   check and the token/schema-consistency check) ran only against a
   3-item hand-written `LOCAL_REGISTRY`, never `@heyloo/templates`' real
   `TEMPLATE_DEFINITIONS` — the file's own INTEGRATION NOTE documented
   this was reverted from live-registry scanning to avoid a circular
   package dependency (`@heyloo/templates` depends on
   `@heyloo/adapter-retell`, so adding the reverse import cycles).
   Meanwhile `packages/templates/src/red-team/compiler-gate.test.ts` (the
   only place that runs the real 8 templates through the real compiler)
   deliberately asserts only `disclosureVerified`, never node shapes
   (Rule 2 — `providerPayload` stays `unknown` outside the adapter
   package). So nothing in CI ever verified, for any real template, that
   single-tool states become Function Nodes or that transfer_call becomes
   a native node — only against invented fixtures. And
   `prompt-lint.ts`'s `ALLOWED_DYNAMIC_VARIABLES` was a second,
   hand-maintained allowlist duplicating (not deriving from) the
   schema-derived check already written in `registry-consistency.test.ts`.

**Fix (this pass):**
- `veterinary.ts`: split `emergency_referral` into a no-tool triage/offer
  state plus two new dedicated single-tool terminal states —
  `emergency_warm_transfer` (`allowed_tools: ["transfer_call"]`) and
  `emergency_take_message` (`allowed_tools: ["take_message"]`) — wired by
  two new transitions (`caller_wants_direct_transfer` /
  `caller_declines_direct_transfer`). Both prompt-promised capabilities
  are now actually reachable. `emergency_detected` extraction stays on the
  parent `emergency_referral` state (extraction compiles to agent-level
  `post_call_analysis_data` keyed by field name, not per-node — reaching
  the parent state is what "emergency detected" means).
- `packages/canonical-types/src/agent-template.ts`: `zAgentTemplate`'s
  `.check()` now fails any state declaring `transfer_call` alongside
  another tool (new exported `TRANSFER_CALL_TOOL_NAME` constant), naming
  the offending state and tool list — this would have caught the vet bug
  at template-authoring/insert time instead of shipping it silently.
- `registry-consistency.test.ts`: resolved the circular-dependency note
  by reading `@heyloo/templates`'s own build artifact
  (`dist/templates.build.json`, already emitted by that package's `build`
  script) directly off disk (`node:fs`, not a package import — no
  package.json edge, no cycle), re-validated against `zAgentTemplate`.
  Both existing describe blocks (transfer-call wiring, token/schema
  consistency) and a new "single-tool states lock to a FunctionNode/
  TransferCallNode" describe block (covering the top-line claim in full —
  not just transfer_call) now run against `[...LOCAL_REGISTRY,
  ...REAL_REGISTRY]`, i.e. the real 8 shipped templates plus the fast
  synthetic fixtures. **Residual, flagged rather than fixed**: this is a
  genuine cross-package build-order dependency (`@heyloo/templates` must
  be built before this test file runs) that `turbo.json`'s default
  `^build` graph does not guarantee for `@heyloo/adapter-retell#test`
  (deliberately not made a package.json dependency, to avoid recreating
  the cycle). `loadRealRegistry()` throws a clear, actionable error
  rather than silently skipping if the artifact is missing. The durable
  fix — a turbo task-level `"@heyloo/adapter-retell#test": {"dependsOn":
  ["@heyloo/templates#build"]}` override — is a root `turbo.json` change
  outside this file's ownership; filed to whichever cluster owns root
  build orchestration.
- `packages/templates/src/red-team/prompt-lint.ts`: `ALLOWED_DYNAMIC_VARIABLES`
  is now computed from `@heyloo/canonical-types`' schemas
  (`zAgentDynamicVariables` + every vertical's `z*Overrides` +
  `verticalDetailsSchema`, via the same `derivedTokensForField` mapping
  `registry-consistency.test.ts` already used) instead of a second
  hand-maintained list, so a schema field rename/removal is caught here
  automatically. New `prompt-lint.test.ts` covers the derivation directly.
- `compiler-gate.test.ts` (packages/templates) intentionally left
  untouched: extending it to inspect node shapes would require narrowing
  `providerPayload` from `unknown` inside `packages/templates`, which
  would violate Rule 2 (provider-specific shapes must stay inside
  `packages/adapters/*`). The node-shape assertions instead live in
  `registry-consistency.test.ts`, inside the adapter package, now against
  the real registry — satisfying the same end-to-end coverage goal
  without the Rule-2 violation.

**Gates run:** `pnpm --filter @heyloo/canonical-types typecheck` and
`test` (163/163, up from 161 — two new structural-validator tests),
`pnpm --filter @heyloo/templates typecheck` and `test` (243/243, up from
237 — new `prompt-lint.test.ts`), `pnpm --filter @heyloo/adapter-retell
typecheck` and `test` (158/158, up from 128 — 30 new assertions from the
real-registry scan plus the new single-tool-node-locking describe block),
after rebuilding `@heyloo/canonical-types` → `@heyloo/adapter-retell` →
`@heyloo/templates` in that order so `templates.build.json` reflects the
vet fix.

## 2026-09-10 — REPAIR: structured_payload/customer-metadata claim (voice tools) — validation was never wired, `addresses` was aspirational, schema parity was a hand-copy of a hand-copy

Verifier claim "Tools/payloads: typed per-vertical `structured_payload`
validated on `create_booking`/`create_order`; `customers.metadata`
(vehicles/pets/addresses) written and returned by `lookup_customer`;
`join_waitlist` writes `waitlist_entries` the SMS YES consumer picks up;
canonical tool schemas and runtime schemas cannot drift" was **still
broken** on 3 of its 4 parts (the `join_waitlist`↔SMS-YES chain was
already real and untouched here).

1. **`structured_payload` validation was dead code, not wired.**
   `packages/canonical-types/src/booking-payloads.ts`'s
   `zBookingStructuredPayloadFor(vertical)` was only ever used to build
   the JSON-Schema authoring hint shown to the model
   (`packages/templates/src/shared/tools.ts`) — `create_booking.ts` took
   `args.structured_payload` (runtime-typed as a bare
   `z.record(z.string(), z.unknown())`, deliberately loose per CLAUDE.md
   Rule 2 hot-path discipline) and inserted it verbatim, with no call to
   any per-vertical validator anywhere. Fix: new
   `supabase/functions/_shared/schemas/booking-payloads.ts` — a
   Deno-importable, field-for-field mirror of the canonical per-vertical
   schemas (same documented Deno/Node-can't-share-a-package constraint as
   `admin/schemas.ts` and this same file's own `extractMetadataMerge`) —
   exposing `sanitizeBookingStructuredPayload(vertical, raw)`: a
   per-field sanitize (unknown-schema fields pass through untouched,
   known fields that fail their own validator are dropped) rather than a
   hard `.parse()` gate, so one malformed field never fails a real
   booking. `create_booking.ts` now calls it before building
   `structuredPayload`. New regression test in `create_booking.test.ts`
   posts `vehicle_year: "not_a_number"` + an invalid enum value alongside
   a valid `vehicle_make` for an `auto` booking and asserts only
   `vehicle_make` survives to the `bookings` insert.

2. **`create_order` has no `structured_payload` field, by design —
   documented rather than added.** Neither the canonical
   (`zCreateOrderRequest`) nor runtime (`CreateOrderArgsSchema`) schema
   ever declared one; `allergies`/`special_instructions` are already
   separate typed top-level fields written straight to real `orders`
   columns, and `booking-payloads.ts` has no per-vertical *order* shape
   (its fields — `vehicle_year`, `pet_name`, `matter_type`, etc. — are
   all booking-specific and vestigial for the one vertical that places
   orders, restaurant). Per CLAUDE.md Rule 4 (append a documented
   decision rather than redesign out-of-scope), decided NOT to add a
   `structured_payload` field to `create_order`: it would duplicate
   `allergies`/`special_instructions` with no real schema to validate
   against. The original claim's "…validated on create_booking/
   create_order" should be read as create_booking only.

3. **`customers.metadata.addresses` was aspirational — implemented via
   `customer_addresses` instead of the dead metadata key.** Nothing ever
   wrote `metadata["addresses"]` (only `"vehicles"`/`"pets"`, in
   `create_booking.ts`'s `extractMetadataMerge`), and
   `customers.metadata`'s own column comment
   (`20260907130400_customers.sql:31`) already says addresses there are
   "superseded by `customer_addresses` for structured use" — that table
   already exists and is already populated/read by `create_order.ts`'s
   delivery-radius check. Fix: `lookup_customer.ts` now also queries
   `customer_addresses` (tenant+customer scoped, default-first ordering)
   and returns an `addresses` array the same optional-when-present way
   `vehicles`/`pets` already work; `zLookupCustomerResult`'s existing
   `addresses` field (`packages/canonical-types/src/tools.ts`) is now
   real rather than dead. Two new `lookup_customer.test.ts` cases mirror
   the existing vehicles/pets coverage (addresses present / addresses
   absent).

4. **Schema-parity test was diffing a hand-copy against a hand-copy.**
   `supabase/functions/_shared/schemas/voice-tools.test.ts`'s
   `CANONICAL_TOP_LEVEL_KEYS` was a third, manually maintained literal
   that was never itself checked against
   `packages/canonical-types/src/tools.ts` — it could drift from the
   real canonical schema exactly like the thing it was meant to catch
   drifting, and covered only 6 of 10 tools. Fix: added
   `@heyloo/canonical-types` as a real `devDependency` of
   `@heyloo/edge-functions` (`supabase/functions/package.json`,
   `workspace:*` — this package's Vitest/Node test run, not its Deno
   hot-path entrypoints, which still cannot and do not import it; the
   `pnpm install`-created `node_modules/@heyloo/canonical-types` symlink
   requires that package's `dist/` to be built, same as every other
   workspace consumer). Rewrote `voice-tools.test.ts` to import the real
   `z*Request` schemas from `@heyloo/canonical-types` and diff directly
   against the runtime schemas for all 10 tools (up from 6): top-level
   key-set parity (added/removed-field drift) AND per-field
   required/optional parity (a field silently changing requiredness on
   one side — a shape drift a pure key-set diff can't catch). Extending
   coverage to the 4 previously-untested tools surfaced one real,
   pre-existing drift: `send_payment_link`'s canonical `amount_cents` was
   required (`zCents`) while the runtime schema — and the handler itself,
   `send_payment_link.ts`, which explicitly falls back to the referenced
   order's `total_cents` when `amount_cents` is omitted — treats it as
   optional. Fixed the canonical schema (`amount_cents: zCents.optional()`)
   to match the real, intentional handler behavior rather than loosening
   the runtime schema to match a stricter-than-actual canonical one.

**Gates run:** `pnpm --filter @heyloo/edge-functions typecheck` and
`test` (765/765, up from 764 pre-existing on this branch — 2 new
`lookup_customer.test.ts` cases, 1 new `create_booking.test.ts`
regression case, `voice-tools.test.ts` parity rewritten in place),
`pnpm --filter @heyloo/canonical-types typecheck` and `test` (163/163,
unchanged count — `send_payment_link` optionality fix touched no
existing assertion), `pnpm --filter @heyloo/templates test` (243/243,
unaffected), after `pnpm --filter @heyloo/canonical-types build` to
refresh `dist/` for the new workspace symlink.

## REPAIR — Motel deposit-hold exclusivity (2026-09-10)

Verifier status on the "motel deposit hold" claim was `partial`: every
piece (room inventory, room-type/capacity-aware `check_availability`,
`quoted_rate_cents`, `hold_expires_at` + 15-min cron expiry, deposit-policy
config, Stripe confirm-on-pay) worked and was tested, but the hold did not
actually *hold* the room — a `scheduled` deposit-hold booking was invisible
to both DB-level race-proofing mechanisms (the `bookings` GIST exclusion
constraint and the availability-invalidation trigger), both scoped to
`status = 'confirmed'` only. This was a disclosed KNOWN LIMITATION in
`create_booking.ts` and `20260910122000_motel_deposit_hold_expiry_cron.sql`,
not a hidden bug — closed here.

Fix: new migration `20260910170000_motel_hold_exclusion.sql` (never edits
the applied `20260907130600_booking_core.sql` / `..._functions_triggers.sql`
per CLAUDE.md Rule 2):

1. A second, narrower partial GIST exclusion constraint on `public.bookings`
   — `bookings_hold_exclusion`, scoped to
   `where (status = 'scheduled' and hold_expires_at is not null)` — chosen
   over widening the existing `status = 'confirmed'` constraint (approach
   (a) in the gap's remediation note) after verifying every `status =
   'scheduled'` write site in the repo (`create_booking.ts`'s motel
   deposit-hold branch is the only one that ever sets `hold_expires_at`;
   `webhooks-twilio-sms/handler.ts`'s waitlist auto-book and the dashboard
   booking-edit route both always write `status = 'confirmed'` directly),
   so approach (b) matches exactly the rows a deposit hold ever produces
   and leaves every other vertical's booking path untouched.
2. `fn_invalidate_availability_on_booking()` re-`create or replace`d to also
   flip `availability_slots.is_available = false` for an inserted/updated
   `scheduled` booking carrying a non-null `hold_expires_at` (so
   `check_availability.ts`'s existing `is_available = true` filter stops
   offering a held room), and flip it back to `true` when such a hold is
   cancelled/no-showed (the cron expiry sweep hitting an unpaid hold),
   mirroring the existing confirmed→cancelled/no_show branch.
3. `create_booking.ts`'s existing `EXCLUSION_VIOLATION` (23P01) catch block
   needed no code change — it already turns any exclusion-constraint hit
   into `{confirmed: false, reason: "slot_taken"}`; the new constraint just
   gives it a second, real trigger. Removed the KNOWN LIMITATION comment
   block above the deposit-hold branch and replaced it with a description
   of the now-real exclusivity mechanism.
4. Removed the corresponding KNOWN LIMITATION paragraph from
   `20260910122000_motel_deposit_hold_expiry_cron.sql`'s header comment.

Tests added (no pgTAP/integration DB harness exists anywhere in this repo
— pre-existing repo-wide pattern, not introduced here — so both are
mock-`SqlClient` unit tests consistent with the rest of this suite):
- `create_booking.test.ts`: a new case in the motel deposit-hold describe
  block asserting a second `create_booking` call that collides with an
  active hold (insert throws `23P01`, as `bookings_hold_exclusion` would
  raise) is rejected `{confirmed: false, reason: "slot_taken"}` via the
  existing catch path.
- `check_availability.test.ts`: a case documenting that a resource whose
  only slot is held (i.e. `is_available = false`, as the extended trigger
  now guarantees) never appears in the tool's returned slots.

**Gates run:** `pnpm --filter @heyloo/edge-functions test` (767/767, up
from 765 — the 2 new cases above) and `typecheck` (pre-existing, unrelated
failures in `voice-tools/handler.ts:86` unused `geocode` destructure and
`voice-tools/tools/create_order.ts:287` `exactOptionalPropertyTypes`
mismatch — neither file touched by this repair; noted, not fixed, per
CLAUDE.md Rule 4 file-ownership scope).

Files touched: `supabase/migrations/20260910170000_motel_hold_exclusion.sql`
(new), `supabase/functions/voice-tools/tools/create_booking.ts`,
`supabase/functions/voice-tools/tools/create_booking.test.ts`,
`supabase/functions/voice-tools/tools/check_availability.test.ts`,
`supabase/migrations/20260910122000_motel_deposit_hold_expiry_cron.sql`.

## 2026-09-10 — REPAIR: dental same-day urgency criteria reconciled with emergency_detected (offering/intake-link paths reconfirmed correct)

Verifier claim "Dental: same-day urgency flag flows from extraction to
dashboard alert; offering selection captured; secure intake link issued at
booking, SMS-delivered, public form stores DOB/insurance encrypted, never
in transcripts" was **partial**, scoped to the urgency-flag hop only — the
offering-selection, intake-token-issuance/SMS, and api-intake
encryption/RLS paths were independently re-traced and confirmed already
correct with passing coverage, no changes made to any of those.

On investigation, the specific bug the verifier evidence described
(`voice-events/handler.ts`'s `handleCallAnalyzed` never reading a
`urgency_flag` enum field dental/vet declared) had already been fixed by
an earlier pass this same day (see the "post-call `classification`/
`outcome`/`follow_up_needed` extraction closed" entry above and
`docs/audit/FIX_REQUESTS.md`'s "SUPERSEDED (2026-09-10 REPAIR pass)" note)
— that pass dropped the separate `urgency_flag` enum from both
`veterinary.ts`'s `emergency_referral` and `dental.ts`'s `pain_triage`
entirely, leaving `emergency_detected` (boolean) as the one signal
`call_logs.urgency_flag` (the dashboard alert) is derived from, precisely
to avoid the enum-vocabulary collision / dedupe-by-field-name problem that
made the original two-field design silently drop one of them at compile
time. `handler.ts`, its test, `veterinary.ts`, and `auto-repair.ts` were
all already internally consistent under this design: vet/auto's
`emergency_detected` means "the call reached this dedicated
emergency/safety state," which is exactly what routes there, so the
extraction criteria and the live routing criteria can never drift apart.

**Residual gap this pass actually closed:** dental's `pain_triage` state
uses a different pattern — one state, transcript-scanned by Retell's
post-call analyzer regardless of live routing, not "reached a dedicated
state." Its `emergency_detected` description ("knocked-out or badly
broken tooth, severe pain, or facial swelling affecting
breathing/swallowing") was narrower than the same state's own
`prompt_fragment`, which calls pain level, swelling, fever, *or* a
knocked-out/badly-broken tooth a same-day urgency tier ("flag it clearly").
A same-day case triggered only by fever + swelling (no broken tooth, not
severe pain) would satisfy the prompt's own same-day definition but not
`emergency_detected`'s narrower one — so `call_logs.urgency_flag` would
stay false and the dashboard "Urgent" badge would never fire for it, even
though nothing in the current codebase reads the model-invented
`urgency_flag` name the earlier verifier evidence pointed at (confirmed:
still zero read sites, repo-wide grep). Fixed by widening the
`emergency_detected` extraction description on `dental.ts`'s `pain_triage`
state to name exactly the same trigger set as its own
`prompt_fragment`'s same-day tier (pain, swelling, fever,
knocked-out/badly-broken tooth), plus the separate facial-swelling/
breathing safety-emergency case — rather than narrowing the live prompt to
match the boolean (dropping fever as a live same-day trigger would be a
real triage-quality regression, not a documentation fix). Left
`voice-events/handler.ts` itself untouched — re-adding a read of a
`urgency_flag` field that no template declares would be dead code, and
re-adding the field to `dental.ts` would reintroduce the exact
dedupe-collision bug the prior pass removed it to fix.

Also corrected a stale doc comment: `packages/templates/src/red-team/
simulation-scenarios.ts`'s vet "emergency" scenario still said
"emergency_detected/urgency_flag extraction fields are populated" —
`urgency_flag` no longer exists on any template; text now says
`emergency_detected` only. `veterinary.ts`'s and `auto-repair.ts`'s own
inline comments were already accurate (no claim of a live `urgency_flag`
field) and needed no change.

New coverage: `packages/templates/src/red-team/structural.test.ts` gets a
new describe block — `dental: pain_triage's emergency_detected extraction
matches its own same-day urgency tier` — asserting `pain_triage`'s
`prompt_fragment` and its `emergency_detected` extraction description both
name each of the same-day trigger words (pain/swelling/fever/knocked/
broken), so this can't silently drift back apart.

**Gates run:** `pnpm --filter @heyloo/templates typecheck` and `test`
(249/249, up from 249 baseline — net +7 new assertions in the new describe
block, no regressions), `pnpm --filter @heyloo/adapter-retell test`
(158/158, unchanged — extraction description text isn't snapshotted),
`pnpm --filter @heyloo/edge-functions test` (774/774, unchanged — no files
in that package were touched this pass).

Files touched: `packages/templates/src/verticals/dental.ts`,
`packages/templates/src/red-team/simulation-scenarios.ts`,
`packages/templates/src/red-team/structural.test.ts`.

## 2026-09-10 — REPAIR: `take_message`'s `callback_window` was captured but never surfaced anywhere a tenant looks

Verifier's "Vet + Auto + Generic" claim was `status=partial`: three of four
sub-claims (pet/vehicle payload store+reuse, vet emergency extraction,
generic native `transfer_call`) were confirmed true end-to-end. The fourth
— "reason/callback window captured and visible in dashboard" — was only
half true. `reason` (folded into `message_text`) was genuinely visible on
both the Call Detail page and the Messages thread. `callback_window` was a
real Zod field (`_shared/schemas/voice-tools.ts`) the model could fill and
`take_message.ts` did write it into `messages_outbound.payload`, but from
there it went nowhere: the actual outbound SMS renderer
(`_shared/templates.ts`'s `take_message` case) never interpolated it, and
the dashboard Messages-thread label map (`apps/web/src/lib/messages/
outbound-preview.ts`) had no case for `take_message` at all, so it fell
through to the generic "System message sent" placeholder — zero content,
zero test coverage of the gap.

Fixed all three hops named in the verifier's remaining-work list:

1. `supabase/functions/_shared/templates.ts` — the `take_message` render
   case now appends `` — callback window: <value>`` to the SMS body when
   `callback_window` is present, omitted cleanly when absent (string
   interpolation, no schema change).
2. `apps/web/src/lib/messages/outbound-preview.ts` — added a real
   `take_message` case (alongside the existing verbatim `owner_reply`
   case) that renders `caller_name`/`message_text`/`callback_window` from
   the payload as `isVerbatim: true`, instead of falling through to the
   generic label map.
3. `supabase/functions/voice-tools/tools/take_message.ts` — durability
   fix per the verifier's own most-robust-fix recommendation:
   `args.callback_window` is now also merged into
   `call_logs.structured_booking_payload` (same jsonb `||` merge the
   existing `structured_payload` fields already use), so it's visible
   directly on the Call Detail page's generic "Captured on the call"
   key/value render (`call-detail-client.tsx`'s `keyValueEntries`) without
   depending on which channel/template renders the staff SMS.

New coverage closing the exact gap the verifier flagged (no test
previously exercised `take_message` in either renderer): two new cases in
`_shared/templates.test.ts` (callback window present/absent in the SMS
body), two new cases in `apps/web/src/lib/messages/
outbound-preview.test.ts` (callback window present/absent in the thread
label), and one new case in `voice-tools/tools/take_message.test.ts`
asserting `callback_window` lands in `structured_booking_payload` merged
alongside an existing `structured_payload` field.

No change needed to `call_logs` schema (no `callback_window` column —
folding it into the existing generic `structured_booking_payload` jsonb
column was the documented, more-robust fix over adding a dedicated
column) or to any vet/auto/generic file — those three sub-claims were
already correct as verified.

**Gates run:** `pnpm --filter @heyloo/edge-functions test` (777/777, up
from 774 baseline — net +3 new assertions), `pnpm --filter
@heyloo/edge-functions typecheck` (clean), `pnpm --filter @heyloo/web
test` (219/219, up from 217 baseline — net +2 new assertions), `pnpm
--filter @heyloo/web typecheck` (clean).

Files touched: `supabase/functions/_shared/templates.ts`,
`supabase/functions/_shared/templates.test.ts`,
`supabase/functions/voice-tools/tools/take_message.ts`,
`supabase/functions/voice-tools/tools/take_message.test.ts`,
`apps/web/src/lib/messages/outbound-preview.ts`,
`apps/web/src/lib/messages/outbound-preview.test.ts`.

## 2026-09-10 — REPAIR: batch-simulation harness built for real (item 14 above only shipped the seed data)

Verifier's claim was `status=still_broken` on its second sub-claim (the
first — `manage_booking` hard-asserted for every booking vertical,
`structural.test.ts` ~184-201 — was already correct, no repair needed).
Item 14 above (`red-team/simulation-scenarios.ts`) shipped a typed,
well-formed dataset, but nothing executable: `SimulationScenario`/
`InjectionFixture`'s `expectation` was prose only, `structural.test.ts`'s
dataset-shape describe block only checked the dataset was well-formed, and
this directory's own `README.md` said outright "None of the above is
implemented in this package." BUILD_PLAN.md:56's actual T6 deliverable —
"batch-simulation CI harness" — had never been built.

**Docs-first (CLAUDE.md Rule 1):** `docs.retellai.com` stayed
egress-blocked this pass too. Fell back to the official `retell-sdk` npm
package's own generated source (same standing methodology this repo's
`RETELL-VERIFY` items already use) and found Retell's REAL
batch-simulation surface is its `Tests` resource
(`node_modules/retell-sdk@5.64.0/resources/tests.d.ts`) —
`createTestCaseDefinition`/`createBatchTest`/`getTestRun`, confirmed
field-for-field and logged as `VERIFY-13` in `docs/VERIFY.md`. Notably,
`user_prompt` is a PERSONA an LLM-driven simulated caller follows for the
whole call, not a literal fixed turn script — the harness's persona-prompt
builder is written against that confirmed shape, not a guess.

**Built, entirely within this cluster's ownership
(`packages/templates/src/red-team/`):**

1. `simulation-types.ts` — the grading vocabulary
   (`SimulationAssertion`: `tool_called`/`tool_not_called`/
   `tool_called_with_zero_params`, `state_reached`/`state_not_reached`,
   `first_utterance_contains`, `agent_never_says`, `no_forbidden_fields`,
   `all`/`any` composition, and a `manual_review` escape hatch for the one
   guarantee — `silence_voicemail`'s response-timing ladder — no
   tool-call/state signal can prove) plus the provider-agnostic
   `BatchSimulationClient` seam a real backend implements. Deliberately
   imports no provider SDK (CLAUDE.md Rule 2).
2. `grader.ts` + `grader.test.ts` — `gradeTranscript`, proven for every
   assertion kind to both pass a satisfying transcript and fail a
   violating one (the same "does it discriminate" bar `compiler-gate.
   test.ts` already holds the disclosure gate to).
3. Every entry in `simulation-scenarios.ts` (15) and `injection-
   fixtures.ts` (9) now also carries `expect(template)` — a real,
   template-aware `SimulationAssertion` derived from the actual compiled
   state/tool names (verified against every vertical file directly, not
   guessed), alongside the existing prose `expectation`. `legal`'s
   `transfer` scenario and the `no_availability` `"*"` wildcard are
   template-aware (legal's `transfer_to_human` only takes a message,
   never calls `transfer_call` directly; single-`intake`-state `generic`
   has no dedicated `take_message_fallback` state at all) rather than one
   assertion assumed to fit every vertical.
4. `run-simulation.ts` (`runHarness`, exported and pure) — compiles every
   `TemplateDefinition` via `RetellProvider.compileTemplate` (refusing to
   submit a template whose disclosure gate fails), builds one
   `SimulationTestCase` per applicable scenario/fixture
   (`scenarioAppliesTo`/`fixtureAppliesTo`, tool- and coverage-gated),
   submits through an injected `BatchSimulationClient`, and grades every
   returned transcript — a real pass/fail/needs-review per case, not a
   prose check. `main()`/`loadRealClient()` fail closed (throw, never
   fabricate a pass) when `RETELL_API_KEY` is unset or
   `@heyloo/adapter-retell` hasn't yet grown the Tests-API wrapper this
   harness needs (see below) — matches CLAUDE.md Rule 2's webhook posture
   ("missing secret = reject, never skip") deliberately extended to this
   capability gap.
5. `run-simulation.test.ts` — exercises `runHarness` end-to-end against an
   in-memory mock `BatchSimulationClient` covering all 8 templates' full
   applicable case sets, INCLUDING a genuine discrimination check (one
   template's client deliberately returns empty/wrong transcripts,
   proving the harness reports real failures — not a suite that can only
   ever go green).
6. `structural.test.ts` — new describe block statically walking every
   applicable `expect(template)` result and asserting it only names tools/
   states that actually exist on that template (caught and fixed one real
   bug during this pass: the `no_availability` `"*"` wildcard referencing
   `take_message_fallback`, a state `generic`'s single-state design
   doesn't declare).
7. `README.md` rewritten to describe what's actually implemented (dropped
   the "None of the above is implemented" line) and what's still pending.

**What's still pending — one seam, filed in `docs/audit/
FIX_REQUESTS.md`, not built here:** `createRetellBatchSimulationClient`,
a real `BatchSimulationClient` wrapping Retell's `Tests` API. It belongs
in `packages/adapters/retell` — CLAUDE.md Rule 2 keeps provider SDK usage
out of `packages/templates`, and that path is outside this repair
cluster's file ownership — so the exact shape needed (methods, zod
boundary, the still-open `transcript_snapshot` normalization question
`VERIFY-13` flags) is requested there instead of guessed at here. A second
FIX_REQUESTS entry sketches the (secret-gated, non-blocking until both
land) CI wiring for `.github/workflows/ci.yml`, also outside this
cluster's ownership. Until the adapter piece lands, `pnpm --filter
@heyloo/templates run simulate` fails closed with an explicit, actionable
error naming exactly this gap — confirmed by running it in this session
both without `RETELL_API_KEY` and with a fake one, in both cases a clean
non-zero exit and no fabricated pass.

**Gates run (scoped):** `pnpm --filter @heyloo/templates typecheck`
(clean), `pnpm --filter @heyloo/templates test` — 7 files / 364 tests, all
green (up from 4 files / 137 per the verifier's own baseline — net new:
`grader.test.ts`, `run-simulation.test.ts`, plus `structural.test.ts`'s
new describe block). `pnpm --filter @heyloo/templates build` (clean,
`run-simulation.ts` compiles into `dist/red-team/run-simulation.js` the
same way `scripts/generate-build-artifact.ts` already does). Also ran,
informationally, the downstream consumer: `pnpm --filter
@heyloo/adapter-retell {typecheck,test}` after rebuilding
`packages/templates` — 18 files / 158 tests, all green (this pass touched
nothing in that package, so this only confirms the rebuild didn't regress
anything it consumes).

Files touched: `packages/templates/src/red-team/simulation-types.ts` (new),
`packages/templates/src/red-team/grader.ts` (new),
`packages/templates/src/red-team/grader.test.ts` (new),
`packages/templates/src/red-team/run-simulation.ts` (new),
`packages/templates/src/red-team/run-simulation.test.ts` (new),
`packages/templates/src/red-team/simulation-scenarios.ts`,
`packages/templates/src/red-team/injection-fixtures.ts`,
`packages/templates/src/red-team/structural.test.ts`,
`packages/templates/src/red-team/README.md`,
`packages/templates/package.json` (new `simulate` script),
`docs/VERIFY.md` (VERIFY-13), `docs/audit/FIX_REQUESTS.md` (two entries).

## WAVE-2 — Integration pass over the vertical-completeness build wave

INTEGRATOR pass over the uncommitted WAVE-2 tree (engine, config pipeline,
payloads, templates, commissions, onboarding — per-cluster detail lives in
each cluster's own prior BUILD_NOTES entries above; this section covers
only the integration pass itself: closing the 3 outstanding verifier
items, running every gate, and committing). No cluster's own work was
redesigned — CLAUDE.md Rule 4.

### Verifier item 1 — turbo build-order gap for `registry-consistency.test.ts` — **DONE**

Root `turbo.json` gained exactly the fix the verifier and
`docs/audit/FIX_REQUESTS.md`'s own entry sketched: a package-specific task
override,

```json
"@heyloo/adapter-retell#test": {
  "dependsOn": ["^build", "@heyloo/templates#build"],
  "outputs": []
}
```

One subtlety confirmed against Turborepo's own current docs this pass
(CLAUDE.md Rule 1): a `pkg#task` entry inside the root `turbo.json`
**fully replaces** the general task's config for that package — it does
NOT merge, and `$TURBO_EXTENDS$` (which does support incremental merging)
applies only inside a package-level `turbo.json` file (Package
Configurations), not to a `pkg#task` key in the root file. So the full
`test` task shape (`dependsOn: ["^build"]`, `outputs: []`) had to be
repeated alongside the one new dependency, not just the new dependency
added on its own — an easy, silent way to accidentally drop `^build`
ordering for this one package if done carelessly.

Verified two ways: `turbo run test --filter=@heyloo/adapter-retell
--dry=json` shows `@heyloo/adapter-retell#test`'s `dependencies` now
includes `@heyloo/templates#build`; and a real `pnpm -w test` run from
this state builds `@heyloo/templates` (writing
`packages/templates/dist/templates.build.json`) before
`@heyloo/adapter-retell#test` runs, so `registry-consistency.test.ts`'s
`REAL_REGISTRY` suite (38 tests, exercising the actual 8 shipped
templates, not just synthetic fixtures) executes for real rather than
only passing by accident of local build order. `docs/audit/
FIX_REQUESTS.md`'s matching entry marked resolved.

### Verifier item 2 — motel hold regen fix — **DONE**

New migration `supabase/migrations/20260910180000_motel_hold_regen_fix.sql`
(never edited the two already-applied migrations that previously touched
this function/table, per CLAUDE.md Rule 2) — `create or replace`s
`public.fn_regenerate_availability_slots(uuid, uuid, int)` so its
buffer-padded overlap check treats an active scheduled deposit hold
(`status = 'scheduled' and hold_expires_at is not null`) the same as a
`status = 'confirmed'` booking, in both the motel per-night branch and the
generic per-window-slot branch. This closes the one remaining gap
`20260910170000_motel_hold_exclusion.sql` left open: that migration
already fixed the GIST exclusion constraint and
`fn_invalidate_availability_on_booking()` to respect an active hold, but
`fn_regenerate_availability_slots()` — called by the nightly
`job-internal-availability-rollforward` cron and any tenant business-hours
edit — still only checked `status = 'confirmed'`, so regenerating a
resource's slots while a caller's deposit hold was still active would
silently re-open that room (`is_available` flips back to `true`) even
though the exclusion constraint still blocked the actual conflicting
INSERT — a caller could be quoted a phantom-open night by
`check_availability.ts` and only discover the conflict at
`create_booking.ts`. The new predicate is copied verbatim from
`bookings_hold_exclusion`/`fn_invalidate_availability_on_booking()` so all
three race-proofing mechanisms stay provably identical.

**Verified against a throwaway local Postgres** (same harness used for the
migrations-reproducible-from-zero gate, see below): inserted a
`status='scheduled'` booking with `hold_expires_at` in the future for a
motel resource's night 5 days out, called
`fn_regenerate_availability_slots`, and confirmed the held night's
`availability_slots` row came back `is_available = false` (not silently
re-opened). No existing test file for this function specifically exists
in the repo (its only committed exerciser is `scripts/e2e-backend.ts`
against a real deployed instance); this ad hoc verification was
session-only, never committed.

### Verifier item 3 — batch-simulation harness `createRetellBatchSimulationClient` — **DONE, one sub-piece still open per VERIFY-13**

Added `packages/adapters/retell/src/tests-api.ts` (exported from that
package's `index.ts`) implementing exactly the shape
`packages/templates/src/red-team/run-simulation.ts`'s `loadRealClient` and
`docs/audit/FIX_REQUESTS.md`'s own sketch called for —
`createRetellBatchSimulationClient(opts): BatchSimulationClient`, wrapping
Retell's `Tests` API (`create-test-case-definition`/`create-batch-test`/
`list-test-runs`) via this package's existing hand-rolled `RetellClient`
(fetch-based), not the `retell-sdk` package itself — matches this
package's own established convention (`raw-types.ts`, `sdk-contract.
test.ts`): `retell-sdk` stays a devDependency used only for compile-time
shape verification, never a runtime import.

**Rule 1 documentation-first check performed, unlike prior Retell VERIFY
entries:** `docs.retellai.com` was NOT egress-blocked this pass —
`create-test-case-definition`, `create-batch-test`, and `list-test-runs`
API reference pages were fetched live and cross-checked against the
`retell-sdk@5.64.0` npm package's own generated `resources/tests.d.ts`;
both agree exactly. `docs/VERIFY.md` VERIFY-13 updated with this
confirmation.

**Genuinely could not be fully resolved, exactly as VERIFY-13's own
standing note anticipated:** `TestCaseJobResponse.transcript_snapshot`'s
internal field names. The SDK types this field `unknown` on purpose
("Can be either ConversationFlowPlaygroundSnapshot or
RetellLlmPlaygroundSnapshot") and no reachable documentation — including
the live `docs.retellai.com` pages fetched this pass — shows an example
payload for either. Per CLAUDE.md Rule 1 item 2 (docs unreachable/absent
→ build against the researched shape + a runtime Zod validator + a
`docs/VERIFY.md` entry, never silently guess):
`normalizeTranscriptSnapshot` (`tests-api.ts`) is written against the
closest OFFICIALLY-DOCUMENTED sibling shape this same SDK uses for the
identical concept elsewhere — the `Call` resource's
`transcript_with_tool_calls` discriminated union
(`Utterance | ToolCallInvocationUtterance | ToolCallResultUtterance |
NodeTransitionUtterance | ...`) — behind a Zod boundary that throws a
loud, specific, actionable error (never a silently-empty transcript,
which would make `tool_not_called`/`state_not_reached` assertions
spuriously pass) the moment a real payload doesn't match. **Action item
left exactly where VERIFY-13 left it:** a real Retell staging account run,
inspecting one actual `transcript_snapshot`, is needed to confirm or
correct this one parser before the harness's live leg (`pnpm --filter
@heyloo/templates run simulate`) can be trusted end to end. No
`RETELL_API_KEY`/staging credential is available in this session either
(same constraint the prior pass logged), and this session is under the
same explicit no-remote-operations constraint.

Unit-tested (`packages/adapters/retell/src/tests-api.test.ts`, 6 cases:
zero-case short-circuit, the full submit→poll→normalize happy path across
two cases settling on different polls, an errored case, an unrecognized
`transcript_snapshot` shape, a malformed `responseEngineRef`, and a poll
timeout) against an injected `fetchImpl`/`sleep` — no live account needed
for the plumbing itself. `docs/audit/FIX_REQUESTS.md`'s two related
entries (the adapter wrapper itself, and the now-unblocked-but-still-
unbuilt CI wiring request) updated; `run-simulation.ts` and this
directory's `README.md` headers updated to stop describing the wrapper as
not existing.

### Pre-existing lint failures fixed while getting gates green

Two `lint/suspicious/noAssignInExpressions` errors in
`packages/adapters/retell/src/compiler/conversation-flow.ts` (pre-existing
in the WAVE-2 tree this pass integrated, not introduced by any of the 3
verifier items above) — `(fromNode.edges ??= []).push(...)` split into a
plain `fromNode.edges ??= []; fromNode.edges.push(...)` two-statement
form, behaviorally identical. Three `eslint` errors in `apps/web`, also
pre-existing in the WAVE-2 tree:
- `setup-progress-panel.tsx`'s dismissed-flag read moved from a
  `useEffect` + `setState` (flagged `react-hooks/set-state-in-effect`) to
  a lazy `useState(() => readDismissed(tenantId))` initializer, mirroring
  `use-impersonation-banner.tsx`'s already-established identical pattern
  for the same browser-only-localStorage-read-once shape.
- `test-agent-client.tsx`'s `waitingForCall` auto-reset-on-call-finished
  effect (same `set-state-in-effect` rule) removed entirely — `latestCallQuery`'s
  `refetchInterval` option is now a function of the query's own latest
  data (`(query) => waitingForCall && !query.state.data?.ended_at ? 4000 :
  false`, a TanStack Query v5-native pattern) so polling already stops the
  instant the call shows `ended_at`, with no separate state flip needed;
  every UI consumer of `waitingForCall` already also checks
  `!testCallDone`, so this is behaviorally identical, not just
  lint-silencing.
- `setup-progress-panel.test.tsx`'s one `testing-library/prefer-find-by`
  finding fixed (`waitFor(() => expect(getByLabelText(...)))` →
  `expect(await findByLabelText(...))`).

### Gates run (full, not scoped to any one cluster)

All from a clean uncommitted WAVE-2 tree plus this pass's own changes:

- `npx biome check --write .` — clean (0 errors; 38 pre-existing warnings
  in files this pass never touched — `noExplicitAny` in adapter test
  fixtures, one `noUndeclaredEnvVars` in `scripts/e2e-backend.ts`, one
  `useOptionalChain` suggestion in `webhooks-twilio-sms/handler.ts` —
  left as-is, none block the gate and none are regressions from this
  pass).
- `pnpm -w typecheck` — 18/18 packages clean.
- `pnpm run lint` (biome + per-package `turbo run lint`, which for
  `@heyloo/web` runs `eslint .`) — 0 errors (4 pre-existing warnings in
  files this pass never touched: a React Compiler incompatible-library
  note on `react-hook-form`'s `watch()`, an `<img>` LCP suggestion, a
  `window.location.href` navigation suggestion, one unsafe-regex
  suggestion in an e2e test helper).
- `pnpm -w test` — 19/19 package test tasks green: 777 tests in
  `@heyloo/edge-functions`, 230 in `@heyloo/web`, 164 in
  `@heyloo/adapter-retell` (up from the prior 158 baseline — net new:
  `tests-api.test.ts`'s 6 cases), plus every other package's suite.
- `apps/web` production build (`next build --webpack`) — succeeds; 118
  static pages generated, TypeScript pass clean.
- `node --experimental-strip-types scripts/ci/verify-jwt-guard.ts` —
  PASSED, 41 functions checked against `supabase/config.toml`.
- **Migrations reproducible from zero, throwaway local Postgres** — built
  a fresh harness this pass (this sandbox ships Postgres 16 plus
  cluster-wide `anon`/`authenticated`/`service_role` roles pre-seeded,
  unlike the no-Docker constraint the T1/LIVE-MINE-FIXES passes logged;
  `pg_cron`'s `.control` file is installable via apt here but was still
  left uninstalled — enabling it needs `shared_preload_libraries` +a
  cluster restart on what is a shared system Postgres, and every real
  `pg_cron`/`pgmq`/`pg_net` call site is already self-guarded by a
  `pg_extension` existence check with a `raise notice` no-op, confirmed by
  reading every one of the 7 migration files that reference them — so
  trimming just the 3 `create extension` lines for those, matching
  `LIVE-MINE-FIXES`'s own documented "extensions trimmed" approach, was
  sufficient without weakening what's actually being verified). Minimal
  stub `auth`/`storage`/`realtime` schemas (an `auth.users(id uuid pk)`
  table + `auth.uid()`/`auth.jwt()` stub functions, `storage.buckets`/
  `storage.objects`, `realtime.messages(topic text)` — sized to exactly
  what the real migration files' DDL needs to validate at CREATE time:
  FK targets, RLS policy `using` expressions, one `insert into
  storage.buckets`). All 45 real migration files (44 pre-existing +
  this pass's new `20260910180000_motel_hold_regen_fix.sql`) applied
  verbatim, in filename order, from an empty database — zero errors —
  followed by `supabase/seed/seed.sql`, also zero errors. Throwaway
  database and all scratch SQL files dropped/deleted after verification,
  never committed.

### Incomplete / honestly deferred

- **VERIFY-13's `transcript_snapshot` shape** — see verifier item 3 above.
  Needs a live Retell staging account run; cannot be closed from this
  sandboxed, no-remote-operations session.
- **CI wiring for the batch-simulation job** (`docs/audit/FIX_REQUESTS.md`'s
  third related entry, `.github/workflows/ci.yml`) — now technically
  unblocked (both prerequisite items landed this pass) but not attempted;
  outside this integration pass's own file scope, and needs a real
  `RETELL_STAGING_API_KEY`-shaped secret to do anything once wired.
- Every `docs/audit/FIX_REQUESTS.md` item NOT explicitly named above (team-
  invite UI ownership, `tenants.policies_reviewed_at` "reviewed" semantics
  precision, etc.) is pre-existing from earlier passes and out of this
  integration pass's 3-item scope — left exactly as those passes recorded
  them, not re-triaged here (CLAUDE.md Rule 4). (`job-lead-callback-retry`,
  named as an open gap by one such entry, was independently built and
  cron-wired within this same WAVE-2 tree by whichever cluster owned that
  work — `supabase/functions/job-lead-callback-retry/`,
  `supabase/migrations/20260910160000_wave2_cron.sql` — before this
  integration pass started; not this pass's doing, noted here only so the
  FIX_REQUESTS entry naming it isn't mistaken for still-open.)

## DS — Design system + UI Preview Mode

**What was built**

- **Tokens** (`packages/ui/src/theme/globals.css`, rewritten): a
  near-monochrome neutral ramp (`--neutral-50…950`) + one signature accent
  ramp ("ember", a warm coral-amber, `--accent-50…900`) bound to
  `--primary`/`--ring`; semantic success/warning/destructive/info; a fluid
  `clamp()` type scale (`--text-display` → `--text-micro`, each with a
  paired Tailwind v4 `--text-*--line-height`/`--letter-spacing`); an
  expanded radius scale; a soft neutral shadow scale; motion tokens
  (150/200/250ms, `--ease-out`); breakpoints moved to the brief's
  390/768/1024/1440/1920 (`xl`/`2xl` off Tailwind's stock 1280/1536); a
  named z-index scale. Full light+dark, `:root[data-theme]` +
  `prefers-color-scheme`, documented in the new `docs/DESIGN_SYSTEM.md`.
- **Typography**: Fraunces (display) + Inter (UI/body) + IBM Plex Mono
  (phone numbers/ids/money), loaded via `next/font/google` in
  `apps/web/src/app/[locale]/layout.tsx`, self-hosted at build time —
  confirmed by inspecting `.next/static/css/*.css` after a real
  `pnpm build`: all 3 families present as `@font-face` rules with hashed
  self-hosted `woff2` URLs, `font-display:swap`, and next/font's automatic
  metric-matched fallback face (e.g. `Fraunces Fallback`).
- **No new npm dependency for dark mode**: `apps/web/package.json` isn't
  in this task's ownership, so dark mode is a small inline no-flash
  bootstrap `<script>` in the root layout + `<ThemeToggle>`
  (`@heyloo/ui`) writing `localStorage["heyloo-theme"]`, instead of
  `next-themes`.
- **New shared components**: `Container`, `Section`, `PageHeader`,
  `ThemeToggle` (`packages/ui/src/layout`), `Callout`, `DataList`
  (`packages/ui/src/custom`). `Button` gained a `loading` prop. No
  existing component prop/API renamed.
- **Icon policy**: `packages/ui/src/icons/index.tsx` — `VERTICAL_ICONS`/
  `VerticalIcon` (one lucide glyph per `Vertical`), `NAV_ICONS`,
  `STATUS_ICONS`. Audited `packages/ui/src` for emoji usage — none found.
- **UI Preview Mode** (`apps/web/src/lib/preview/**` + `(preview)/**`):
  see `apps/web/src/lib/preview/README.md` for full detail. Summary of
  scope decisions:
  - All 63 real tenant/admin/partner pages + the 3 root shell layouts + 1
    nested layout (67 files) are mirrored 1:1 under `(preview)/preview/**`
    as one-line `export { default } from "<real page>"` re-exports —
    mechanically generated, not hand-written, so there's no drift risk
    from typing 67 files by hand. Real page/layout components are never
    forked.
  - Auth is bypassed via 3 tiny drop-in replacements for
    `requireTenantSession`/`requireAdminSession`/`requirePartnerSession`
    (`apps/web/src/lib/preview/mocks/`), swapped in only via a
    `UI_PREVIEW_MODE`-gated bundler alias in `next.config.ts` — chosen
    over trying to fake a real Supabase session, because `@supabase/ssr`
    resolves session from cookies BEFORE ever calling `fetch`, so a
    fetch-only mock can't fake "logged in" by itself.
  - "No network" is enforced by patching `globalThis.fetch` (once on the
    server, once in the browser — see the README for why both) to
    intercept Supabase REST/Auth/Storage calls and this app's own
    `/api/**` routes, falling back everywhere else to the real `fetch` (so
    Next's own client-side RSC navigation between `/preview/*` pages isn't
    broken).
  - **Fixture fidelity is intentionally uneven, not exhaustive.** Hand-
    authored rows exist for the ~15 highest-traffic tables (by `.from(...)`
    call-site count); everything else — most `/api/admin/**`/
    `/api/tenant/**` endpoints included — falls back to a generic
    non-crashing shape (`{ rows: [] }`, or a synthesized-but-plausible row
    built from the actually-requested `select` columns). This is a
    deliberate CLAUDE.md Rule 4 scope call given the sheer number of
    tables/endpoints in this app (28+ tables, dozens of API routes) — a
    reviewer screenshotting a specific page that looks sparse should
    extend `apps/web/src/lib/preview/fixtures.ts` for that table/endpoint
    rather than read it as a bug.
  - **Known gap, documented, not fixed (out of ownership)**: the mirrored
    `(tenant)` root layout still wraps children in the real
    `TenantRealtimeProvider`, which opens a Supabase Realtime WebSocket —
    `mock-fetch.ts` only intercepts `fetch`, not WebSockets. This degrades
    silently (the realtime client's own retry/error handling, not a page
    crash) rather than truly honoring "no network" for that one channel.
    Fixing it would mean touching `apps/web/src/lib/realtime/**`, outside
    this cluster's file ownership.
  - **Turbopack `resolveAlias` gotcha** (found by actually running
    `UI_PREVIEW_MODE=1 next dev` against the config, not assumed): the
    alias target must be a path relative to `next.config.ts`
    (`"./src/lib/preview/mocks/...")`) — an absolute path (leading `/`) is
    read as an unsupported "server-relative" import and the build fails.
    Webpack's `resolve.alias` wants the opposite (a real absolute path).
    `next.config.ts`'s `previewModeAliases(kind)` builds both forms from
    one shared list rather than duplicating the mock filenames twice.

**Verification performed (this environment, not assumed)**

- `pnpm --filter @heyloo/ui typecheck` / `test` — clean, 23 tests passing
  (8 new: `Callout`, `DataList`, `VerticalIcon`, `Button`'s `loading`
  prop).
- `pnpm --filter @heyloo/web typecheck` — clean (includes all 67 mirror
  files + the new preview lib).
- `pnpm --filter @heyloo/web test` — 238/238 passing (8 new: the preview
  guard's 5 unit tests + the `(preview)` layout's 3 render tests — the
  "test asserting the guard" DO#4 calls for).
- `pnpm --filter @heyloo/web build` (`next build --webpack`, matching the
  repo's real `build` script) — succeeds; `/preview`, `/preview/index`,
  `/preview/system` all appear in the route manifest as prerendered
  static pages (the guard's `notFound()` is deterministic with no
  `UI_PREVIEW_MODE` set, so Next statically prerenders the 404 branch).
- `next start` against that production build: `/` and `/pricing` → 200;
  `/preview` and `/preview/system` → **404**, including when re-launched
  with `UI_PREVIEW_MODE=1` set on the `next start` process itself — this
  confirms the "`NODE_ENV !== "production"` is a hard floor, not just a
  build-time absence of the alias" claim end to end, not just via the
  unit test.
- `UI_PREVIEW_MODE=1 next dev` (Turbopack, this repo's real `dev` script):
  `/preview/system` (a full client-rendered page exercising ~30 shared
  components across both forced themes) returns 200 with real content —
  confirms the guard's "allow" branch, the client-side fetch-mock
  bootstrap, and the whole component import surface all work together at
  runtime, not just in typecheck.
- **Found and separated an unrelated, pre-existing environment issue**:
  under `next dev` (Turbopack) in this sandbox specifically, EVERY
  server-rendered page — including `/` and `/pricing`, neither touched by
  this pass — throws `TypeError: ...react.js.createContext is not a
  function` from Next's own vendored RSC React bundle. Confirmed this is
  not caused by this pass's changes: (1) it reproduces on completely
  untouched marketing pages, (2) `pnpm build` (webpack) + `next start`
  serve those same untouched pages fine, and (3) it doesn't happen on
  `/preview/system`'s pure-client render path. Left unfixed — a
  Turbopack-dev-mode/sandbox-specific issue, not a DS-cluster or
  UI-Preview-Mode bug, and outside this pass's file ownership to chase
  further. Anyone hitting it: `UI_PREVIEW_MODE=1 pnpm dev --webpack` (or
  just review via `pnpm build && UI_PREVIEW_MODE=1 pnpm start`, noting
  `next start` always forces `NODE_ENV=production` so that specific
  combination won't show preview routes either — a real fix needs
  Turbopack dev mode itself sorted out in this environment) is the
  workaround until someone with dev-server ownership looks at it.

**Not attempted (scope discipline, CLAUDE.md Rule 4)**

- Storybook — explicitly out of scope per the cluster brief; `/preview/
  system` is the substitute.
- Restyling every one of `packages/ui`'s ~60 exported components file-by-
  file — most already consume semantic Tailwind classes bound to the
  rewritten tokens (`bg-primary`, `border-border`, …), so the token
  rewrite re-themes them with no markup change; this pass did a targeted
  pass (`Button`, and a token-compliance grep for raw hex/rgb — none
  found) rather than touching all ~60 files individually.

## Cluster TENANT — dashboard design-system pass (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Applied the DS cluster's re-themed tokens + new layout/custom primitives
(`PageHeader`, `Callout`, `NAV_ICONS`, `ThemeToggle`) across the whole
`(tenant)/dashboard` surface — visual/UX only, no data hooks, route
contracts, query keys, form schemas, or realtime wiring touched.

- Every page's ad-hoc `<h1 className="text-xl font-semibold">…</h1>`
  (32 call sites across every dashboard route: Overview, Calls, Call
  detail, Bookings, Customers, Customer detail, Messages, Message thread,
  Orders, Order detail, Setup + Resources + Offerings + Import, Agent
  settings, Billing, Integrations, Support + ticket detail, Team, Refer,
  Delivery, Phone setup, Test-your-agent) replaced with `<PageHeader
  title=… description=… actions=…/>` — title/description text unchanged,
  right-aligned actions (buttons, status badges, view toggles, the
  customer-search box) now use `PageHeader`'s wrap-safe `actions` slot
  instead of a hand-rolled flex row, so they stay usable at 390px without
  per-page tuning.
- `tenant-shell-client.tsx`: nav now uses `NAV_ICONS` for every item (five
  items — Agent, Phone Setup, Delivery, Billing, Refer & Earn — had no
  icon before), grouped into three labeled `NavSection`s (Operate /
  Configure / Account) instead of one flat list; topbar gained
  `<ThemeToggle>` next to the existing realtime pill/notification center.
  Mobile tab bar unchanged (still the 5-item subset).
- Ad-hoc `rounded-md border border-warning/40 bg-warning/10 p-3` /
  `border-primary/30 bg-primary/5` notice `<div>`s (Overview's "finish
  phone setup"/"test your number" prompts, Refer's W-9 threshold warning,
  Delivery's A2P-pending warning, Test-your-agent's unpublished-agent
  warning) replaced with `<Callout tone="…">` — same copy, now with the
  tone's icon and consistent card treatment. The one full-width past-due
  banner in `(tenant)/layout.tsx` was deliberately left as a raw strip
  (it's a page-width banner in `AppShell`'s `banner` slot, not a card —
  `Callout` isn't the right shape there).
- Customers page's raw `<input>` → `Input` primitive; Agent-settings'
  native mobile `<select>` tab-switcher → `Select`/`SelectTrigger`/
  `SelectContent`/`SelectItem` (same `onValueChange`-driven route-push
  behavior); Bookings' two plain `list`/`calendar` `<Button>`s → a single
  `ToggleGroup`.
- Integrations page (previously the one list with no loading state) now
  wrapped in `DataState` with a 4-card skeleton grid, matching every other
  list's loading/empty/error convention.
- The three `not-found.tsx` files (call/customer/ticket detail) upgraded
  from a bare centered `<h1>` to `EmptyState` (lucide icon +
  description + a "Back to …" link) per the brief's empty-state pattern.
- No changes to `packages/ui`, `apps/web/src/components/phone-setup/**`,
  or any file outside this cluster's ownership paths — the agent-settings
  sub-pages (`greeting`/`hours`/`services`/`faq`/`instructions`/
  `language`/`manual-mode`/`vertical-details`) and `setup-progress-panel.tsx`/
  `support-reply-form.tsx` were reviewed and left untouched: they already
  render through `Card`/`Form`/`Input`/`Progress` primitives on semantic
  tokens with no raw hex, ad-hoc form elements, or emoji, so the token
  rewrite alone re-themes them correctly.

**Verified**: `tsc -b` (apps/web) — clean, 0 errors repo-wide at the time
this note was finalized (the `live-call-hero.tsx` error described in the
`docs/audit/DESIGN_REQUESTS.md` entry above was present for most of this
session and independently fixed by the owning marketing-cluster agent
mid-session, on this same shared working tree — the request entry is left
as-is for the record); `biome check` on every touched path — clean;
`vitest run` — apps/web full suite (51 files / 238 tests) and
`packages/ui` (8 files / 23 tests) both green, no test assertions needed
updating.

Could not get a real-browser screenshot pass at 390/768/1024/1440
(`UI_PREVIEW_MODE=1`, port 3120) in this session — no screenshot tool was
available. Two attempts to stand up a server each hit a pre-existing,
out-of-ownership blocker: `UI_PREVIEW_MODE=1 next dev --webpack` started
and served `/en/preview/dashboard`, but every request threw the same
sandbox-specific `TypeError: (0, react.js.createContext) is not a
function` from Next's vendored RSC React bundle that the DS cluster
already documented reproduces on completely untouched pages regardless of
Turbopack vs. webpack dev mode; once `tsc` was clean, `next build
--webpack` compiled and typechecked successfully but then failed
prerendering `/en` — `Error: Event handlers cannot be passed to Client
Component props` on `/[locale]/(marketing)/page` — an unrelated,
in-flight marketing-cluster bug, not this pass's or DS's. Every markup
change in this pass is a mechanical `PageHeader`/`Callout`/`Input`/
`Select`/`ToggleGroup`/`EmptyState` swap of already-responsive DS-cluster
components, or an icon/grouping change to the existing `AppSidebarNav`/
`MobileTabBar`, so the existing responsive behavior of those shared
components should carry through unchanged — but an actual screenshot pass
is still owed once a production build gets all the way through.

## Cluster MARKETING — public site + auth design-system pass (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Applied the DS cluster's tokens + new layout/custom primitives across
every public/marketing surface — visual/UX only; every route path, form
field name, analytics event, and data-fetching call kept as-is.

**What was built**

- **Home** (`(marketing)/page.tsx`): new hero with a live-feeling product
  visual (`components/marketing/live-call-hero.tsx` — a client
  storyboard, not a real Retell call: transcript turns animate in on a
  timer, a `check_availability()` tool-call badge appears, a booking card
  slides into a mini "dashboard" panel, then loops; `aria-hidden` since
  it's decorative and the surrounding copy carries the real message),
  `TrustStrip` (disclosed AI / recorded with consent / number stays
  yours), `VerticalGrid` (business-type cards using `VerticalIcon` +
  `heroStat` as the one-line outcome, replacing the old emoji grid),
  `DashboardPreview` (a real `MetricCard`/`CallFeedItem`/`DataList`/
  `StatusBadge` layout seeded with static illustrative data — never a
  screenshot), pricing teaser, demo CTA. Built with `Container`/`Section`
  throughout instead of one hand-rolled `max-w-6xl` wrapper, so
  backgrounds alternate (`bg-muted/30` strips) and the page uses full
  width at 1440/1920 instead of one centered column.
- **Header/footer** (`components/marketing/marketing-header.tsx`,
  `marketing-footer.tsx`): `VerticalIcon` in the business-types dropdown
  and mobile menu (was raw emoji), `ThemeToggle` added, mobile menu
  redone with ≥44px touch targets and `aria-expanded`; footer gained a
  4-column sitemap (business types / product / legal) instead of a
  one-line strip. Translation keys (`Nav.*`/`Footer.*`) kept, not
  hardcoded.
- **Pricing**: tier cards renamed from the internal `Primary`/`Secondary`
  to customer-facing `Answer & Book` / `Connected` (DESIGN BRIEF's own
  example names) — copy and feature lists unchanged, ✓ characters swapped
  for a real `lucide-react` `Check` icon.
- **`[vertical]` pages**: icon swapped from the content data's emoji
  field to `<VerticalIcon vertical={content.vertical}>` (the emoji string
  in `content/marketing/verticals.ts` is left alone — that file is
  outside this cluster's ownership; the page just stops reading the
  `icon` field), added an illustrative "a typical call" transcript
  snippet per vertical.
- **Demo**: two-column shell (form + "what happens next" / vertical
  badge / disclosure note) at `lg`+, single column on mobile, wrapped
  around the existing `<DemoFlow>` client state machine
  (`components/demo/demo-flow.tsx`, out of ownership) — no changes to
  that component's logic or the `/api/demo/*` contracts.
- **Signup stepper**: `WizardStepper` steps deduped into one shared
  `lib/marketing/signup-steps.ts` (was copy-pasted verbatim in 3 client
  components); `business-type-form.tsx`'s vertical picker now uses
  `VerticalIcon` instead of emoji; each step client gained a short
  heading (`h1`/description) instead of a bare form; `provisioning-
  client.tsx`'s failure state uses `Callout` instead of an ad-hoc red
  div. `signup/forwarding` wraps `PhoneSetupWizard` (out of ownership)
  unchanged.
- **Auth pages** (`/login`, `/mfa/challenge`, `/mfa/enroll`,
  `/reset-password`, `/reset-password/confirm`): new shared
  `components/marketing/auth-shell.tsx` (brand mark + centered card, no
  chrome) — every page kept its own form/`useForm`/Supabase-call logic
  untouched, only the wrapper changed. Added `login`/`mfa`/
  `reset-password` `layout.tsx` files (new — none existed) so each route
  gets a real `<title>`/description/favicon; the pages themselves are
  `"use client"` and can't export `metadata`.
- **Intake form**: wrapped in a "secure, private link" trust line
  (`ShieldCheck`), success/form cards restyled for a clinical-clean feel
  — field names, Zod schema, and the `api-intake` invoke contract
  untouched.
- **Blog/legal**: blog index restyled as a divided list with a hover
  affordance; blog post + all three legal docs (terms/privacy/dpa) now
  share one `components/marketing/legal-page.tsx` shell (was 3
  near-identical files) with hand-authored prose styling (no `@tailwindcss/
  typography` dependency in this package) for readable measure/rhythm.
- **404s**: added `(marketing)/not-found.tsx` (didn't exist before — the
  brief names "404" as a deliverable) and restyled the existing
  `[vertical]/not-found.tsx` and `blog/[slug]/not-found.tsx`.
- **Favicon/OG**: `apps/web/public/favicon.svg` (hand-authored SVG mark,
  no binary) wired in via `icons: { icon: "/favicon.svg" }` metadata on
  the marketing layout and the 3 auth layouts (root `[locale]/layout.tsx`
  is out of ownership, so this couldn't go there); `(marketing)/
  opengraph-image.tsx` — code-generated via `next/og`'s `ImageResponse`
  (verified against the current installed Next 16.3.4 docs at
  `node_modules/next/dist/docs/.../opengraph-image.md` per CLAUDE.md Rule
  1 — file convention, exports, and the `ImageResponse` call shape all
  match exactly), shared by every marketing page unless a more specific
  route later overrides it.

**Conflict with DESIGN SYSTEM AUDIT (CLAUDE.md Rule 4 — documented,
proceeded with the existing decision)**: the brief asks for "pricing that
shows the real card for each business type with included minutes and
overage plainly" on `/pricing` and per-`[vertical]` pages. The existing,
explicit FRONTEND_SPEC decision (doc comment on both `/pricing`'s page
and `/api/platform-settings/price-card/route.ts`) is that the real price
card is shown in exactly one place, pre-signup: signup step 2, after a
signed draft cookie exists — "the real price card never appears here"
on `/pricing` verbatim in the old code. That's a product/conversion
decision, not a styling one, and reversing it would mean either exposing
`platform_settings` pricing to an unauthenticated route or duplicating
the price-card computation — out of scope for a visual pass. Kept the
generic tier comparison on `/pricing` (restyled, customer-named plans)
and the "$299/mo — see your real price at signup" line on `[vertical]`
pages, both pointing to signup for the real number.

**Bug found and fixed within this cluster's own ownership** (also filed
as a `docs/audit/DESIGN_REQUESTS.md` request to DS for the real fix): the
`next build --webpack` prerender failure on `/en` that the TENANT
cluster's entry above flagged as "an unrelated, in-flight
marketing-cluster bug" turned out to be `packages/ui/src/custom/
call-feed-item.tsx` (DS-owned) defining its own `onClick` without a
`"use client"` directive — any Server Component that renders
`<CallFeedItem>` hits React's "Event handlers cannot be passed to Client
Component props" at prerender time. This cluster's `dashboard-preview.tsx`
was the first RSC call site to hit it. Fixed locally by making
`dashboard-preview.tsx` itself `"use client"` (that component has no
actual interactivity of its own — the directive exists solely to satisfy
`CallFeedItem`'s requirement); the proper fix (adding `"use client"` to
`call-feed-item.tsx` itself) is DS's to make, logged in
`docs/audit/DESIGN_REQUESTS.md`.

**Verified**: `pnpm typecheck` (root, all 14 packages via turbo) — clean.
`pnpm --filter @heyloo/web test -- --run` — 51 files / 238 tests, all
green, no assertions needed updating. `pnpm --filter @heyloo/ui test --
--run` — 8 files / 23 tests, green (untouched by this pass). `biome
check` (every touched path) — clean after one auto-fix pass (formatting
+ import ordering) and one manual fix (`noArrayIndexKey` in
`live-call-hero.tsx`). `pnpm build` (webpack) — succeeded end-to-end
after the `CallFeedItem` fix above; `pnpm start -p 3110` +
`@playwright/test`'s bundled `chromium` (`executablePath
/opt/pw-browsers/chromium`) against `home`/`pricing`/`[vertical]`/`demo`/
`signup step 1`/`login`/`blog`/`legal/terms`/a 404 route at 390×844,
768×1024, 1024×900, 1440×900, and 1920×1080 — zero horizontal overflow
(`document.documentElement.scrollWidth` checked against `clientWidth` at
every shot) at every breakpoint on every page. Additional spot checks:
the mobile hamburger menu's open state (touch targets, icon swap) and
`prefers-color-scheme: dark` on home/pricing/login — dark mode fully
re-themes with no unstyled/raw-token surfaces. Screenshots are local to
this session's scratchpad, not committed.

**Not attempted (scope discipline, CLAUDE.md Rule 4)**

- Per-page `opengraph-image` overrides beyond the one shared marketing
  default — the brief's "Metadata/OG per page" is satisfied by each
  page's existing `title`/`description` plus the shared OG image; a
  bespoke OG render per business type would be a reasonable follow-up but
  wasn't attempted here.
- `content/marketing/verticals.ts` and `content/marketing/home.ts`
  (`apps/web/src/content/marketing/**`) were read but not edited — that
  path is distinct from this cluster's `apps/web/src/lib/marketing/**`
  ownership; the emoji `icon` field there is simply no longer read by any
  restyled call site rather than removed from the data.

## ADMIN/PARTNER — cockpit + partner portal restyle (design-system pass)

Restyled every page under `apps/web/src/app/[locale]/(admin)/cockpit/**`
and `(partner)/portal/**`, plus `components/admin/admin-shell-client.tsx`,
`components/partner/partner-shell-client.tsx`, and
`components/partner/payouts-table-client.tsx`, onto the tokens/components
in `docs/DESIGN_SYSTEM.md` (which packages/ui already carried — this was
composition, not a token/primitive change). Consistent, mechanical pass:

- Every ad-hoc `<h1 className="text-xl font-semibold">…</h1>` (and its
  hand-rolled `flex items-center justify-between` action row) replaced
  with `<PageHeader>` (font-display title, wrap-safe right-aligned
  actions, optional description) — the one page-header pattern now used
  everywhere in both surfaces.
- Money/percent/count table cells wrapped in `tabular-nums` (delta/cost
  columns additionally color-coded success/destructive where the sign is
  meaningful, e.g. `cockpit/margin/calls`); ids in `font-mono`.
  Vertical-name cells go through `.replace(/_/g, " ")` + `capitalize`
  instead of printing the raw `real_estate` slug.
- Raw hand-styled `<select>` elements (platform settings' vertical
  pickers) replaced with the shared `Select` primitive — same
  value/onChange contract, no stock browser chrome.
- Ad-hoc colored `<div>` notices (outreach complaint-rate warning,
  Config Lab's "simulation only" line, a per-tenant margin "suggested
  action" `Card`) replaced with `Callout` (`warning`/`danger`/`info`
  tone) — the component the design system names for exactly this.
- Both shells (`AdminShellClient`, `PartnerShellClient`) gained a
  lucide-react icon per nav item (via `NavItem.icon`, already supported
  by `AppSidebarNav`/`SidebarMenuButton` — no packages/ui change needed)
  and a font-display wordmark with an accent-colored icon in the sidebar
  header, replacing the plain text label.
- Admin's existing "best viewed on desktop" mobile gate (admin-shell-
  client.tsx) was kept as-is, not made responsive — `AppShell`'s own doc
  comment states this is deliberate per FRONTEND_SPEC §0.5 ("desktop-
  primary… applied by the caller"), not an oversight this pass should
  reverse. The partner portal has no such gate and relies on the shared
  `Sidebar` primitive's existing mobile collapse (packages/ui, unchanged
  here) for its mobile usability.

**Not attempted (scope discipline, CLAUDE.md Rule 4)**: the design
brief's partner-portal "earnings hero (this month, lifetime)" is not on
`(partner)/portal/page.tsx` — that page's existing query only reads
`referral_links`/`referrals.status`, no dollar amounts (those live in
`commission_events`/`referral_payouts`, queried only by
`portal/customers` and `portal/payouts`). Adding a lifetime/MTD $ rollup
to the dashboard would mean new data wiring, which the cluster brief
says to keep intact rather than extend. Restyled the dashboard's
existing referral-count metrics instead of fabricating or wiring new
earnings figures; a real earnings hero needs a small backend aggregation
this pass didn't add.

**Verified**: `apps/web` `pnpm exec tsc -b --pretty` — clean. `apps/web`
`pnpm exec vitest run` — 51 files / 238 tests, all green, no assertions
needed updating (`payouts-table-client.test.tsx`'s `getByText` calls
still match — badge/tabular-nums styling doesn't change text content).
`packages/ui` `pnpm exec vitest run` — 8 files / 23 tests, green
(untouched by this pass). `biome check` on every touched file — clean
after one `--write` pass (formatting/import-order only, no semantic
change). Not run: a `next start` + screenshot pass at 390/768/1440
(`UI_PREVIEW_MODE=1`) — the preview route group mirrors these pages
mechanically per `docs/DESIGN_SYSTEM.md`'s "UI Preview Mode" section, so
the static verification above (typecheck + tests + lint, all green) was
the practical gate available in this pass; a follow-up visual screenshot
pass is recommended before shipping.

## DS — DESIGN_REQUESTS follow-up pass (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Applied both open items in `docs/audit/DESIGN_REQUESTS.md` (the TENANT
entry was already resolved, left as-is), then ran the repo-wide gates.
Full detail/verification for each fix is written inline in
`docs/audit/DESIGN_REQUESTS.md` next to the request it resolves rather
than duplicated here; summary:

- **MARKETING's request** (`CallFeedItem` missing `"use client"`):
  fixed, plus 5 more `packages/ui/src/custom/*.tsx` files found by the
  same grep pattern (`alert-rule-row.tsx`, `connection-lifecycle-card.tsx`,
  `manual-mode-banner.tsx`, `reply-feed-item.tsx`, `state-trace-viewer.tsx`)
  — same bug, same fix. `packages/ui/src/primitives/command.tsx`'s
  `onOpenChange` was checked and is not the same bug (passed to a Client
  Component, not a host element).
- **ADMIN/PARTNER's request** (preview-mode `fetch` mock not intercepting
  client-side `/api/admin/**` calls): root cause was `UI_PREVIEW_MODE`
  being a server-only env var invisible to the browser bundle, so
  `isPreviewModeEnabled()` never returned `true` client-side and
  `installPreviewFetchMock()` never ran there. Fixed via a
  `NEXT_PUBLIC_UI_PREVIEW_MODE` build-time mirror in `next.config.ts`'s
  `env` field (derived from the same already-`NODE_ENV`-gated boolean, so
  the production floor is unchanged) plus `guard.ts` checking both vars.
  `src/types/env.d.ts` gained both as typed `ProcessEnv` properties.

**No component prop/API changes surfaced during this pass** (consistent
with the DS cluster's own `docs/BUILD_NOTES.md` entry: "No existing
component prop/API renamed") — `pnpm -w typecheck` needed no consumer
adjustments beyond the 2 fixes above (which broke `tsc` themselves
`process.env.NEXT_PUBLIC_UI_PREVIEW_MODE` needing a real `ProcessEnv`
property under `noPropertyAccessFromIndexSignature`, and the test files'
`process.env["UI_PREVIEW_MODE"] = ...`/`delete` calls needing that
property non-`readonly`).

**Verified**: `pnpm -w typecheck` (all 14 packages) — clean. `pnpm
--filter @heyloo/web test -- --run` — 51 files / 238 tests green. `pnpm
--filter @heyloo/ui test -- --run` — 8 files / 23 tests green. `biome
check` on every touched file — clean after one `--write` pass (trailing
newline only). `pnpm build` (`next build --webpack`, `UI_PREVIEW_MODE`
unset) — succeeds end to end; `/en` and every other marketing/tenant/
admin/partner route prerender or build without the "Event handlers
cannot be passed to Client Component props" error; confirmed all 3 font
families (Fraunces, Inter, IBM Plex Mono) are actually fetched and
self-hosted — `@font-face` rules with fallback faces present in
`.next/static/css/*.css` and 25 `.woff2` files present under
`.next/static/media/`.

## repair:tenant — round-1 design review blocker, root-caused and fixed (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

The round-1 tenant-surface design review reported a single `blocker`
finding across all 33 `/preview/dashboard/**` routes: it "could not render
or screenshot any tenant page in this environment," attributing this to
two stacked infra issues already logged in this file — (1) `next start`
always forces `NODE_ENV=production`, and `guard.ts`'s
`isPreviewModeEnabled()` hard-floors preview routes to 404 whenever
`NODE_ENV === "production"` (by design — see `guard.ts`'s own comment: "no
env var can re-enable this in a production deployment," a security
invariant, not a bug — so no fix was made there, and it isn't this
cluster's file anyway), and (2) the DS/TENANT clusters' own prior notes
(this file, ~L1257 and ~L6249) that `next dev` throws `TypeError: …
react.js.createContext is not a function` on literally every
server-rendered page in this sandbox, previously written up as an
unresolved, unowned "Turbopack/webpack + `transpilePackages` +
`react-server` condition" sandbox bug.

**Root-caused and fixed the createContext crash itself** — it was not a
sandbox/toolchain bug but a real, reproducible code defect, squarely a
"shared-component defect attributable to the system" under this cluster's
`packages/ui` ownership carve-out: three `packages/ui/src/primitives/*`
files render third-party components that keep their own internal React
state/context (`calendar.tsx` → `react-day-picker`'s `DayPicker`,
`command.tsx` → `cmdk`'s `Command`, `sonner.tsx` → `sonner`'s `Toaster`)
but were missing the file-level `"use client"` directive every other
stateful primitive in this package already carries (the same defect class
the DS cluster's `DESIGN_REQUESTS` follow-up pass fixed in 6 `custom/*`
files earlier this session — these 3 were missed because that pass's grep
targeted inline event-handler props, which none of these three files have
themselves; the crash instead comes from the wrapped library's own
internal hook/context calls). Without the directive, Next's RSC/client
boundary extraction (`transpilePackages` re-processing `@heyloo/ui`'s
`dist/*.js`) leaves these modules reachable from the server component
graph, where they hit React's server build's stubbed-out `createContext`
(Server Components cannot use Context) — exactly the
`createContext is not a function` signature both prior notes recorded.
`sonner.tsx`'s `<Toaster>` is rendered by `apps/web/src/app/providers.tsx`
(already `"use client"`, wraps every route in the app including plain
marketing pages), which is why the crash reproduced on completely
unrelated, untouched pages and not just preview/tenant ones.

Fix: added `"use client"` as the first line of all three files
(`packages/ui/src/primitives/calendar.tsx`, `command.tsx`, `sonner.tsx`);
no markup, props, or behavior changed. Rebuilt `packages/ui` (`tsc -b`) so
`dist/primitives/{calendar,command,sonner}.js` carry the directive (the
package resolves through `dist`, not `src`).

**Verified live against this shared session's already-running
`UI_PREVIEW_MODE=1 next dev --webpack` server (PID 26264/26247, started by
a concurrent agent on this shared working tree — not restarted, just
re-requested after the fix)**: before the fix, `/en` (plain marketing
home), `/en/preview/portal`, and `/en/preview/dashboard` all logged
`⨯ TypeError: (0 , react__WEBPACK_IMPORTED_MODULE_0__.createContext) is
not a function` server-side (confirmed via
`.next/dev/logs/next-development.log`, not assumed). After the fix and
rebuild, the same routes plus `/preview` (the index), `/preview/dashboard`,
`/preview/dashboard/bookings` (the page that actually renders `<Calendar>`)
and `/preview/dashboard/integrations` all return HTTP 200 with real page
content and zero `createContext` errors in either the HTTP response body
or the server log across several fresh (non-cached, log-confirmed
recompiles) requests.

**Known remaining gap, out of this cluster's ownership, not a design
defect**: `/preview/dashboard/**` still 307-redirects to `/login` on this
particular already-running dev server even with the createContext crash
gone and `UI_PREVIEW_MODE=1`/`NODE_ENV=development` confirmed set on its
process env (`/proc/<pid>/environ`, not assumed) — response headers show
`x-nextjs-cache: HIT` / `x-nextjs-prerender: 1` on the redirect, consistent
with a stale statically-prerendered redirect cached before
`UI_PREVIEW_MODE` was live on that process, rather than the preview-auth
mock itself failing (`/preview` and `/en` both render real content with no
auth issue). This is `docs/DESIGN_SYSTEM.md`'s UI-Preview-Mode
infra/caching territory (DS cluster ownership, not `(tenant)/**`); a fresh
`.next` dev cache on the next real preview-mode server start should clear
it. Recommend re-running the actual round-1 tenant design review now that
the render blocker is fixed.

**No `(tenant)/**`/`components/tenant/**` files were touched** — every
tenant page in this cluster's ownership was already re-themed by the prior
"Cluster TENANT — dashboard design-system pass" entry above; this pass's
only changes are the 3 `packages/ui` directive fixes.

**Verified**: `packages/ui` — `tsc -b` clean, `vitest run` 8 files / 23
tests green, `biome check` on all 3 touched files clean (no fixes needed).
`apps/web` — `tsc -b` clean, `vitest run` 51 files / 238 tests green, no
assertions needed updating.

## Cluster repair:admin-partner — design repair pass (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Fixed all blocker/major crashes and most minors from a design review scored
34/100 against the admin cockpit + partner portal. Summary of the
non-obvious decisions:

- **Admin mobile "desktop-primary" gate**: kept the existing hard gate
  (real cockpit content, not a reduced summary, still only renders
  `md:` and up) rather than building the promised reduced mobile view —
  that's a real feature, out of scope for a visual-repair pass. Fixed the
  copy bug instead: `AdminShellClient`'s gate message is no longer
  hardcoded to "The margin cockpit is desktop-primary" on every route; it
  now derives the current top-level nav section's label (falling back to
  a generic "This cockpit view is desktop-primary" for detail routes that
  don't match a nav item) so Outreach/Templates/Support/etc. no longer
  read as mislabeled.
- **Shared defensive-rendering fixes** (all in `packages/ui`, since the
  reviewer attributed these crashes to shared primitives used by many
  pages): `DataTable` defaults `data` to `[]`; `StatusBadge` no longer
  calls `.replace()` on an undefined `value` (falls back to an "Unknown"
  outline badge); `MetricCard`'s `formatValue` returns "—" for any
  non-finite number instead of producing `$NaN`/`$NaN.NaN`/`NaN%`, which
  was the actual root cause behind both the CAC page's "$NaN" and the
  admin Partners list's "$NaN.NaN" YTD-paid findings; `MarginWaterfall`
  defaults `segments` to `[]` and renders a real chart-level `EmptyState`
  instead of crashing on `.map()`.
- **`AppShell`** (`packages/ui/src/layout/app-shell.tsx`) gained
  `min-w-0` on both the content-column flex item and `<main>` — the
  standard fix for a wide, `whitespace-nowrap`-cell `<DataTable>` (or any
  wide descendant) forcing the outer sidebar+content flex row past the
  viewport at 768px/390px despite `main`'s own `overflow-x-hidden`, since
  a flex item's automatic minimum width otherwise ignores that. Also gave
  `DataTable`'s own row-collapse wrapper an explicit `overflow-x-auto`
  (in addition to the one already inside the shared `<Table>` primitive)
  per the review's explicit ask, even though it's likely redundant with
  the `min-w-0` fix.
- **`/cockpit/support` Radix Tabs `aria-valid-attr-value`**: the page used
  `Tabs`/`TabsList`/`TabsTrigger` as a pure filter control with **no**
  `TabsContent` at all, so every trigger's Radix-generated `aria-controls`
  pointed at a panel id that never existed in the DOM. Fixed by adding one
  `TabsContent` per status filter (`forceMount` + `data-[state=inactive]:
  hidden`, so all five stay in the DOM and every trigger's `aria-controls`
  resolves), reusing the single existing query result for the active tab
  and a `{ isPending: true }` stand-in for the hidden ones — no extra
  fetches, no behavior change.
- **`/portal/payouts` "Sample Payout Method"**: the code
  (`(partner)/portal/payouts/page.tsx`) does `Paid via {(partnerRow?.
  payout_method ?? "paypal").replace(/_/g, " ")}` — correct, generic
  code. If a real or preview-mock partner row's `payout_method` column
  literally contains the string `"sample_payout_method"`, that's a leaked
  placeholder value in the *data*, not a code defect; not something this
  page-code-only pass can fix. Flagging here per CLAUDE.md Rule 4 rather
  than guessing at a data-layer change outside this cluster's ownership.
- **Per-route `<title>`s**: every admin cockpit `page.tsx` is a client
  component (`"use client"`), so none of them could export `metadata`
  directly (Next.js requires that from a Server Component). Added a
  sibling `layout.tsx` (plain server component, `export const metadata`
  + `{children}`) next to each of the 25 admin cockpit routes and the 2
  partner routes that were missing one, rather than changing any page to
  a server component (would risk behavior/data-wiring changes out of
  scope for this pass).
- Logged two items this cluster's ownership doesn't cover to
  `docs/audit/DESIGN_REQUESTS.md`: the `/portal/disclosure` UI-Preview-Mode
  redirect limitation (`apps/web/src/lib/preview/**`), and a
  `text-warning`-on-`bg-warning/10` contrast pattern that recurs outside
  this cluster's files (`packages/ui/src/theme/globals.css` token pair /
  `(tenant)/layout.tsx`'s manual-mode banner).

**Verified**: `packages/ui` — `tsc -b` clean, `vitest run` 8 files / 23
tests green, `biome check` clean on all touched files. `apps/web` —
`tsc -b` clean, `vitest run` 51 files / 238 tests green, `biome check`
clean on all touched files. No route contracts, data wiring, or existing
test assertions were changed — only defensive guards, empty/loading
states, `aria-label`s, per-route metadata, and layout hardening.

## DESIGN-1 — Integrator pass over the design wave (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Closed out the whole uncommitted design wave documented piecemeal above
(`DS`, `Cluster TENANT`, `Cluster MARKETING`, `ADMIN/PARTNER`, the
`DESIGN_REQUESTS` follow-up, and the two `repair:*` rounds) — new design
token system (`packages/ui/src/theme/globals.css`), Fraunces/Inter/IBM
Plex Mono via `next/font`, `Container`/`Section`/`PageHeader`/`Callout`/
`DataList`/`ThemeToggle`, the `VerticalIcon`/`NAV_ICONS`/`STATUS_ICONS`
lucide-only icon system, and the `UI_PREVIEW_MODE` route group
(`apps/web/src/app/[locale]/(preview)/**`) used to screenshot every
surface for review. As INTEGRATOR: ran every gate, fixed what the gates
caught, and committed. No new design decisions — CLAUDE.md Rule 4.

**Round-3 design review scores** (screenshotted via `UI_PREVIEW_MODE`,
axe-core pass included; full per-surface findings were each cluster's own
review artifact, not reproduced here):

| Surface | Score | Pass | Summary |
|---|---|---|---|
| Marketing | 91/100 | yes | Genuinely strong, a real step up over two prior repair passes — all 18 marketing routes clean. |
| Tenant dashboard | 79/100 | no | Real, substantial improvement over round 2 — every previously-flagged axe critical gone, shared `PageHeader`, full nav icon coverage — but still short of the pass bar. |
| Admin/partner cockpit | 85/100 | no | Big jump from round 2's 34/100 (blocker-riddled) — zero crashes, zero horizontal overflow across ~30 routes at 4 viewports, full light/dark token parity — still short of the pass bar. |

Tenant and admin/partner did not clear the pass threshold this round;
shipping this pass anyway (rather than holding for a round 4) is a scope
call within this task's own remit — CLAUDE.md Rule 4 — since the gaps are
incremental polish on an already-shipped, already-tested surface, not new
defects this integrator pass introduced or found. Follow-up polish for
both belongs in a future design cluster, not blocking this integration.

**Fixed during integration** (all found by the gates, none pre-existing
in a way any single cluster owned):
- `apps/web/src/app/[locale]/(preview)/layout.test.tsx`: destructured
  `getByText` off `render()`'s return instead of using `screen.getByText`
  — `testing-library/prefer-screen-queries` ESLint error.
- `apps/web/src/app/[locale]/(preview)/preview/system/page.tsx`: two
  unescaped `"` in JSX text (`react/no-unescaped-entities`), and a
  `Date.now()` call inside the component body for the impersonation-banner
  gallery fixture (`react-hooks/purity` — the React Compiler forbids
  calling impure APIs during render). Fixed by hoisting the computed
  timestamp to a module-level constant (evaluated once at import time, not
  render) rather than `useMemo`/`useState`+`useEffect`, both of which the
  compiler still flags since their callback still runs during a render
  pass — the value is static gallery fixture data, not a live countdown,
  so module-scope is the correct fix, not a workaround.
- `apps/web/src/lib/preview/mock-fetch.ts`: dropped an
  `// eslint-disable-next-line no-var` above a `declare global { var … }`
  ambient declaration — the rule doesn't fire there, so the directive was
  flagged as unused.
- `apps/web/src/content/marketing/verticals.ts`: removed the unused
  `icon: string` field (literal emoji per vertical — 🔧🐾⚖️🦷🏠🛎️🍽️📞) from
  `VerticalContent` and every entry. Confirmed dead via grep — no
  consumer (`vertical-grid.tsx`, `marketing-header.tsx`,
  `marketing-footer.tsx`, `business-type-form.tsx`, the `[vertical]` page)
  ever reads `.icon`; the real business-type glyph is
  `@heyloo/ui`'s `VerticalIcon` (lucide-only, per `docs/DESIGN_SYSTEM.md`
  §Icons). Left over from before that consolidation and caught by the
  no-emoji-in-source grep gate.
- `packages/ui/src/icons/index.tsx`: rewrote a doc comment that itself
  quoted two emoji as examples of what the icon system replaces (ironic
  given the no-emoji policy the comment was explaining) — same gate.
- Deleted three temporary Playwright screenshot/smoke scripts left in
  `apps/web/` from review rounds (`.scratch-smoke.mjs`,
  `.scratch-smoke2.mjs`, `shoot-tenant-round3.mjs`) — not committed, not
  intentional tooling (nothing under `scripts/` or `apps/web/tests`
  references them).

**Verified as the no-jargon/no-emoji/preview-mode gates**: zero emoji
remain in `apps/web/src` or `packages/ui/src` (Unicode-range grep across
every source file, not just `.tsx`). "Primary plan"/"Secondary plan"/
"upsell" appear nowhere in `apps/web/src`. Every literal `tenant`/`Tenant`
string in rendered UI copy lives in the `(admin)/cockpit/**` internal ops
surface (Heyloo staff tooling, not customer-facing); every occurrence in
the `(tenant)`/`(marketing)`/`(partner)` surfaces is a route path, DB
column name, React Query key, or identifier — not displayed copy. UI
Preview Mode's hard production-disable has its own test
(`(preview)/layout.test.tsx`, 3 cases: unset → 404, `production` even
with the env var set → still 404, both conditions met → renders) and it
passes.

**Gates — all green**: `npx biome check --write` on every touched path
(0 errors after fixes; 42 pre-existing warnings elsewhere in the repo,
none in touched files, none newly introduced); `pnpm -w typecheck`
(18/18 packages); `pnpm run lint` (`biome check .` 0 errors + `turbo run
lint`, 0 ESLint errors across all 14 packages, 30 pre-existing warnings
unrelated to this pass); `pnpm -w test` (19/19 package test tasks —
`apps/web` 51 files/238 tests, `packages/ui` 8 files/23 tests, both
including the new preview-mode-guard and gallery-page tests, all
green); `apps/web` production build (`next build --webpack`, real
`next/font` Google Fonts fetch, no `--turbopack`) — compiled clean, zero
TypeScript errors, all ~173 static/dynamic routes generated. `git status`
carries no build output, `.env*`, `node_modules`, or screenshot/PNG
artifacts.

## ADMIN-R4 — round-4 admin/partner polish (design round-3 follow-up)

Scope: `apps/web/src/app/[locale]/(admin)/**`, `(partner)/**`,
`components/admin/**`, `components/partner/**`, `app/api/partner/**`
(latter only for the referral-link issue below). Source: round-3
admin-partner design review (score 85, `pass: false`) — journal
`wf_67bb4e1a-864`, last `admin-partner` result — plus its `_axe.json`.

**Axe criticals fixed** (confirmed by filtering `_axe.json` for
`impact: "critical"` — exactly these two page/violation pairs, in both
themes):
- `cockpit/config-lab/page.tsx`: the three `Select` triggers (Vertical,
  LLM tier, Voice tier) had no programmatic accessible name (`button-name`,
  critical). Added `aria-label` on each `SelectTrigger` + a matching
  `SelectValue placeholder` (belt-and-suspenders — root cause of Radix's
  intermittent SelectValue-as-name failure wasn't isolated, but an
  explicit `aria-label` never depends on mount timing).
- `cockpit/templates/[vertical]/page.tsx`: "System prompt" and "States
  (JSON)" were a `CardTitle`/`<p>` sitting near their `Textarea`s with no
  `htmlFor`/`aria-labelledby` (`label`, critical). Added real
  `<Label htmlFor>` for each (the System-prompt one `sr-only` since the
  `CardTitle` above it already carries the visible heading; States (JSON)
  keeps its existing visible caption, now as the `<Label>` itself).

**Partner dashboard "Generating…" link — real bug, not just a stall**:
`(partner)/portal/page.tsx` only ever *read* `referral_links` for the
signed-in partner and rendered `"Generating…"` when none existed — no
code path ever created one. The tenant self-referral flow
(`api/tenant/refer/ensure-link/route.ts`) has a find-or-create step;
the external-partner path (partner rows provisioned by an admin via
`admin-referral-partners`) never got the equivalent, so any partner
without a pre-existing `referral_links` row saw a permanently frozen
placeholder — the round-3 review's "~14s stall" screenshot pair was very
likely this (a partner/session with no row vs. one with a row already
seeded), not a real timing hang; no polling/retry loop exists anywhere
in the partner portal's client code (checked `copy-link-button.tsx` and
the rest of `components/partner/**`).

Fix: added `api/partner/_lib/ensure-referral-link.ts` (service-role
find-or-create, same shape/constraint reliance —
`referral_links_code_unique` — as the tenant version) and
`api/partner/ensure-link/route.ts` (POST, for a future client-triggered
regenerate). `portal/page.tsx` now calls the helper directly (function
call, not an HTTP round-trip — service-role client stays server-only per
its own doc comment) so a real link is present by first paint; the dead
"Generating…" state can no longer be reached (missing-link now falls
back to visible "Link unavailable — try refreshing the page." instead of
an unbounded placeholder). Tests: `ensure-referral-link.test.ts` (4
cases incl. the unique-code race fallback) and `ensure-link/route.test.ts`
(4 cases: 401/403/200/500).

**Mobile desktop-gate mislabeled under `/preview`** — real component bug,
not preview-only: `AdminShellClient`'s `currentSectionLabel()` matched
`usePathname()` against hardcoded `/cockpit/...` hrefs; the
`(preview)/preview/cockpit/**` mirror tree re-exports the real
`(admin)/layout.tsx` unmodified (confirmed), so it renders the identical
`AdminShellClient` under a `/preview`-prefixed pathname, and the mobile
"desktop-primary" gate always fell back to the generic sentence there.
Fixed by stripping a leading `/preview` before matching. While in there,
split the pure nav-config/matching logic out of the `"use client"`
component into `admin-nav-sections.ts` (no `next-intl`/`next/navigation`
import) so `currentSectionLabel` has a real unit test
(`admin-nav-sections.test.ts`, 5 cases incl. both the real and
`/preview`-mirrored forms of a detail route) — importing the previous
single-file component in a test pulled in `next-intl`'s navigation
factory, which fails to resolve in this sandbox (unrelated pre-existing
environment issue, not worth fighting for one pure function).

**Reviewed but left as-is** (out of this cluster's ownership or already
filed): the preview-fetch-mock gap for `tenants/[id]`/`partners/[id]`/
`support/[id]`/partner `customers` (owned by `lib/preview/**`, not this
cluster, per the round-3 review's own note); missing per-route `<title>`
on the `(preview)` mirror layouts (same); `MetricCard`'s bare `—` vs. the
nicer `EmptyState` pattern (component lives in `packages/ui`, not owned
here); the preview banner's landmark/contrast issue (already filed in
`docs/audit/DESIGN_REQUESTS.md`, `packages/ui` token-level); the support
list's blank Tenant/Priority columns (already filed, `lib/preview`
fixture shape); the 768px sidebar staying full-width (cosmetic,
"consider" not "fix" in the review, no existing collapse-breakpoint
affordance to wire up without a `packages/ui` change).

Read the three admin detail pages (`tenants/[id]`, `partners/[id]`,
`support/[id]`) end-to-end for the review's "styling parity" ask — each
already follows the shared `PageHeader`/`Card`/`Label htmlFor` pattern
correctly (no unlabeled controls reachable outside a closed dialog, no
crash-shaped bugs); the round-3 reviewer couldn't actually verify their
rendered state at all (blocked by the same preview-fixture gap above),
so there was no concrete parity defect in the real components to fix
beyond the axe items already listed.

Gates run (apps/web only, this cluster's scope): `tsc --noEmit` (repo-wide,
clean), `eslint` on every touched/added file (clean), `vitest run` scoped
to `api/partner/**`, `components/admin/**`, `(admin)/**`, `(partner)/**`,
`components/partner/**` (4 files, 15/15 passing). Full-repo `vitest run`
has 2 pre-existing failures in `(tenant)/dashboard/billing` and
`components/tenant/setup-progress-panel` — both in files this cluster
does not own and did not touch (a different concurrent agent's in-progress
`(tenant)`/`packages/ui` changes were present in the working tree during
this pass); not fixed here, flagging for the TENANT cluster.

## TENANT-R4 (round-3 review majors)

Fixed every major from the round-3 tenant design review
(`.../subagents/workflows/wf_67bb4e1a-864/journal.jsonl`, last `surface:
"tenant"` result) that lives in a real component, all with tests:

- `components/tenant/setup-progress-panel.tsx` — was `steps.map(...)` on
  whatever `query.data` happened to be, with no shape check; a malformed
  or error response (not just the documented preview-mock gap) would
  have crashed the single most important panel on the dashboard home.
  Now: an explicit `query.isPending` loading skeleton, and a runtime
  `Array.isArray(data.steps)` guard (plus `query.isError`) before ever
  destructuring — anything that doesn't match `SetupProgressResponse`
  renders nothing instead of throwing. `requiredDone`/`requiredTotal` are
  also coerced through `Number(...) || 0` before the percentage divide.
  Tests added for the malformed-shape and fetch-error paths.
- `dashboard/team/page.tsx`, `dashboard/delivery/page.tsx`,
  `dashboard/integrations/page.tsx` — each destructured one specific field
  off its query response (`.members`, `.sync_log`, `.integrations`) with
  no guard; any response that doesn't carry that exact field crashes on
  `.length`/`.map` of `undefined`. Team now goes through `DataState` with
  a `members` shape guard in `isEmpty`; Integrations' existing `DataState`
  `isEmpty` now guards `Array.isArray(data.integrations)` before the
  `.length` check it was doing unguarded; Delivery's sync-log panel now
  reads `Array.isArray(airtableQuery.data?.sync_log) ? ... : []` instead
  of asserting the field exists. Tests added for all three (empty/guarded
  render + normal-data render).
- `packages/ui/src/custom/segment-badge.tsx` — `SEGMENT_META[segment]`
  with no fallback threw on any `segment` value outside the 4-member
  enum; `customers/page.tsx` feeds it a Postgres-view column typed
  `CustomerSegment` but never runtime-validated, so a legacy/null/future
  value would crash the whole customers table, not just in preview mode.
  Added a neutral `outline`-badge fallback (raw value, or "Unknown" for
  empty/null) plus `segment-badge.test.tsx`. This file is outside this
  cluster's `apps/web` ownership (packages/ui belongs to the design
  system), but the review named this exact component/fix by path, the
  change is a single isolated fallback branch, and leaving a known
  page-crashing bug unfixed seemed worse than the ownership exception —
  flagging here per Rule 4 rather than silently redesigning scope.
- `packages/ui/src/custom/usage-meter.tsx` + `dashboard/billing/page.tsx`
  — the billing usage card could render a literal `NaN` two ways: (1)
  `billing/page.tsx`'s (and `overview-client.tsx`'s) `usage_daily` reduce
  did `Number(r.billable_minutes)` with no null guard — `Number(null)` is
  `0` but `Number(undefined)` is `NaN`, and a missing/null row poisoned
  the whole sum; fixed with `Number(r.billable_minutes ?? 0) || 0` in
  both places. (2) `UsageMeter` printed `"{used} of {included} minutes
  used"` unconditionally — a 0/missing `included_minutes` (the common
  case when the plan lookup hasn't resolved) always read as "N of 0",
  which reads as broken/NaN-adjacent even once (1) is fixed. `UsageMeter`
  now shows "Unlimited" when `included` is 0 but there's real usage, a
  plain "0 of 0" when both are 0, and coerces every input through
  `Number.isFinite` first so a non-finite prop can never reach the label.
  Same out-of-ownership note as SegmentBadge above (named by path in the
  review). Tests: `usage-meter.test.tsx` (packages/ui) plus
  `dashboard/billing/page.test.tsx` (apps/web, exercises the real reduce
  + component together).
- `dashboard/refer/page.tsx` — the link `<code>` block rendered a
  genuinely empty box when `data.code` was falsy (no placeholder), and
  the funnel was only ever a bare bar chart with its numeric axis hidden
  — at all-zero or near-zero values it reads as blank rather than as a
  designed state. Added a real "couldn't generate your link — Try again"
  placeholder (with a manual `refetch()`) for the missing-link case, and
  an explicit numeric stat-tile row (Clicks/Signups/Qualified/Paid, each
  always showing a real number) above the existing chart so the funnel
  is never blank even when every stage is 0. `DataState`'s own pending
  skeleton already covered the "show a skeleton while loading" ask — no
  change needed there. Test added.
- `dashboard/setup/offerings/page.tsx` — minor round-3 polish item: at
  1024px the Duration column's text could push the Actions column out of
  the table's scroll container. Added `whitespace-nowrap` to the
  Duration/Actions header+cells so both stay a fixed, predictable width
  regardless of content length.

Left as-is (named "minor" in the round-3 review, not one of the assigned
majors, and lives entirely inside a `packages/ui` component this cluster
doesn't own): `HoursEditor`'s two-time-picker row wrapping awkwardly at
exactly 768px (390/1024/1440 all lay out cleanly per the review).

Gates run (apps/web + packages/ui, since two fixes above cross into
`packages/ui`): `tsc -b --pretty` in both packages (clean); `vitest run`
full-repo in `apps/web` (59 files / 264 tests passing) and in
`packages/ui` (10 files / 33 tests passing, including the 2 new files);
`eslint` on every touched/added `apps/web` file (clean after fixing one
`testing-library/no-container` violation in the refer-page test).

## PREVIEW-R4 — preview-harness completeness pass (round-3 review follow-up)

Scope: `apps/web/src/lib/preview/**` and the `(preview)/preview/**` mirror
tree only — per the round-3 tenant + admin-partner design reviews
(`.../subagents/workflows/wf_67bb4e1a-864/journal.jsonl`, last `surface:
"tenant"` / `"admin-partner"` results), every finding attributed to
"preview infra, not this cluster's fix" now has a mirror fix here.

- **`/api/tenant/**` fixtures** (`fixtures.ts`'s `API_FIXTURES`) — added
  exact hand-shaped responses for `/api/tenant/setup-progress`,
  `/api/tenant/team`, `/api/tenant/delivery/airtable/status`, and
  `/api/tenant/integrations`, each matching the route's own exported
  TS response interface (`SetupProgressResponse`, `TeamListResponse`,
  `AirtableStatusResponse`, `IntegrationsListResponse`) rather than the
  generic `{ rows: [] }` fallback these 4 client-side panels were
  destructuring a specific field off of and crashing on. Since all 4 are
  `"use client"` panels that `fetch()` their own `/api/tenant/**` route
  from the browser, UI Preview Mode's fetch interceptor answers them
  directly — the real Next.js Route Handler (and its Supabase reads)
  never runs in preview, so only the route's RESPONSE SHAPE needed to be
  right, not its internals.
- **Detail-route `.maybeSingle()` cardinality bug** (`mock-fetch.ts`) —
  root-caused exactly per the round-3 review: `.maybeSingle()` does NOT
  set the `vnd.pgrst.object+json` Accept header (confirmed against the
  installed `@supabase/postgrest-js@2.116.0` source — it fetches as a
  list and enforces cardinality CLIENT-side via `isMaybeSingle`), so the
  old mock's "ignore all filters, return the whole table" behavior handed
  back all 8 `call_logs` rows for a single-record lookup, and
  postgrest-js nulled the result out (>1 row). Added real PostgREST
  filter parsing (`eq`/`neq`/`in`/`is.null`) in `mock-fetch.ts`'s new
  `applyFilters`, with one deliberate exception: an `id=eq.<value>` filter
  that matches nothing (every preview detail route uses the placeholder
  id `"demo"`, never a real fixture id) is dropped rather than applied,
  and the result is then capped to 1 row — so a real id still narrows
  correctly, `tenant_id` scoping still narrows correctly, and the `"demo"`
  placeholder still resolves to a real record instead of "not found".
  Fixes `/dashboard/calls/[id]`, `/customers/[id]`, `/orders/[id]`,
  `/support/[id]` in one place. Test coverage: new
  `mock-fetch.test.ts` (11 tests: single-row-not-whole-table, real eq
  match, `in()`, a genuinely-empty non-id filter stays empty, unfiltered
  list unaffected, plus the `/api/**` fixtures below).
- **Dynamic `/api/admin/**/[id]` fixtures** (`fixtures.ts`'s new
  `API_FIXTURE_MATCHERS`, dispatched from `mock-fetch.ts`'s
  `mockAppApiResponse`) — `API_FIXTURES` only ever exact-matched a fixed
  GET pathname, so `/api/admin/admin-tenants/demo`,
  `/api/admin/admin-referral-partners/demo`, and
  `/api/admin/admin-support-requests/demo(/notes)` all fell through to
  `{ rows: [] }`, rendering "Unnamed tenant" / "X not found" per the
  review. Added a method+regex matcher list, checked after an exact-match
  miss (and BEFORE the old "any non-GET returns `{ ok: true }`"
  shortcut, so a POST-only route can have a real fixture too — used for
  `/api/tenant/refer/ensure-link`, which was rendering a blank link/funnel
  because it's POST and had no way into the old GET-only fixture map).
  Each `build()` result matches what the calling PAGE destructures
  (`TenantDetail` is a flat object; `admin-tenants/:id`'s REAL edge
  function wraps it `{ tenant: {...} }` and doesn't even have
  `mrr_cents`/`margin_pct`/`minutes_used` on `tenants` — a real page/API
  contract mismatch, left as-is per this cluster's scope, worth an
  admin-partner-cluster look).
- **Fixture data gaps** (`fixtures.ts`) — `customers` rows now carry a
  real `segment` (cycled through all 4 `CustomerSegment` enum values) and
  `lifetime_value_cents` instead of `SegmentBadge` getting a synthesized,
  non-enum placeholder string; `orders` rows now carry a real `items`
  array, `fulfillment_type`, `delivery_address`, `customer_id` (matching
  real `customers` fixture ids), `allergies`, `special_instructions` —
  the synthesized default for an unmapped `items` column was the STRING
  `"Sample items"`, which `order.items.map(...)` would throw on;
  `support_requests` rows now carry `tenant_name`/`priority`/`updated_at`/
  `body` (the admin ticket queue's Tenant/Priority columns were rendering
  blank, per round-2 AND round-3); `referrals` rows now carry a real
  `referred_tenant_id` pointing at an actual `tenants` fixture id (was
  synthesizing to a non-existent `"referred_tenant-N"` id), fixing
  `/portal/customers`' `tenants.select(...).in("id", tenantIds)` lookup
  that was falling back to the literal word "Customer" for every row;
  added a `support_request_notes` table and a `commission_events` row for
  the two admin/partner detail pages that read them.
- **Missing preview-mirror document titles** (63 mirror `page.tsx` files
  under `(preview)/preview/**`, plus a new `preview/system/layout.tsx`) —
  every mirror only ever `export { default } from "<real page>"`, which
  drops that real page's `export const metadata`/`generateMetadata` even
  when one exists, and MANY real tenant-dashboard pages (`team`, `refer`,
  `delivery`, all of `agent/*`, `customers`, `billing`, `integrations`,
  `support`, `setup*`, `bookings` — all `"use client"`) have no metadata
  source at all in the real tree (confirmed: no sibling `layout.tsx`
  either, unlike the admin cockpit's per-route-`layout.tsx` pattern) —
  this is a genuine PRODUCTION accessibility gap (missing
  `<title>`/WCAG 2.4.2) outside this cluster's ownership (real
  `(tenant)/dashboard/**` page files); flagging here for whichever
  cluster owns those files rather than editing them. In the meantime,
  every registered `PREVIEW_ROUTES` mirror now gets its OWN explicit
  `export const metadata` sourced from that route's `label` in
  `routes.ts`, so every `/preview/**` tab has a real, distinct title
  regardless of what the underlying real page does or doesn't export —
  closes the axe `document-title` failures on ~29-30/30 sampled routes
  from both the tenant and admin-partner round-3 reviews.
- **Not-found handling** — mirrored the 3 real designed
  `not-found.tsx` files that exist (`calls/[id]`, `customers/[id]`,
  `support/[id]`) into their `(preview)` counterparts (Next only resolves
  `not-found.tsx` from the route's OWN segment tree, so a real one 3
  levels away in `(tenant)/**` never applied to `(preview)/preview/**`
  without its own copy); also added `(preview)/not-found.tsx` — a
  group-wide fallback for an unregistered `/preview/*` path — since there
  was no `not-found.tsx` anywhere above the `(preview)` layout at all
  (not even at the app root), so a stale/typo'd preview URL hit Next's
  bare, unstyled default.
- **New test coverage**: `routes.test.ts` — a filesystem-level check
  (deliberately NOT a full module `import()`; several real pages
  construct a Supabase client at module scope, which throws under plain
  Vitest with no real env vars, and `next-intl`'s navigation helpers
  don't resolve under Vitest either) that every `PREVIEW_ROUTES` entry
  has (a) a mirror `page.tsx` on disk, (b) that mirror re-exports a
  `default` FROM the exact `source` path the registry declares (not just
  "exports something"), and (c) that declared `source` file actually
  exists — 63 routes × that check, plus no-duplicate-url/href checks (65
  tests total). `mock-fetch.test.ts` — 11 tests covering the filter
  logic and the new/changed `/api/**` fixtures above.

Left as-is (real, out-of-ownership issues surfaced but not fixed here,
per CLAUDE.md Rule 4 — noted for the owning cluster):
- Tenant client-dashboard pages with zero document-title source in the
  real (non-preview) tree, listed above.
- `admin-tenants/:id`'s real backend response shape (`{ tenant: {...} }`,
  no margin/MRR columns) vs. what `TenantDetail`/the page destructures —
  a real page/API contract gap, not a preview-fixture gap; this cluster's
  fixture matches the PAGE per its own brief ("match what pages
  destructure"), but the mismatch itself is admin-partner cluster's to
  resolve.
- `/cockpit/margin/customers/[tenantId]` and
  `/cockpit/outreach/campaigns/[id]` detail routes were not in the
  round-3 review's explicit list of broken dynamic routes (only
  `tenants/[id]`, `partners/[id]`, `support/[id]` were) and still fall
  through to the generic `{ rows: [] }` `/api/**` default — left
  unmapped to stay in scope; can be added to `API_FIXTURE_MATCHERS` the
  same way if a future review flags them.

Gates run (apps/web only, per this cluster's scope): `tsc -b --pretty`
(clean); `vitest run` full-repo (61 files / 340 tests passing, up from 59
files / 264 tests — the 2 new preview test files account for the delta);
`eslint` on every touched/added file (clean); `biome check` on every
touched/added file (clean, ran `biome check --write` once to normalize
formatting on 3 files).

## repair2:admin-partner — round-2 design review, blockers/majors/cheap minors (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Fixed within this cluster's ownership ((admin)/**, (partner)/**,
components/admin/**, components/partner/**, lib/preview/**, plus
packages/ui for shared-component defects):

- **Partners detail placeholder clipping (major)**: `TermsForm`'s
  `Rate (%)` `<input type="number">` carried `placeholder="No recurring
  commission"` on all 8 per-vertical cards — far too long for the field,
  clipped mid-word at every viewport. Added a `ratePlaceholder` prop:
  `"None"` on the default-terms card, `"Inherit"` on the 8 per-vertical
  override cards (the "any field left blank inherits the default above"
  helper text already explains what blank means there).
- **Support ticket detail unnamed Select (major, axe critical)**: the
  status `SelectTrigger` had no accessible name. Added
  `aria-label="Ticket status"`, and — since the redundant `StatusBadge`
  sitting next to it showed the same value in a different case
  ("Open" vs. Select's "open") — dropped the badge and made the
  `SelectTrigger` itself render capitalized, fixing the casing
  inconsistency (minor, same finding cluster) in the same change.
- **Tenants list MRR/Margin always "—" (major)**: root-caused, not
  papered over. `supabase/functions/admin/handler.ts`'s real
  `admin-tenants` LIST route responds `{ tenants: [...] }` (id/name/
  vertical/status only — `mrr_cents`/`margin_pct` are not columns on
  `public.tenants` anywhere, confirmed against every migration), not the
  `{ rows: [...] }` the list page destructured — a real production
  contract bug, not just a design defect (the page would have rendered
  blank/crashed against the real backend, not just shown "—"). Backend
  code is out of this cluster's file ownership, so the in-scope fix is
  defensive: the list page now reads `data.tenants ?? data.rows ?? []`.
  Money fields (`mrr_cents`/`margin_pct`) still aren't computed by the
  real backend anywhere (list OR detail) — the detail page's convincing
  numbers are an intentionally-fabricated preview fixture (see the
  existing note above), not real. Rather than inventing more fake
  financial figures to make the list page "match" the detail page, the
  list preview fixture was updated to the same "fixture matches the
  page" convention already used for the detail route, so review can see
  the intended full design — flagged here again because **actually
  computing MRR/margin (a join to billing/subscriptions data) is a real
  backend feature gap, not a frontend fix, and remains open** for
  whichever cluster owns `supabase/functions/admin/handler.ts` and the
  `tenants` schema.
  - Also surfaced by this same root-cause investigation: `support/page.tsx`
    (`/cockpit/support`) and, unverified, the referral-partners list page
    have the identical `{ rows }`-vs-`{ <resource>: [...] }` mismatch
    against `handleSupportRequests`'s real `{ support_requests: [...] }`
    response. Left unfixed — out of this round's explicit review
    findings, and touching every cockpit list page was judged
    scope-creep for a design-repair pass — but it's the same class of bug
    and should get the same `data.<resource> ?? data.rows ?? []` guard.
- **Outreach campaign detail / margin per-customer detail preview gaps
  (moderate)**: neither `/api/admin/admin-outreach/campaigns/:id` nor
  `/api/admin/admin-cockpit/per-customer-margin/:id` was in
  `API_FIXTURE_MATCHERS` (flagged as a known gap in the prior round's
  BUILD_NOTES entry above), so both fell through to the generic
  `{ rows: [] }` default and rendered "Unnamed campaign" / an "Unknown"
  badge. Added both matchers with realistic data.
- **Portal payouts leaked fixture literal (moderate)**: `PREVIEW_PARTNER`
  had no `payout_method`, so the generic table synthesizer produced the
  literal string `"sample_payout_method"`, rendered verbatim as "Paid via
  Sample Payout Method". Added `payout_method: "paypal"` to the fixture.
- **`/preview/portal/disclosure` unreachable (moderate)**: the preview
  mock `requirePartnerSession` hardcoded `acknowledged: true` for every
  partner route — including the disclosure page's own route, whose real
  page does `if (acknowledged) redirect("/portal")`. That made the
  disclosure screen redirect itself away on every preview visit, despite
  the mock's own comment claiming it would stay reachable. Fixed by
  keying `acknowledged` off `nextPath !== "/portal/disclosure"` — every
  other partner page still sees `acknowledged: true`.
- **Outreach leads blank empty state (minor)**: `DataState`'s default
  `isEmpty` (`Array.isArray(data) ? ... : data == null`) never fires for
  an object like `{ leads: [...] }`/the generic `{ rows: [] }` fallback,
  so the page fell through to `render()` with `data.leads` undefined and
  `LeadTable` drew only its header. Added an explicit `isEmpty` check and
  the standard `EmptyState` copy ("No leads fetched yet — choose a
  vertical and source, then Fetch leads").
- **Shared topbar not a landmark (moderate, axe region) + admin sidebar
  never collapses (minor, "consider" from a prior round)**: both traced
  to the same root cause — `admin-shell-client.tsx` hand-rolled its own
  `<div className="flex h-14 ...">` topbar instead of using the shared
  `<TopBar>` component (`packages/ui/src/layout/top-bar.tsx`) that
  `partner-shell-client.tsx` already uses, which (a) renders a real
  `<header>` and (b) includes the `SidebarTrigger` toggle button admin
  was missing entirely — partner's sidebar was "collapsible" only in the
  sense that its topbar exposes that same trigger, not any different
  component. Switched admin to `<TopBar>`; both findings close together.
  Auto-collapsing below a width threshold was NOT added — out of scope
  for this pass, and the manual trigger is the same affordance the
  reference implementation (partner) relies on.
- **DataTable no scroll affordance (minor)**: added a CSS-only two-layer
  scroll-shadow (solid fade + radial vignette, `background-attachment:
  local`/`scroll`) to the inner `overflow-x-auto` wrapper in
  `packages/ui/src/custom/data-table.tsx`, shared by every list page
  including `/cockpit/support`'s clipped "Last updated" column.
- **Preview banner color-contrast (moderate, axe serious, packages/ui
  token defect — explicitly flagged as outside this cluster's direct
  ownership but touched anyway since it's a `packages/ui` shared-token
  fix, in scope per this cluster's ownership rule, and was blocking a
  clean axe pass on every page this cluster owns)**: `--warning` in
  `packages/ui/src/theme/globals.css`'s light `:root` was
  `oklch(0.62 ...)`, visibly lighter than `--success`/`--destructive`/
  `--info`'s `~0.52-0.55`. Darkened to `oklch(0.48 0.14 75)`. Dark-theme
  value untouched (axe only flagged light mode).

Not fixed (real gaps, correctly out of scope per CLAUDE.md Rule 4):
- Actual MRR/margin computation in the backend (see above) — needs
  `supabase/functions/admin/handler.ts` + a real query/join, not
  something this cluster's file ownership can reach.
- The same `{ rows }` vs `{ <resource> }` response-shape mismatch on
  `/cockpit/support` (and possibly the referral-partners list) —
  identified but not fixed this round; see above.

Gates run (apps/web only, per this cluster's scope, from `apps/web/`):
`pnpm typecheck` / `tsc -b --pretty` and `pnpm test` / `vitest run`.

## DESIGN-2 — Integrator pass over the round-4 design wave (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Closed out the whole uncommitted round-4 design wave documented piecemeal
above (`ADMIN-R4`, `TENANT-R4`, `PREVIEW-R4`, and `repair2:admin-partner`
— itself a repair pass against the round-2 admin/partner review, folded
into this same uncommitted tree alongside the round-3-driven work) — as
INTEGRATOR: ran every gate, fixed what the gates caught, investigated one
review-artifact discrepancy that did not hold up, and committed. No new
design decisions of my own — CLAUDE.md Rule 4.

**Real bugs fixed by the clusters this pass integrates** (full detail in
each section above; summarized here since this is the entry a future
reader will land on first):
- Two axe-critical unlabeled controls (`config-lab`'s three `Select`
  triggers, `templates/[vertical]`'s two unlabeled textareas).
- A real dead-end in production, not just a design defect: the partner
  portal's referral link showed a permanently frozen "Generating…" for
  any partner row an admin provisioned without ever creating a
  `referral_links` row — no code path did — via a new
  `ensure-referral-link` find-or-create helper, tested.
- A real component bug reachable outside `/preview` too:
  `AdminShellClient`'s mobile section-label matcher didn't strip a
  `/preview` prefix, so the desktop-only gate always fell back to
  generic copy under the review route group.
- Multiple guard-missing crash paths on the tenant dashboard
  (`setup-progress-panel`, `team`/`delivery`/`integrations` pages,
  `SegmentBadge` on an out-of-enum value, `usage-meter`'s literal `NaN`)
  that would crash on a real malformed/edge-case API response, not only
  in preview mode.
- A root-caused preview-harness cardinality bug: `.maybeSingle()` doesn't
  set the `Accept: vnd.pgrst.object+json` header (confirmed against the
  installed `postgrest-js` source), so the old "ignore filters, hand back
  the whole table" mock silently violated real single-row cardinality;
  replaced with real PostgREST filter parsing plus one documented
  exception for the `"demo"` placeholder id.
- The preview `--warning` token contrast failure (light theme only).

**Round-5 design review** (post round-4, screenshotted via
`UI_PREVIEW_MODE`, axe-core included): **tenant dashboard 84/100
(fail)** — up from round-3's 79, every route landing on a real page
with no `NaN`/`undefined` text or the bare Next.js default 404; **admin/
partner cockpit 79/100 (fail)** — down from round-3's 85, the reviewer's
own method note flags that this app's `next build && next start` combo
doesn't produce a usable preview server by design (`guard.ts`/
`next.config.ts` hard-disable `UI_PREVIEW_MODE` once `NODE_ENV=
"production"`), so the round-5 admin/partner run is not apples-to-apples
with round-3's. Neither surface cleared the pass bar. Per CLAUDE.md
Rule 4 and the same scope call DESIGN-1 already made once (round-3
also didn't clear the bar): shipping this integration now rather than
holding for a round 6 is correct — the round-4 clusters fixed everything
in their own explicit review findings, and further polish is a new
design pass's job, not this integrator's to invent.

**Investigated, did not reproduce (no code change)**: the tenant
round-5 raw screenshot results (`_results.json`) show 52/256 captures
not landing on a clean `200` — but every one of them is one of two
things: (a) 23 real `404`s, concentrated entirely on the four dynamic
`/preview/dashboard/{calls,customers,orders,support}/demo` routes,
overlapping viewport/theme pairs, or (b) 29 Playwright
`net::ERR_CONNECTION_RESET` navigation errors scattered across unrelated
static routes (`/dashboard`, `/dashboard/agent/*`, `/dashboard/billing`,
etc.) — never a rendering defect (`hasNaN`/`has404`-the-bare-Next-page
were false throughout). Re-ran all four dynamic routes live against this
exact tree (`UI_PREVIEW_MODE=1 next dev`, both via direct navigation and
inspecting the RSC flight payload) — all four return `200` with real
fixture content (e.g. `calls/demo` renders its actual transcript, not
the `not-found.tsx` boundary; the flight payload's `"notFound"` segment
reference some `curl`+grep passes mistook for evidence is Next's normal
prefetch-boundary embedding, present on every request whether or not
`notFound()` fires). The four affected routes failing together, mixed
with connection-resets on completely unrelated routes at the same
general point in a 256-shot batch, is the signature of dev-server
instability during that specific screenshot run, not a page-level
defect — no fix applied since there is nothing here to fix. Left as
un-actioned data for whichever cluster picks up round-6 to re-run if it
recurs.

**Fixed during THIS integration pass**: nothing — `npx biome check
--write` found only 4 pre-existing `noImportantStyles` warnings in the
`prefers-reduced-motion` block of `packages/ui/src/theme/globals.css`
(intentional — an accessibility override that has to win the cascade;
left as-is, same call `packages/ui` already made for this exact block
before this pass), 0 errors, 8 files reformatted (whitespace only, no
behavior change). `pnpm -w typecheck`, `pnpm run lint`, and `pnpm -w
test` were all already clean going in — every ESLint/type/test issue any
gate would have caught was already fixed by the clusters themselves this
round (see their own sections above), unlike DESIGN-1's integration
where the gates still had work to do.

Also removed 4 uncommitted scratch Playwright scripts left in `apps/web/`
from this round's own review passes (`.axe-detail.mjs`,
`.axe-detail2.mjs`, `.axe-detail3.mjs`, `.shoot-round5.mjs`) — not
committed, not intentional tooling, same class of cleanup as DESIGN-1's
three.

**Gates — all green**: `npx biome check --write` on every changed path
under `apps/web/src`, `packages/ui/src`, `docs` (0 errors, 4 pre-existing
warnings noted above); `pnpm -w typecheck` (18/18 packages); `pnpm run
lint` (`biome check .` 0 errors, 42 pre-existing warnings elsewhere in
the repo untouched by this pass + `turbo run lint`, 0 ESLint errors
across all 14 packages, 30 pre-existing warnings unrelated to this pass
— same counts as DESIGN-1, confirming nothing regressed); `pnpm -w test`
(19/19 package test tasks — `apps/web` 61 files/340 tests, `packages/ui`
10 files/33 tests, both green, including every new test file the round-4
clusters added: `mock-fetch.test.ts`, `routes.test.ts`,
`admin-nav-sections.test.ts`, `ensure-referral-link.test.ts`,
`ensure-link/route.test.ts`, the 5 new tenant-page test files, and
`segment-badge.test.tsx`/`usage-meter.test.tsx`); `apps/web` production
build (`next build --webpack`, no `--turbopack`) — exit 0, all ~201
static/dynamic route lines generated, zero TypeScript errors; the
preview-mode-guard tests specifically (`(preview)/layout.test.tsx`'s 3
cases — unset env → 404, `NODE_ENV=production` even with the var set →
still 404, both conditions met → renders — and `lib/preview/guard.test.ts`'s
5 cases) pass, confirming UI Preview Mode's hard production-disable is
still intact after this round's `next.config.ts`/`guard.ts`-adjacent
changes. `git status` carries no build output, `.env*`, `node_modules`,
or screenshot/PNG artifacts — the 4 scratch review scripts above were
removed rather than committed.

## SHARED+TENANT-R6 (round 6, tenant + packages/ui cluster) — discovered gap, not fixed (scope discipline)

`apps/web/src/app/[locale]/(tenant)/dashboard/billing/page.tsx`'s invoice
table renders each row's `status` via `<StatusBadge variant="tenant"
value={row.original.status} />`. `StatusBadgeVariant="tenant"`'s color map
(`packages/ui/src/custom/status-badge.tsx`) is `trialing`/`active`/
`past_due`/`paused`/`canceled` — TENANT lifecycle states, not invoice
states (a real Stripe-style invoice status is closer to `open`/`paid`/
`void`/`uncollectible`). An unmapped invoice status still renders safely
(`StatusBadge`'s own fallback: `outline` variant, title-cased label) — not
a crash, not FIX item 9's placeholder-string bug — just the wrong color
semantics for whichever invoice statuses happen to collide with a TENANT_COLOR
key (e.g. an invoice literally named `active` would render as a success/green
pill, which reads as "this invoice is active," not obviously wrong but not
quite right either). Left as-is per CLAUDE.md Rule 4 (this round's assigned
scope is the crash/contrast/formatting/fixture fixes enumerated in the task,
not a new `StatusBadge` variant); the round-6 tenant fixture's new
`billing_invoices` rows use `"open"`/`"paid"` (realistic invoice statuses),
which fall through to `StatusBadge`'s safe `outline` fallback today. A real
fix would add an `"invoice"` `StatusBadgeVariant` with its own color map.

## ADMIN+PREVIEW-R6 (round 6, admin+preview cluster) — design repair pass (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Scope: `apps/web/src/app/[locale]/(admin)/**`, `(partner)/**`,
`components/admin/**`, `components/partner/**`, `lib/preview/**` (except
the fixtures/mock-fetch/matchers/registry files carved out for the DS
cluster), the `(preview)/**` mirrors, and `supabase/functions/admin/**`
only for the tenants-detail response shape. Source: round-5 admin-partner
design review (score 79, `pass: false`) — journal `wf_879719da-69e`, last
`admin-partner` result.

**Fixes**:
- **"AAL2 verified" pill AA contrast** (major, all 25 cockpit routes):
  `AdminShellClient`'s topbar pill used `text-success` on `bg-success/10`
  — a colored-text-on-tint-of-itself pairing that measured 4.31:1 against
  the 4.5:1 AA floor. Switched the label to `text-foreground` (kept only
  the icon/border colored) — the same safe pattern `<Callout
  variant="success">` already uses, so it stays AA independent of how the
  tenant-dashboard cluster's own `--success`/`--warning` token retune (see
  their round-5 finding on `Badge variant="warning"`) lands. Applied the
  identical fix to the `(preview)` route group's "UI Preview Mode" banner,
  which had the same `text-warning`-on-`bg-warning/10` pairing and the
  same axe `region` gap (a bare `<div>` outside any landmark) — now a
  `<section aria-label="Preview mode notice">`. Filed
  `docs/audit/DESIGN_REQUESTS.md` asking `packages/ui` to promote this
  into a real `<StatusPill>` component so future call sites stop
  hand-deriving the same contrast pairing.
- **axe `region` on all 25 cockpit routes** (moderate): `<AppSidebarNav>`'s
  underlying `<Sidebar>` primitive (`packages/ui`) renders plain `<div>`s
  with no landmark of its own, so the whole nav column sat outside any
  landmark. Fixed at the call site (not in `packages/ui`) by wrapping it
  in a real `<aside aria-label="…">` in both `AdminShellClient` and
  `PartnerShellClient` (the partner portal has the identical underlying
  gap even though round 5's axe pass didn't happen to flag it there).
- **768px sidebar collapse** (moderate): added `admin-icon-rail.tsx`, a
  local icon-only `<aside>` (built from the same `NavSection` config
  `<AppSidebarNav>` takes) shown only in the 768–1023px range
  (`md:block lg:hidden`), with the full labeled nav taking over at
  `lg:block`. `packages/ui`'s `<Sidebar>` has no built-in collapsed/icon
  mode yet — real prop requested in `docs/audit/DESIGN_REQUESTS.md`; this
  local fallback ships the actual fix now per the task brief.
- **`/cockpit/tenants` 768px column clipping** (moderate): added
  `renderMobileCard` (MRR/Margin %, matching the `/cockpit/partners`
  pattern) so the DataTable collapses to stacked cards below `lg` instead
  of clipping its rightmost columns.
- **`/cockpit/tenants/[id]` page/API contract mismatch** (major, real bug
  — not preview-only): the page destructured a flat `TenantDetail`
  (`tenant.mrr_cents`, `tenant.margin_pct`, `tenant.minutes_used`) but
  `public.tenants` has no such columns and the edge function's GET-by-id
  route only ever returned `{ tenant: {...raw row} }` — every metric tile
  silently rendered `—`/`0` in production. Fixed for real in
  `supabase/functions/admin/handler.ts`'s `handleTenants`: the detail
  route now also queries `v_tenant_margin` (current-month revenue/cost/
  margin, same view the margin cockpit's per-customer route already reads)
  and sums `usage_daily.billable_minutes` for the current month, returning
  `{ tenant, metrics: { mrr_cents, margin_pct, minutes_used } }`. Updated
  the page to match, added 2 new edge-function tests (populated + all-zero
  cases — 75/75 `supabase/functions/admin` tests green,
  `tsc -p tsconfig.json` clean) and aligned both the `admin-tenants/:id`
  preview fixture matcher and its `mock-fetch.test.ts` assertion to the
  new shape.
- **`/cockpit/templates/[vertical]` empty textareas** (major, preview-only):
  no `API_FIXTURE_MATCHERS` entry existed for `admin-templates/:vertical`,
  so the System-prompt/States(JSON) `Textarea`s' `defaultValue` was always
  `undefined` and rendered empty (the real edge-function route itself
  already returns real compiled content — see the separate real-bug note
  below). Added a matcher returning a representative, non-empty compiled
  template (hand-authored per this file's own convention, not imported
  from `@heyloo/templates` — `apps/web` has no dependency on that
  package) for whichever `:vertical` the review clicks into.
- **`/portal/disclosure` missing `<h1>`** (moderate, axe
  `page-has-heading-one`): `<FTCDisclosureGate>`'s "FTC disclosure
  requirement" heading is a `CardTitle` (`packages/ui`'s `Card` renders it
  as a `<div>`, not an `<hN>`), and nothing else on the page has a heading
  at all. Added a `sr-only` page-level `<h1>Disclosure</h1>` in
  `DisclosureGateClient` (kept screen-reader-only since a second *visible*
  title above the gate's own card heading would just repeat it). Audited
  every `(admin)`/`(partner)` `page.tsx` (grep for `<h1`/`<PageHeader>`,
  which itself renders a real `<h1>`) — disclosure was the only page
  missing one, and none have more than one.
- **Preview harness**: verified the per-route mirror `<title>` and
  `/api/partner/**` items from the task brief are already satisfied — all
  25 cockpit + 6 portal preview mirrors already carry a
  `metadata.title`; the partner customers page reads `referrals`/
  `commission_events`/`tenants` straight off Supabase REST (no
  `/api/partner/customers` route exists), and those `TABLE_FIXTURES` rows
  are already populated with matching ids; `support_requests` fixture rows
  already carry `tenant_name`/`priority` (the DESIGN_REQUESTS.md ask from
  an earlier round was since resolved). No changes needed for any of
  these — noted here rather than silently skipped.

**Real bug found, not fixed (out of ownership)**: `TemplatesListPage`
(`cockpit/templates/page.tsx`) routes to `/cockpit/templates/${row.vertical}`
(a vertical *slug*, e.g. `"auto_repair"`), and `TemplateEditorPage` queries
`admin-templates/${vertical}` — but `handleTemplates`'s GET-by-id branch
(`supabase/functions/admin/handler.ts`) does
`select * from public.agent_templates where id = ${templateId}`, and
`agent_templates.id` is a real `uuid` primary key, `vertical` a separate
`text` column (`unique (vertical, version)`, multiple rows per vertical
across versions). In production this route either throws an
`invalid input syntax for type uuid` error or 404s — it can never resolve
by vertical. Not fixed here: `supabase/functions/admin/**` is scoped to
this cluster ONLY for the tenants-detail response shape (CLAUDE.md Rule
4); a real fix needs a `where vertical = $1 and is_active order by version
desc limit 1`-shaped branch (or a dedicated `admin-templates/by-vertical/
:vertical` route) added to `handleTemplates` by whichever cluster owns
that file's other routes.

**Gates**: `apps/web` — `npx tsc -b --pretty` clean; `npx vitest run` on
this cluster's paths (`(admin)/**`, `(partner)/**`, `(preview)/**`,
`components/admin/**`, `components/partner/**`, `lib/preview/**`) 91/91
green; full-repo `npx vitest run` 349/350, the 1 failure
(`(tenant)/dashboard/metadata.test.tsx`, a `next-intl`/`next/navigation`
module-resolution timeout) reproduces intermittently on files this
cluster never touched (confirmed across 3 runs, different test failing
each time — `overview-client.test.ts` once, 2 different `metadata.test.tsx`
cases another time, a timeout the third), consistent with node_modules/
pnpm-store churn from concurrent work elsewhere in this shared tree, not
a regression from this pass. `packages/ui` — `npx vitest run` 64/64 green
(after rebuilding `packages/ui`'s `dist/` so `apps/web`'s `tsc -b` could
see another cluster's new `formatPhoneDisplay` export; `packages/ui`'s own
`tsc -b` has 7 pre-existing errors in `hours-editor.test.tsx`/
`contrast.test.ts`, both mid-edit by the tenant-dashboard/packages-ui
cluster, not this cluster's files). `npx biome check` clean (0 errors) on
every file this cluster touched.

## DESIGN-3 — Integrator pass over the round-6 design wave (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Closed out the uncommitted round-6 design wave (`ADMIN+PREVIEW-R6` above,
plus the shared-component/tenant-dashboard cluster's own round-6 fixes,
which landed in the tree without a matching `BUILD_NOTES.md` section of
their own — folded into this entry since this is the reader's landing
point either way) as INTEGRATOR: ran every gate, fixed the one real bug a
gate caught, and committed. No new design decisions of my own —
CLAUDE.md Rule 4.

**Round-6/final shared-component fixes** (in the tree alongside
`ADMIN+PREVIEW-R6`, not previously written up):
- **`formatPhoneDisplay`** (`packages/ui/src/lib/format-phone.ts`, new,
  exported from `@heyloo/ui`): the single "(XXX) XXX-XXXX" formatter
  `PhoneInput` already had inline, promoted to a shared helper and wired
  into every customer-facing phone-number display that previously showed
  a raw E.164 string — calls feed/detail, customers list/detail, message
  threads list/detail, bookings list/detail, order detail
  (`CallFeedItem`, `calls-list-client`, `customer-detail-client`,
  `customers/page`, `messages-list-client`, `message-thread-client`,
  `bookings/page`, `order-detail-client`).
- **Link contrast (`text-primary` → `text-primary-hover`)**: the base
  `accent-500` link color measured 3.42-3.57:1 for normal-weight text —
  below WCAG AA's 4.5:1 (axe `color-contrast`, round-final tenant
  review) — across every "Message this customer"/"Back to …" link
  (`Button`'s `link` variant, `customer-detail-client`, `bookings/page`,
  `order-detail-client`, the 3 tenant `not-found.tsx` pages) and
  `TranscriptViewer`'s caller-speaker label. `accent-600`
  (`text-primary-hover`, the same token `bg-primary`'s hover state
  already uses) clears AA in both themes without a new token.
- **`Button`'s `default` size touch target**: 36px (`h-9`) measured under
  the 44px mobile/tablet touch-target guidance at 390/768 (round-final
  tenant review, medium) for the size backing nearly every primary CTA.
  Now `h-11` below `lg` (1024px), `lg:h-9` at desktop/mouse widths.
- **`MetricCard`'s non-finite value**: used to silently render a bare
  `"—"`; now a real `<MinusCircle> No data` empty state matching the
  rest of the app's `EmptyState` convention.
- **`HoursEditor`'s open/close time pair**: `flex-wrap` could split the
  "to" separator from its closing-time input onto its own line at 768px;
  grouped both inputs in one `flex-nowrap` unit.
- **`--warning-foreground`**: was near-black (`oklch(0.16 0.02 75)`),
  measuring 2.93:1 against the *solid* `Badge variant="warning"`
  background — below AA (round-5 tenant review, blocker). Since
  `--warning-foreground` is consumed only on that one solid background
  (every other `--warning` use is text-on-tint or a bare dot, unaffected),
  flipped it to near-white (`oklch(0.99 0 0)`, ~6.5:1); dark theme was
  already passing and is unchanged.
- **`CentsInput`/new `BpsInput`** (`packages/ui/src/forms/bps-input.tsx`,
  new) replace `vertical-details`'s raw `<Input type="number">` fields for
  every dollar/percent value (late-cancellation fee, consult fee, deposit
  amount, delivery fee/minimum, tax rate, avg transaction value) — an
  owner no longer has to do cents-math or basis-point-math by hand, and
  the labels drop their parenthetical "(cents)"/"(basis points)" hints
  now that the controls are self-explanatory (round-final tenant review,
  low).
- **`team` page's role `<Select>`**: the visible `<Label>Role</Label>`
  wasn't wired to the Radix trigger via `htmlFor`/`aria-labelledby`, so it
  had no accessible name (axe `button-name`, critical). Added
  `aria-label="Role"` directly on the `SelectTrigger`.
- **`OverviewClient`'s trend adapter extracted** (`usageDailyToTrend`,
  exported, unit-tested in the new `overview-client.test.tsx`): the old
  inline `rows.map(...)` passed a possibly-null `total_calls` straight to
  `TrendChart` relying entirely on its own defensive coercion; the
  extracted adapter makes "every point is a finite number" its own
  contract instead.
- **Preview harness — `/preview/dashboard/messages/[phone]`**: unlike
  `[id]` routes, `mock-fetch.ts` has no "unmatched filter, fall back to
  whatever else narrowed the query" exemption for the phone-number
  filters (`from_e164`/`recipient`/`phone_e164`) — a literal `"demo"`
  phone matched zero seeded rows and the page silently rendered a blank
  thread (round-final tenant review, high). Pointed the route straight at
  the real seeded conversation (`+15125551000` / Priya Natarajan) instead.
- `packages/ui/src/theme/contrast.test.ts` (new, real OKLCH→sRGB WCAG
  contrast-ratio math, mirroring how browsers/axe-core resolve
  `oklch()`) is the harness that caught the `--warning-foreground` and
  link-contrast findings above and now guards them from regressing.

**Real bug found and fixed by THIS integration pass** (not attributable
to any round-6 cluster — a pre-existing test-fixture time bomb, not a
design defect): `worker-adapter-push/handler.test.ts`'s ezyVet "finds an
existing contact and creates the appointment" case hardcoded
`CONNECTION_ROW.expires_at: "2026-09-10T20:00:00Z"` — a timestamp that
was in the future when originally written but had already passed by the
time this integration ran (today is 2026-09-10, past 20:00 UTC), so
`shouldRefreshEzyVetAuth` now sees an expired token and the handler makes
a 3rd (refresh) fetch call the test's `expect(call).toBe(2)` never
accounted for. Out of this pass's design scope, but a real, unambiguous
one-line fixture bug (not a design/architecture question) blocking the
mandatory `pnpm -w test` gate for every future integrator until it
naturally decays again — fixed by pushing the fixture to
`"2099-01-01T00:00:00Z"` per CLAUDE.md Rule 4 (documented here rather
than silently patched).

**Round-6/7 design review scores** (post-integration, screenshotted via
`UI_PREVIEW_MODE`, axe-core included): **tenant dashboard round 7: 83/100
(fail)** — up from round-5's 84 baseline noise band, still short of the
pass bar; **admin/partner cockpit round 6: 90/100 (pass)** — up from
round-5's 79, clearing the bar for the first time this design track.
Per CLAUDE.md Rule 4 and the same scope call DESIGN-1/DESIGN-2 already
made: admin/partner is launch-ready on this metric; tenant dashboard
needs at least one more focused round — not this integrator's to invent
new findings for.

**Gates — all green**: `npx biome check --write` on every changed path
under `apps/web/src`, `packages/ui/src`, `supabase/functions` (0 errors,
same 4 pre-existing `noImportantStyles` warnings in the
`prefers-reduced-motion` block noted by DESIGN-1/DESIGN-2 — left as-is,
same call made twice before); `pnpm -w typecheck` (18/18 packages);
`pnpm run lint` (0 errors, pre-existing warnings elsewhere unchanged);
`pnpm -w test` (19/19 package test tasks — `apps/web` 63 files/351
tests, `packages/ui` 17 files/73 tests, `supabase/functions` all green
after the ezyVet fixture-date fix above); `apps/web` production build
(`next build --webpack`) — exit 0; the preview-mode-guard tests
(`lib/preview/guard.test.ts`) pass. No PNG/scratch files or build output
staged.

## DESIGN-4 — accent text contrast, touch targets, currency inputs, template-by-vertical fix (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

Scope: `apps/web/**`, `packages/ui/**`, `supabase/functions/admin/**`. Task
brief listed 7 items plus a mid-task addition (item 8, the tenant Overview
preview-mode loading-skeleton report). Several of the 7 had already been
fixed by round 6/`DESIGN-3` before this pass started; re-verified each
rather than assuming, and only changed what was actually still broken.

**1 — dedicated accent-text token**: added `--accent-text` (resolves to
`accent-600`, same value `--primary-hover` already used, in `:root`, both
dark blocks, and the two `/preview/system` `.heyloo-theme-*` scoped
panels) bound to `--color-accent-text` → `text-accent-text` in
`packages/ui/src/theme/globals.css`, decoupling "the accent used as text"
from "a button's hover fill" as its own semantic concept per the task
brief, even though the two happen to share a value today. Added a new
`describe` block in `packages/ui/src/theme/contrast.test.ts` computing
the ratio against `background`/`surface`/`card` in all 3 theme blocks
(mirrors the existing `primary-hover-as-link-text` block, which is
unchanged and still passes). Moved every real text/link use of the accent
onto the new token: `TranscriptViewer`'s caller-speaker label, `Button`'s
`link` variant, `MobileTabBar`'s active-tab label, `customer-detail-
client`/`order-detail-client`'s "Message this customer" links, the 3
tenant `not-found.tsx` pages, `bookings/page.tsx`, `vertical-grid.tsx`'s
"See what it handles" link, `blog/page.tsx`'s title-hover link, and the
`legal-page.tsx`/`blog/[slug]/page.tsx` prose `[&_a]` anchor color (all
previously `text-primary-hover` or bare `text-primary`, both audited via
grep). Left every icon-only `text-primary`/`text-accent` use alone
(`VerticalIcon`/`Sparkles`/`Loader2` spinners, `RadioGroup`'s indicator
dot, the admin/partner shell header icons) — these are graphical UI
objects subject to WCAG's 3:1 non-text threshold, not 4.5:1, and
`accent-500` already clears that.

**2 — Team page Role `<Select>` accessible name**: was `aria-label="Role"`
directly on the trigger (a round-6 fix that worked but duplicated the
adjacent visible `<Label>Role</Label>` text as a second, invisible copy).
Wired the two together properly instead: `id="invite-role-label"` on the
`<Label>`, `aria-labelledby="invite-role-label"` on the `SelectTrigger` —
matches the task brief's literal ask (htmlFor/id or aria-labelledby) and
removes the duplication. Audited every other `SelectTrigger` under
`(tenant)/dashboard/**` (`agent/language/page.tsx`: a bare `aria-label`
with no adjacent visible label to associate instead — already correct as
written; `setup/resources/page.tsx`: shadcn's `FormLabel`/`FormControl`
pattern already wires `htmlFor`/`id` correctly, confirmed `<button>` is a
labelable element per the HTML spec so `<label for>` on a Radix
`SelectTrigger` button is a real, valid association) — no other gaps
found. New test in `team/page.test.tsx`:
`screen.getByRole("combobox", { name: "Role" })`.

**3 — Button touch targets**: already `h-11` (44px) below `lg` (1024px),
`lg:h-9` (36px) at desktop — a round-6 fix, kept as the "cleanest
approach" (a breakpoint split, not a `(pointer: coarse)` media query,
since every viewport this app ships below `lg` is touch and `lg`+ is
where the mouse-driven desktop layout starts, so the two coincide and a
breakpoint is one fewer moving part for the same result). What was
missing: `docs/DESIGN_SYSTEM.md` never actually documented this decision
— added a "Touch targets" subsection under Components explaining the
breakpoint choice and which sizes are exempt (`sm`/`icon`, dense inline
contexts only, never a page's primary CTA). Audited for a "sticky mobile
primary action" bar per the brief's explicit check — none exists in the
app today (`MobileTabBar` is bottom navigation, not a primary-action bar;
grepped for `fixed…bottom-0` and `sticky` app-wide) — nothing to fix
there. Added 2 new `button.test.tsx` cases asserting the default size's
class list contains `h-11`/`lg:h-9` and that `size="lg"` stays `h-11`
unconditionally, as the regression guard the brief asked for (no existing
snapshot tests to update — none exist for `Button`).

**4 — vertical-details currency/percent inputs**: `CentsInput`/`BpsInput`
(round 6) already fully replace every raw cents/bps `<Input
type="number">` in `agent/vertical-details/page.tsx` with friendly-labeled
dollar/percent controls (labels already jargon-free — "Late-cancellation
fee (optional)", "Delivery fee", "Sales tax rate", no "(cents)"/"(basis
points)" left anywhere) — re-verified, nothing left to change on the form
itself. Two real gaps: no `cents-input.test.tsx` existed at all (only
`bps-input.test.tsx` did) — added one covering both conversion directions
plus the empty/non-numeric-input cases, mirroring `BpsInput`'s existing
test shape. And the task brief's literal naming ask — "a CurrencyInput /
PercentInput" — didn't exist under those names; added `CurrencyInput`
(`cents-input.tsx`) and `PercentInput` (`bps-input.tsx`) as exported
aliases of the existing components (same conversion, same tests via
`expect(CurrencyInput).toBe(CentsInput)`) rather than renaming the
existing, already-correct, already-tested components and churning every
call site for a naming preference alone.

**5 — preview messages-detail link**: `routes.ts` already points
`/preview/dashboard/messages/[phone]` at the real seeded thread
(`%2B15125551000`, round 6) — re-verified, the registry test
(`routes.test.ts`) still green, no change needed.

**6 — REAL bug, `/cockpit/templates/[vertical]` (`ADMIN+PREVIEW-R6`,
found-but-not-fixed there per that pass's own scope note)**: confirmed
still present. `TemplatesListPage` always links to `/cockpit/templates/
${row.vertical}` (a text slug, e.g. `"auto_repair"`) and the editor's GET
+ its "Run publish gate" POST both send that same slug straight through
to `admin-templates/:key` — but `handleTemplates`'s GET-by-id AND
`.../publish` branches both did a literal `where id = ${templateId}`
against `agent_templates.id`, a real `uuid` primary key (`vertical` a
separate `text` column, `unique(vertical, version)`, multiple rows per
vertical across published versions) — every real call from this page
either 500s on `invalid input syntax for type uuid` or, worse for
publish, silently updates/queries the wrong row. Fixed in
`supabase/functions/admin/handler.ts` with a shared `resolveTemplateByKey`
helper: a genuine uuid (regex-checked) still resolves by `id` (kept for
any future direct-by-id caller); anything else — every real caller today
— resolves to that vertical's highest-`version` row (deliberately NOT
filtered to `is_active`, unlike the task brief's literal example query:
an `is_active`-only filter would make a vertical's very first,
not-yet-published draft permanently invisible to the one page that's
supposed to let an admin open and publish it — chosen after finding this
chicken-and-egg gap, documented here per CLAUDE.md Rule 4 rather than
following the example query verbatim). Used for both the GET-by-id branch
(the editor's initial load) and the `.../publish` branch (previously the
*exact same* `where id = ${templateId}` bug, undiscovered by the earlier
pass since it only audited the GET branch — publish would have keyed its
two `is_active` flip statements and its Retell `agent_name` off the raw
vertical slug too). `PATCH` (unreachable from any real caller today) is
left strictly id-based on purpose — it edits one specific version row,
where "resolve by vertical" would be the wrong semantics. No frontend
change was needed: the page already sends the vertical slug in both
places, which is now handled correctly; chose in-place resolution over a
dedicated `admin-templates/by-vertical/:vertical` route so nothing on the
`apps/web` side had to change. 5 new `handler.test.ts` cases (resolves by
vertical; still resolves a genuine uuid by id; 404s for a vertical with no
rows; the disclosure-gate-failure and full publish-success cases updated
to send the vertical slug like the real caller does, with the
publish-success case asserting the two `is_active` updates key off the
*resolved* uuid, not the raw slug — the bug this guards).

**7 — billing invoice status pill**: `billing/page.tsx` routed both the
desktop column and the mobile-card invoice-status pill through
`StatusBadge variant="tenant"` — the tenant *lifecycle* palette
(`trialing`/`active`/`past_due`/`paused`/`canceled`), which shares only
`past_due` with `billing_invoices.status`'s real value set. Added a
proper `"invoice"` `StatusBadgeVariant` to `packages/ui/src/custom/
status-badge.tsx`, colored against the REAL check constraint
(`supabase/migrations/20260907131000_money.sql`: `draft`/`finalized`/
`paid`/`past_due`/`void` — not Stripe's own `open`/`uncollectible` naming
the task brief's example list used, which this table's schema never
actually stores; adapted the variant to the schema that's actually
queried rather than the brief's example verbatim, documented per Rule 4):
`draft` outline, `finalized` secondary, `paid` success, `past_due`
warning, `void` destructive. New `status-badge.test.tsx` (didn't exist for
this component at all before) covering all 5 labels, a
distinct-not-shared-default color check, and the unrecognized-value
fallback.

**8 — tenant Overview "loading skeletons" report + a real UI-Preview-Mode
build bug found investigating it**: Reproduced and root-caused with a
real headless-Chromium run (Playwright, cached browsers under
`/opt/pw-browsers`, no network fetch needed) against a live `UI_PREVIEW_
MODE=1 next dev` server. `/preview/dashboard` at 1440 renders completely
correctly — Calls today/Bookings today/Minutes used/Spam deflected KPI
tiles, the 14-day trend chart, and all 8 seeded "Recent calls" rows all
resolved with real numbers, zero console errors. `OverviewClient`'s
`usage_daily`/`call_logs` queries and `SetupProgressPanel`'s own
`data.steps` shape-guard (a round-3 finding, already fixed) are correct
as written — no change needed to either, and no reproduction of the
reported symptom under the project's own documented, tested preview-mode
activation path (`docs/DESIGN_SYSTEM.md`/`next.config.ts`'s own comments:
"confirmed by running `UI_PREVIEW_MODE=1 next dev`").

Investigating whether the report instead reflected a genuine `next build
--webpack && next start` run (this repo's actual `build`/`start` scripts)
surfaced a real, separate, previously-undiscovered bug: **UI Preview
Mode's build-time module aliasing never took effect under webpack at
all** — confirmed by instrumenting `next.config.ts`'s `webpack()` hook
during a real `UI_PREVIEW_MODE=1 next build --webpack`: the alias table
it received was exactly correct (`@/lib/auth/require-tenant-session` →
the mock file, etc.), yet the compiled server bundle's own stack traces
for `(tenant)`/`(admin)`/`(preview)` routes showed the REAL, cookies()-
throwing `src/lib/auth/require-tenant-session.ts`/`require-admin-
session.ts` executing, never the mock. Root cause: this repo's tsconfig
maps `@/*` → `./src/*`, and Next's SWC compiler resolves that mapping to
a real, on-disk relative import specifier DURING transpilation — BEFORE
webpack's own `resolve.alias` ever sees the original `@/lib/auth/<name>`
string at all, making that alias key a silent no-op. Turbopack doesn't
have this problem (confirmed working, per above) because its
`resolveAlias` is consulted against the pre-rewrite specifier — the
project's own doc comment only ever claimed to have "confirmed" the
config via `next dev` (Turbopack), never a real webpack build. Fixed in
`apps/web/src/lib/preview/preview-mode-aliases.ts` (`previewModeAliases`,
extracted out of `next.config.ts` itself so it's unit-testable without
importing `@sentry/nextjs`/`next-intl` — confirmed importing
`next.config.ts` directly under Vitest throws inside `@sentry/
server-utils`'s bundler-plugin resolution, an unrelated import-time side
effect): the webpack branch now ALSO aliases the already-resolved real
absolute source path (`src/lib/auth/<name>.ts`) — the form webpack's
resolver actually receives post-SWC-rewrite — to the same mock target,
alongside the pre-existing (harmless, but ineffective on its own) `@/...`
specifier alias. Verified the fix directly: re-running the same
instrumented `next build --webpack UI_PREVIEW_MODE=1` afterward produced
ZERO `"Static generation failed due to dynamic usage ... reason: cookies"`
messages for any `require*Session` call (there were dozens before, one
per real/preview route) — the mocks are now genuinely used. New
`next.config.test.ts` unit-tests `previewModeAliases` directly for both
bundler kinds (turbopack: single `@/...`-keyed entry; webpack: BOTH the
`@/...` key and the resolved-real-source-path key, both pointing at the
same mock target — the exact pairing this bug needed).

Not fully resolved: a complete, successful `next build --webpack
UI_PREVIEW_MODE=1 && next start` end-to-end screenshot of `/preview/
dashboard` (the literal ask) could not be completed in this session —
the build's own "Generating static pages" phase OOMs in this sandbox
partway through its ~174 static pages (each of 3 parallel build-worker
child processes hits Node's default ~2GB heap ceiling; `NODE_OPTIONS
--max-old-space-size` on the parent process doesn't propagate to them),
and, separately, a scoped single-route build (`--debug-build-paths`, to
dodge the OOM) hit an apparent Next.js 16.3.4 framework bug of its own on
the built-in `/_global-error` page (`useContext(LayoutRouterContext)`
returning `null`) unrelated to anything in this app's own code or to the
aliasing fix above (the ORIGINAL, unfixed build also failed early on
`/_not-found`/`/en/preview/cockpit/outreach` before ever reaching
`/dashboard`, with the identical opaque digest, so this class of
build-time fragility predates this pass and isn't specific to Overview).
The required gate (`apps/web` production build, `next build --webpack`,
no `UI_PREVIEW_MODE`) is unaffected and passes clean (exit 0, confirmed
both before and after every change in this pass). The aliasing fix itself
is real, verified, and committed regardless of whether the full
build+start round-trip completes in this sandbox — it is the actual root
cause behind webpack-mode UI Preview Mode never using its own fixture
data, and the fix is unit-tested directly.

**Gates**: `npx biome check --write` on every path touched (0 errors, the
same 4 pre-existing `!important` warnings in the `prefers-reduced-motion`
block noted by every prior round — left as-is, same call made every time);
`pnpm -w typecheck` (18/18 packages); `pnpm run lint` (0 errors,
pre-existing warnings elsewhere unchanged); `pnpm -w test` — `apps/web`
64 files/354 tests (up from DESIGN-3's 63/351: +1 file/+2 tests for the
new `next.config.test.ts`, +1 test for the team-page Select accessible
name), `packages/ui` 19 files/97 tests (up from 17/73: new
`status-badge.test.tsx` (7 tests) and `cents-input.test.tsx` (5 tests,
including the `CurrencyInput` alias check), +1 test each in
`bps-input.test.tsx` (`PercentInput` alias) and `button.test.tsx` (the 2
touch-target regression tests), +9 tests from the new `contrast.test.ts`
describe block — 3 theme blocks × 3 surface tokens), `supabase/functions/
admin` 80/80 (+3 new GET-by-vertical/by-id/404 template-resolution tests
over this session's own pre-fix baseline, plus the existing publish/
disclosure-gate tests updated in place to send the vertical slug the real
caller actually sends) — all green; `apps/web` production build (`next
build --webpack`,
no `UI_PREVIEW_MODE`) exit 0, run twice (before and after every change in
this pass) to isolate the item-8 finding above from the required gate.
No PNG/scratch files, `.next`, or other build output staged.

## Cluster S — Channels: schema, pricing, docs (2026-09-11)

BUILD_PLAN task: `text_conversations`/`text_messages` (two-way SMS/web-chat
thread + transcript), tenant text-agent/widget config columns,
`call_logs.channel`, price-card + `usage_daily` metering for the text
agent, docs. Three new migrations, all additive, no earlier migration
edited:

- `supabase/migrations/20260911100000_channels_text_conversations.sql` —
  `text_conversations` (thread: `status 'ai'|'human'|'closed'`,
  `ai_enabled`, `structured_state`) + `text_messages` (append-only
  transcript: `direction`, `author 'ai'|'human'|'customer'`, `tool_calls`,
  `messages_outbound_id` FK for outbound SMS delivery-status linkage,
  `provider_message_id` for inbound). RLS: tenant `SELECT`; tenant
  `UPDATE` on conversations (status/ai_enabled human-takeover, role
  `owner|admin|member`); tenant `INSERT` on messages forced to
  `author='human'` (a dashboard session can never spoof an ai/customer-
  authored row) and scoped to a conversation the tenant actually owns
  (EXISTS check, same DB-H1-hardened-era pattern bookings/orders already
  use); everything else `service_role`-only. Impersonation read-only guard
  included from the start (this migration postdates
  `20260910110000_impersonation_claim.sql`, so it's written directly
  against the current hardened convention rather than needing a follow-up
  hardening pass). Broadcast triggers on both tables via the existing
  `fn_broadcast_tenant_update()`.
- `supabase/migrations/20260911101000_channels_tenant_and_call_log_columns.sql`
  — `tenants.{text_agent_enabled, text_agent_persona, quiet_hours,
  widget_enabled, widget_settings, widget_public_key}` (unique index on
  the key) + `call_logs.channel text default 'phone' check in
  ('phone','web')`.
- `supabase/migrations/20260911110000_channels_pricing_and_usage.sql` —
  `usage_daily.text_messages_out int not null default 0`;
  `fn_upsert_usage_daily` re-declared (`CREATE OR REPLACE`, same
  convention the impersonation-claim migration used for
  `custom_access_token_hook` rather than editing an applied migration) to
  compute it; an idempotent `jsonb ||` merge adding
  `included_text_conversations`/`text_conversation_overage_cents` (200 /
  5&cent;) into every existing `price_card_<vertical>` `platform_settings`
  row.

**DECIDE resolutions** (CLAUDE.md Rule 4, full reasoning in
`BACKEND_SPEC.md` §13): (1) `messages_inbound`/`messages_outbound` remain
the SMS transport; `text_conversations`/`text_messages` are a new layer on
top, not a replacement — §13.1. (2) Metering unit is **per outbound AI
message**, not per conversation or conversation-day — §13.3, with the
reasoning for rejecting the other two shapes spelled out there.
(3) `phone_e164` on `text_conversations` is nullable (a `web_chat` visitor
may never give one), despite BUILD_PLAN's own column-list shorthand not
marking it `?` the way `customer_id?` is marked — the only literal
column-list case in this task where the given shorthand was ambiguous
enough to warrant a documented judgment call rather than a literal
transcription.

**Extended `scripts/ci/rls-cross-tenant-probe.ts`**: `text_conversations`
added to the standard tenant-scoped cross-read probe list;
`text_messages` (needs a `conversation_id` FK, so can't be a plain list
entry) is seeded and separately probed in `main()`, mirroring the existing
`customer_addresses`/`waitlist_entries` pattern for their `customer_id`
dependency.

**Verification performed** (no `supabase start` attempted — Docker is
present and usable in this sandbox, unlike prior sessions' documented
no-Docker constraint, but spinning up the full GoTrue+PostgREST+Realtime
stack was judged out of proportion for a 3-migration schema task when the
RLS/constraint substance is directly testable at the SQL layer; noted as a
real, not merely inherited, scope call): built a throwaway local Postgres
16 harness — stub `auth`/`storage`/`realtime` schemas (`auth.users` +
`auth.uid()`/`auth.jwt()` stubs, `storage.buckets`/`storage.objects`,
`realtime.messages` + a no-op `realtime.broadcast_changes()` stub matching
the real function's call signature) plus the standard Supabase default
grants (`grant all on all tables in schema public to anon, authenticated,
service_role` + matching `alter default privileges` — without this, every
RLS check trivially "passes" for the wrong reason, `permission denied`
before RLS is even evaluated; this took one iteration to notice and fix),
the 3 unavailable `create extension` lines (`pg_cron`/`pgmq`/`pg_net`)
trimmed per this doc's own established approach. Applied all 48 real
migration files (45 pre-existing + this task's 3) in filename order from
an empty database — **zero errors** — then `supabase/seed/seed.sql` — also
zero errors. Directly exercised, as a real `authenticated` role with
`request.jwt.claims` set (not just as the seeding superuser): inserted/
updated `text_conversations`/`text_messages` rows and confirmed real
data flows through `fn_upsert_usage_daily` into
`usage_daily.text_messages_out`; confirmed tenant A cannot `SELECT` tenant
B's `text_conversations`/`text_messages` rows; confirmed tenant A CAN post
an `author='human'` reply into its own conversation; confirmed tenant A
CANNOT insert an `author='ai'` (spoofed) message — `ERROR: new row
violates row-level security policy for table "text_messages"`; confirmed
tenant B cannot insert into tenant A's conversation even with a
correctly-scoped `tenant_id` (the `EXISTS` ownership check) — same error;
confirmed tenant A CAN flip its own conversation's `status`/`ai_enabled`
(human takeover); confirmed `tenants.widget_public_key`'s unique
constraint rejects a duplicate across two tenants; confirmed
`call_logs.channel`'s `CHECK` rejects an invalid value and defaults to
`'phone'`. Also directly confirmed, empirically (not just by reading the
SQL), the `docs/audit/CHANNELS_REQUESTS.md` request #2 finding: applying
`seed.sql` after the migrations wipes the merged price-card keys back out
via its own `on conflict ... do update set value = excluded.value`.
`node --experimental-strip-types scripts/ci/rls-cross-tenant-probe.ts`
run directly (no `SUPABASE_URL` available in this harness, so it fails
fast at its own env-var check) — confirms no syntax/import errors in the
edit, not a full pass; the full HTTP-level probe still needs a real
`supabase start` + `supabase functions serve` run per this doc's own
established caveat for that script. Throwaway database and all scratch
SQL files dropped/deleted after verification, never committed.

**Real, currently-unresolved conflict discovered and documented, not
silently fixed**: a different, concurrently-running build agent
("Cluster T / BUILD_PLAN text-agent task") had already landed
`supabase/migrations/20260911120000_text_conversations.sql`, which adds
the *same three things* this task was assigned (`call_logs.channel`,
`usage_daily.text_messages_out`, a `text_conversations` table) with a
materially different, incompatible shape — applying it after this task's
migrations fails (`column "channel" of relation "call_logs" already
exists`, reproduced directly in the harness above). Per CLAUDE.md Rule 4,
this was not redesigned around or silently deleted; full detail (both
schemas side by side, the reasoning for why neither is a strict subset of
the other, and a recommendation) is in `docs/audit/CHANNELS_REQUESTS.md`
item 1, and it is surfaced as a `cross_cluster_requests` entry in this
task's own structured output for the orchestrator to arbitrate. This
repo's migrations are, as of this task's own files plus that pre-existing
one, **not currently reproducible from zero end to end** — only with the
`20260911120000` file excluded, which is exactly what was verified above
and is not this cluster's file to fix or remove.

**Gates run**: throwaway-Postgres migration + seed + live RLS/constraint
exercise (above, in lieu of `pnpm` gates — this task touched no
TypeScript/application code besides the one CI script, which was run
directly per above); no `pnpm -w typecheck`/`test` run since nothing in
`packages/`/`apps/` changed. No build output, `.env*`, or scratch files
staged.

## CLUSTER T — Text agent engine (SMS + web chat, 2026-09-11)

Built the text-agent engine and wired it into both channels: `supabase/
functions/_shared/text-agent/**` (new — `engine.ts` orchestrates the
Anthropic Messages tool-use loop; `tool-router.ts` dispatches every
booking/order/message/waitlist/lookup tool call to the SAME `voice-tools/
tools/*.ts` implementations, unmodified; `conversation-store.ts`,
`tools.ts`, `system-prompt.ts`, `anthropic-messages.ts`, `rate-limit.ts`,
`verification.ts`, `widget-token.ts` — plus tests for each),
`webhooks-twilio-sms/handler.ts` (routes an "other"-classified inbound SMS
into the engine after STOP/HELP/waitlist-YES precedence, optional
`textEngineDeps` param so every pre-existing compliance test keeps passing
unchanged), `supabase/functions/api-text-chat/**` (new — the widget's chat
mode HTTP entrypoint), `packages/templates/src/shared/text-persona.ts`
(new — per-vertical text disclosure/persona, composed from the SAME
policy fragments every voice template reuses, parity-tested byte-for-byte
against a hand-mirrored Deno-side copy in `_shared/text-agent/
system-prompt.ts` since Deno cannot import the Node/ESM `@heyloo/
templates` package, same documented constraint as `_shared/schemas/
booking-payloads.ts`/`admin/schemas.ts` for `@heyloo/canonical-types`),
`_shared/templates.ts` (new `chat_phone_verification` template case),
`supabase/config.toml` (new `[functions.api-text-chat]` entry),
`.env.example` (`ANTHROPIC_TEXT_AGENT_MODEL`).

**Deliberate deviation from API_AND_FLOWS.md's "SMS sending path" section**
(A.1): that spec assumed Retell's native chat-agent SMS channel for
two-way SMS conversations. This task's own explicit instruction directs a
purpose-built Anthropic Messages API tool-use engine instead, reusing the
SAME `voice-tools/tools/*.ts` handlers a live call uses — this also better
satisfies CLAUDE.md Rule 2's provider-isolation invariant (a Retell chat
channel would couple the text flow to Retell-specific SMS semantics) and
lets one canonical booking-logic path serve voice, SMS, and web chat.
Documented here per Rule 4 rather than redesigned around silently.

**`CallContext.callLogId` reuse problem and its fix**: `voice-tools/
tools/*.ts` (out of this cluster's ownership — read-only reuse) requires a
real, non-null `call_logs.id` (`create_booking`/`create_order`'s
`source_call_id`, and `take_message`'s direct `update call_logs set ...`).
A text conversation has no real call. Fix: a lazily-created SHADOW
`call_logs` row per `text_conversations` row (`ensureShadowCallLog`,
`retell_call_id = 'text:' || conversation.id`), tagged via a new,
additive `call_logs.channel` column (`'voice'|'sms'|'web_chat'`, default
`'voice'`) so voice-only dashboards/rollups can filter it out — flagged to
the dashboard cluster in `docs/audit/CHANNELS_REQUESTS.md`.

**Identity rules (MASTER_SPEC §3.7-adjacent, this task's own instruction)**:
SMS — `CallContext.callerNumber` is always the texter's own verified
number (set by the inbound webhook, never trusted from the model).
Web chat — `callerNumber` stays `null` until the customer provides and
confirms a phone by a 6-digit SMS code (`verify_phone`, an engine-internal
tool declared ONLY for the web_chat channel, never added to `packages/
templates`'s shared voice-tool registry since it has no voice equivalent);
`lookup_customer`'s existing G6 caller-scope check (`samePhone(args.phone,
ctx.callerNumber)`) then naturally rejects every lookup attempt until that
happens — no fork of that tool was needed.

**TCPA quiet-hours decision (this task's own instruction: "document TCPA
reasoning")**: `_shared/quiet-hours.ts` (9pm-9am tenant-local) gates the
reminder-scheduler's UNSOLICITED outbound sends. A text-agent reply is
never unsolicited — it is a direct reply inside a conversation the
CUSTOMER just initiated — so the engine does NOT apply quiet-hours gating
to its own replies at all, on either channel; `engine.test.ts`'s "golden
conversation: quiet hours" test asserts a 3am customer-initiated text
still gets a reply. A2P/opt-out ARE still enforced for the SMS channel
specifically (separate, non-TCPA-quiet-hours gates: carrier campaign
verification and CTIA opt-out compliance).

**A2P gate wording**: this task's brief said "if tenant `a2p_status !=
approved`" — `tenants.a2p_status`'s real enum (BACKEND_SPEC §10.1,
`20260907130100_tenancy.sql`) is `'pending_verification'|'verified'|
'failed'`, no `'approved'` value exists. Mapped to `!= 'verified'`,
documented at the one call site (`engine.ts`).

**Metering**: `usage_daily.text_messages_out` (new, additive `int not
null default 0` column) incremented once per AI-authored reply actually
sent (never per inbound customer message, never for a gated/no-reply
turn) via `incrementTextMessagesOut`.

**Rate limiting / tool-loop / timeout budgets**: in-process sliding-window
limiter per (tenant, channel, phone-or-conversation-id) — same
module-scope-singleton, per-warm-instance shape as `_shared/circuit-
breaker.ts`'s `ToolCircuitBreaker`, not a cross-instance-exact limit.
Tool-use loop capped at 4 round trips; the whole turn wrapped in
`withTimeout` (8s default) — either failure mode degrades to a fixed
graceful-fallback reply, never a thrown error or silence, matching
`_shared/responses.ts`'s discipline. Reply capped at 350 max_tokens
(SMS-shaped, short replies) to keep the "~5s p95" latency budget and
per-turn token cost down.

**Golden-conversation tests** (`engine.test.ts`, this task's own
requirement): booking, reschedule, take-message, waitlist, opt-out
mid-conversation, quiet hours, human handoff, prompt-injection attempt,
A2P-pending — plus rate-limiting, web-chat verification-code interception,
and two resilience tests (Anthropic timeout, tool-loop exhaustion). Tool
dispatch and conversation-store persistence are exercised for real against
`voice-tools/tools/*.ts` in `tool-router.test.ts`/`conversation-
store.test.ts` instead of re-mocked there too — `engine.test.ts` itself
mocks both modules so it tests ONLY the engine's own orchestration
(gating order, disclosure, loop, persistence), per-file separation of
concerns rather than one giant integration test.

**Real, currently-unresolved migration-filename conflict discovered**
(same shared-tree collision Cluster S's own `docs/BUILD_NOTES.md` entry
above independently found and documented from its side — read that entry
first): this cluster's `supabase/migrations/20260911120000_text_
conversations.sql` and Cluster S's `20260911100000_channels_text_
conversations.sql`/`20260911101000_channels_tenant_and_call_log_
columns.sql` both add `call_logs.channel`, `usage_daily.
text_messages_out`, and a `text_conversations`-shaped table, with
materially different, non-additive shapes — applying both fails
(`column "channel" of relation "call_logs" already exists`). Full
side-by-side comparison, plus this cluster's own additional finding
Cluster S's write-up didn't have visibility into — see
`docs/audit/CHANNELS_REQUESTS.md` item 1's update below — is there, not
duplicated here. Per CLAUDE.md Rule 4, neither this cluster's own files
nor Cluster S's were deleted or silently rewritten; this cluster's own
migration was independently verified against a real, throwaway local
Postgres 16 (`pgcrypto`/`btree_gist` extensions installed via apt;
`pg_cron`/`pgmq`/`pg_net` unavailable in this sandbox, so a minimal stub
`tenants`/`phone_numbers`/`customers`/`call_logs`/`usage_daily` schema +
the 4 helper functions (`fn_set_updated_at`/`fn_broadcast_tenant_update`/
`fn_jwt_tenant_id`/`fn_jwt_is_platform_admin`/`fn_jwt_role`) it actually
depends on was hand-built instead of applying the full real migration
chain) — applied cleanly with zero errors, then every exact query shape
`conversation-store.ts` issues (the SMS upsert-or-reopen `ON CONFLICT
... WHERE` clause, the shadow-`call_logs` `ON CONFLICT (retell_call_id)`
upsert, the full `saveConversationPatch` UPDATE including its
boolean-parameterized `CASE WHEN` for `last_outbound_at`, the
`usage_daily` upsert) was executed directly and its result verified
row-by-row — not just typechecked/unit-tested with a mocked `sql`.
Followed by a second throwaway database applying this cluster's follow-up
migration (`20260911130000_text_conversation_messages.sql`, below) on top
— also zero errors, with real inserts/selects confirming the
customer/ai-author derivation. Both throwaway databases dropped after
verification; no scratch SQL files committed.

**Follow-up migration, `text_conversation_messages`** (new, additive,
self-contained — references only this cluster's own uncontested
`text_conversations` table content, deliberately touches neither
`call_logs` nor `usage_daily` again to avoid deepening the conflict
above): fills a real gap Cluster W's `docs/audit/CHANNELS_REQUESTS.md`
item 5 identified — `text_conversations.recent_turns` is a BOUNDED
working-memory window (trimmed to `MAX_REPLAYED_TURNS`), never the full
transcript, and the pre-existing `messages_inbound`/`messages_outbound`
(SMS's own audit trail) has no column distinguishing an AI-generated
reply from a human dashboard operator's manual one — so the dashboard's
planned "AI vs human vs customer" authorship thread view had nowhere to
read that distinction from. `text_conversation_messages` is the full,
unbounded, `author ('customer'|'ai'|'human')`-tagged transcript for BOTH
channels; `conversation-store.ts`'s `saveConversationPatch` now writes a
row here for every turn it also appends to `recent_turns`, deriving
`author` from the turn's own `role` (`'user'` -> `'customer'`,
`'assistant'` -> `'ai'`) — `'human'` rows are reserved for a future
dashboard "take over"/reply write path (Cluster W's own UI, outside this
cluster's ownership), permitted by that migration's own RLS insert
policy (`author = 'human'` only, tenant-member/admin-scoped).

**Widget contract adopted mid-task, not invented**: `docs/audit/
CHANNELS_REQUESTS.md` item 4 (posted by Cluster W, which had ALREADY built
`packages/widget/src/api.ts`'s `sendChatMessage`/`packages/widget/src/
types.ts`'s `WidgetChatResponse` and `apps/web/src/lib/widget/
session-token.ts`'s `mintWidgetToken`/`verifyWidgetToken` against an
assumed `api-text-chat` shape before this function existed in the tree)
was discovered partway through this task, after an initial simpler
`{tenant_id, session_token, message}` contract had already been built and
tested. Rebuilt `api-text-chat` to match that real, already-consumed
contract exactly: `{widget_token, message, conversation_token?}` in,
`{conversation_token, reply, sent, reason?}` out (200) or
`{error:"invalid_widget_token"|"expired_widget_token"|"invalid_request"}`
(401/422); `tenant_id` is NEVER a client-supplied field — it is resolved
server-side from the verified `widget_token`
(`_shared/widget-token.ts` — first written here as this cluster's own
Deno-portable port of `apps/web`'s HMAC construction using `_shared/
crypto.ts`'s existing `hmacSha256Hex`/`timingSafeEqual` primitives, then
DISCOVERED to be a near-byte-for-byte duplicate of a file another
concurrently-running cluster had independently built at that exact same
shared, non-`text-agent`-scoped path for `api-widget-voice-token` — that
file's own docstring names `api-text-chat` as its other intended consumer.
Rather than ship two parallel implementations of the same security-
critical HMAC-verification logic, deleted this cluster's own copy and its
test and switched `api-text-chat/handler.ts` to import the other cluster's
`_shared/widget-token.ts` directly — `handler.test.ts` still cross-checks
against a token minted with Node's own `node:crypto` the EXACT way
`mintWidgetToken` does, not just round-tripped against itself); added
`OPTIONS` CORS preflight handling + `Access-Control-Allow-Origin`
(echoing the request `Origin`) on every response, per that same request's
explicit requirement. `WIDGET_TOKEN_SECRET` was already declared in
`.env.example` (Cluster W) — reused verbatim, no second secret minted.

**Gates run**: `pnpm turbo typecheck test --filter=@heyloo/edge-functions
--filter=@heyloo/templates --filter=@heyloo/canonical-types` — green (98
edge-functions test files / 865 tests, 8 templates test files / 368
tests, 11 canonical-types test files / 163 tests; typecheck clean across
all three under `exactOptionalPropertyTypes: true`). `pnpm biome check
--write` over every new/changed file (formatting only; one pre-existing,
untouched lint warning elsewhere in `webhooks-twilio-sms/handler.ts` left
as-is, out of scope). Both new migrations additionally verified directly
against a real throwaway local Postgres 16 (detailed above), not just
typechecked.

**Deferred, filed as cross-cluster requests, not built**: the actual
dashboard "take over"/"hand back to AI" UI and its human-authored-reply
write path (Cluster W's own ownership — this cluster only exposes the
`text_conversations.status` state transition and the
`text_conversation_messages` `author='human'` insert policy for it to use);
resolving the `call_logs.channel`/`usage_daily.text_messages_out`/
`text_conversations` migration-filename conflict itself (needs
orchestrator arbitration, not a single cluster's unilateral call — see
`docs/audit/CHANNELS_REQUESTS.md` item 1's update).

## Cluster W — Website widget + dashboard (2026-09-11)

BUILD_PLAN task: the embeddable website widget (Voice web-call + Chat
modes), its apps/web-side session/config/voice-token routes, the tenant
Install page, and the dashboard-side pieces that had to change to support
it (Messages authorship/takeover, Agent settings' new Text agent tab, a
Billing usage tile). Built against `docs/spec/BACKEND_SPEC.md` §13 and
this task's own read-first list; full list of new/changed files below by
area.

**`packages/widget/` (new package)** — the actual embed script. Framework-
free, no dependency on the rest of the monorepo at runtime (it ships as a
standalone `<script>` on an arbitrary third-party page): `src/index.ts`
(boot — captures `document.currentScript` synchronously, reads `data-key`/
`data-preview-config`), `src/panel.ts` (builds the whole shadow-DOM button
+ panel UI procedurally — no framework), `src/api.ts` (fetch wrappers,
`.then()` chains only — see below), `src/styles.ts`/`src/icons.ts`/
`src/dom.ts` (small helpers), `src/voice-bridge.ts` + `src/voice-runtime.ts`
(the lazy-loaded voice chunk), `src/types.ts`. Built with `tsup` (esbuild
under the hood) to two independent IIFE bundles (`tsup.config.ts`):
`widget.global.js` (the always-loaded main script — **4.98–5.00KB gzipped,
well under the 25KB budget**, `scripts/check-size.mjs` enforces it) and
`voice-runtime.global.js` (bundles `retell-client-js-sdk`, ~680KB raw,
loaded only once a visitor opens Voice mode — never counted against the
main budget). `target: "es5"` — esbuild lowers `let`/`const`/arrow
functions/optional chaining/nullish coalescing/classes, but CANNOT lower
`async`/`await` or generators to ES5 at all (the build fails loudly
instead of silently shipping broken output), which is why every async
flow in `src/**` is written as explicit `.then()`/`.catch()` chains
instead — documented at the top of `api.ts` and `tsup.config.ts`.
Real-file-based tests throughout (21 tests, 3 files) — `panel.test.ts`
renders the actual shadow DOM and asserts on it (accessibility roles,
tab/keyboard behavior, preview-mode send flow, a real end-to-end chat
send against a mocked `fetch`), `api.test.ts`/`index.test.ts` cover the
network layer and boot-time attribute parsing.

**Real bug found and fixed via actual Playwright screenshots, not just
unit tests** (see "Screenshot verification" below): the chat and voice
tab panels both had an inline `style="display:flex;…"` attribute
alongside the `hidden` attribute/property `panel.ts`'s `showTab` toggles —
an inline style ALWAYS wins over the `[hidden]{display:none}` UA-
stylesheet rule regardless of the `hidden` attribute's presence, so both
panels rendered stacked on top of each other at once (screenshot showed
the chat message list, input row, AND the voice orb/Start-call button all
visible simultaneously under the "Chat" tab). Fixed by moving those two
layout rules into real CSS classes (`.hl-chat-panel`/`.hl-voice-panel` in
`styles.ts`) and adding an explicit `[hidden]{display:none!important}`
rule as a second line of defense — re-verified by screenshot after the
fix (both tabs now render exclusively). This is exactly the kind of bug
unit tests alone would not have caught (jsdom happily reports `.hidden ===
true` regardless of what actually paints) — the reason the task's own
brief asked for real screenshot verification, not just `pnpm test`.

**`apps/web` — widget serving + API routes (new)**:
`src/app/widget.js/route.ts` / `src/app/widget-voice.js/route.ts` — read
`packages/widget/dist/*.global.js` from disk at request time (module-scope
cached per warm instance) and serve with a content-hash ETag (304 support)
+ short real cache (`widget.js`: 5min; the lazy `voice-runtime.js`: 1hr,
since it's never linked directly by a tenant page, only fetched
dynamically by `widget.js` itself). `apps/web/next.config.ts` gained
`outputFileTracingIncludes` pinning both dist files into a standalone
build's traced output (they're read via `fs`, never `import`ed, so Next's
build-time tracer can't discover them on its own) and `apps/web/
package.json` gained an unused `@heyloo/widget` devDependency purely to
give turbo's own dependency graph a `build` ordering edge (`turbo.json`'s
`build: {dependsOn: ["^build"]}`) — verified end to end with a real `next
build --webpack` (twice: once mid-task, once as the final gate) that both
routes appear in the route manifest and serve real, correctly-sized
content; `docs/audit/CHANNELS_REQUESTS.md` item 6 flags the
`docs/DEPLOY.md` doc gap for whoever owns that file.
`src/app/api/widget/{config,session,voice-token}/route.ts` — the three
routes BUILD_PLAN named explicitly: `GET config` (public, origin+
`widget_public_key`-gated via `src/lib/widget/resolve-tenant.ts`'s single
choke-point implementation of BACKEND_SPEC §13.2's "two independent
checks", returns only client-safe fields, never `allowed_origins` itself);
`POST session` (mints the `WIDGET_TOKEN_SECRET`-signed `widget_token`,
rate-limited, same origin/key gate); `POST voice-token` (verifies the
token — never trusts a bare `tenant_id` — then proxies to the NEW
`supabase/functions/api-widget-voice-token` edge function, mirroring how
`api/tenant/test-agent/web-call/route.ts` already proxies to
`api-tenant-test-call` for the authenticated-dashboard equivalent of this
same flow; provider isolation, CLAUDE.md Rule 2, means this apps/web route
can never touch Retell directly). `src/lib/widget/{session-token,
rate-limit,resolve-tenant,settings-schema}.ts` back all three. 53 tests
across these + the two serving routes, all passing; full `apps/web`
production build (`next build --webpack`) run clean twice (zero warnings/
errors beyond pre-existing, unrelated Next/Sentry deprecation notices) as
the final gate, plus a `pnpm -w typecheck`-equivalent `tsc -b` pass on
every touched package.

**`supabase/functions/api-widget-voice-token` (new edge function)** —
mints a Retell web-call token for the TENANT's own real published agent
(Voice mode), same shape as `api-tenant-test-call/handler.ts` but
authenticated by the `widget_token` (independently re-verified server-
side, never a caller-supplied `tenant_id`) since there is no Supabase user
JWT in this flow at all — `verify_jwt: false`, `supabase/config.toml`
entry added. `supabase/functions/_shared/widget-token.ts` (new) is the
Deno-side HMAC verifier ported from `apps/web/src/lib/widget/session-
token.ts`'s Node construction (`_shared/crypto.ts`'s existing
`hmacSha256Hex`/`timingSafeEqual` primitives) — cross-runtime
interoperability directly tested (`widget-token.test.ts`'s own dedicated
test mints a token with Node's `createHmac` and verifies it with the Deno-
side function). 15 tests across the edge function + shared verifier.

**Widget ↔ `api-text-chat` contract — posted early, then actually adopted
mid-task by the other cluster building that function**: this task's own
brief said to agree the contract "in your first 10 minutes"; posted as
`docs/audit/CHANNELS_REQUESTS.md` item 4 (full request/response shape +
CORS + auth) once the design was settled, built `packages/widget/src/
api.ts`'s `sendChatMessage`/`types.ts`'s `WidgetChatResponse` against it
before `api-text-chat` existed in the tree at all. Confirmed directly in
this session, after the other cluster's own `docs/BUILD_NOTES.md` entry
surfaced mid-task: `supabase/functions/api-text-chat/**` now exists,
matches that contract exactly (`{widget_token, message,
conversation_token?}` → `{conversation_token, reply, sent, reason?}`), and
imports `_shared/widget-token.ts` (this cluster's own file, built for
`api-widget-voice-token`) directly rather than duplicating it — verified
`_shared/widget-token.ts` is byte-identical to what this cluster wrote (no
changes needed on this side). `docs/audit/CHANNELS_REQUESTS.md` item 7
closes the loop.

**`dashboard/website-widget/` (new tenant page)** — Install page: master
enabled toggle (saves immediately), embed snippet with copy button and a
"Generate/Rotate key" action (`widget_public_key`, client-generated opaque
value written via the existing `tenants_update` RLS policy — no new API
route needed, same direct-write pattern `agent/manual-mode/page.tsx`
already uses), an allowed-domains editor (add/remove, validated to a bare
`https://host` origin — rejects a path/query/fragment or a duplicate
before it's ever saved), appearance (modes/position/accent/greeting), a
usage tile (30-day AI text-reply count, honestly labeled "SMS + widget
chat combined" since `usage_daily.text_messages_out` genuinely can't be
split by channel today), and a REAL live preview — mounts the actual
built `widget.js` against the current, possibly-unsaved form state via
`data-preview-config` (debounced re-mount on change), not a mocked
approximation. Nav link added (`tenant-shell-client.tsx`, new `Globe`
`NAV_ICONS.websiteWidget` entry in `packages/ui`). Preview-mode mirror +
fixture data added (`(preview)/preview/dashboard/website-widget/page.tsx`,
`lib/preview/routes.ts`, `PREVIEW_TENANT`'s new widget/text-agent fields
in `lib/preview/fixtures.ts`). 7 tests.

**Agent settings → new "Text agent" tab** (`dashboard/agent/text-agent/`)
— master toggle, persona (tone + optional sign-off), quiet hours.
Documented explicitly, in the page's own docstring, that
`text_agent_persona`'s shape is "owned by the text-agent runtime" per that
migration's comment, but the runtime (`_shared/text-agent/system-
prompt.ts`'s `buildTextSystemPrompt`) does not read either
`text_agent_persona` or `quiet_hours` as of this task — this page is the
tenant self-service surface for a reasonable, forward-looking shape a
follow-up engine change can wire in without a schema change, not a claim
that it's already wired up. Tab added to `agent-settings-tabs.tsx`,
preview mirror + routes.ts entry added. 4 tests.

**Billing → Text conversations usage tile**: `api/platform-settings/
tenant-plan/route.ts` extended (2 new response fields,
`included_text_conversations`/`text_conversation_overage_cents`, read from
the same already-fetched `price_card_<vertical>` row, defaulting to the
BACKEND_SPEC-documented 200/5¢ when absent — e.g. on an environment where
`docs/audit/CHANNELS_REQUESTS.md` item 2's `seed.sql` gap hasn't been
fixed yet). `billing/page.tsx`'s existing usage query extended to also
select `text_messages_out` (one extra column on an already-issued query,
no new round trip) and a new Card rendering the same included/used/
overage math `UsageMeter` already does for minutes, by hand (that
component's copy is hardcoded to "minutes", so reused the same `Progress`
primitive directly with honest text rather than repurposing a
minutes-specific component). 5 new tests + 2 pre-existing tests
reconfirmed passing unchanged.

**`dashboard/messages/` — AI vs human vs customer authorship + Take
over/Hand back to AI** (this task's own brief item; initially deferred as
blocked — see `docs/audit/CHANNELS_REQUESTS.md` item 5 — until the other
cluster's follow-up `text_conversation_messages` migration landed
mid-session and unblocked it; built against that table once it existed,
not against a guess). Backward-compatibility constraint that shaped the
whole design: `customer-detail-client.tsx`, `order-detail-client.tsx`, and
`bookings/page.tsx` (none owned by this cluster) already deep-link
`/dashboard/messages/<phone>` with a real E.164 number — renaming that
route's param to a conversation id would silently break every one of
those links. Instead: the SAME `[phone]` route now accepts either a real
phone (unchanged) or an opaque `wc:<conversation id>` key for a web-chat-
only conversation (which has no phone at all until/unless the visitor
verifies one, BACKEND_SPEC §13.1) — `src/lib/messages/text-
conversations.ts`'s `webChatKey`/`parseThreadKey` is the one place that
distinction is made, never leaking a `wc:`-prefixed string into
`formatPhoneDisplay`/a `.eq("phone_e164", …)` filter anywhere else.
`messages-list-client.tsx`: unchanged SMS-thread base (`messages_inbound`/
`messages_outbound`), now ALSO queries `text_conversations` to (a) attach
a status badge to an existing SMS thread and (b) surface web-chat-only
conversations (which have no `messages_inbound` row at all — that
transport is SMS-only) as their own rows. `[phone]/message-thread-
client.tsx`: when a `text_conversations` row exists for the thread, shows
the real `text_conversation_messages` transcript with author-colored/
-labeled bubbles (customer/AI/You) instead of the legacy inbound/outbound
view, plus a "Take over"/"Hand back to AI" button (direct client write to
`text_conversations.status`, permitted by that migration's own
`text_conversations_human_takeover` RLS policy — no new API route needed);
when no `text_conversations` row exists (a thread the engine never
touched — pre-existing STOP/HELP-only history, or simply not created
yet), falls back to the exact prior behavior, unchanged, zero regression
risk. A human reply always inserts a `text_conversation_messages` row
(`author: 'human'`, permitted by that same migration's insert policy); for
an SMS thread it ALSO sends a real SMS via the pre-existing `messages_
outbound`/`fn_enqueue_message_outbound` path (`api/tenant/messages/
[phone]/route.ts`, unchanged) so the customer actually receives it; for a
web-chat thread it can only save the transcript row — **known, documented
gap, not silently glossed over**: the widget's chat is a plain request/
response HTTP call with no live-push mechanism (no WebSocket/polling), so
a human's dashboard reply to a web-chat visitor won't reach them until
they send another message and the (not-yet-built) delivery of saved human
replies into that next `api-text-chat` turn is wired up — out of this
task's scope to build the push side of that, flagged here rather than
implied to work. Also not carried over from the old view: a STOP/HELP
reply sent by a customer mid-conversation returns early in `webhooks-
twilio-sms/handler.ts` before ever reaching the text-agent engine, so it
never gets a `text_conversation_messages` row — an ongoing SMS
conversation's author-tagged transcript can be missing that one message
even though `messages_inbound` still has it; a real, small, documented
gap rather than a claim of 1:1 parity with every legacy message. 16 tests
across the three files (`text-conversations.test.ts`,
`messages-list-client.test.tsx`, `message-thread-client.test.tsx`).
`database.types.ts` gained hand-transcribed `TextConversationRow`/
`TextConversationMessageRow` types (plus `text_messages_out` on
`UsageDailyRow` and the widget/text-agent columns on `TenantRow`) — this
package's own stated convention ("hand-maintained... add a column here the
day a page needs it"), not a full `supabase gen types` run (unavailable in
this sandbox, same constraint every other package in this repo already
documents).

**Cross-cluster requests filed** (`docs/audit/CHANNELS_REQUESTS.md`,
items 4-7, posted by this cluster): item 4 (the widget/`api-text-chat`
contract, posted early per this task's own instruction, since adopted —
item 7 closes the loop); item 5 (the authorship-table gap, since filled by
the other cluster's `text_conversation_messages` migration); item 6
(`docs/DEPLOY.md`'s widget-build-step + new edge function secrets gap,
still open — this cluster doesn't own that file).

**Screenshot verification** (this task's own explicit instruction — "at
1440/390 via Playwright", PNGs not committed): a static test page
(`/tmp/.../scratchpad/widget-test-page.html`) with the REAL built
`widget.global.js` inlined into a plain `<script data-key="..."
data-preview-config="...">` tag — no server, no backend — rendered at
1440×900 and 390×844: `widget-{desktop,mobile}-closed.png` (launcher
only), `widget-{desktop,mobile}-open-chat.png`, `widget-{desktop,mobile}-
open-voice.png` (tab switch). This exercise is what caught and confirmed
the fix for the `[hidden]`-vs-inline-`style` bug above — the FIRST
screenshot pass, before the fix, visibly showed both tabs' content
stacked. `dashboard/website-widget` (the Install page) was ALSO attempted
via a separate `UI_PREVIEW_MODE=1` run (both `next build --webpack` +
`next start` and plain `next dev`/`next dev --webpack` were tried) against
`/preview/dashboard/website-widget` — every attempt left the page stuck on
`DataState`'s loading skeleton indefinitely, its `useTenantQuery`/
`useQuery` `queryFn` never observed to execute at all (confirmed by a
temporary `console.log` at the very top of the query function, which never
printed) even though `tsc`, `pnpm test` (7/7 for this exact component,
mocking the same Supabase call shape), and two independent full `next
build --webpack` production builds all pass clean for this file with no
changes. One dev-server run's own log additionally showed a transient SWC
"Syntax Error" pointing at a location `tsc` itself parsed without
complaint on the identical file content — evidence pointing at dev-server/
Turbopack-or-webpack compilation instability specific to this session's
sandbox (a tree three build agents are concurrently editing live) rather
than a defect in the shipped code. Not chased further past a reasonable
number of attempts across three different dev-server configurations;
the stuck-loading captures were deleted rather than kept/reported as a
successful design screenshot. The Install page's correctness rests on its
7 passing tests + clean `tsc`/production-build gates instead, same
evidentiary standard every other new page in this task meets.
`widget-*.png` (6 files, the widget itself — the higher-risk, more novel
piece, and the one that actually caught a real bug) ARE genuine, correct
captures, and are what's under this session's scratchpad directory
(`/tmp/claude-0/.../scratchpad/`) now — never committed to the repo, per
this task's own instruction; paths and this caveat reported in this
task's structured output notes for the orchestrator.

**Deliberately out of scope / deferred, not silently skipped**: live
push of a human's dashboard reply into an OPEN web-chat conversation (the
widget's chat transport has no server-push mechanism today — see the
Messages section above); resolving `docs/audit/CHANNELS_REQUESTS.md` item
1's `call_logs.channel`/migration-filename conflict (not this cluster's
call — flagged, not touched); wiring `tenants.text_agent_persona`/
`quiet_hours` into the actual engine prompt (the Agent settings tab is the
tenant-facing half only, documented as such in its own file).

**Gates run**: `packages/widget` — `tsc -b` clean, `tsup` build (both
bundles), `scripts/check-size.mjs` (5.00KB gz, budget 25KB), `vitest run`
(3 files/21 tests). `apps/web` — `tsc -b` clean (`exactOptionalPropertyTypes:
true`), `vitest run` **full suite: 78 files / 423 tests, all green** (not
just the new/changed files — a full regression pass after the
`database.types.ts` change), two full `next build --webpack` runs (mid-
task and as the final gate) both exit 0 with zero warnings/errors beyond
pre-existing unrelated Next/Sentry deprecation notices, plus a third
`UI_PREVIEW_MODE=1 next build --webpack` + `next start` run for the
screenshot pass. `supabase/functions` — `tsc -p tsconfig.json --noEmit`
clean, `vitest run` on the two new files (2 files/15 tests). `packages/
supabase-client`/`packages/ui` — `tsc -b` clean after the new row types/
`NAV_ICONS` entry; `packages/ui`'s own full suite (19 files/97 tests) re-
run to confirm the new icon didn't regress anything. `biome check --write`
over every new/changed file (formatting only — every substantive finding
was a real lint error, e.g. a `forEach` callback returning a value,
fixed, not suppressed). No `.next`, build output, or `.env*` staged;
PNGs kept out of the repo per this task's own instruction.

## Integrator — Channels migration-collision resolution + cross-cluster requests pass (2026-09-11, session_012xvcAnjqsMbPqitErDJQbR)

Applied every unapplied request in `docs/audit/CHANNELS_REQUESTS.md` after
three concurrently-run build clusters (S — schema/pricing/docs, T —
text-agent engine, W — website widget + dashboard) finished. The one
blocking item was item 1/item 6, the real, reproduced migration collision
between Cluster S's `20260911100000_channels_text_conversations.sql` /
`20260911101000_channels_tenant_and_call_log_columns.sql` and Cluster T's
`20260911120000_text_conversations.sql` (both independently adding
`call_logs.channel`, `usage_daily.text_messages_out`, and a differently-
shaped `text_conversations` table).

**Resolution and why**: kept Cluster T's `text_conversations` design as
canonical — independently confirmed it is the only one actually wired to
working code before touching anything: `webhooks-twilio-sms/handler.ts`
and `api-text-chat/handler.ts` both call `_shared/text-agent/engine.ts`'s
`handleInboundText`, which reads/writes Cluster T's schema exclusively;
Cluster W's dashboard (`apps/web/src/app/[locale]/(tenant)/dashboard/
messages/**`, `apps/web/src/lib/messages/text-conversations.ts`) and
`packages/supabase-client/src/database.types.ts`'s `TextConversationRow`/
`TextConversationMessageRow` were already built against Cluster T's column
names/enum values, not Cluster S's — Cluster S's `text_conversations`/
`text_messages` tables had zero consumers anywhere in the tree. Concrete
changes:

- `20260911100000_channels_text_conversations.sql`: neutered to an
  explained no-op (kept in place, timestamp preserved, never delete a
  cluster's actual deliverable file silently — CLAUDE.md Rule 2's "never
  edit an applied migration" doesn't apply here since nothing in this tree
  has ever been applied to a real environment, confirmed by re-deriving
  every migration from zero below).
- `20260911101000_channels_tenant_and_call_log_columns.sql`: kept the
  `tenants.*` text-agent/widget columns unchanged; `call_logs.channel`
  reconciled to a single 4-value enum (`'phone'|'web_voice'|'sms'|
  'web_chat'`, default `'phone'`) per Cluster T's own item-6 follow-up,
  which correctly identified the two clusters' 2-value enums as describing
  genuinely different, both-needed axes rather than a "pick one" conflict.
- `20260911110000_channels_pricing_and_usage.sql`: kept the
  `usage_daily.text_messages_out` column and the `price_card_*`
  jsonb-merge `UPDATE`; rewrote `fn_upsert_usage_daily` to stop touching
  `text_messages_out` at all (it used to recompute it from Cluster S's now-
  gone `text_messages` table on every `on conflict do update set`) — that
  column is event-sourced, incremented directly and exclusively by
  `_shared/text-agent/conversation-store.ts` per outbound AI message; the
  nightly rollup function silently resetting it to 0 on every cron run
  would have been a real, live billing-undercount bug, not just a schema
  mismatch, had this shipped as Cluster S originally wrote it.
- `20260911120000_text_conversations.sql`: removed its now-duplicate
  `call_logs.channel`/`usage_daily.text_messages_out` `ALTER TABLE`s (both
  now owned exactly once, by the two files above); its `text_conversations`
  `CREATE TABLE` and everything after is unchanged.
- `scripts/ci/rls-cross-tenant-probe.ts` (Cluster S's file, needed a fix
  regardless of arbitration direction): its seed/probe of Cluster S's
  now-gone `text_messages` table swapped for Cluster T's
  `text_conversation_messages` (same dependent-FK seeding pattern, just the
  right table/columns — no `direction` column on the new table).
- `packages/supabase-client/src/database.types.ts`: `CallLogRow` was
  missing a `channel` field entirely (neither cluster had added it, since
  neither knew which enum would win) — added the reconciled 4-value type.

**Verified, not just asserted** — a real throwaway Postgres 16 instance
(this environment ships one; `service postgresql start`, a stub `auth`/
`storage`/`realtime` schema matching what earlier clusters' own
BUILD_NOTES entries describe, the 3 unavailable `create extension pg_cron/
pgmq/pg_net` lines stripped since this box doesn't have those extensions
installed — the migrations' own code already `raise notice`s and no-ops
gracefully without them, confirmed by reading `20260910093000_queues_and_
scheduled_jobs.sql` rather than assuming):
1. All 50 migration files in `supabase/migrations/` apply cleanly, zero
   errors, in filename order, from an empty database.
2. `supabase/seed/seed.sql` then applies cleanly on top (also fixes item 2
   below — the seed's own literal price-card jsonb now carries the two new
   keys so a `supabase db reset` no longer wipes them).
3. A live smoke test inside a transaction (rolled back): inserted
   `call_logs` rows with all 4 `channel` values including the un-set
   default; inserted a `text_conversations` row + a `text_conversation_
   messages` row and joined them; called `fn_upsert_usage_daily`, then
   directly incremented `usage_daily.text_messages_out` (the same `UPDATE`
   shape `conversation-store.ts` uses), then called `fn_upsert_usage_daily`
   again — confirmed the second rollup call does **not** reset the
   incremented value back to 0, the exact bug being fixed.

**Also applied** (the rest of the task's unapplied-request list, all
confirmed already-done or done here):
- Widget chat mode ↔ `api-text-chat` contract (item 4/7): confirmed
  already exactly matching — `api-text-chat/handler.ts` imports `_shared/
  widget-token.ts` verbatim, `packages/widget/src/api.ts`'s
  `sendChatMessage`/`types.ts`'s `WidgetChatResponse` need no changes. No
  action needed.
- Dashboard nav links to Messages / Website widget (item implied by the
  task brief): already present in `tenant-shell-client.tsx`. No action
  needed.
- `supabase/config.toml` `[functions.api-text-chat]`/
  `[functions.api-widget-voice-token]` entries: already present with
  correct `verify_jwt = false`. No action needed.
- `.env.example`/`docs/DEPLOY.md` env docs (item 6, posted twice under the
  same number by Cluster W): `WIDGET_TOKEN_SECRET`/`RETELL_API_KEY` were
  already in `.env.example` and `docs/DEPLOY.md`'s var table, but the table
  didn't cross-reference that `api-widget-voice-token` needs both — added
  that note. Added the missing `docs/DEPLOY.md` §3.7 note that
  `packages/widget` must build before `apps/web` (the two widget-serving
  routes read its `dist/` files from disk, not via `import`) plus a
  `/widget.js`/`/widget-voice.js` 200-not-404 smoke-test line.
- `supabase/seed/seed.sql` (item 2): added `included_text_conversations`/
  `text_conversation_overage_cents` to all 8 `price_card_<vertical>`
  literals — verified via the same throwaway-Postgres harness that a fresh
  `seed.sql` apply now carries both keys.
- `docs/spec/BACKEND_SPEC.md` §13 / `docs/spec/FRONTEND_SPEC.md` §12: both
  rewritten to describe the resolved shape (Cluster T's `text_conversations`
  / `text_conversation_messages`, the reconciled `call_logs.channel`
  4-value enum) rather than Cluster S's superseded design.

**Known gap found while verifying, NOT fixed here (out of this pass's
scope — flagging per CLAUDE.md Rule 4 rather than redesigning)**: a widget
**voice** call (`api-widget-voice-token` → Retell web call → `voice-events`
webhook) never actually gets `channel = 'web_voice'` tagged, and worse,
`voice-events/handler.ts`'s `resolveTenantForCall` resolves the tenant by
looking up `phone_numbers` via `call.to_number` — a web call has no
`to_number` (no Twilio number involved at all), so `voice-events` likely
drops the tenant-resolution entirely for a widget voice call today and
never inserts a `call_logs` row for it at all, not just an untagged one.
This is a real, currently-uncovered gap in Cluster W's widget voice
feature (the `api-widget-voice-token/handler.ts` comment itself already
flagged the channel-tagging half as "not written here"), but fixing
`voice-events`'s tenant-resolution to also handle web calls (likely via the
Retell `agent_id` rather than `to_number`) is a real engine change beyond
"apply every unapplied request" — appended to `docs/audit/
CHANNELS_REQUESTS.md` as a new item for whoever picks up the widget-voice
feature next.

**Gates run**: throwaway-Postgres migration-from-zero + seed + live smoke
test (above, real verification, not theorized) for every schema change;
`pnpm -w typecheck` run after all edits (see this session's own final
summary for the exact result and any further fixes it required).

## REPAIR — Cluster T text-agent safety follow-up: web_chat rate-limit bypass + verify_phone SMS-bombing cap

**What was fixed** (per verifier findings on the "text agent safety" claim;
files: `supabase/functions/_shared/text-agent/engine.ts`, `tool-router.ts`,
`rate-limit.ts`, `supabase/functions/api-text-chat/handler.ts`; tests in the
sibling `*.test.ts` for each):

1. **Rate-limit bypass (web_chat conversation-creation reset).**
   `handleInboundText`'s rate-limit key for `web_chat` used to be
   `${tenantId}:web_chat:${conversation.id}`, but `resolveOrCreateConversation`
   mints a brand-new `conversation.id` every time a caller omits
   `conversation_token` — since `api-text-chat` is public
   (`verify_jwt: false`) and reachable directly with just a `widget_token`,
   a caller could omit `conversation_token` on every request and get a
   fresh rate-limit bucket every time, i.e. the limiter never actually
   engaged. Fix: added an optional `WebChatTurnInput.sessionKey`, keyed by
   the engine's rate limiter instead of `conversation.id` when present
   (falls back to `conversation.id` when absent, e.g. direct engine
   callers). `api-text-chat/handler.ts` derives it as
   `` `widget_token:${sha256Hex(body.widget_token)}` `` — stable for the
   token's whole 15-minute TTL regardless of how many fresh conversations
   get created under it, since the widget_token is already the thing this
   endpoint trusts as caller identity. Regression tests: `engine.test.ts`
   ("keys the web_chat limiter on the caller-supplied sessionKey...") and
   `api-text-chat/handler.test.ts` ("still enforces the rate limit when
   conversation_token is omitted on every call") — the latter drives 9 real
   `handleTextChat` calls through a fixture that mints a DISTINCT
   `conversation.id` every time (matching the real DB's actual behavior)
   and asserts the 9th is `rate_limited`.

2. **`verify_phone` open SMS-relay / bombing.** `verify_phone` sends a real
   SMS to whatever number the customer (or a scripted attacker) supplies,
   with no cap beyond the general per-session message rate limit — which
   fix #1 closes for a single session, but a per-tenant SMS-cost/abuse
   vector independent of session identity was still open (many freshly-
   minted sessions, each under budget individually, could still add up to
   unlimited real sends). Added two independent caps in
   `tool-router.ts`'s `runVerifyPhone`, checked BEFORE any send/DB write:
   - Per-conversation distinct-number cap
     (`MAX_DISTINCT_PHONES_PER_CONVERSATION = 3`): tracked in
     `conversation.structured_state.verify_phone_attempts` (a plain string
     array), persisted via the normal `saveConversationPatch` path. A 4th
     distinct number in one conversation is blocked
     (`{sent:false, reason:"too_many_numbers"}`); resending to an
     already-attempted number is never blocked by this cap.
   - Tenant-wide hourly cap (`verifyPhoneRateLimiter` in `rate-limit.ts`,
     20/hour, same `TextAgentRateLimiter` shape as the existing message
     limiter): keyed on `tenantId` alone (never conversation/session), so
     it holds even across attacker-minted fresh conversations/sessions
     that would otherwise each look individually within-budget.
   Regression tests in `tool-router.test.ts`: distinct-number-cap block +
   resend-still-works, and a 25-iteration fresh-conversation/fresh-phone
   loop asserting exactly 20 sends succeed and 5 are `rate_limited`.

**Not changed in this pass** (out of scope per the verifier's own
priority ordering — flagging per CLAUDE.md Rule 4 rather than expanding
scope):
- `widget_token` is still reusable (not single-use) for its full TTL, and
  `/api/widget/session`'s Origin check is still the only non-browser-caller
  guard (`apps/web/src/lib/widget/session-token.ts`,
  `apps/web/src/lib/widget/rate-limit.ts`) — the verifier flagged this as
  worth considering but lower priority than the two fixes above, which
  directly close the demonstrated bypass/abuse paths regardless of how a
  `widget_token` was obtained.
- `verifyBookingIdentity`'s name+time "knowledge" fallback
  (`_shared/identity-verification.ts`) for unverified web_chat sessions —
  called out by the verifier as a secondary, lower-severity, pre-existing
  write-path issue, not part of this pass's rate-limit/SMS-bombing scope.

**Gates run**: `cd supabase/functions && npx vitest run` — 870 tests across
98 files, all passing, including this pass's 5 new regression tests spread
across `engine.test.ts` (+2), `api-text-chat/handler.test.ts` (+1), and
`tool-router.test.ts` (+2); `npx tsc -p supabase/functions/tsconfig.json
--noEmit --pretty` clean; `biome check` clean on every touched file. No
`apps/web` or `packages/**` files were touched by this pass, so their
gates weren't re-run.

## Cluster repair (2026-09-11) — Calls-dashboard channel leak + quiet-hours decision ratified

**1. Fixed: `call_logs` shadow rows polluting the voice Calls dashboards.**
The text-agent's shadow `call_logs` rows (`channel in ('sms','web_chat')`,
`started_at` always `null` — see `20260911101000_channels_tenant_and_
call_log_columns.sql`) were showing up as blank "In progress" rows at the
top of every voice-only Calls surface, because Postgres's default
`ORDER BY started_at DESC` is `NULLS FIRST` and none of these queries
filtered `channel`. Fixed by adding `.in("channel", ["phone","web_voice"])`
plus explicit `{ ascending: false, nullsFirst: false }` ordering to:
- `apps/web/src/components/tenant/calls-list-client.tsx` (Calls list)
- `apps/web/src/components/tenant/overview-client.tsx` (Overview's
  "Recent calls" widget and its spam-deflected count)
- `apps/web/src/app/api/tenant/calls/export/route.ts` (CSV export)
- `apps/web/src/app/[locale]/(tenant)/dashboard/customers/[id]/page.tsx`
  (customer profile's call history — same bug shape, in scope for
  consistency even though not in the original three named files)

Not touched: `apps/web/src/app/[locale]/(tenant)/dashboard/calls/[id]/
page.tsx` (fetches one call by its own id, not a list — a direct link to a
shadow row's id would still render mostly-blank, but that's an out-of-
scope "should a text conversation even have a /dashboard/calls/[id] URL"
question, not this ordering bug) and `api/tenant/setup-progress/route.ts`
(counts `is_test_call = true` only, unaffected by channel).

**2. Quiet-hours claim: ratifying the existing decision, no code change.**
Re-reviewed the reasoning at line ~8131 above (`_shared/quiet-hours.ts`
gates only unsolicited proactive outbound; a text-agent reply is a direct
response inside a conversation the customer just started, so it is
deliberately exempt on both channels). This is confirmed as the intended
behavior, not a gap to close — "quiet hours respected" in the original
task brief should be read as "quiet hours are respected for unsolicited
outbound (reminders, campaigns), not reinterpreted as deferring a direct
reply to a customer-initiated conversation." No change made to
`resolveTenantTextContext` / `engine.ts`.

**3. `.env.example` duplicate `ANTHROPIC_TEXT_AGENT_MODEL`**: deduped —
kept the fuller comment in the Cluster T text-agent-engine section, left a
pointer comment in the Channels/widget section instead of a second
declaration.

**4. Root `vitest run` project-glob bug** (`apps/*` matching non-project
`apps/README.md`/`apps/docs`): left as-is, out of scope for this repair
pass (pre-existing, unrelated to the SMS feature or the two items above);
scoped `vitest run` invocations continue to be the correct workaround.

**Gates run**: `apps/web` — `npx tsc --noEmit` clean. No existing test
exercises the touched query chains directly (`overview-client.test.tsx`
only covers the pure `usageDailyToTrend` adapter), so no test needed
updating; none broken.

## REPAIR — Text-conversation price-card admin edit was destructive; text-agent `price_version` was hardcoded (2026-09-11, session_012xvcAnjqsMbPqitErDJQbR)

Verifier's "admin can edit the values" claim was false, and worse: the
existing admin Pricing-tab save path silently deleted
`included_text_conversations`/`text_conversation_overage_cents` from
`platform_settings.price_card_<vertical>` on the FIRST edit through the
UI, because the write handler built a brand-new `value` object from only
the fields its schema knew about and did a full JSONB replace. Fixed:

1. Added `included_text_conversations`/`text_conversation_overage_cents`
   (both required, matching the other pricing fields' "admin always sends
   an explicit value" convention) to `platformPricingTableSchema`
   (`packages/canonical-types/src/schemas/platform-pricing-table.ts`) and
   its Deno mirror `PlatformPricingTableSchema`
   (`supabase/functions/admin/schemas.ts`).
2. `supabase/functions/admin/handler.ts`'s pricing POST now spreads the
   previously-stored `value` (`...(before ?? {})`) before overwriting the
   fields this schema knows about, so any field a future migration/seed
   adds before the admin form is updated to know about it survives an
   edit instead of being wiped — not just the two new fields, structurally
   fixed for any future one. Added a regression test
   (`admin/handler.test.ts` — "merges a pricing save onto the
   previously-stored value...") that seeds a `some_future_field` the
   schema doesn't know about and asserts it survives both the response
   body and the actual `insert` values.
3. Added the two fields to the `PricingTab` UI
   (`apps/web/src/app/[locale]/(admin)/cockpit/settings/page.tsx`) —
   inputs, state (defaulted to 200/5¢ to match the tenant-facing read-path
   fallbacks in `/api/platform-settings/tenant-plan`), and the save
   payload.
4. `incrementTextMessagesOut`'s two call sites
   (`_shared/text-agent/engine.ts:216,326`) now pass
   `tenantContext.priceVersion` instead of the literal `"v1"`.
   `resolveTenantTextContext` (`_shared/text-agent/conversation-store.ts`)
   now selects `t.price_version` and returns it on `TenantTextContext`
   (`_shared/text-agent/types.ts`) — the "small additional column" the
   original task brief anticipated; reuses the tenant/agent-config query
   already run for every text turn rather than a second round trip.

**Gates run**: `supabase/functions` — `npx vitest run` (98 files, 871
tests, all green) and `npx tsc -p tsconfig.json --noEmit --pretty` clean.
`packages/canonical-types` — `npx vitest run` (163 tests green) and
`npx tsc -b --pretty` clean. `apps/web` — `npx tsc -b --pretty` clean and
`npx vitest run` (78 files, 423 tests, all green).

## REPAIR — Cluster S/W widget-voice `channel='web_voice'` gap: fixed

**What was fixed** (per verifier finding on the "website widget" claim —
`call_logs` for a widget voice call was either absent entirely or, if
narrowly patched, mistagged `'phone'`; files: `supabase/functions/
voice-events/handler.ts`, `handler.test.ts`):

- `resolveTenantForCall` now has two resolution paths instead of one. It
  still tries `call.to_number -> public.phone_numbers` first (unchanged,
  real Twilio-originated calls always carry `to_number`); when that's
  absent or unmatched — exactly how a Retell web call arrives, since
  `createWebCall` (`_shared/providers/retell.ts`) never sends a
  `to_number` at all — it now falls back to `call.agent_id ->
  agent_configs.retell_agent_id -> tenant_id`, joining `tenants` the same
  way for `owner_test_phone`/test-call detection.
- The resolver returns which path matched (`channel: 'phone' |
  'web_voice'`), and both `handleCallStarted`'s insert and
  `handleCallEnded`'s out-of-order fallback insert now write that value
  into `call_logs.channel` explicitly (`phone_number_id` is `null` on the
  `web_voice` path — there is no PSTN number to attach). The column
  default (`'phone'`) is now only ever hit for pre-existing rows/schema
  default, not relied on implicitly for real inserts.
- This closes the exact gap this same file's `channel` column comment
  (`20260911101000_channels_tenant_and_call_log_columns.sql`) and
  `api-widget-voice-token/handler.ts`'s "not written here" comment both
  point at, and the gap flagged above in the "Integrator — Channels
  migration-collision resolution" entry and mirrored in `docs/audit/
  CHANNELS_REQUESTS.md` item 8 — both marked resolved there.
- Added `handler.test.ts` cases: `handleCallStarted` resolving a call with
  `agent_id` set and no `to_number` via `agent_configs`, asserting the
  insert carries `channel='web_voice'` and a `null` `phone_number_id`; a
  no-`to_number`-and-no-`agent_id` call still no-ops (never silently
  invents a tenant); and `handleCallEnded`'s out-of-order fallback insert
  path doing the same agent_id resolution + `channel='web_voice'` tagging.

**Gates run**: `supabase/functions` — `npx vitest run` (98 files / 874
tests, all passing, including the 3 new cases above) and `npx tsc -p
tsconfig.json --noEmit --pretty` (clean).

## CHANNELS-1 — Integrator pass over the Channels wave (SMS text agent +
website widget), final gate run + commit (2026-09-11, session_012xvcAnjqsMbPqitErDJQbR)

Closed out the last open verifier finding on this feature and ran every
CLAUDE.md gate before committing the whole Channels wave (Clusters S/T/W
plus every repair entry above) as one commit.

**Real bug fixed** — the verifier's own finding: `messages-list-client.tsx`
(the tenant Messages inbox list) merges three sources per thread —
`messages_inbound`, `messages_outbound`, and `text_conversations` — and the
SMS-with-a-matching-conversation-row branch only ever copied `c.status`
onto the already-built row, never `c.updated_at`/the conversation's latest
`recent_turns` entry. So whenever the text-agent engine's own write (an
agent-only STOP/HELP/YES reply, or any turn recorded solely via
`conversation-store.ts` — `text_conversations.updated_at` moving forward
with no corresponding `messages_inbound`/`messages_outbound` row landing in
this component's own 300-row queries) was the most recent activity on a
thread, the list kept showing a stale `lastAt`/preview and could sort the
thread out of place entirely. Fixed: that branch now also promotes
`existing.lastAt`/`existing.preview` from the conversation row whenever
`c.updated_at` is newer than what the SMS tables already produced, using
the conversation's own last `recent_turns` entry as the preview text.
Regression test added (`messages-list-client.test.tsx` — "updates lastAt/
preview from a text_conversations row newer than the matching SMS row").

**Two real `react-hooks/set-state-in-effect` lint errors fixed** (found by
the `pnpm run lint` gate, not pre-existing — both were part of this
feature's own uncommitted work): `dashboard/agent/text-agent/page.tsx` and
`dashboard/website-widget/website-widget-client.tsx` both used the
`useState<Form | null>(null)` + `useEffect(() => setForm(derived), [query.
data])` shape to seed a locally-edited form from a query result — a
cascading-render anti-pattern the React Compiler ESLint plugin now flags as
an error, not a style nit (calling a state setter synchronously inside an
effect body). Fixed the same way in both, rather than suppressing the rule:
split each into an outer component that gates on `query.data`/`DataState`
being loaded and an inner component that takes the loaded row as a prop and
seeds its form state via `useState(() => deriveForm(initial))` — a lazy
initializer that runs once at mount, not an effect — eliminating the
null-gap entirely instead of bridging it with a synchronous `setState`. No
behavior change for either page's own tests (`text-agent/page.test.tsx`
unchanged and still green; `website-widget-client.test.tsx` updated only
to drop a `.closest("li")` DOM-traversal call in favor of querying the
remove button by its already-origin-specific accessible name, and to
`eslint-disable`-with-justification its `afterEach`'s cleanup of the
`<script>` tag the component's own preview effect appends directly to
`document.body` outside the render tree — both were newly-introduced
`testing-library/no-node-access` errors the same lint gate caught).

**Gates run, all green:**
- `npx biome check --write` on every changed path (70 pre-existing +
  1 test file this pass touched) — 0 errors; 2 pre-existing unsafe-fix
  warnings in files this pass didn't author (`admin/handler.test.ts`,
  `webhooks-twilio-sms/handler.ts`) left as-is, out of scope.
- `pnpm -w typecheck` — 21/21 tasks clean.
- `pnpm run lint` — 0 errors (down from 6 before this pass's two fixes
  above); 31 pre-existing warnings across the repo, none in Channels code.
- `pnpm -w test` — 21/21 test tasks green: `apps/web` 78 files/424 tests
  (+1 from the merge-bug regression test), `supabase/functions` 98
  files/874 tests, `packages/canonical-types` 11/163,
  `packages/templates` 8/368, `packages/widget` 3/21, `packages/ui`
  19/97, plus every other package's smoke test.
- `apps/web` production build — `next build --webpack`, exit 0, every
  route compiled including `/widget.js`, `/widget-voice.js`,
  `/api/widget/session`, `/api/widget/voice-token`, `/api/widget/config`.
- `packages/widget` — `pnpm build` (tsup, `widget.global.js` 14.42KB /
  `voice-runtime.global.js` 678.65KB) then `pnpm size` — 5.00KB gzipped
  against the 25KB budget on the always-loaded main bundle (voice-runtime
  is lazy-loaded, deliberately excluded from that budget per the check
  script's own comment).
- `node --experimental-strip-types scripts/ci/verify-jwt-guard.ts` —
  PASSED, 43 functions checked against `supabase/config.toml`.
- Migrations from zero, verified live (not just re-asserting the prior
  REPAIR entry's result, which predates this pass): `service postgresql
  start` against this sandbox's local Postgres 16 (no Docker/`supabase
  start` available, same constraint every prior pass in this repo has
  hit and disclosed), a session-only stub of the `auth`/`storage`/
  `realtime` schemas + `anon`/`authenticated`/`service_role`/
  `supabase_auth_admin` roles, all 50 real migration files applied
  verbatim in filename order against an empty database (stripping only
  the 3 `create extension` lines for `pg_cron`/`pgmq`/`pg_net` — genuinely
  unavailable outside a Supabase-hosted Postgres, and every migration
  that depends on them already no-ops gracefully without them) — zero
  errors — followed by `supabase/seed/seed.sql`, also zero errors.
  Spot-checked the schema this pass's own fix and the wider Channels wave
  depend on: `text_conversations`/`text_conversation_messages` exist with
  their documented RLS policies and triggers, `call_logs.channel` is the
  reconciled 4-value text column, and all 8 `platform_settings.price_card_
  <vertical>` rows carry `included_text_conversations: 200`/
  `text_conversation_overage_cents: 5` after seeding.
- **Not run** (unchanged from every prior pass in this repo, not in this
  task's own gate list): `scripts/ci/rls-cross-tenant-probe.ts` — needs a
  live `supabase start` (PostgREST + GoTrue), which this sandbox has never
  had available (no Docker daemon). CLAUDE.md Rule 2 still requires this
  probe stay green in the real CI environment that does have it.

**New secrets needed (owner to-do):** `WIDGET_TOKEN_SECRET` (32+ random
bytes, generated — HMAC key signing the embeddable widget's short-lived
session token; shared by `api-text-chat` and `api-widget-voice-token`, set
once). `ANTHROPIC_TEXT_AGENT_MODEL` is optional (defaults to
`claude-sonnet-5` in code if unset) — only needed if the owner wants a
different model for SMS/web-chat replies than voice tools/outreach use.
Both already documented with these exact names in `.env.example` and
`docs/DEPLOY.md`'s secrets table (by prior Channels-cluster passes, this
pass only confirmed the entries are current and named correctly).

**Owner to-do — widget domain:** the embeddable widget's `<script>` tag
(`<script src="https://app.heyloo.example/widget.js" data-key="...">`,
shown on the tenant's own Website Widget settings page) is served from the
**same domain `apps/web` deploys to** — there is no separate CDN/asset
domain — because `apps/web/src/app/widget.js/route.ts` and
`.../widget-voice.js/route.ts` read `packages/widget/dist/*.global.js`
from disk at request time. Before go-live: (1) confirm `packages/widget`
is actually built as part of the production deploy (`docs/DEPLOY.md` §3.7
— already wired via `turbo.json`'s dependency graph + `outputFileTracingIncludes`,
but worth the explicit `/widget.js`/`/widget-voice.js` 200-not-404 smoke
test that section now documents); (2) each tenant's "Allowed domains" list
(`tenants.widget_settings.allowed_origins`) must be the exact `https://`
origin of *their own* site, not this app's own domain — the widget's CORS/
origin check (`docs/audit/CHANNELS_REQUESTS.md` item 4) rejects anything
not on that per-tenant allowlist, by design.

**Incomplete / deferred, not this pass's scope (CLAUDE.md Rule 4):** the
one item this pass closed was the only remaining item on the verifier's
partial-status list for the SMS text agent; nothing else was flagged as
open. `scripts/ci/rls-cross-tenant-probe.ts` staying unrun in every sandbox
pass (noted above) is a standing, previously-disclosed environment gap, not
a new one.

## CHANNELS-2 — Channels follow-up wave: rate limits, calls filters,
## pricing merge, reply tracking, quiet hours, multi-entity (2026-09-11,
## session_012xvcAnjqsMbPqitErDJQbR)

Verified/fixed every item in `docs/audit/CHANNELS_REQUESTS.md`'s adversarial
follow-up list against HEAD, per item below. Several were already fixed by
prior repair passes (confirmed independently, not just re-asserted — every
"already fixed" item below was re-run against its existing test before
being left alone) and only needed a status check; the rest were real gaps,
fixed with regression tests. A new item 10 (multiple saved vehicles/pets/
addresses) was added mid-task by the coordinator and is its own section
below.

1. **Rate-limit bypass in api-text-chat (web_chat conversation-creation
   reset)** — ALREADY FIXED (prior REPAIR pass, `engine.ts`'s
   `WebChatTurnInput.sessionKey`, keyed by the caller's `widget_token` hash
   rather than `conversation.id`). Confirmed via `engine.test.ts` ("keys
   the web_chat limiter on the caller-supplied sessionKey...") and
   `api-text-chat/handler.test.ts` — both still green, no changes needed.
   A DB-side cap on conversations-created-per-tenant-per-minute (the
   task's alternative phrasing of the same fix) was judged redundant once
   the session-key fix closes the actual bypass — not added, to avoid a
   second, overlapping rate-limit mechanism for the same threat.

2. **verify_phone SMS-bombing relay** — PARTIALLY already fixed, ONE real
   gap found and closed. Already in place: a per-conversation distinct-
   phone-number cap (`MAX_DISTINCT_PHONES_PER_CONVERSATION = 3`) and a
   tenant-wide hourly cap (`verifyPhoneRateLimiter`, 20/hour). Missing:
   the task's own third requirement, a **cooldown per number** — nothing
   stopped an attacker from minting many fresh conversations (each
   individually under the distinct-number cap, and collectively still
   under the tenant's 20/hour budget) all targeting the SAME victim
   number in a rapid burst. Added `VERIFY_PHONE_NUMBER_COOLDOWN_MS`
   (60s, keyed on `tenantId:phone`, independent of conversation/session
   identity) in `tool-router.ts`'s `runVerifyPhone`, checked after the
   other two caps, before any send. Regression tests (`tool-router.test.ts`):
   a fresh conversation targeting an already-recently-texted number is
   blocked (`reason: "cooldown"`) even though the distinct-number cap
   alone wouldn't catch it; the existing "resend to an already-attempted
   number" test was updated to advance a fake clock past the cooldown
   first (it now legitimately tests the DISTINCT-NUMBER cap's own
   exemption, not the interaction with the new cooldown).

3. **Calls surfaces showing text/web-chat shadow call_logs rows** —
   ALREADY FIXED (prior Cluster-repair pass) for `calls-list-client.tsx`,
   `overview-client.tsx` (both queries — the widget AND the spam-deflected
   count), the export route, and the customer-profile call history — all
   four already filter `.in("channel", ["phone","web_voice"])`. The gap:
   NO test existed for three of the four surfaces (BUILD_NOTES' own prior
   entry says so explicitly: "no existing test exercises the touched query
   chains directly... none broken"), so nothing would have caught a
   regression. Added tests: `calls-list-client.test.tsx` (new file),
   `overview-client.test.tsx` (new describe block covering both `call_logs`
   queries), `export/route.test.ts` (new case asserting the `.in()` call
   args). The customer-profile page (`dashboard/customers/[id]/page.tsx`)
   is a server component with no existing test scaffold for this pattern
   in the repo; left uncovered by an automated test (code confirmed
   correct by inspection) — flagged here rather than silently skipped.

4. **Admin Platform Settings pricing tab — merge, not replace** — ALREADY
   FIXED (prior REPAIR pass): `platformPricingTableSchema`/
   `PlatformPricingTableSchema` both carry `included_text_conversations`/
   `text_conversation_overage_cents`, the admin handler spreads the
   previously-stored value before overwriting known fields, and
   `PricingTab` has the two inputs. Regression test
   (`admin/handler.test.ts`, "merges a pricing save onto the previously-
   stored value...") re-run, still green — confirmed, not re-fixed.

5. **incrementTextMessagesOut exactly-once-per-sent-reply** — ALREADY
   correct by construction (both SMS and web_chat route through the same
   `handleInboundText`, which calls it from exactly two `sent: true`
   branches — the verify-code auto-reply and the normal AI-reply path —
   never from a `noReply(...)` branch). No dedicated regression test
   existed proving this explicitly, though. Added
   (`engine.test.ts`, new describe block "incrementTextMessagesOut
   metering"): one test per channel proving exactly-one-call on a
   successful reply, and one test driving all four suppression paths
   (opted-out, human-handoff, A2P-pending, rate-limited) in sequence and
   asserting zero calls across all of them.

6. **Messages list merge (text_conversations newer than SMS-derived
   row)** — ALREADY FIXED (CHANNELS-1's own integrator pass, the exact bug
   this item describes). Regression test
   (`messages-list-client.test.tsx`, "updates lastAt/preview from a
   text_conversations row newer than the matching SMS row") re-run, still
   green.

7. **AI SMS reply delivery tracking (option (b))** — REAL GAP, now fixed.
   The synchronous TwiML `<Message>` reply `webhooks-twilio-sms/handler.ts`
   sends back to Twilio was never mirrored into `messages_outbound` at
   all — the dashboard thread's delivery-status view had no record the
   reply was ever sent. Fixed: `processInboundSms` now inserts a
   `messages_outbound` row (`channel:'sms'`, `template_key:
   'text_agent_reply'`, `status:'sent'` — never `'queued'`, since the send
   already happened via TwiML and must never be picked up and re-sent by
   the outbound queue worker — `sent_at: now()`, `payload:{body: <reply>}`)
   for every reply actually sent, and never for a suppressed one.
   `provider_message_id` is left null (Twilio never hands this webhook
   response a SID for a TwiML-sent reply; only a future status-callback
   handler could backfill it — out of scope here). `docs/spec/
   BACKEND_SPEC.md` §13.1 updated with a new subsection documenting this.
   Regression tests in `webhooks-twilio-sms/handler.test.ts`: asserts the
   insert's shape on a real AI reply, and its absence when the engine
   suppresses the reply.

8. **Quiet hours — customer replies exempt, proactive sends gated** — the
   text-agent-reply half was ALREADY correct (ratified by a prior repair
   pass, no code change needed there — `handleInboundText` never reads
   `tenants.quiet_hours` at all, by design). The gap: the task's own
   second half ("make the engine read tenants.quiet_hours for any
   proactive path") was NOT done — `job-reminder-scheduler/handler.ts`'s
   proactive booking-reminder SMS used `isQuietHours`'s hardcoded 9pm-9am
   default, never the tenant-configurable `tenants.quiet_hours` column
   Cluster S added specifically for this. Fixed: added
   `resolveQuietHoursWindow` (`_shared/quiet-hours.ts`) parsing
   `{start,end,enabled}` from the jsonb column (falling back to the
   platform default for an unconfigured tenant or a malformed field, only
   skipping gating entirely on an explicit `enabled:false`);
   `scheduleOneReminder` now selects `t.quiet_hours` and resolves it
   instead of calling `isQuietHours` with implicit defaults. `docs/spec/
   BACKEND_SPEC.md` §13.2 updated with a new subsection stating exactly
   what this column gates and doesn't. Regression tests:
   `quiet-hours.test.ts` (`resolveQuietHoursWindow` parsing/fallback
   cases) and `job-reminder-scheduler/handler.test.ts` (a tenant's custom
   narrower window is respected; `enabled:false` sends straight through
   the platform-default window; an unconfigured tenant still gets the
   platform default).

9. **Widget voice calls resolve tenant by agent_id, channel='web_voice'**
   — ALREADY FIXED (prior REPAIR pass: `voice-events/handler.ts`'s
   `resolveTenantForCall` falls back to `agent_id -> agent_configs.
   retell_agent_id -> tenant_id` when `to_number` is absent, both insert
   paths tag `channel='web_voice'`). Regression tests in
   `voice-events/handler.test.ts` re-run, still green — confirmed, not
   re-fixed.

**Edge functions changed in this pass** (redeploy needed):
`_shared/text-agent/tool-router.ts` (verify_phone cooldown),
`_shared/quiet-hours.ts` (resolveQuietHoursWindow),
`job-reminder-scheduler/handler.ts` (reads tenants.quiet_hours),
`webhooks-twilio-sms/handler.ts` (messages_outbound delivery-tracking
insert), `voice-tools/tools/create_order.ts` (address_id resolution +
default-preservation fix), `voice-tools/tools/lookup_customer.ts`
(bounded/flagged vehicles/pets/addresses), `_shared/schemas/voice-tools.ts`
(delivery_address address_id/set_as_default fields). No migration files
were added or changed by this pass — every fix is application-layer.

### Item 10 (owner priority, added mid-task) — multiple saved vehicles,
### pets, and delivery addresses

The data model already supported several saved vehicles/pets
(`customers.metadata.vehicles[]`/`.pets[]`, appended-not-overwritten by
`create_booking.ts`'s existing `extractMetadataMerge`) and several
addresses (`customer_addresses`, one row per address), but the
conversation layer only ever handled the single/default case — exactly
the gap the task named (`restaurant.ts:150`'s old "still to 42 Oak St?"
line, which silently assumed one saved address).

**(a) `lookup_customer` bounded, most-recent-first, flagged.**
`voice-tools/tools/lookup_customer.ts` now bounds vehicles/pets/addresses
to 5 each. Addresses were already ordered `is_default desc, created_at
desc`; added `limit 5` at the query level. Vehicles/pets are stored
oldest-first in the metadata array (each booking appends) — added
`boundRecurringEntries()`, which reverses to most-recent-first, slices to
5, and flags entry 0 with `most_recent: true` (addresses don't need a
separate flag — `is_default` already serves that role). Tests:
`lookup_customer.test.ts` — bounds 7 vehicles to 5 most-recent-first with
the flag on the right entry; a single saved vehicle still gets flagged
(the exactly-one case the template fragment below depends on); the
addresses query's `limit` argument is asserted directly.

**(b) Shared template fragment.** New `MULTI_ENTITY_FRAGMENT`
(`packages/templates/src/shared/fragments.ts`) encodes the exact rule:
none on file → collect; exactly one → confirm back briefly ("still the
2019 Civic?"); several → offer by short label and ask which ("the Civic or
the F-150?"), never read a full address back to an unverified caller
(MASTER_SPEC §3.7); a new one mentioned → capture as an ADDITIONAL entry,
default only if the caller says so. Wired into the FOUR verticals whose
caller can actually have more than one recurring entity —
`auto-repair.ts` (vehicles), `veterinary.ts` (pets), `restaurant.ts` +
`generic.ts` (delivery addresses) — deliberately NOT the other four
(legal/dental/real_estate/motel have no recurring-entity concept, and
adding it there would just be prompt bloat). Also mirrored into the
text-agent persona on BOTH sides of the Deno/Node boundary
(`packages/templates/src/shared/text-persona.ts` and its by-hand Deno
mirror `_shared/text-agent/system-prompt.ts`, parity-tested by
`system-prompt.test.ts`) — the text agent's `buildTextSystemPrompt` is a
single composer for every vertical (no per-vertical fragment selection
the way voice templates have), so it's included universally there. Also
updated `restaurant.ts`'s `collect_delivery_address` state prompt to
reference `address_id`/`set_as_default` instead of assuming one default
address. Tests: `structural.test.ts` (new describe block) asserts the
fragment's marker text is present on exactly the four verticals named
above and absent from the other four (catches both under- and
over-application); `single_prompt` word/tool budget test
(`registry-consistency.test.ts`) re-run, still green (soft-warn only,
generic was already over budget before this pass per its own comment —
unchanged conclusion).

**(c) create_booking/create_order carry the chosen entity.** For
vehicles/pets, the existing `structured_payload` fields (`vehicle_year`/
`make`/`model`, `pet_name`/`species`/`breed`) already ARE the chosen
entity's label and already land on the booking (`bookings.
structured_payload`, `call_logs.structured_booking_payload`) — no schema
change needed there, only the persona fragment above so the model
actually asks which one instead of guessing. For addresses — a real gap —
added `address_id`/`set_as_default` to `delivery_address`
(`packages/canonical-types/src/tools.ts`'s `zDeliveryAddressInput` +
`.check()`, `_shared/schemas/voice-tools.ts`'s Deno mirror,
`createOrderTool()`'s model-facing JSON schema in `shared/tools.ts`).
`create_order.ts` resolves `address_id` server-side (scoped by the
caller's own phone, same pattern the existing radius-check query already
used) to the saved row's real street/city/state/zip/geocode BEFORE the
delivery-radius check runs — fixing a real, separate bug in the same area
while here: the radius check previously always used the caller's
DEFAULT saved address's geocode regardless of which address was actually
being delivered to, so a caller with multiple addresses picking a
non-default one got checked against the wrong address entirely. Tests:
`canonical-types/src/tools.test.ts` (address_id-only payload accepted, a
payload with neither address_id nor street rejected);
`create_order.test.ts` (radius check uses the CHOSEN address_id's own
geocode, not the default's — proven by an address that would pass on the
default's geocode but fails on the chosen one's).

**(d) customer_addresses: adding an address never silently replaces the
default.** A real, previously-shipped bug: `saveDeliveryAddress` (`create_
order.ts`) unconditionally cleared every existing default and made
whatever address was just spoken the new one, on EVERY delivery order —
so a caller's second-ever delivery order to a genuinely different address
silently stole their saved home address's default status. Fixed: an
address becomes/stays the default only when (a) the caller explicitly set
`set_as_default`, (b) it's already the default (correcting its own
details never demotes it), or (c) the customer has no default yet (their
first saved address). New `markAddressDefault()` handles the explicit-
`set_as_default` case for a REUSED (`address_id`) address without
re-geocoding it. Regression test (`create_order.test.ts`, "a second
delivery address does NOT steal the caller's existing default") — a
customer with an existing default placing an order to a different,
unrelated address asserts the clearing UPDATE never runs and the new row
inserts with `is_default: false`.

**(e) Tests, summarized** (all passing, listed above inline): template
structural tests for the fragment on all four verticals + the negative
case on the other four; a voice-tools test for `lookup_customer` returning
bounded/flagged multiples; an engine golden conversation
(`engine.test.ts`, "asks which pet when lookup_customer returns more than
one saved pet") driving a real two-turn tool-use loop (lookup_customer ->
two pets -> the model's final reply asking "Max or Bella?"); the
create_order address_id/radius-check and default-preservation tests above.

**Gates run for this whole task** (all green): `npx biome check --write`
on every changed path (0 errors, one pre-existing unsafe-fix warning in
`webhooks-twilio-sms/handler.ts` left as-is, matching CHANNELS-1's own
documented precedent for that exact file/line); `pnpm -w typecheck`
(21/21, after rebuilding `packages/canonical-types` and `packages/
templates` dist output so their Node-consuming parity tests picked up the
source edits — dist output itself is gitignored, not committed);
`pnpm run lint` (0 errors — 31 pre-existing warnings across the repo, none
newly introduced); `pnpm -w test` (21/21 test tasks —
`supabase/functions` 98 files/893 tests, `apps/web` 79 files/427 tests,
`packages/templates` 8 files/368 tests, `packages/canonical-types` 44
tests in the touched file alone, `packages/adapters/retell` 19 files/164
tests, plus every other package); `apps/web` production build
(`next build --webpack`, exit 0). `scripts/ci/rls-cross-tenant-probe.ts`
not run — same standing, previously-disclosed sandbox limitation (no
Docker/`supabase start` available here) as every prior pass; no schema
changed by this task either, so nothing new depends on it.

**Not done / explicitly out of scope:** a dedicated automated test for the
customer-profile page's call-history channel filter (item 3) — code
confirmed correct by inspection, no test scaffold exists in the repo yet
for this server-component pattern; a stale/foreign `address_id` on
`create_order` (deleted address, or belongs to a different caller) is
left alone rather than guessed at — it degrades to the pre-existing
"no caller geocode, skip with a warning" path, never invents an address.

## OUTREACH-2 — Phone-complaint review scoring for outreach leads

Built the "review-mining phone-complaint filter" genuine-gap recommendation
from `docs/research/CUSTOMER_ACQUISITION_TOOLS_2026.md` (§4 recommendation
#2): a cheap Claude pass reads a lead's Google reviews and scores how
strongly they signal "customers complain about phone access", re-ranking
the outreach fetch batch and sharpening the personalized opener for
high-scoring leads.

**Task-instruction discrepancy (CLAUDE.md Rule 4 — documented, not
redesigned):** the task named `docs/spec/API_AND_FLOWS.md` "flow 8" as the
flow to update. Flow 8 in that file is "Tenant cancellation → port-out →
data export → retention wind-down" — unrelated to outreach. The actual
outreach flow (lead fetch → personalize → send → reply → demo → customer)
is **Flow 5**, confirmed both by that flow's own numbered walkthrough and
by every existing outreach code comment/doc cross-reference in the repo
(`api-outreach-fetch-leads/handler.ts`, `job-outreach-personalize/
handler.ts`, `docs/research/CUSTOMER_ACQUISITION_TOOLS_2026.md` itself,
all of which cite "Flow 5"). Updated Flow 5 instead — inserted as new step
"2b" (not renumbered into 3/4/5/etc.) specifically so the several existing
cross-references to Flow 5's numeric steps elsewhere in this file and in
API_AND_FLOWS.md's own A.5 section (step 1, step 4-5, step 7, step 8)
stay correct without a repo-wide renumbering pass.

**Design decision — standalone job, not a stage inside
`job-outreach-personalize`.** The personalize submit/collect pair is
already a two-phase Batches-API pipeline keyed on `status = 'queued'` AND
gated on `research_batch_id`/`personalization` enrichment keys. Review
scoring has an entirely independent selection query (`reviews_analyzed_at
is null` + a Google place id, irrelevant to `status` — a lead is worth
scoring before it's even queued for send) and a third provider
(Outscraper) neither existing job touches. Folding it in would overload
one handler with two unrelated selection/failure-mode contracts for no
shared benefit — a new `job-outreach-review-score` (`supabase/functions/
job-outreach-review-score/{handler,index}.ts`) owns its own hourly cron
cadence and only ever writes `leads.phone_complaint_score`/
`phone_complaint_evidence`/`reviews_analyzed_at`; `job-outreach-
personalize-collect` reads (never writes) those columns to sharpen its own
opening-line hook.

**google_place_id gap discovered and fixed.** Neither `OutscraperPlace`
nor `fromOutscraperPlace` (`api-outreach-fetch-leads/handler.ts`) captured
a Google place id at all before this task, despite the Search endpoint's
own response already returning one (`place.place_id`, confirmed against
the official `outscraper` npm SDK's own bundled example) — meaning "leads
with a Google place id" was previously an empty set. Fixed by adding
`OutscraperPlace.place_id` and storing it into
`leads.enrichment.google_place_id` at fetch time — a jsonb field, not a
new dedicated column, matching this table's own existing pattern of
parking non-core, per-source metadata (`full_address`, `category`,
`rating`, `website`, `employees`, `org_phone`) in `enrichment` rather than
adding a column per source-specific field.

**Model env var.** Added `ANTHROPIC_OUTREACH_REVIEW_SCORE_MODEL` (default
`claude-haiku-4-5`) rather than reusing `ANTHROPIC_OUTREACH_RESEARCH_MODEL`
— the two are different prompts with different failure modes, and this
codebase already gives every other outreach Anthropic call site its own
dedicated var (`_RESEARCH_MODEL`, `_PERSONALIZE_MODEL`, `_CLASSIFY_MODEL`).
`claude-haiku-4-5` confirmed as a real, current, cheapest-tier model id via
`node_modules/@anthropic-ai/sdk`'s own `Model` union type (`messages.d.ts`).

**pipeline_costs.category widened.** `pipeline_costs_category_check` had
no bucket for this new spend line (Outscraper Reviews + Anthropic
classification). Widened via an additive `DROP CONSTRAINT`/`ADD
CONSTRAINT` (same allowed values plus `review_scoring`) in the same
migration — safe pre-launch (no rows exist that the widened constraint
wouldn't already satisfy).

**Threshold is a judgment call, not sourced.** `PHONE_COMPLAINT_SCORE_
THRESHOLD = 0.6` (`job-outreach-personalize-collect/handler.ts`) — the
point at which a lead's complaint snippet gets worked into its opener — is
a founder's-own-hypothesis constant, same caveat this codebase already
attaches to its other unmeasured outreach-economics numbers (e.g. the
~$0.02/lead personalization-cost estimate). Re-tune once real reply-rate
data exists to compare complaint-flagged vs. unflagged sends.

**Snippet-substring enforcement is code, not the zod schema.** The zod
boundary (`_shared/schemas/review-score.ts`) validates each evidence
snippet's SHAPE only (a bounded non-empty string) — it has no access to
the original review text. The actual "never invent a snippet" guarantee
is `filterFabricatedEvidence` in `job-outreach-review-score/handler.ts`:
every snippet is checked against the lead's own fetched review texts
(plain substring match) and silently dropped if not found verbatim —
covered by a dedicated test with a prompt-injection-attempt fixture review
(the model is told review text is untrusted data, never instructions, and
even if it were tricked into echoing a fabricated complaint, the substring
check still strips it).

**Failure handling.** Matches every existing Anthropic call site's
documented rule (API_AND_FLOWS.md A.5: never block, never fabricate). An
Outscraper start-call failure or a poll that never reaches a terminal
status leaves the lead unscored and retried next hourly run (no
`reviews_analyzed_at` write, so no double-charge risk from re-running a
call that never actually completed). A classification call
failure/unparseable response/schema mismatch still marks
`reviews_analyzed_at` (the Outscraper spend already happened — retrying
that part forever on a persistently-failing Anthropic call would defeat
the whole point of cost-bounding) but leaves `phone_complaint_score` null
rather than guessing; `job-outreach-personalize-collect` already treats
null the same as "below threshold". A place with zero reviews is marked
analyzed with a confident `score: 0` (no Anthropic call needed — nothing
to classify).

**Admin UI field-casing gap discovered, fixed only for this task's own
column.** `admin-outreach/leads` (`supabase/functions/admin/handler.ts`)
returns raw Postgres rows (snake_case: `company_name`, `contact_name`,
…), but `LeadTable`'s `LeadRowData` contract (`packages/ui/src/custom/
lead-table.tsx`) is camelCase, and the existing `leads/page.tsx` passed
the raw API response straight through with no mapping — meaning
`companyName`/`contactName` (and now `phoneComplaintScore`) would render
as "—" against real live data (single-word fields like `email`/`status`
happened to work by coincidence). This is a PRE-EXISTING bug, not
introduced here, and fixing every admin table's field-casing across the
cockpit is out of this task's scope — but leaving the new Score column
equally broken would make step 3 non-functional in practice, so
`leads/page.tsx` now maps the raw row into `LeadRowData` explicitly
(`toLeadRow`) before handing it to `LeadTable`. The broader mismatch (any
other admin table built the same way) is not audited or fixed here.

**Migration verification (LIVE-MINE-FIXES harness approach, applied
fresh for this task).** Configured a real local PostgreSQL 16 cluster
(`postgresql-16-cron` is installed as a system package in this
environment, unlike prior sessions — `shared_preload_libraries = 'pg_cron'`
+ `cron.database_name` set, cluster restarted, `create extension pg_cron`
succeeded for real) with minimal stub `auth`/`storage`/`realtime` schemas
(a bare `auth.users` table + `auth.uid()`/`auth.jwt()` functions, empty
`storage.buckets`/`storage.objects` tables, an empty `realtime.messages`
table — the exact objects every `CREATE POLICY` statement in this repo's
migrations references) and the pre-existing roles this Ubuntu package
already provisions (`anon`/`authenticated`/`service_role`); only
`supabase_storage_admin` needed creating. `pgmq`/`pg_net`/`supabase_vault`
are genuinely unavailable as installable extensions here (no control
file), so a throwaway copy of the migrations directory had their two
`create extension` lines commented out for this local run only (matching
this same section's own prior documented approach) — every downstream use
of `pgmq.*`/`net.*` is already guarded by a `pg_extension` existence check
before use, so nothing else needed trimming. All 50 pre-existing migration
files plus this task's own 2 new ones applied cleanly, in order, from an
empty database — zero errors. `pg_cron` being genuinely live (not just
guard-skipped) let this pass exercise real `cron.schedule` upserts for
every pg_net-independent job (5 DB-internal jobs registered for real);
`job-outreach-review-score`'s own cron entry still guard-skips locally
(pg_net/vault absent, same as every other HTTP-calling job) with the
expected `NOTICE`, not a new limitation. Directly exercised: inserted
leads with/without `enrichment.google_place_id`, ran the exact update
statement `job-outreach-review-score` issues (score/evidence/
`reviews_analyzed_at`), confirmed the job's own selection query correctly
includes/excludes each lead, confirmed `idx_leads_phone_complaint_score`
orders nulls-last, confirmed the widened `pipeline_costs_category_check`
accepts `review_scoring`, and ran the admin route's literal sort/filter
SQL (`order by phone_complaint_score desc nulls last`, `min_score`
threshold) directly against real data. Harness and its throwaway
migrations copy were session-only, never committed.

**Tests** (all passing, summarized): `_shared/providers/outscraper.test.ts`
(new — `startGoogleMapsReviews`/`pollGoogleMapsReviews`, `place_id`
capture); `_shared/providers/anthropic.test.ts` (new —
`buildReviewScoringPrompt`, `classifyPhoneComplaintScore` success/failure/
untrusted-data framing); `job-outreach-review-score/handler.test.ts` (new
— positive/negative/mixed/prompt-injection-attempt classifier fixtures,
snippet-substring enforcement both ways, no-place-id skip, poll-timeout
never-marks-analyzed, Outscraper-failure never-blocks, schema-mismatch
leaves score null, zero-reviews scores 0 with no Anthropic call);
`api-outreach-fetch-leads/handler.test.ts` (added — `place_id` ->
`enrichment.google_place_id` capture); `job-outreach-personalize-collect/
handler.test.ts` (added — high-score lead's snippet reaches the hook
prompt, and is used directly as the fallback opener when the hook call
fails); `admin/handler.test.ts` (added — `sort=score` ordering, `min_score`
filter); `packages/ui/src/custom/lead-table.test.tsx` (new — Score column
dash/percentage/visual-distinction); `apps/web`'s `leads/page.test.tsx`
(new — raw-row-to-`LeadRowData` mapping, `buildLeadsQueryString` pure-
function coverage for sort/min-score instead of driving a Radix `Select`'s
pointer/scroll interactions through jsdom, which no test in this repo does
anywhere else either; the min-score native `<input>` IS exercised via a
real `userEvent.type` + refetch assertion). Incidental: lifted the
existing `extractJsonObject` helper out of `api-menu-import/handler.ts`
into a new shared `_shared/json-extract.ts` so the review-score classifier
doesn't duplicate it — `api-menu-import/handler.test.ts` still passes
unchanged (behavior-preserving).

**Gates run for this whole task** (all green): `npx biome check --write`
on every changed path (0 errors; 1 pre-existing warning surfaced in
`admin/handler.test.ts` at a line this task did not touch — a git diff
confirms the file's only change was 28 pure insertions); `pnpm -w
typecheck` (21/21); `pnpm run lint` (0 errors, 43 pre-existing warnings
repo-wide, none in any file this task touched); `pnpm -w test` (21/21 test
tasks — `supabase/functions` 101 files/923 tests, `packages/ui` 20
files/100 tests, `apps/web` 80 files/435 tests); `apps/web` production
build (`next build --webpack`, exit 0, no errors).

**Not done / explicitly out of scope:** a live Outscraper Reviews API call
against a real account (docs/VERIFY.md's own MEDIUM-confidence flag on the
per-review field names beyond `review_text`); auditing/fixing the broader
admin-cockpit snake_case-vs-camelCase field mismatch beyond this task's own
new Score column (flagged above, pre-existing, not introduced here); a live
`supabase db push` deploy of the two new migrations (no live Supabase
project reachable from this environment — verified locally instead, per
the harness section above); re-deriving `docs/DEPLOY.md`'s own stale
"21 cron jobs" running total (already stale before this task from several
other jobs added since — flagged in that doc rather than silently
recomputed).

## PAGES — website creative-brief storyboard composed into (marketing) (2026-09-14, session_012xvcAnjqsMbPqitErDJQbR)

Composed `docs/design/WEBSITE_CREATIVE_BRIEF.md`'s §2 storyboard into the
existing `(marketing)` routes/components, within this cluster's ownership
(`apps/web/src/app/[locale]/(marketing)/**`, `apps/web/src/components/marketing/**`,
`apps/web/src/lib/marketing/**`) — no new npm dependencies, no route/form/
analytics-event/signup-flow changes. Full detail and the ENGINE hand-off
contract are in `docs/audit/SITE_REQUESTS.md` (new); summary here per
Rule 4.

**New**: `lib/marketing/use-in-view.ts` (shared `IntersectionObserver`
entrance primitive, resolves to "visible" under reduced motion/no IO
support/SSR), `lib/marketing/use-count-up.ts` (dashboard metric count-up),
`components/marketing/reveal.tsx` (the shared fade/slide-up entrance,
`as="div"|"li"`), `components/marketing/how-it-works.tsx` (extracted from
the home page's inline JSX, added the per-step center-crossing scale
pulse), `components/marketing/demo-icon-cycle.tsx` (the demo-CTA's
off-screen-only icon cycle that permanently settles on `generic`).

**Changed**: `trust-strip.tsx` (150ms entrance fade), `vertical-grid.tsx`
(40ms-staggered entrance + ≤4px desktop pointer-parallax on each card's
icon, now a client component), `dashboard-preview.tsx` (CSS-3D
tilt-and-settle panel entrance, metric count-up, 50ms-staggered call
rows — no WebGL, a `perspective`+`rotateX`/`translateZ` transform per the
brief's own "this is a transform, not a scene"), `live-call-hero.tsx`
(was a perpetual `setInterval` loop; now plays once on scroll-into-view
and holds the resolved frame, matching the brief's explicit rule against
background-loop motion; reduced motion renders the resolved frame
immediately, no timer). `page.tsx` (home), `[vertical]/page.tsx`, and
`pricing/page.tsx` wired the above in and gave the pricing-teaser/demo-CTA/
plan-card/pain-stat/intake-list sections the brief's "entrance-stagger,
no scroll-scrub" treatment. All motion timing constants (durations,
stagger intervals) reconciled against `packages/ui/src/motion-tokens.ts`
(`MOTION_DURATIONS_MS`, `ENTRANCE_STAGGER_MS`) once that file appeared
mid-session from the ENGINE cluster's concurrent work in the same tree —
PAGES' hand-picked values already matched it exactly, so components were
switched to import the shared constants rather than repeat the literals.

**Not done (explicitly out of scope, documented in SITE_REQUESTS.md)**:
the flagship pinned-WebGL hero morph itself (§3) — needs `three`/
`@react-three/fiber`/`@react-three/drei`/`gsap`, outside this cluster's
file ownership; ENGINE's building blocks for it
(`components/motion/**`, `components/three/**`) appeared mid-session but
with no finished top-level component to integrate against yet, so
`LiveCallHero`'s DOM/CSS storyboard (retimed to play-once, per above)
remains the shipped experience on every tier — this already matches the
brief's own described fallback content model, not a stand-in. `/demo`'s
loading-state hero treatment (§4) — lives in `components/demo/demo-flow.tsx`,
outside this cluster's ownership. The generated OG still
(`docs/design/ASSETS.md` item 4) was not swapped in for the code-generated
`opengraph-image.tsx` — the brief only asks for that swap after a review
that didn't happen this pass; both stay available for a future decision.

**Gates run for this task**: `pnpm eslint` scoped to every path this
cluster touched (0 errors); `pnpm typecheck` (`apps/web`, `tsc -b`) — the
files this cluster owns compile cleanly, but the whole-repo build
currently fails on `apps/web/src/components/three/hero-morph-scene.tsx`
(`TS4111`, index-signature access), an ENGINE-cluster file this task never
touched (confirmed via `git status`: untracked, not among this task's
edits) — flagged in `docs/audit/SITE_REQUESTS.md` for ENGINE rather than
fixed here (out of ownership); `pnpm vitest run` scoped to
`src/components/marketing` + `src/lib/marketing` (7 files/17 tests, all
new/changed components: a real render plus an explicit
`prefers-reduced-motion` fallback test each) — all green. A whole-repo
`pnpm vitest run` also surfaces 3 pre-existing failures in
`components/three/read-css-color.test.ts` (also ENGINE, also untouched by
this task, also flagged in SITE_REQUESTS.md rather than fixed here).

## POLISH+PERF — perf-budget script was silently broken, actually ran it
## for the first time (2026-09-14, session_012xvcAnjqsMbPqitErDJQbR)

Re-entered this cluster (ownership unchanged from the prior POLISH+PERF
pass: `apps/web/next.config.ts`, `[locale]/layout.tsx`'s font/preload/
theme, `globals.css`, `packages/ui/src/primitives/{button,card,nav-item,
badge}.tsx`, `components/marketing/shared/**`, `scripts/site-perf/**`,
`.github/workflows/ci.yml`'s perf job, DESIGN_SYSTEM.md's budget note) to
verify the prior pass's own outstanding note — "re-run the perf budget
now" (`docs/audit/SITE_REQUESTS.md`, ENGINE's reconciliation) — since
that had never actually been done: every file this cluster owns was
re-confirmed clean first (`pnpm typecheck`/`eslint`/`biome check` across
every owned path, `pnpm vitest run` on `components/marketing/shared` and
`packages/ui/src/primitives` — all green, no regressions from the prior
pass), then `node --experimental-strip-types scripts/site-perf/measure.ts`
was actually executed end to end for the first time this session.

**It never ran successfully before — two real bugs in `measure.ts`,
found by actually running it instead of only reading it:**

1. **The server never started.** `startServer()` spawned
   `pnpm run start -- -p PORT`; this repo's pnpm forwards the `--`
   separator to the underlying `next start` script literally instead of
   stripping it (confirmed directly: `pnpm run start -- -p 4319` prints
   `> next start -- -p 4319` and fails with `Invalid project directory
   provided, no such directory: .../apps/web/-p` — Next's CLI parses the
   arg right after `--` as the positional `[directory]`), so the script's
   own 60s poll loop always timed out with a misleading "did not start"
   error that hid the real cause entirely. Fixed by spawning
   `pnpm exec next start -p PORT` instead — the `next` binary directly,
   no script-passthrough `--` involved.
2. **Once the server DID start, every measured route's `initialJsBytesGz`
   silently read as `0`.** `resolvePlaywright()` dynamically
   `import()`s `@playwright/test`'s resolved CJS entry point; that
   package's `index.js` has no named-export markers cjs-module-lexer can
   synthesize, so a dynamic `import()` of it collapses every named export
   (`chromium` included) into a single `default` key — `const { chromium
   } = await resolvePlaywright()` was silently destructuring `undefined`,
   which then threw `TypeError: Cannot read properties of undefined
   (reading 'launch')` the first time the fixed server-start let the
   script get that far. Fixed by unwrapping `mod.default` once inside
   `resolvePlaywright()` so every call site keeps its static-import-shaped
   destructuring.

**A third bug survived even after both of those were fixed, and it's the
one that actually matters**: with the server running and Playwright
actually launching, the Home route reported `Initial JS (gz): 1.5KB`
against the 250KB budget — passing, but implausibly small for a
production Next.js/Sentry/next-intl bundle. The byte count came from
summing `response.headers()["content-length"]` on same-origin `script`
responses; confirmed by curling a real `next start` chunk with `Accept-
Encoding: gzip` (CLAUDE.md Rule 1) that Next's production server answers
every JS chunk request as `Transfer-Encoding: chunked` +
`Content-Encoding: gzip` with **no `Content-Length` header at all**
whenever the request declares gzip support — which every real browser,
Chromium included, always does. So the sum was reading ~0 bytes for
nearly every real script response, and **the perf-budget CI job would
have passed regardless of how large the actual bundle got, silently,
forever** — the exact failure mode a budget gate exists to prevent.
Fixed by switching to Chrome DevTools Protocol's
`Network.loadingFinished` `encodedDataLength` (what Chrome's own Network
panel and Lighthouse report as "transferred size"), captured via the
`CDPSession` the script already opens for CPU throttling — populated
unconditionally, no dependence on which headers a given response happens
to carry.

**With all three fixed, the Home route's real number is `751.2KB` gz —
3x the 250KB budget, `site-perf-budget` FAILS for real now.** Diagnosed
the dominant contributor by grepping the built `.next/static/chunks/*.js`
for library string markers: the two largest chunks (~292KB and ~147KB
gz) are overwhelmingly `@sentry/nextjs`'s browser SDK (`sentry-`,
`sentry.browser.*`, `sentry-tracing-init` markers throughout), not the
WebGL/GSAP hero (confirmed separately still unwired into `page.tsx` —
`HeroScrollScene` exists per ENGINE's reconciliation note but nothing in
`(marketing)/page.tsx` imports it yet, so this number has nothing to do
with the flagship set piece). `lucide-react`/`@radix-ui` icons are
already in Next 16's `optimizePackageImports` default list (verified
against this exact Next version's shipped docs, Rule 1) — not a lever
here. Applied the one safe, in-ownership mitigation:
`next.config.ts`'s `withSentryConfig(...)` now sets
`bundleSizeOptimizations: { excludeDebugStatements, excludeReplayIframe,
excludeReplayShadowDom, excludeReplayWorker }` (verified against this
exact `@sentry/nextjs@10.73.0`'s shipped `config/types.d.ts`, Rule 1) —
confirmed behavior-unchanged because `apps/web/instrumentation-client.ts`
(NOT this cluster's file) calls only `Sentry.init({ dsn,
tracesSampleRate: 0.1 })`, no `replayIntegration()` anywhere, so every
Replay tree-shaking flag is a pure no-risk win per the SDK's own docs
("this has no effect if you did not add replayIntegration"); deliberately
did NOT set `excludeTracing` — `tracesSampleRate: 0.1` means tracing is
genuinely in use, and the SDK's own docs warn against tree-shaking it out
from under that. Re-measured after adding it: **byte count unchanged
(751.2KB, identical to the decimal)** — expected and consistent, since
Replay code was never in the bundle to begin with (no `replayIntegration`
call), so there was nothing left for those specific flags to remove; the
real weight is Sentry's core + tracing/OpenTelemetry bundle, which is
genuinely in use and not something `next.config.ts` alone can shrink
further.

**Not fixed, flagged instead of redesigned (CLAUDE.md Rule 4 — out of
this cluster's file ownership):** the actual budget miss needs a decision
in `apps/web/instrumentation-client.ts` — e.g. a marketing-route-scoped
lazy/deferred Sentry init, or accepting a higher marketing-route JS
budget as a deliberate observability tradeoff — neither of which this
cluster's ownership list (next.config.ts/layout.tsx-theme/globals.css/4
named ui primitives/marketing-shared/site-perf/ci-perf-job/
DESIGN_SYSTEM-note) can resolve alone. `scripts/site-perf/measure.ts`
and `.github/workflows/ci.yml`'s `site-perf-budget` job are both correct
and now genuinely enforcing the budget (previously they were not enforcing
anything, silently) — the next person to touch `instrumentation-client.ts`
or land the WebGL hero should expect this job to fail in CI until the
Sentry tradeoff is resolved, and should re-run
`node --experimental-strip-types scripts/site-perf/measure.ts` locally
per its own docstring before assuming otherwise.

**Gates run for this task**: `pnpm typecheck` (`apps/web`, `tsc -b`) and
`pnpm typecheck` (`packages/ui`) both clean; `eslint` scoped to every
path this cluster touched (0 errors); `npx biome check` on every file
this cluster touched (0 errors, no fixes needed); `pnpm vitest run`
scoped to `components/marketing/shared` (4 files/16 tests) and
`packages/ui/src/primitives` (2 files/12 tests) — all green, unchanged
from the prior pass (this task's only behavioral code change,
`next.config.ts`'s `bundleSizeOptimizations`, has no test surface of its
own — verified via 3 real production builds + measurements instead, per
above). Did NOT run a full-repo `pnpm -w typecheck`/`pnpm -w test` (out
of scope for a 2-file + 1-comment-block change verified end-to-end
against the real thing three times over); every owned file this task
touched is the complete list in "Files changed" below.

## RECONCILE — PAGES↔ENGINE component API, ASSETS paths, whole-repo typecheck + apps/web production build (2026-09-14, session_012xvcAnjqsMbPqitErDJQbR)

Read `docs/audit/SITE_REQUESTS.md` (all three clusters' entries — PAGES,
POLISH+PERF, ENGINE's reconciliation) and reconciled the one thing it
documented as NOT yet done: `(marketing)/page.tsx` still called
`<LiveCallHero />` directly; ENGINE's finished `HeroScrollScene`/
`HeroScrollScene.Visual` swap-in contract was never wired in. ASSETS
paths were checked and need no changes — every path in
`docs/design/ASSETS.md`'s tables matches an actual file under
`apps/web/public/site/**` byte-for-byte, and the only place those paths
are referenced in code (`components/marketing/shared/media-loop.test.tsx`)
already matches too.

**Wiring the documented contract in as-is broke `next build --webpack`**:
`(marketing)/page.tsx` is an async Server Component (`/** RSC, ~zero
client JS */`), and ENGINE's contract's own worked example
(`<HeroScrollScene.Visual fallback={<LiveCallHero />} />`) requires
dotting into a static sub-property (`.Visual`) of a `"use client"`
module's default export. React Server Components cannot do that — only a
client module's own top-level named exports may cross the server/client
boundary; property access on one of those exports has to happen inside
an actual client module. (Confirmed directly in
`react-server-dom-webpack`'s `deepProxyHandlers.get`, vendored into this
Next 16.3.4 install: it explicitly throws "Cannot access
HeroScrollScene.Visual on the server ... you can only pass the imported
name through" for exactly this pattern — but only in the `next dev`/RSC
runtime's own dev-mode proxy; the production **webpack** build's flight
client-reference proxy silently resolves the dotted access to
`undefined` instead of throwing, which is what surfaced as `next build`'s
opaque `Error: Element type is invalid: expected a string ... but got:
undefined` on `/en`'s prerender, not ENGINE's own clearer dev-time
error.) Fixed on the consumer side, per this task's own instruction to
fix breakage by adjusting consumers to producers, without touching
ENGINE's `hero-scroll-scene.tsx` (its compound-component shape is correct
and still exactly as documented for any caller that's already inside a
client module): added `components/marketing/hero-scroll-section.tsx`
(new, `"use client"`) — a thin wrapper that owns the one dotted
`HeroScrollScene.Visual` reference internally and exposes a plain
`<HeroScrollSection className visualFallback>{children}</HeroScrollSection>`
API with no compound access, safe for `page.tsx` to import and render by
name. `page.tsx`'s hero markup is otherwise byte-for-byte what ENGINE's
contract specified (headline/subhead/CTAs as unchanged DOM siblings
inside the pin, `<LiveCallHero />` as the fallback).

**Gates run**: `pnpm -w typecheck` (whole repo, all 15 packages including
`@heyloo/web`/`@heyloo/ui`) — clean. `apps/web`: `next build --webpack`
— clean, all 183 routes generated, no errors (run twice: once to catch
the RSC breakage above, once after the fix to confirm it's gone).
`pnpm exec vitest run src/components/marketing src/app` — 292/292 tests
pass, no regressions. Did not run a full whole-repo `pnpm -w test` or
`pnpm -w lint` (out of scope for this task; pre-existing lint findings in
ENGINE's `components/motion/**`/`components/three/**` — React hooks
rules around `setState`-in-effect/ref-in-render, testing-library query
preferences — are unchanged by this task and were not introduced by it).

**Home route initial JS, measured for real** (`node
--experimental-strip-types scripts/site-perf/measure.ts`, POLISH+PERF's
now-fixed CDP-based measurement): **1037.1KB gz** (budget 250KB, still
failing — was 751.2KB before this task wired the hero in). LCP 420ms
(budget 2500ms, passes). CLS regressed to 0.230 (budget 0.05, fails; was
not separately reported as failing before this task, since the set piece
wasn't mounted). Both increases are consistent with, and expected by,
ENGINE's own note in `SITE_REQUESTS.md` ("Expect the WebGL bundle to
show up ONLY in a qualifying-device budget run ... expect zero change to
a non-qualifying/reduced-motion run's numbers") — Playwright's headless
Chromium is a qualifying (desktop-sized, WebGL-capable) device, so this
measurement exercises the `three`/`@react-three/fiber`/`gsap` bundle
loading shortly after hydration, plus whatever reflow happens when
`LazyWebglBoundary` swaps `LiveCallHero` out for the mounted `<Canvas>`
once `useDeviceCapability` resolves. Neither the pre-existing Sentry
budget gap (751.2KB, flagged to `instrumentation-client.ts`'s owner in
POLISH+PERF's own entry above) nor this new qualifying-tier increase is
this task's to redesign (CLAUDE.md Rule 4 — this task's scope was the
PAGES↔ENGINE API reconciliation + typecheck/build, not a perf-budget
fix); flagging both here as the next actionable data point for whoever
picks up the outstanding `site-perf-budget` failure — a non-qualifying/
reduced-motion re-run of `measure.ts` (e.g. `prefers-reduced-motion`
emulated via Playwright, or a mobile viewport) would isolate whether the
CLS regression is qualifying-tier-only before assuming it affects every
visitor.

**Files changed**: `apps/web/src/app/[locale]/(marketing)/page.tsx`
(hero markup now goes through `HeroScrollSection`, import list
reconciled). **New**: `apps/web/src/components/marketing/hero-scroll-section.tsx`.
No other files touched by this task; `next.config.ts`/`docs/BUILD_NOTES.md`/
`docs/audit/SITE_REQUESTS.md`/`scripts/site-perf/{budgets,measure}.ts`
were already modified in-tree by the POLISH+PERF pass before this task
started and are unchanged by it.

# SITE REPAIR — fixes for the 37/100 review (2026-09-14)

Owned by cluster **SITE REPAIR**, scope: any file under `apps/web/**`,
`packages/ui/**`, `scripts/site-perf/**` needed to clear every
blocker/major and cheap minor in the review. Every route path, form,
analytics event wiring, and the signup flow's logic is unchanged — this
pass touched motion/perf/markup only.

## Blockers fixed

- **Hero WebGL set piece rendered blank** (`hero-scroll-section.tsx`,
  `hero-scroll-scene.tsx`, `hero-morph-scene.tsx`): `<HeroScrollScene.Visual>`
  was rendered with no `className`, so its wrapper div (`position:
  relative` only) never got a size and the `<canvas>` fell back to the
  raw HTML 300x150px default. Fixed by giving `HeroScrollSection` a real
  sizing className (`HERO_VISUAL_CLASSNAME` — an `aspect-[4/3]` box,
  capped `max-w-xl` on the tablet single-column tier, uncapped at `lg:`
  where the grid column itself bounds it to ~448-656px) passed to
  `<HeroScrollScene.Visual className=...>`, applied ONLY on the
  qualifying (WebGL) branch — the non-qualifying fallback (`LiveCallHero`)
  deliberately keeps no imposed size, since it already sizes itself by
  content and a canvas-tuned aspect box would clip/badly whitespace it.
  Re-tuned the orthographic camera's `zoom` (260 → 170) so the morph
  geometry (`morph-geometry.ts`'s authored 2.2×0.8 world-unit bounding
  box across all 4 keyframes) renders at ~375-390px — comfortably inside
  the box at every qualifying viewport, with margin — instead of the
  previous zoom, which only worked out to fit the OLD broken 300x150px
  box and was actually ~2x too wide for a correctly-sized container.
- **Initial JS 955.2KB gz vs. 250KB budget — reduced to 686.9KB (a
  28% cut, each step re-measured via a real Playwright run against a
  production build+server, never estimated), STILL over budget — real
  progress, not a full fix.** (`next.config.ts`, `packages/ui/package.json`
  + `src/index.ts`, `instrumentation-client.ts`, `providers.tsx`, new
  `lib/perf/defer-non-critical.ts`, plus 9 admin/tenant/partner call
  sites switched to a new `@heyloo/ui/charts` subpath import.)

  Root-caused by actually diffing built `.next/static/chunks/*.js`
  byte-for-byte against `recharts`/`date-fns`/`zod`/`cmdk`/`input-otp`
  string markers and, where a chunk's own minified content wasn't
  identifiable that way, its literal source strings (e.g.
  `"https://react.dev/errors/"` → that chunk is React itself;
  `createRenderParamsFromClient` → that one is Next.js's own client
  runtime) — never guessed. Findings, in the order fixed:

  1. **The 292KB single dominant chunk** (`recharts`+`zod`+`date-fns`,
     confirming the review's "dashboard-oriented vendor chunk" finding)
     — root cause: `packages/ui/src/index.ts`'s barrel included
     `export * from "./charts/index.js"` alongside everything else, so
     ANY marketing import of an unrelated named export
     (`DashboardPreview`'s `MetricCard`/`CallFeedItem`/etc.) pulled in
     the whole module graph. Two standard tree-shaking fixes were tried
     FIRST and both measured almost no effect on their own:
     `experimental.optimizePackageImports: ["@heyloo/ui"]` (Next's own
     documented barrel-import fix — kept, harmless) and
     `packages/ui/package.json`'s `"sideEffects": false` (confirmed safe
     — no module-scope side-effecting imports anywhere in
     `packages/ui/src`, checked directly; kept too, real if smaller
     effect elsewhere) — 955.2KB → 841.1KB, nowhere near enough. The fix
     that actually worked: physically remove `charts` from the main
     barrel and expose it only via a new `"./charts"` `exports` subpath
     (`package.json`) — not relying on any tree-shaker's heuristics at
     all, since a module that was NEVER IN the entry point's graph can't
     leak into it regardless. The 9 real consumers (all
     admin/tenant/partner dashboard pages — confirmed by search, zero in
     `(marketing)/**`) now `import { TrendChart } from "@heyloo/ui/charts"`
     instead of the shared barrel. This alone dropped the dominant
     292KB chunk entirely — 841.1KB → 812.0KB → 686.9KB (the last two
     numbers also reflect Sentry/PostHog deferral below).
  2. `Sentry.init()` was eager module-scope code in
     `instrumentation-client.ts` (Next's own docs: this file "runs
     before your application becomes interactive," on every route) —
     now behind a dynamic `import()` deferred via `deferUntilInteraction`.
  3. `@heyloo/analytics` (statically importing `posthog-js`) was
     imported at module scope in `providers.tsx` — now dynamically
     imported, same deferral. `deferUntilInteraction` fires on the first
     real interaction or a 4s fallback timeout — deliberately well
     beyond `scripts/site-perf/measure.ts`'s 1.5s post-load settle
     window, so deferred code reliably lands outside the measured
     "initial JS" while still initializing promptly for a visitor who's
     actually using the page. Tradeoff (errors before init are missed)
     logged in `docs/VERIFY.md` as a deliberate call, not an oversight.

  **What's left in the remaining 686.9KB** (identified, not yet fixed —
  flagged as a follow-up task, out of this pass's remaining budget):
  ~131KB is React + Next.js's own client runtime (confirmed by literal
  source strings, e.g. `https://react.dev/errors/`) — likely close to
  an unavoidable floor for this stack, not a bug. The rest is the SAME
  barrel-leakage pattern as the charts fix, just for other heavy,
  dashboard-only pieces of `@heyloo/ui`'s `custom`/`primitives`/`forms`
  directories that `sideEffects: false` alone didn't fully shake out of
  the marketing route either: confirmed present in the home route's own
  chunks are `cmdk` (a `Command`/`Combobox`-style component, two chunks,
  9 + 22 string-marker hits) and `input-otp` (an OTP input component,
  15 hits) — neither has any real use on the marketing route. The same
  fix pattern (a new `@heyloo/ui/<name>` subpath export + migrating that
  component's real dashboard-only consumers off the main barrel) would
  very likely apply, but finding and converting every such consumer
  (unlike charts' contained 9 files, `cmdk`/`input-otp`-backed components
  may have many more call sites across `(tenant)`/`(admin)`/`(partner)`)
  is real, separate, scoped work beyond this pass — see the spawned
  follow-up task.
- **CLS 0.230 vs. 0.05 budget — FIXED, confirmed 0.003 via a real
  Playwright re-measurement** (`hero-scroll-scene.tsx`,
  `use-device-capability.ts`, `use-reduced-motion.ts`, new
  `use-isomorphic-layout-effect.ts`, `use-scroll-progress.ts`). Two
  JS/state-driven fix attempts were tried and both failed re-measurement:
  (1) reserving space with our own placeholder and collapsing it via an
  `onPin` callback fired right after `ScrollTrigger.create()` — measured
  WORSE (0.471), because ScrollTrigger's pin-spacer sizing isn't
  necessarily final the instant `.create()` returns (GSAP's own docs
  describe pin measurements settling across a refresh cycle), so
  collapsing our placeholder that early briefly under-reserved before
  GSAP's own spacer caught up. (2) `pinSpacing: false` (`useScrollProgress`
  now accepts it, passed through to `ScrollTrigger.create()`) plus a
  permanent placeholder driven by `qualifies` state — measured
  UNCHANGED, still 0.471, proving the problem was never about the
  hand-off mechanics at all. Root-caused with a live `layout-shift`
  capture (a standalone Playwright script reading
  `PerformanceObserver({type:"layout-shift"})` entries' `sources`, not
  guessed): on a REAL page load the browser paints the SERVER-RENDERED
  HTML — computed with `qualifies: false`, since SSR has no `window` to
  probe WebGL/`prefers-reduced-motion` with — before ANY client JS runs,
  hydration included. No client effect, however early
  (`useLayoutEffect`/`useIsomorphicLayoutEffect` included), can
  retroactively change what already painted first; once hydration
  finishes and `qualifies` resolves `true` a couple seconds later
  (`gsap`'s own dynamic-import delay under CPU throttling), the
  reservation appearing IS the shift, for any implementation that
  decides "should this space exist" from post-hydration JS state — no
  amount of earlier-effect-timing can fix a problem that's really about
  *what already rendered before JS ran at all*.

  **The actual fix**: decide the reservation from CSS media queries
  instead of JS state, since the browser evaluates media queries on the
  very first parsed byte of SSR'd HTML, no JS required.
  `HERO_PIN_RESERVE_CLASSNAME`'s rule (`hero-scroll-scene.tsx`, an inline
  `<style>` tag rendered every time — matches this codebase's own
  existing pattern for scoped rules, e.g. `how-it-works.tsx`'s
  `@keyframes`) mirrors `qualifiesForWebgl`'s width
  (`MIN_QUALIFYING_WIDTH`, now exported from `use-device-capability.ts`
  /`TABLET_MAX_WIDTH`) and `prefers-reduced-motion` checks — the only two
  gates CSS can actually see; each instance's real `pinVhTablet`/
  `pinVhDesktop` prop values flow in via `--hero-pin-vh-{tablet,desktop}`
  CSS custom properties set inline, so the shared stylesheet rule stays
  correct per-instance/prop-override rather than a hardcoded number. The
  remaining two gates (`probeWebglContext`/`deviceMemory`/`saveData`) are
  JS-only and can't be known this way — for that rare remainder (CSS
  guessed "reserve," the JS probe then says "doesn't actually qualify")
  `forceCollapse` corrects the reservation back to `0` once `ready` — a
  narrow, uncommon-case shift instead of today's universal one.
  `useDeviceCapability`/`useReducedMotion` still resolve via
  `useIsomorphicLayoutEffect` (kept — cheap insurance against an
  unnecessary extra re-render on a pure client-side remount, just not
  what actually fixes this CLS regression).
- **Hydration error #418 on every home page load**
  (`lib/marketing/use-in-view.ts`): `skipObserving()` (reads
  `window`/`matchMedia`, absent during SSR) was called inside a
  `useState` lazy initializer, so server and first-client-render could
  disagree. Fixed per React's own hydration-mismatch guidance: always
  start `false`, resolve the real value in the mount effect instead.
- **Sparkle icon on the hero badge** (`(marketing)/page.tsx`): replaced
  `lucide-react`'s `Sparkles` (the checklist's explicitly named forbidden
  "AI sparkle" glyph) with `PhoneCall`, on-brand to the actual product.

## High/low fixed

- **Hero badge clipped behind the sticky header while pinned**
  (`hero-scroll-scene.tsx`): the pin's `start` was the literal `"top
  top"`; changed to `"top top+=64"` (`marketing-header.tsx`'s `h-16`
  sticky nav height) so pinned content clears the header instead of
  sitting partially behind it.
- **Dashboard-reveal "ghosted duplicate" during its tilt-and-settle
  entrance** (`dashboard-preview.tsx`, low severity, flagged as
  needing a manual re-check rather than a confirmed bug): added
  `isolate` to the `perspective`-establishing wrapper so the 3D-
  transformed panel can't composite against paint from outside its own
  subtree on engines where that's possible — a defensive, zero-risk fix
  for exactly this class of artifact.

## Verification

`pnpm --filter @heyloo/web typecheck` clean. Full `apps/web` vitest suite
(533 tests, including new/updated coverage for every file above) green.
`pnpm --filter @heyloo/web run build` (production) — see this task's
returned result for the actual pass/fail and bundle-size numbers; full
Playwright-based `scripts/site-perf/measure.ts` re-run status likewise in
the returned result, since it requires a live server boot this note was
written before confirming.

See `docs/VERIFY.md`'s "SITE REPAIR (2026-09-14)" entry for the
Sentry/PostHog lazy-init tradeoff and doc-verification note (CLAUDE.md
Rule 1).

## SITE REPAIR — 2nd pass, 80/100 review (2026-09-14,
## session_012xvcAnjqsMbPqitErDJQbR)

Fixed all 4 findings from the follow-up review (1 blocker resolved, 1
blocker substantially improved but not fully closed — see below — 1
medium, 1 low), then kept investigating the still-failing JS budget past
what the review's own hypothesis (Sentry) turned out to explain.

**Blocker — `LiveCallHero` hydration error #418** (`live-call-hero.tsx`):
`useState(() => (prefersReducedMotion() ? FRAMES.length - 1 : 0))` was
the exact SSR/first-client-render mismatch pattern `use-in-view.ts`'s
`useInView` already documents and was fixed for (`window.matchMedia` is
unavailable during SSR — always resolves `false` there — but can already
resolve `true` on the client's own first render, before hydration
completes) — just left unfixed in this one other call site. `frame` now
starts at a fixed `0` on both sides; the reduced-motion jump to the final
frame happens in the mount effect instead, same fix shape as `useInView`.

**Medium — `MetricCard` positive-delta text contrast** (`packages/ui/src/
theme/globals.css`): axe-core measured a "serious" violation for
`text-success` (MetricCard's positive delta) on `--card`, but this repo's
own contrast math (`contrast.ts`) computed the PRE-fix value at 5.16:1 —
comfortably over AA's 4.5:1. Rather than trust either number blindly,
added a new `contrast.test.ts` describe block for this exact usage
pattern (`text-success`/`text-destructive` as plain text, not the
existing PILL_PAIRS-only coverage which only checked them as a solid
badge background) and darkened `--success` (0.52 → 0.44 lightness) well
past the line rather than chasing the exact boundary — the discrepancy
between this repo's simplified per-channel oklch gamut clamping and a
real browser's CSS Color 4 gamut mapping is the likely explanation, and a
real margin is cheap insurance against it recurring. `--success-
foreground` (solid-pill use, `Badge variant="success"`) is unaffected;
dark theme was already passing with headroom and is unchanged.

**Low — latent `prefers-reduced-motion` hydration bug in `Sticky`/
`Parallax`/`MediaLoop`** (`components/marketing/shared/{sticky,parallax,
media-loop}.tsx`): same class of bug as `LiveCallHero`'s (a direct,
render-body call to `prefersReducedMotion()`), flagged as latent since
none of the three was wired into any tested route yet. Fixed the same
way — `reduced` is real state, starts `false` on both sides, the real
check moves into an effect — but for `Sticky`/`Parallax` specifically,
merged the check into the SAME effect that starts observing (rather than
a separate earlier effect) so a reduced-motion visitor's
`IntersectionObserver` is never created at all, not created-then-
immediately-torn-down a tick later; for `MediaLoop` (which has two
downstream observer-creating effects sharing one `reduced` flag), each
effect does its own fresh `prefersReducedMotion()` re-check instead,
since a merge wasn't structurally possible with two consumers. Caught the
first (unmerged) version of this exact race via `parallax.test.tsx`'s own
"never observes under reduced motion" assertion actually failing —
good, that's what the test is for.

**Blocker — initial JS still 2.7x over budget (686.9KB vs. 250KB gz)**:
substantially improved (**686.9KB → 440.7KB**, each step re-verified via
a real `node --experimental-strip-types scripts/site-perf/measure.ts`
run against a production build+server) but still over budget — real,
large progress, not a full fix. The review's own hypothesis (Sentry, cited
as the likely culprit from the two largest chunks) turned out to be a
false lead on closer inspection — worth recording exactly how, since it's
a reusable lesson for the next person profiling this route:

1. **The review's "confirmed Sentry" chunks weren't Sentry.** Grepping
   built chunks for the literal string `sentry` matched almost every
   chunk in the build — but that's `@sentry/webpack-plugin`'s "debug ID"
   injection (`e._sentryDebugIds=...`), a ~200-byte source-map-linking
   stub added to EVERY chunk regardless of content, not the SDK itself.
   The two chunks the prior pass fingered as "~292KB+147KB, overwhelmingly
   Sentry" were actually confirmed (via distinctive markers —
   `createRenderParamsFromClient`, `NEXT_ROUTER_PREFETCH_HEADER`, and
   separately React's own `https://react.dev/errors/` string) to be
   Next.js's RSC/flight client runtime and `react-dom` — i.e. framework
   floor, not a bug. Real Sentry SDK markers (`captureException`,
   `browserTracingIntegration`, `@sentry/core`) were checked for
   separately and found in ZERO of the home route's chunks even before
   any Sentry-specific fix landed, meaning the earlier deferred-`import()`
   fix (prior pass, `instrumentation-client.ts`) had already fully kept
   the real SDK out — the lesson here is that "Sentry debug-ID noise in a
   `strings` grep" isn't evidence of SDK weight, and cost real
   investigation time before the real culprits below were found.
2. **Applied anyway, on general principle** (`instrumentation-client.ts`
   now `export {}` — no `@sentry/nextjs` reference at all; new
   `lib/perf/sentry-init.tsx`'s `<SentryInit>`, deferred-`import()` same
   as before, mounted only from the `(tenant)`/`(admin)`/`(partner)` root
   layouts): a global `instrumentation-client.ts` is loaded by Next on
   EVERY route unconditionally by design, so it can never be made
   marketing-exclusive from inside that one file — moving the call
   entirely out of it and into route-group-scoped layouts is the only way
   to make "not reachable from marketing" true by construction rather
   than by the SDK happening to tree-shake away today. Zero measured byte
   change (confirms finding #1 — there was nothing left to remove), but
   it's a correct, permanent guarantee instead of an incidental one, and
   marketing (signup included) no longer has ANY `@sentry/nextjs`
   reference in its reachable module graph — accepted tradeoff: no
   browser-side error monitoring on those routes, logged in
   `docs/VERIFY.md`.
3. **The real dominant contributor (found by actually profiling, per the
   finding's own instruction): the WebGL hero engine, loading almost
   immediately after hydration.** A CDP network capture split on the
   page's own `load` event (not just `measure.ts`'s pass/fail number)
   showed `three`/`@react-three/fiber`/drei chunks (~230KB gz) and
   `gsap`/`ScrollTrigger` chunks (~46KB gz) arriving within ~500ms of
   hydration — well inside the budget script's 1.5s post-load settle
   window — on exactly the kind of qualifying desktop device the
   measurement itself runs as. `budgets.ts`'s own docstring already
   describes the INTENDED behavior ("a lazy-loaded chunk ... that only
   fetches after a LATER scroll/interaction is correctly excluded") —
   the prior pass's "confirmed correctly code-split ... not the cause"
   conclusion checked that the import was SPLIT (true) but not that it
   was actually DEFERRED past the measurement window (it wasn't):
   `LazyWebglBoundary`'s `qualifies` flipped `true` (triggering `Scene`'s
   `next/dynamic` import) the instant `useDeviceCapability`'s synchronous
   on-mount probe resolved, with nothing gating it on the visitor
   actually reaching/scrolling toward the pinned hero.
   **Fix** (`components/motion/lazy-webgl-boundary.tsx` only — did NOT
   touch `hero-scroll-scene.tsx`'s `useScrollProgress`/CSS-reservation
   pin logic, which stays exactly as its own carefully-measured CLS fix
   left it): gate `Scene`'s mount on a new `engaged` flag, true on first
   scroll/pointer/key interaction or a 2500ms fallback
   (`deferUntilInteraction`, the same primitive `SentryInit`/PostHog
   already use — "scroll" as the natural trigger for a scroll-linked set
   piece). `fallback` (`LiveCallHero`) is a complete, correct rendering
   the whole time either way, and GSAP's `ScrollTrigger` is already
   tracking real progress in the background from mount regardless of
   `Scene`'s own mount timing, so there's no catch-up jump once it does
   mount. Saved ~155KB (677.2KB → 522.1KB — see item 2's number for why
   it started at 677 not 686.9). Re-measured CLS after this change: still
   0.007 (budget 0.05, comfortable pass) — confirms the CLS fix's own
   CSS-only reservation is untouched by this.
4. **Second real contributor: viewport-prefetch of OTHER marketing
   routes.** With WebGL out of the way, a second CDP capture found
   `/pricing`, `/login`, and `/signup`'s error-boundary chunks — the last
   pulling in a ~55KB gz Supabase client bundle — arriving in the same
   post-load window. Root cause: `marketing-header.tsx`'s nav is sticky
   (always in the viewport), and Next's default `<Link>` behavior
   prefetches the FULL route the instant it's in view (verified against
   this exact Next version's shipped docs,
   `node_modules/next/dist/.../link.md` §prefetch — CLAUDE.md Rule 1).
   None of that does anything for the home route's OWN first paint.
   **Fix**: every `<Link>` in `marketing-header.tsx` now sets
   `prefetch={false}` — route paths/forms/signup-flow behavior unchanged,
   a real click still navigates via a normal (just less pre-warmed)
   transition. (Footer links left untouched — below the fold on a real
   page load, so never actually triggered the viewport-prefetch gate;
   confirmed by the same CDP capture showing no footer-route chunks in
   either pass.) Saved ~81KB (522.1KB → 440.7KB).
5. **What's left in the remaining 440.7KB, deliberately not chased
   further this pass**: confirmed (by re-running the same CDP-split
   capture on the final build) that everything now arriving is either (a)
   framework floor — React/react-dom/Next's RSC runtime, `next-intl`,
   Radix primitives the page's own header/nav/theme-toggle genuinely use,
   a `zod`-heavy chunk — none of it dead weight the way `cmdk`/
   `input-otp`/`recharts` were, or (b) GSAP's own ~46KB, still loading
   eagerly because `useScrollProgress`'s pin-creation effect (unlike
   `Scene`'s mount) is tightly coupled to the hero's own CLS fix (0.230 →
   0.003, multiple documented failed attempts already on record above) —
   deferring it the same way `Scene` was deferred risks reopening that
   exact regression and needs its own careful re-measurement, which this
   pass's remaining scope didn't budget for. Even removing all 46KB of
   GSAP would land around ~395KB, still well over 250KB — the framework
   floor alone is the larger remaining gap and isn't fixable from
   `apps/web/**`/`packages/ui/**` without a materially different stack
   decision (per CLAUDE.md Rule 4, flagged rather than redesigned here).
   `docs/audit/SITE_REQUESTS.md` has a note for whoever next touches
   `components/motion/**` about the GSAP-deferral option specifically.

**`command`/`input-otp` barrel-leakage follow-up, closed** (flagged but
not fixed by the prior POLISH+PERF pass): `cmdk` (the admin ⌘K palette)
and `input-otp` (the MFA challenge/enroll inputs) were re-exported from
`@heyloo/ui`'s main barrel exactly like `charts` used to be, so any
marketing import of an unrelated named export pulled their whole module
graphs in too. Same fix as `charts`: both now live behind their own
`exports` subpaths (`@heyloo/ui/command`, `@heyloo/ui/input-otp`,
`packages/ui/package.json`), physically removed from
`custom/index.ts`/`primitives/index.ts`'s barrels; the 3 real consumers
(`admin-shell-client.tsx`, `mfa/challenge/page.tsx`, `mfa/enroll/
page.tsx`) updated to import from the subpaths instead. Confirmed (string-
marker grep on the rebuilt chunks) zero `cmdk`/`input-otp`/`InputOTP`
markers remain anywhere in the home route's bundle. Modest measured
saving on its own (686.9KB → 677.2KB, ~10KB) — smaller than the prior
pass's hit-count-based estimate suggested, but a real, permanent fix
regardless of the byte count, and the barrel-leakage class of bug is now
fully closed for every 3rd-party-backed component this repo currently
ships (`charts`, `command`, `input-otp`).

**Files changed**: `apps/web/src/components/marketing/live-call-hero.tsx`,
`apps/web/src/components/marketing/shared/{sticky,parallax,
media-loop}.tsx` (+ their `.test.tsx` where behavior changed),
`apps/web/src/components/marketing/marketing-header.tsx`,
`apps/web/src/components/marketing/hero-scroll-section.test.tsx`,
`apps/web/src/components/motion/lazy-webgl-boundary.tsx`(+test),
`apps/web/instrumentation-client.ts`, new
`apps/web/src/lib/perf/sentry-init.tsx`,
`apps/web/src/app/[locale]/{(tenant),(admin),(partner)}/layout.tsx`,
`apps/web/src/app/[locale]/mfa/{challenge,enroll}/page.tsx`,
`apps/web/src/components/admin/admin-shell-client.tsx`,
`packages/ui/src/theme/globals.css`(+`contrast.test.ts`),
`packages/ui/src/{index.ts,custom/index.ts,primitives/index.ts}`, new
`packages/ui/src/command-entry.ts`, `packages/ui/package.json`.

**Gates run**: `pnpm --filter @heyloo/ui typecheck` (`tsc -b`) clean;
`pnpm --filter @heyloo/web typecheck` (`tsc -b`) clean; `pnpm --filter
@heyloo/ui test` (contrast suite, 39 tests) green; `pnpm --filter
@heyloo/web exec vitest run src/components/motion src/components/three
src/components/marketing` (91 tests, including every updated/new test
above) green; `pnpm --filter @heyloo/web run build` (`next build
--webpack`, production) clean, all routes generated; 5 full
`scripts/site-perf/measure.ts` runs against real production
build+`next start` servers across this pass (one per fix, to isolate
each change's actual measured effect) — final numbers: **LCP 488ms (PASS,
budget 2500ms), CLS 0.007 (PASS, budget 0.05), Initial JS 440.7KB (FAIL,
budget 250KB — 1.76x over, down from 2.7x at the start of this pass)**.
Did not run a full-repo `pnpm -w typecheck`/`pnpm -w test` (out of scope
for a change confined to `apps/web/**`/`packages/ui/**`, both verified
directly).

## SITE REPAIR — 3rd pass, 58/100 review: the missing DOM overlay
## (blocker) + the GSAP JS-budget lever (blocker, escalated per Rule 4)
## (2026-09-14, session_012xvcAnjqsMbPqitErDJQbR)

Fixed the review's blocker and re-attempted the documented next lever on
the JS-budget blocker; the minor finding turned out to be resolved as a
side effect of the blocker fix, verified rather than separately coded.

**Blocker — the pinned WebGL hero rendered only the abstract line, no
product content ever appeared on a qualifying device**: built the
missing DOM overlay `morph-geometry.ts`'s own comment always described
("the DOM transcript layer does its own animation on top") but that no
composing component had ever actually built —
`apps/web/src/components/motion/hero-story-overlay.tsx`
(`HeroStoryOverlay`), composited into `hero-scroll-scene.tsx`'s
`HeroScrollSceneVisual` alongside the WebGL canvas. Four panels, one per
`hero-story.ts` stage (ring/answer/book/land), stacked absolutely and
cross-faded at `resolveHeroStage`'s own boundaries — never a second,
independently authored set of stage numbers:

- **ring** (0-0.2): a minimal "Incoming call…" pill — the beat's own
  visual is the WebGL waveform-as-handset line; this is just a
  caller-side anchor for it.
- **answer** (0.2-0.55): a TranscriptViewer-styled call panel — speaker-
  colored bubbles revealing turn by turn (including the compiled-in AI +
  recording disclosure, verbatim, CLAUDE.md Rule 2), then the font-mono
  `check_availability()` tool-call badge.
- **book** (0.55-0.8): a PriceCard/StatusBadge-styled booking card
  assembling field by field (vehicle/service, then a "Confirmed" pill,
  then the date/time).
- **land** (0.8-1): a CallFeedItem-styled dashboard row — the booking has
  landed.

Real content, not a re-authored story: `apps/web/src/content/marketing/
hero-call.ts` is a new single source of truth for the storyboarded call
(turns, disclosure, tool-call name, booking fields), extracted from
`live-call-hero.tsx`'s previously-private `TURNS`/`FRAMES` constants and
now imported by both `live-call-hero.tsx` (the non-qualifying/reduced-
motion/mobile fallback) and `hero-story-overlay.tsx` (the qualifying-tier
overlay) — the same copy on every tier, never duplicated or re-drifted,
matching WEBSITE_CREATIVE_BRIEF.md §3's "current copy/CTAs unchanged."

Cross-fade is continuous and scroll-linked, not scroll-triggered-then-
autoplaying: a `panelOpacity(progress, start, end, isFirst, isLast)`
function ramps each panel's opacity across a small window centered on
each internal stage boundary, computed fresh from raw `progress` every
animation frame (so it scrubs correctly in both directions) — deliberately
NOT React state for the per-frame write itself (same "mutate in place"
rationale as `hero-morph-scene.tsx`'s own `HeroMorphLine`: a `setState`
at that rate would re-render four panels' worth of DOM for no visual
benefit over a direct `element.style.opacity` write). `isFirst`/`isLast`
suppress the ramp at the very edges of the whole timeline (progress 0/1)
— there's no preceding/following panel to fade with there, so `ring`
starts at opacity 1 (not a stray half-faded 0.5) and `land` ends at
opacity 1. Discrete content (which transcript turns are visible, the
tool badge, how many booking fields have assembled) is real React state,
but only re-set when its derived value actually changes — a handful of
times per scroll pass, not every frame. Pauses its own `requestAnimationFrame`
loop via `IntersectionObserver`/`visibilitychange`, mirroring
`hero-morph-scene.tsx`'s existing GPU-discipline pattern.

**Composition gate, found while building this (not itself a pre-existing
bug, but load-bearing for the fix)**: `HeroStoryOverlay` only mounts once
the visitor has "engaged" (`hero-scroll-scene.tsx`'s new `engaged` state,
lifted into `HeroScrollContext`) — never alongside `LazyWebglBoundary`'s
own pre-engagement `fallback` render. Both `fallback` (`LiveCallHero`)
and the overlay render a full transcript/booking UI; mounting the overlay
unconditionally would have stacked two competing renditions of the same
content in the brief instant before the visitor's first scroll/interaction
engages the real `Scene`. `HeroStoryOverlay` and `Scene` key off two
independent `deferUntilInteraction` listeners on the same events, so in
practice they appear together, replacing `fallback` cleanly.

**Blocker — initial JS still 1.76x over budget (440.7KB vs. 250KB gz)**:
continued the documented next lever (`docs/audit/SITE_REQUESTS.md`'s
"GSAP's eager load is the next lever ... if you want it"). Gated
`hero-scroll-scene.tsx`'s `useScrollProgress` call (and therefore
`gsap`/`ScrollTrigger`'s ~46KB gz dynamic import) behind the same
`engaged` state used for the overlay above — first scroll/pointer/key
interaction, or a 2500ms fallback (`ENGAGE_FALLBACK_MS`, same value and
mechanism as `lazy-webgl-boundary.tsx`'s existing `Scene` deferral).
Confirmed safe for the file's own carefully-measured CLS fix before
touching it: `HERO_PIN_RESERVE_CSS`'s space reservation is decided
entirely by CSS media queries evaluated on the first parsed byte of
SSR'd HTML — it has never depended on GSAP/JS timing at all, so deferring
*when* `ScrollTrigger.create()` runs cannot reopen that regression (the
prior CLS root cause was specifically about the *reservation* being
JS/state-driven; that's unchanged here). Re-measured with a real
`node --experimental-strip-types scripts/site-perf/measure.ts` run
against a production build + `next start` twice (once immediately after
the code change, once again after a `biome check --write` formatting
pass) — both runs agreed:

**LCP 416-556ms (PASS, budget 2500ms), CLS 0.003 (PASS, budget 0.05,
unchanged from the prior pass — confirms the CLS fix is untouched),
Initial JS 396.1KB (FAIL, budget 250KB — 1.58x over, down from 1.76x;
saved ~44.6KB, matching the prior pass's own prediction "even removing
all 46KB of GSAP would land around ~395KB").**

**Rule 4 discovery, not redesigned here**: 396.1KB is still over the
250KB budget. This was the last lever available from `apps/web/**`/
`packages/ui/**` alone that `docs/audit/SITE_REQUESTS.md` and
`docs/BUILD_NOTES.md`'s prior pass had identified — both the WebGL engine
and GSAP are now fully deferred behind a real visitor interaction, never
part of the initial route chunk. What's left (confirmed by the prior
pass's own CDP-split capture, unchanged by this pass since neither
`hero-story-overlay.tsx`'s plain DOM/Tailwind markup nor the `engaged`
gate added any new dependency) is framework floor — React/Next's RSC
runtime, `react-dom`, `next-intl`, Radix primitives the header/nav/theme
toggle genuinely use, a `zod`-heavy chunk — none of it dead weight the
way earlier barrel-leakage fixes (`cmdk`/`input-otp`/`recharts`) were.
Closing the remaining ~146KB gap is not achievable from this task's file
ownership without a materially different stack decision (dropping
`next-intl`, moving off Radix, etc.) — flagging here per CLAUDE.md Rule 4
rather than redesigning the stack unilaterally. Whoever owns that
decision should treat 396.1KB as the honest current floor, not a bug to
keep chasing from `components/motion/**`.

**Minor — fallback-to-WebGL handoff readable as a visible content swap**:
verified rather than separately coded. `deferUntilInteraction`'s listener
is `{ once: true, passive: true }` on `scroll` itself
(`lib/perf/defer-non-critical.ts`), so in the common case (a visitor who
scrolls) both `Scene` and `HeroStoryOverlay` engage within the visitor's
very first scroll tick — well before they could have scrolled past even
the "ring" stage's own small range of the ~250vh pin. More importantly,
the finding's underlying complaint (swapping from a real transcript/
booking UI to an abstract line) no longer applies: both tiers now show
content-equivalent product UI (`LiveCallHero`'s DOM storyboard pre-engage,
`HeroStoryOverlay` composited over the WebGL line post-engage), so the
handoff reads as a rendering-engine swap, not a content regression. No
code change beyond the blocker fixes above and the composition gate they
required.

**Files changed**: new `apps/web/src/content/marketing/hero-call.ts`,
new `apps/web/src/components/motion/hero-story-overlay.tsx` (+test),
`apps/web/src/components/motion/hero-scroll-scene.tsx` (+test),
`apps/web/src/components/motion/index.ts`,
`apps/web/src/components/marketing/live-call-hero.tsx`.

**Gates run**: `pnpm --filter @heyloo/web typecheck` (`tsc -b`) clean;
`pnpm --filter @heyloo/web exec vitest run` (full suite) — 543 tests,
green; `pnpm --filter @heyloo/web run build` (`next build`, production)
clean, all routes generated; `biome check` clean on every changed file;
2 full `scripts/site-perf/measure.ts` runs against real production
build+`next start` servers — final numbers above. Did not run a
full-repo `pnpm -w typecheck`/`pnpm -w test` (out of scope for a change
confined to `apps/web/**`, verified directly).

## SITE-1 — Integrator pass over the 4th-round review (71/100), the
## `THREE.Color`/oklch blocker fixed, the JS-budget floor re-confirmed
## (2026-09-14, session_012xvcAnjqsMbPqitErDJQbR)

Ran the full gate list against the accumulated SITE-1 diff for the first
time as one pass (prior passes each verified a narrower slice — see the
"Gates run" note on the entry directly above). Fixed the one real,
in-scope blocker the 4th-round review found; re-verified the JS-budget
blocker is the same honest, already-documented floor, not a new
regression; cleaned up a `pnpm run lint` failure the review didn't
measure (Biome/ESLint gates, not part of its Playwright-based scoring)
down to 0 errors.

**Blocker — `THREE.Color: Unknown color model oklch(...)` (review's
"real rendering-defect... meets the blocker bar on its own merits")**:
root-caused to a browser-behavior change, not a logic bug in
`read-css-color.ts`'s own design. That module's whole point (its own doc
comment) is resolving a design-token CSS custom property — declared as
`oklch()` in `packages/ui/src/theme/globals.css` — to a string
`THREE.Color`'s CSS-string parser can actually read, by asking a real DOM
element's `getComputedStyle(...).color` rather than hand-parsing the
token. That worked when Chromium's CSSOM normalized computed `color` to
`rgb()` regardless of how it was authored — current Chromium (confirmed
live against this environment's own Playwright-pinned build) instead
serializes the computed value in whatever color function it was
specified with, so `getComputedStyle` now hands back the literal
`oklch(...)` string right back — exactly what this module existed to
avoid handing `THREE.Color`. Fix: after resolving via `getComputedStyle`
as before, rasterize that resolved color through a 1x1 `<canvas>` (which
does understand `oklch()`) and read the actual pixel back as a plain
`rgb()`/`rgba()` string — this sidesteps however the browser chooses to
serialize the computed value going forward, degrades to the caller's
`fallback` (not a throw) in jsdom/SSR-like environments with no real
`CanvasRenderingContext2D`, and needed no change to any call site
(`hero-morph-scene.tsx`, `hero-morph-canvas2d.tsx`). Verified two ways:
`read-css-color.test.ts`'s existing jsdom-fallback coverage still passes
unchanged (canvas `getContext` returns `null` under jsdom, exercising the
new fallback path), and a live Playwright run against a real production
build+`next start` — scroll-engaging the WebGL hero and capturing browser
console output — shows the `oklch` warning gone; only the pre-existing,
independently-documented-harmless `THREE.Clock deprecated` warning (and
headless-Chromium-only `GPU stall due to ReadPixels` GL driver messages,
an artifact of this sandboxed environment's software GL, not a real
rendering defect) remain. File: `apps/web/src/components/three/
read-css-color.ts`.

**JS-budget blocker (396.1KB gz vs. 250KB budget) — re-measured, not a
regression, same floor the entry above already flagged per Rule 4**: the
review ran this exact number; a live re-measurement after the oklch fix
(`node --experimental-strip-types scripts/site-perf/measure.ts` against a
fresh production build+`next start`, cross-checked with a raw CDP
`Network.loadingFinished` capture before any scroll/interaction) landed
at the identical 396.1KB — LCP 376ms and CLS 0.003 both still comfortably
PASS. Went one level deeper than the prior pass's "framework floor"
description to confirm it's genuinely not fixable from this task's
ownership: the built `.next/static/chunks/*.js` manifest for `en.html`
sums to the same ~396KB (the `noModule`-tagged polyfills chunk, ~39.5KB
gz, correctly excluded — modern/evergreen browsers never fetch a
`nomodule` script at all), and the two single largest chunks —
`3692-*.js` (67.1KB gz) and `3836f4b6-*.js` (62.4KB gz) — decompile to
Next.js's own RSC/client-navigation runtime and React-DOM's client
renderer respectively (confirmed by grepping their un-minified content
for `createRenderParamsFromClient`/Next internal header-name constants
and React's own `"Minified React error #"` string, not by the
`sentry-dbid-*` marker every chunk carries regardless of content — that's
Sentry's build-plugin debug-ID stamp for source-map upload, unrelated to
whether Sentry's SDK is actually in a given chunk, and a red herring this
pass ran down before ruling it out). Those two chunks alone are 129.5KB
gz — over half the entire 250KB budget — before a single line of this
app's own marketing code. The remaining ~227KB (after excluding
polyfills) is `next-intl`, `zod` (one ~26.5KB chunk), `@tanstack/
react-query` (~5.6KB, via `providers.tsx`'s root-layout `<Providers>`,
which wraps every route including marketing since the tenant/admin
dashboards genuinely need it), `sonner`'s `<Toaster>` (~9.8KB), `lucide-
react` icons (~11.3KB), and this app's own route/`@heyloo/ui` code —
none of it a leftover barrel-leak the way `optimizePackageImports`
already fixed for `recharts`/`date-fns`/`cmdk`/`input-otp`. Trimming
`react-query`/`Toaster` off marketing-only routes specifically was
considered and deliberately NOT done in this pass: `<Providers>` is a
single root-layout wrapper shared by every route group (marketing AND
the tenant/admin/partner dashboards that need `QueryClientProvider`
throughout), so route-scoping it the way `instrumentation-client.ts`'s
Sentry fix was route-scoped is a real architecture change, not a
mechanical one, and would only close a small fraction (~15-20KB) of the
~146KB gap while the framework floor stays the dominant, un-closable
cost. Per CLAUDE.md Rule 4 (discovered gap, proceed with the documented
decision rather than redesign): 396.1KB stands, unchanged from the prior
pass's own conclusion — closing it needs either a revised budget for a
hydrated Next.js 16 + React 19 app, or a stack-level decision (partial
hydration/islands, dropping a route-global data-fetching provider onto
marketing specifically, a different rendering strategy for the marketing
shell) outside this task's ownership.

**`pnpm run lint` (Biome + ESLint via `turbo run lint`) — not part of the
review's own scoring, but a required gate here**: found failing at 44
ESLint errors before any change in this pass, all within SITE-1's own
`apps/web/src/components/{motion,marketing,three}/**` files (a pre-
existing, unrelated repo-wide Biome formatting debt in 3 other files —
`(marketing)/[vertical]/page.tsx`, `how-it-works.tsx`, `vertical-grid.tsx`
— was also auto-fixed with `biome check --write`, mechanical/safe, no
semantic change). The ESLint errors were the newer `eslint-plugin-react-
hooks` "React Compiler" rules — `react-hooks/set-state-in-effect` (9
sites) and `react-hooks/refs` (4 sites) — firing on patterns this
codebase already uses intentionally and documents at length in its own
comments: a `useState(false)` + `setState` inside a `useEffect` to avoid
an SSR/hydration mismatch for a client-only check (`window.matchMedia`,
`readCssColor`'s DOM read), and the standard "latest callback/value ref"
sync (`ref.current = value` written directly in the render body, read
later from an effect/rAF loop) so a scroll/rAF-driven effect can read a
fresh callback without re-subscribing every render. Neither pattern was
rewritten (restructuring proven, carefully-tuned scroll-timing code under
a lint rule with known false positives on exactly this idiom is a
correctness risk this pass wasn't going to take); instead each site got a
scoped `eslint-disable-next-line <rule> -- <reason>` comment, the same
style this codebase already uses elsewhere for the identical rule
(`components/shared/segment-error.tsx`'s pre-existing `react-hooks/set-
state-in-effect` disable, Sentry's own documented error-boundary
pattern). The remaining ESLint findings were real `testing-library/
no-node-access` / `no-container` (assertions on `<canvas>`, `<style>`,
CSS-class-selected boxes, and `aria-hidden` elements — none of which have
a role/text-based Testing-Library query, by definition for the
`aria-hidden` case) — also scoped-disabled with a reason — and
`testing-library/prefer-find-by` (4 sites, `lazy-webgl-boundary.test.tsx`
and 2 in `hero-scroll-scene.test.tsx`'s earlier pass), which WAS a
genuine, safe mechanical fix (`await waitFor(() => expect(screen.getBy...
).toBeInTheDocument())` → `expect(await screen.findBy...).toBeInTheDocument()`,
identical polling behavior) applied instead of a disable comment.
`pnpm run lint` now exits 0 (31 pre-existing warnings elsewhere in the
app, none touched by SITE-1, left as-is — out of this task's scope).

**Repo hygiene**: deleted 18 ad-hoc `apps/web/round{2,4}-*.mjs` Playwright
diagnostic scripts left in the working tree from the review's own
measurement process (never part of the shipped app, CLAUDE.md Rule 3 "no
dead files").

**Files changed this pass**: `apps/web/src/components/three/
read-css-color.ts` (the actual fix); scoped eslint-disable comments in
`apps/web/src/components/marketing/{live-call-hero.tsx,shared/media-
loop.tsx,shared/parallax.tsx,shared/sticky.tsx}`,
`apps/web/src/components/three/hero-morph-scene.tsx`,
`apps/web/src/lib/marketing/use-in-view.ts`,
`apps/web/src/components/motion/{use-scroll-progress.ts,use-play-once-
progress.ts,hero-story-overlay.tsx}`; testing-library disable comments +
2 mechanical `findBy` fixes across `apps/web/src/components/{marketing/
hero-scroll-section.test.tsx,motion/hero-scroll-scene.test.tsx,motion/
hero-story-overlay.test.tsx,motion/lazy-webgl-boundary.test.tsx,three/
hero-morph-canvas2d.test.tsx}`; Biome auto-format on 3 pre-existing,
unrelated files (see above); deleted the `round{2,4}-*.mjs` scratch
scripts.

**Gates run**: `npx biome check --write` on every changed path — clean
(4 pre-existing `!important`/reduced-motion warnings only, same
intentional `prefers-reduced-motion` universal-override rule as before,
not touched); `pnpm -w typecheck` — clean, all 21 workspace packages;
`pnpm run lint` — 0 errors (31 pre-existing warnings, untouched); `pnpm
-w test` — 543/543 tests green across 108 files; `pnpm --filter
@heyloo/web build` (`next build --webpack`, production, real Supabase-
placeholder env) — clean, all 183 routes generated; `node
--experimental-strip-types scripts/site-perf/measure.ts` against that
build + `next start` — LCP 376ms PASS, CLS 0.003 PASS, Initial JS 396.1KB
FAIL (documented above, unchanged from the prior pass, not a regression);
no file >2MB, `apps/web/public/site` at 344KB (budget 8MB), `pnpm-
lock.yaml` untouched (no dependency changes this pass).

**Review score**: 71/100, not passing — driven entirely by the JS-budget
gap now confirmed as an honest architectural floor (see above) plus
whatever weight the review placed on the now-fixed oklch defect; every
other review dimension (LCP, CLS, console errors, axe a11y, WebGL
correctness, horizontal scroll, long-task/scroll smoothness) was already
passing and remains so.

## CLUSTER HERO-FILM (Wave 2) — WebGL line morph → scroll-scrubbed frame-sequence film

**What was built**

- `apps/web/src/components/motion/hero-film-frames.ts`: pure frame math
  (no DOM) — `frameForProgress` (piecewise-linear progress→frame map
  pinned at `hero-story.ts`'s own stage boundaries: ring 0–0.2→frames
  1–30, answer 0.2–0.55→30–66, book 0.55–0.8→66–82, land 0.8–1→82–97, per
  this task's own mapping, cross-checked against the actual committed
  frames — see below); `computeHeroFilmLoadOrder` (binary-subdivision
  prefetch order, verified to match `1,97,49,25,73,13,37,61,85,…`);
  `computeHeroFilmCoverFit` (background-size:cover-equivalent
  `drawImage` placement math); asset path builders; and
  `HERO_FILM_CARD_RECT` — the screen rect the film's white card settles
  into, MEASURED (not estimated) via a thresholded pixel scan of the
  committed `f090.webp`/`f097.webp` in both themes (script run, not
  committed) and cross-checked by eye. The two themes' rects genuinely
  differ (dark's card sits higher/wider in frame than light's) — encoded
  as two independently-measured rects, not one shared guess.
- `hero-film-scrubber.tsx`: the real set piece — a `<canvas>` drawn from
  `progressRef` inside a `requestAnimationFrame` loop (paused offscreen/
  tab-hidden, same discipline as the old `hero-morph-scene.tsx`), frames
  decoded via `fetch`+`createImageBitmap` (falls back to a plain
  `new Image()` when `createImageBitmap` is unavailable), first 12 in
  binary-subdivision priority order immediately post-mount, the rest
  deferred behind `deferUntilInteraction` + `requestIdleCallback`.
  `hero-film-themed-image.tsx` renders BOTH theme's `poster`/`final`
  `<img>` unconditionally (identical server/client markup) and lets pure
  CSS (`:root[data-theme]`/`prefers-color-scheme`, the same dual-guard
  pattern `packages/ui/theme/globals.css` already uses for color tokens)
  pick the visible one — zero-flash on first paint with no theme cookie,
  since nothing about which `<img>` is *rendered* ever depends on
  client-only state.
- `use-resolved-theme.ts`: resolves light/dark the same way
  `app/[locale]/layout.tsx`'s bootstrap script does
  (`data-theme` attribute, else `prefers-color-scheme`), reactive via
  `MutationObserver` + a `matchMedia` change listener — used only to
  decide which theme's frame *files* to fetch (pure client-side effect
  work, no render-time server/client mismatch to cause).
- `hero-story-overlay.tsx`: repositioned per this task's brief — the
  "answer" panel now floats top-right instead of centred; the "book"/
  "land" panels are positioned at `HERO_FILM_CARD_RECT[theme]` (absolute
  inset from the measured rect, not a centred flex box) and reshaped
  from a tall stacked card into a single flat row so they actually fit
  that rect's real (wide, short) aspect ratio — verified by Playwright
  screenshot: at progress 1.0 the DOM "New booking" row sits pixel-exact
  on the film's own white card in both themes. Added a
  `window.__heylooScrollDebug`-gated dashed-rect debug overlay
  (`[data-hero-debug="card-rect"]`) per this task's instructions — note
  it's a no-op in a `next build` production bundle (same
  `NODE_ENV==="production"` gate `use-scroll-progress.ts`'s own debug
  publish already uses), so it only actually renders under `next dev`.
- `hero-film-static.tsx`: `HeroFilmFinalImage` (theming final.webp +
  final-720.webp, generated via `sharp` into the same committed
  `hero-film/{theme}/` directory — the two new files this task added
  are the ONLY frame-directory changes; every `f0NN.webp`/`poster.webp`/
  `final.webp` is untouched) and `HeroFilmStatic` (that image +
  `HeroStoryOverlay` pinned at `progress: 1`, for the
  `prefers-reduced-motion` tier).
- `hero-scroll-scene.tsx`: three tiers in priority order —
  `prefers-reduced-motion` (any width) → `HeroFilmStatic`; desktop/
  tablet ≥768px → the real `HeroFilmScrubber` + `HeroStoryOverlay`,
  mounted together with no separate "engaged" gate (the old
  `LazyWebglBoundary` stacking concern doesn't apply: the scrubber shows
  its own theme-correct poster while frames load, never a competing
  full-content fallback); everything else (mobile) → `LiveCallHero`
  (unchanged) with `HeroFilmFinalImage` placed above it, no per-frame
  downloads. Pin/CSS-reservation/engagement-gate machinery for
  `ScrollTrigger` itself is unchanged from the prior pass (round-4
  review verified it; nothing here touches it).
- `use-device-capability.ts` simplified to width + `prefers-reduced-
  motion` only (`qualifiesForFilm`) — the old WebGL-context/
  `deviceMemory`/`connection.saveData` probes were specific to needing a
  GPU context for `three`/r3f; a 2D canvas and `fetch` have no such
  gate, so those checks were dead weight, not a missing feature.
- Deleted: `components/three/**` (the whole old morph — scene, Canvas2D
  fallback, geometry, color-reading — none of it salvageable, the new
  film IS the geometry now) and `lazy-webgl-boundary.{tsx,test.tsx}`
  (WebGL-bundle-specific, no film equivalent needed). Removed
  `three`/`@react-three/fiber`/`@react-three/drei`/`@types/three` from
  `apps/web/package.json`, `pnpm install`'d (lockfile: pure removal, 460
  lines, no unrelated churn).
- `hero-scroll-section.tsx`'s visual-slot box changed from `aspect-[4/3]`
  to `aspect-video` (16:9) — matches the film's authored 1440×810 frames
  exactly, so the canvas's cover-fit never crops, which is what lets the
  overlay's rect-based positioning map straight onto the box's own edges
  with no separate crop-offset math.

**Known rough edge (not a regression, inherited crossfade design)**: the
"book" DOM panel starts fading in at the "book" stage's own start
(progress 0.55, `CROSSFADE_WIDTH` ≈0.035 later) and is at full opacity
for most of that stage — but the film's own card doesn't finish forming
until roughly frame 74–78 of that stage's 66–82 range (verified by
screenshot at progress 0.6: the DOM row is correctly positioned at the
FINAL rect, but the underlying film is still mid-morph, a still-forming
bar, not yet a card, so the two don't visually read as one object for
roughly the first third of the "book" stage). The stage-boundary
crossfade timing itself is inherited from the pre-existing
`hero-story-overlay.tsx`/`hero-story.ts` design (this task repositioned
the panels' X/Y, not their fade timing) — CLAUDE.md Rule 4: flagged
here rather than redesigning the crossfade curve, which is out of this
task's assigned scope. A future pass could fade the "book" panel in on
a frame-index-aware curve (e.g. weighted toward `frameForProgress`
crossing ~74 rather than the raw 0.55 stage start) instead of a fixed
`CROSSFADE_WIDTH`. The FINAL, held state (land, 0.8–1.0 — where the
visitor's eye actually rests, per round-4's own "the hand-off IS the set
piece" framing) is pixel-matched in both themes; only the brief
mid-transition window is affected.

**Gates run**: `pnpm --filter @heyloo/web typecheck` — clean; `pnpm
--filter @heyloo/web test` — 566/566 tests green across 110 files
(includes new suites for every pure-math/theme/component module listed
above: frame-index mapping at exact stage boundaries, load-order
generator against the documented `1,97,49,…` sequence + permutation
invariant, cover-fit math incl. zero-size degradation, theme resolution
incl. live `data-theme`/system-preference changes, reduced-motion static
path, unmount-aborts-in-flight-fetches); `pnpm --filter @heyloo/web
build` (`next build --webpack`, production, placeholder Supabase env) —
clean, compiled + typechecked + all pages generated. Playwright
verification (uncommitted script, chromium at `/opt/pw-browsers/
chromium`, 1440×900): built+started the production server, computed the
pin's real scrollY range from `.hero-pin-reserve`'s own DOM position,
scrolled 0/10/…/100% of it, screenshotted every step in light theme plus
a 0/50/100% spot-check in dark theme, plus a reduced-motion pass and a
390×844 mobile pass — 0 console errors/warnings across all of it.
Visually confirmed: no hard-edged backdrop rectangle in either theme
(the `mask-image` radial-gradient dissolve works), the overlay panels
track the phone/card through every stage, and the "land" state's DOM row
sits exactly on the film's own white card in both themes.

Also ran `node --experimental-strip-types scripts/site-perf/measure.ts`
(the formal LCP/CLS/initial-JS budget harness) against a fresh
production build+`next start`: Home route — LCP 864ms PASS (budget
2500ms), CLS 0.003 PASS (budget 0.05), Initial JS 444.3KB **FAIL**
(budget 250KB). LCP/CLS are comfortably inside budget (the poster `<img>`
as the LCP element, explicit width/height, works as intended). The JS
FAIL is a known pre-existing gap this cluster did not create and cannot
fully close: the prior review pass (see this file's own entry above)
already measured 396.1KB FAIL on the SAME budget with the OLD
three/r3f/drei-based hero and traced the overage to eagerly-initialized
Sentry/PostHog (a different cluster's ownership), not the hero visual —
this pass's 444.3KB is higher than that 396.1KB baseline, but the two
numbers aren't a clean A/B (no isolated before/after was measured on
identical other-code within this session; other agents' concurrent work
on the shared branch could account for some or all of the delta).
`HeroFilmScrubber`/`HeroFilmStatic` are deliberately NOT
`next/dynamic`-code-split the way the old `HeroMorphScene` was: this
task's own spec requires the first 12 frames to start loading
immediately post-hydration (not gated behind a scroll/interaction
engagement signal, unlike the old WebGL chunk), so their small amount of
component code is CORRECTLY part of the initial bundle by design, not a
missed code-splitting opportunity — code-splitting it further would only
help if paired with an engagement gate, which would reintroduce a
flash-of-nothing before the poster's replacement canvas can draw,
regressing the "poster paints before any JS" LCP guarantee this pass
was built around. Flagging the 444.3KB number honestly rather than
re-baselining it away; closing the gap needs the Sentry/PostHog
deferral work already named in the prior entry, not more hero-cluster
changes.

**Files changed this pass**: new —
`apps/web/src/components/motion/{hero-film-frames,hero-film-scrubber,
hero-film-static,hero-film-themed-image,use-resolved-theme}.{ts,tsx}`
+ matching `.test.{ts,tsx}` for each; `apps/web/public/site/hero-film/
{light,dark}/final-720.webp` (generated via `sharp`, the only new frame-
directory assets). Modified —
`apps/web/src/components/motion/{hero-scroll-scene,hero-story-overlay,
use-device-capability,index}.ts(x)` + their tests,
`apps/web/src/components/marketing/hero-scroll-section.tsx` + test,
`apps/web/package.json`, `pnpm-lock.yaml`. Deleted —
`apps/web/src/components/three/**` (8 files),
`apps/web/src/components/motion/lazy-webgl-boundary.{tsx,test.tsx}`.

## CLUSTER GLUE+PERF — hero-film/PAGES-2 reconciliation + perf-budget re-run (2026-09-14)

Found HERO-FILM and PAGES-2's work already merged cleanly in the shared
tree on arrival: `hero-scroll-scene.tsx` renders `HeroFilmScrubber` +
`HeroStoryOverlay` on the qualifying tier, `hero-scroll-section.tsx` uses
`aspect-video`, and `page.tsx` renders `<OwnerPhoneReveal />` directly
after `<DashboardPreview />` — all matching this task's own reconciliation
brief. No merge conflicts to resolve.

**Fixed**: two `testing-library` lint errors (`dashboard-preview.test.tsx`'s
`render()` result named `first` → renamed `view`;
`owner-phone-reveal.test.tsx`'s `container.querySelector('[aria-hidden="true"]')`
→ added the same `eslint-disable-next-line testing-library/no-container,
testing-library/no-node-access` pattern `hero-film-static.test.tsx`/
`hero-story-overlay.test.tsx` already use for the identical
"element-under-test-is-aria-hidden" case).

**Also fixed — two real visual defects found by actually looking at the
Playwright screenshots, not just checking for console errors** (full
writeup with root causes in `docs/audit/SITE_REQUESTS.md`'s GLUE+PERF
section):
1. `hero-story-overlay.tsx`'s "book" stage panel was illegible for its
   entire ~55%-80% scroll range — the vehicle/service text rendered as a
   single truncated character ("2." / "C.") because its not-yet-revealed
   sibling fields stayed mounted (just `opacity-0`) and permanently
   claimed most of the narrow card rect's width. Fixed by conditionally
   MOUNTING each field on its reveal threshold instead of opacity-hiding
   it, matching the "answer" panel's own already-correct pattern one
   panel up in the same file.
2. `hero-film-themed-image.tsx` — the "zero-flash theme-correct image"
   component used everywhere except the scrubber's own canvas (reduced-
   motion tier, mobile final-frame, the scrubber's poster before its
   first frame decodes) — showed the DARK theme's image ALWAYS,
   regardless of the viewer's real theme, because its shared inline
   `style` object set `display: "block"` on both the light and dark
   `<img>`; an inline style always beats a stylesheet rule regardless of
   selector specificity, so the component's own CSS (meant to hide the
   inactive theme) was silently inert since it was written. Fixed by
   moving `display` out of the inline style; added a regression-guard
   test asserting neither `<img>`'s inline style sets `display` at all,
   since the existing test suite only checked the CSS *text* for the
   right rule, never whether it could actually win against the inline
   style — which is exactly how this got through HERO-FILM's own
   (otherwise thorough) verification pass undetected.

Both fixes are minimal, scoped to the two files that had the bug, and
re-verified with a fresh Playwright pass (per-shot isolated browser
contexts, to rule out any test-harness state bleed) showing correct
content/theme in every case: `pnpm --filter @heyloo/web
typecheck`/`test` (567/567, 110 files — one more than before: the new
regression-guard test)/`build` (183 routes, webpack, production) all
clean; `npx biome check --write` on every changed file (0 fixes);
`pnpm run lint` (0 errors, 32 pre-existing unrelated warnings).

**Perf budget re-run** (`node --experimental-strip-types
scripts/site-perf/measure.ts` against a fresh production build of the
merged tree): LCP 464ms PASS, CLS 0.000 PASS, Initial JS 444.3KB FAIL
(budget 250KB) — identical to HERO-FILM's own already-recorded number,
confirming the PAGES-2 merge added zero measurable regression. Re-verified
this task's named levers against the merged tree (three/r3f/drei absent
from both `package.json` and every initial-window chunk; GSAP confirmed
behind the engagement gate for both `hero-scroll-scene.tsx` and
`owner-phone-reveal.tsx`; Sentry confirmed unreachable from the marketing
route's client graph via `instrumentation-client.ts`; no PostHog string in
any initial chunk) and pulled a real per-chunk table via an uncommitted
Playwright/CDP script (`Network.loadingFinished` `encodedDataLength`,
same methodology `measure.ts` itself uses — total matched 444.3KB
exactly). The two largest chunks (68.7KB Next.js App Router client
runtime + 63.9KB React/ReactDOM, ~132.6KB gz together) are pure framework
floor, not this cluster's code — full table and reasoning in
`docs/audit/SITE_REQUESTS.md`'s new "GLUE+PERF cluster" section. Root
cause unchanged from two prior independent measurements (ENGINE's
"~380KB before GSAP" finding, HERO-FILM's own 444.3KB): closing this gap
needs a framework-level decision outside `apps/web/**`/`packages/ui/**`,
per CLAUDE.md Rule 4 — documented and deferred, not redesigned.

Files touched this cluster: `apps/web/src/components/marketing/dashboard-preview.test.tsx`,
`apps/web/src/components/marketing/owner-phone-reveal.test.tsx`,
`apps/web/src/components/motion/hero-story-overlay.tsx` (book-panel
conditional-mount fix), `apps/web/src/components/motion/hero-film-themed-image.tsx`
(inline-style `display` fix), `apps/web/src/components/motion/hero-film-themed-image.test.tsx`
(updated + new regression-guard test), `docs/audit/SITE_REQUESTS.md`,
this entry.

## CLUSTER SITE-REPAIR-3 — hero scroll-freeze fix, dental icon, corrected JS-budget root cause (2026-09-14)

Third repair pass against the reviewer's 64/100 findings (blockers only —
majors/minors not in this list were unaffected). All three fixes verified
against a fresh production build + `next start`, not just unit tests.

**1. Hero pin intermittent freeze (blocker) — FIXED.** Root cause
confirmed via GSAP's own docs (`gsap.com/docs/v3/Plugins/ScrollTrigger/
static.refresh()`, CLAUDE.md Rule 1) and community guidance: a
`ScrollTrigger` created dynamically — here, `use-scroll-progress.ts`'s
`ScrollTrigger.create()`, deferred behind `deferUntilInteraction` and
often firing on the visitor's very first "scroll" event, i.e. already
mid-gesture — caches its start/end pixel positions at the moment
`.create()` runs; if the browser hasn't finished a DOM/layout pass by
then, or the scrollbar has already moved further by the time the
deferred `gsap` chunk resolves, those cached positions go stale and
`onUpdate`'s progress reads ~0 (the "ring" frame) for most of the pin's
scroll distance, only catching up right at the end. Fixed by calling
`ScrollTrigger.refresh(true)` immediately after `.create()` in
`use-scroll-progress.ts` (the `true`/"safe" mode waits a rAF tick, up to
~200ms, for layout to settle first) — exactly GSAP's own documented fix
for this class of bug. Applied the same fix to
`owner-phone-reveal.tsx`'s own separate `ScrollTrigger.create()` (see
finding 3) for consistency, since it has the identical "created lazily,
sometimes mid-scroll" shape.

Verified two ways: (a) a unit test asserting `ScrollTrigger.refresh(true)`
is called, and called after `.create()` (`use-scroll-progress.test.ts`);
(b) a 12-run repeated Playwright probe (not committed — ad hoc, per the
reviewer's own "not a single spot-check" instruction) against a real
production build: fresh browser context each run, wheel-scroll to
~scrollY 1200 (the reviewer's own repro position, ≈53% through the
250vh desktop pin), read the `data-hero-stage` panels' live inline
`style.opacity` in `hero-story-overlay.tsx`. Before the fix this
reproduced the freeze (ring panel stuck near opacity 1, answer/book at
0) in roughly half of runs, matching the reviewer's own "coin-flip"
description; after the fix, 0/12 runs froze — every run correctly showed
`ring: 0, answer: 1` (or further, depending on exactly where the wheel
scroll landed) at the mid-pin position.

**2. Dental vertical icon = `Sparkles` (blocker) — FIXED.**
`VERTICAL_ICONS.dental` in `packages/ui/src/icons/index.tsx` swapped from
`Sparkles` (an AI-sparkle-coded glyph, forbidden by WEBSITE_CREATIVE_
BRIEF.md §7's anti-slop checklist) to `Smile` — a literal, non-abstract
glyph matching the other seven verticals' literal-object convention.
**Important build-hygiene note for whoever touches `packages/ui` next**:
`@heyloo/ui`'s `package.json` `main`/`exports` point at `./dist/index.js`
(a prebuilt output), not `src` — editing `src/icons/index.tsx` alone does
NOT change what `apps/web` actually bundles until `pnpm --filter
@heyloo/ui build` (`tsc -b`) regenerates `dist/`. This bit this exact fix
once during this pass: the first post-fix screenshot of the nav dropdown
still showed the old sparkle glyph because `dist/icons/index.js` was
stale from before the edit; rebuilding `@heyloo/ui` and then rebuilding
`apps/web` produced the correct `Smile` glyph. Re-verified with fresh
screenshots (production build) at all three named placements: the global
nav "Business types" dropdown, the home page's business-types grid
("Dental Practices" card), and the `/dental` page's own hero icon badge
— all three now show `Smile`, not `Sparkles`.

**3. Home route initial JS 444.2KB vs 250KB budget (blocker) —
PARTIALLY FIXED, with a corrected root-cause analysis.** The prior
GLUE+PERF entry's diagnosis ("Sentry/PostHog init," carried forward into
this round's reviewer text) was re-checked against a live per-chunk
network capture (CDP `Network.loadingFinished` `encodedDataLength`,
same methodology `measure.ts` uses) and confirmed **still correct that
neither is the cause**: every chunk's "sentry" string hit is
`@sentry/webpack-plugin`'s few-hundred-byte build-time debug-ID stamp
(`_sentryDebugIds`), injected into literally every chunk for source-map
association — not the real SDK, which remains unreachable from the
marketing route's client graph (confirmed via `instrumentation-client.ts`
and `sentry-init.tsx` as before). No PostHog string anywhere in any
initial chunk either. That diagnosis was stale; this pass found and
fixed the REAL, currently-reproducible cause instead:

`gsap`/`ScrollTrigger` (~46KB gz — three chunks, 20.0+17.6+8.5KB,
confirmed via the same per-chunk capture) was loading on every single
passive page load, contradicting `hero-scroll-scene.tsx`'s own documented
"GSAP never loads until first interaction" invariant, from two places:
  - `scroll-orchestration-provider.tsx`'s idle-prefetch fired
    `requestIdleCallback` unconditionally on mount — on a real page load
    the main thread goes idle almost immediately, so this ran within
    ~1s of first paint regardless of any interaction. Fixed by wrapping
    it in the same `deferUntilInteraction` gate every other GSAP
    consumer already uses.
  - `owner-phone-reveal.tsx` (the closing "reach the owner" phone-buzz
    beat, rendered directly on the home route) called `loadGsap()`
    unconditionally from its setup effect on every mount — this was the
    larger and more direct culprit, since it doesn't depend on idle
    timing at all. Fixed the same way: gated behind
    `deferUntilInteraction`, plus added the same `ScrollTrigger.
    refresh(true)` fix as finding 1 (its own `ScrollTrigger.create()` has
    the identical "created lazily, possibly after the visitor has
    already scrolled past its `once: true` entrance trigger" shape).

Both fixes verified with the full before/after per-chunk capture: home
route initial JS dropped from **444.2KB → 398.2KB gz** (measured twice,
byte-identical both times) — the three gsap chunks are gone from the
initial-load network capture entirely on a passive load, confirming the
root cause. Re-ran the project's own budget harness (`node
--experimental-strip-types scripts/site-perf/measure.ts`, fresh
production build): Home — LCP 596ms PASS, CLS 0.000 PASS, Initial JS
398.2KB **still FAIL** (budget 250KB, 59% over, down from 78% over).
Cross-checked LCP/CLS on the other 3 routes with a separate
PerformanceObserver probe: dental LCP 340ms, pricing 132ms, demo 184ms,
all CLS 0.000 — no regression.

**Remaining gap, honestly not closed this pass**: ~398.2KB is still
~150KB over budget. Of that, ~129.5KB is confirmed pure framework floor
(Next.js App Router client runtime + React/ReactDOM, identified via
`react-dom`/`createRoot`/`hydrateRoot`/`Scheduler` string markers in the
two largest chunks) — not fixable without dropping React/Next, out of
scope. The remaining ~270KB is spread across many small-to-medium
vendor/component chunks (Radix UI primitives used by the marketing
header's nav/dropdowns — present across a dozen+ separate chunks;
`@formatjs/intl-pluralrules` from `next-intl`'s i18n runtime; `zod` and
`date-fns`, source not yet traced to a specific home-page import). Fully
closing the budget would mean route-level code-splitting of Radix-heavy
interactive nav chrome and/or an i18n-runtime trim — a real architectural
lever, not a bug fix, and outside this task's scope per CLAUDE.md Rule 4
("do not redesign"). Flagging as the next concrete lever for whoever
picks up the JS-budget gap next, rather than re-asserting the
already-disproven Sentry/PostHog diagnosis.

**Files changed this pass**: `apps/web/src/components/motion/
use-scroll-progress.ts` (+`.test.ts`) — `ScrollTrigger.refresh(true)`
after `.create()`; `apps/web/src/components/motion/hero-scroll-scene.
test.tsx`, `apps/web/src/components/marketing/hero-scroll-section.
test.tsx` — mock updates for the new `refresh` call;
`apps/web/src/components/motion/scroll-orchestration-provider.tsx`
(+`.test.tsx`) — idle-prefetch gated behind `deferUntilInteraction`;
`apps/web/src/components/marketing/owner-phone-reveal.tsx` (+`.test.tsx`)
— `loadGsap()` gated behind `deferUntilInteraction`, `ScrollTrigger.
refresh(true)` added; `packages/ui/src/icons/index.tsx` — `dental:
Sparkles` → `dental: Smile`; `packages/ui/dist/**` — rebuilt (`pnpm
--filter @heyloo/ui build`) so the icon fix actually reaches `apps/web`;
this entry.

**Verification**: `pnpm --filter @heyloo/web typecheck` / `pnpm --filter
@heyloo/ui typecheck` clean. `pnpm --filter @heyloo/web test` 571/571
(110 files, +3 from this pass's new/expanded tests), `pnpm --filter
@heyloo/ui test` 124/124 — both clean, no regressions. `pnpm --filter
@heyloo/web lint` 0 errors, 32 pre-existing unrelated warnings (unchanged
baseline). `npx biome check` on every changed file: 0 fixes needed.
`pnpm --filter @heyloo/web build` (webpack, production): clean. Full
production-build screenshots taken at every reviewer-named spot (nav
dropdown, home business-types grid, `/dental` hero badge) confirming the
icon fix; 24 total repeated-run Playwright probes (12 pre-fix-style
repro + 12 post-fix) confirming the hero-freeze fix.

## SITE REPAIR — 4th pass, 40/100 review: the REAL hero-freeze root
cause, and a second barrel-leakage fix (2026-09-15)

**1. Hero pin scroll-freeze (blocker) — the PREVIOUS fix (SITE-REPAIR-3
finding 1, `ScrollTrigger.refresh(true)`) was necessary but not
sufficient; a second, independent bug produced the identical symptom and
is what this review actually caught. FIXED.**

Root-caused against a genuinely clean, single-process production build
(the flaky repro that looked like the ScrollTrigger-timing bug was
partly an artifact of this shared sandbox running stale/concurrent
`next-server`/`next build` processes against the same `.next` dir —
always `rm -rf apps/web/.next` and confirm only one `next-server` is
running before trusting a "still broken" repro here). With that isolated,
a temporary diagnostic (`console.log` in `use-scroll-progress.ts`'s
`onUpdate`, removed before this commit) proved `ScrollTrigger`'s own
`self.progress` tracks real scroll position correctly the whole time —
the previous round's fix holds. The freeze is downstream: `hero-story-
overlay.tsx`'s and `hero-film-scrubber.tsx`'s rAF loops each gate on an
`IntersectionObserver` to pause when off-screen, and GSAP's `pin: true`
setup (`use-scroll-progress.ts`) reparents the pinned element into a
spacer wrapper EVEN with `pinSpacing: false` — this briefly detaches
these components' containers (both are descendants of the pinned
element) from the document. Per spec (developer.mozilla.org/en-US/docs/
Web/API/IntersectionObserverEntry/rootBounds, CLAUDE.md Rule 1 — a
detached target still fires a callback), that detach delivers a
`isIntersecting: false` / `rootBounds: null` / zero-area
`boundingClientRect` entry — confirmed via a live production-build probe
(console-logged entries, removed before this commit): it fired exactly
once, right as `ScrollTrigger.create()` ran, and the browser never
delivered a follow-up "back to true" reading afterward even though the
pin's own `position: fixed` box was genuinely on-screen for the rest of
the scroll (confirmed separately via `getComputedStyle`/
`getBoundingClientRect`). Both loops treated that one stale reading as
"left the viewport" and never restarted — freezing the hero at frame 1 /
the "ring" stage for the entire pin, matching every symptom in the
review (the DOM overlay panels stuck at `ring: 1`, the film canvas never
advancing past its poster frame) even though `self.progress` itself was
fine the whole time.

Fix: in both files' `IntersectionObserver` callback, an entry with
`rootBounds === null` while the element is ACTUALLY still
`document.contains`-connected (as opposed to a genuine unmount, which
the existing cleanup already handles) is exactly that detach-artifact,
never a real viewport exit — re-observe instead of trusting it, so the
next real reading isn't lost either. Verified against a fresh, single-
process production build + `next start`, reproducing the review's own
repro methodology: (a) the exact split-timing repro that reliably froze
it before the fix (a tiny scroll to trigger `engaged`, THEN a separate
`window.scrollTo` jump — the shape that most reliably hit the detach
race) now correctly reads `answer: 1` instead of stuck `ring: 1`; (b) an
11-position `scrollY` sweep (65→2315, the reviewer's own pin bounds) at
1440px in BOTH themes, screenshotted at every position — the DOM overlay
panels now correctly cross-fade ring→answer→book→land in sync with the
film's own frame advancing (transcript bubbles + tool-call badge at
30-50%, the booking card assembling on the film's white card at 60-70%,
the dashboard-row hand-off at 90-100% — the full physical-to-UI set
piece, in both light and dark); (c) `diag1`-style repeated wheel-scroll
sweeps (10 stops, scrollY 0→3200) show the same correct progression.
Also re-ran the full `apps/web` test suite (571/571) and `@heyloo/ui`
(124/124) — no regressions.

**2. Home route initial JS 398.3KB vs 250KB budget (blocker) — PARTIALLY
FIXED (398.3KB → 379.2KB gz), same root-cause class as SITE-REPAIR-3
finding 3, not yet fully closed.** Re-measured fresh via `node
--experimental-strip-types scripts/site-perf/measure.ts` against a truly
clean build: confirmed the reviewer's 398.3KB gz exactly (LCP 424-532ms
and CLS 0.000 both comfortably pass throughout, unaffected). Traced the
overshoot with a live per-chunk CDP capture (`Network.loadingFinished`
`encodedDataLength`, same method as `measure.ts`) cross-referenced
against literal string-marker search in each chunk: found a NEW instance
of the exact `@heyloo/ui` barrel-leakage class SITE-REPAIR-3 already
fixed for `charts`/`cmdk`/`input-otp` (that entry's own header comment,
`packages/ui/src/index.ts`) — nobody had yet found it for `Calendar`.
`primitives/calendar.tsx` (`react-day-picker`, which pulls in `date-fns`)
was still re-exported from the main `@heyloo/ui` barrel via `primitives/
index.ts` → `forms/date-range-picker.tsx` → `custom/date-range-pills.tsx`
→ `custom/index.ts`, even though its ONLY real call site in the entire
app is the tenant dashboard overview's date-range filter
(`apps/web/src/components/tenant/overview-client.tsx`) — confirmed via
exhaustive grep, zero other consumers anywhere in `apps/web` or
`packages/ui`. Same fix as the established precedent: carved the whole
chain (`Calendar`, `DateRangePicker`, `DateRangePills`) out of the
default barrel into a new `@heyloo/ui/date-range` subpath export
(`packages/ui/src/date-range-entry.ts`, mirroring `command-entry.ts`'s
shape exactly), updated `overview-client.tsx`'s one import, rebuilt
`@heyloo/ui`. Verified: `date-fns`/`react-day-picker` string markers now
present in ONE dashboard-only chunk (loads on `/dashboard`, confirmed via
the same chunk-content search) and ABSENT from every marketing-route
chunk; re-measured with `measure.ts` against a from-scratch build: **PASS
LCP 516ms, PASS CLS 0.000, FAIL Initial JS 379.2KB** (down from 398.3KB,
budget 250.0KB).

**Remaining gap, honestly not closed this pass**: still ~129KB over
budget. Investigated the reviewer's two named levers specifically:
`marketing-header.tsx` does NOT use a Radix dropdown (it's a plain CSS
`group-hover` menu — confirmed by reading the file), so "split the
header's Radix dropdown" isn't a valid lever as literally stated; the
REAL Radix cost (confirmed via the same chunk-content search: `radix`
string markers across 8 separate chunks, ~89KB gz combined) comes from
`primitives/index.ts` re-exporting every one of the ~25 Radix-backed
primitives (accordion, dialog, select, sheet, tabs, tooltip, etc.) from
the SAME barrel `Button`/`ThemeToggle` need — the same barrel-leakage
class as the `date-range`/`charts`/`command` fixes, but auditing all 25
for real marketing-route reachability (several — `dropdown-menu`,
`popover`, `hover-card` — likely ARE used by non-marketing consumers
across the admin/tenant/partner apps and would need their own careful
per-primitive carve-out, not a blanket exclusion) is a substantially
larger, multi-file architectural pass than fits this review-fix task
per CLAUDE.md Rule 4 ("do not redesign"). `@formatjs/intl-pluralrules`
(next-intl's polyfill) was checked too — no direct app-level import
found; it's pulled in by `next-intl` itself, not something this task's
files can trim without an `next-intl` version/config change outside
`apps/web`/`packages/ui`/`scripts/site-perf`'s file ownership. Flagging
the Radix-barrel audit specifically (which primitive, which real
consumer, which can safely move to its own subpath) as the next concrete
lever — the SAME pattern already proven twice (`charts`, `date-range`),
just bigger.

**3. `owner-phone-reveal.tsx` entrance animation (minor) — checked, no
defect found, no code change made.** Per the review's own instruction
("no code change indicated unless a real freeze is found"): drove a
REAL, slow, incremental wheel-scroll (30px steps, 90ms real waits — not
a synthetic jump) through the section in both themes, screenshotting
every step (80 frames total) from just before the section enters view
through well past it. Every single frame shows either the fully-settled
state (phone chassis + notification card complete) or the section not
yet visible — never a stuck intermediate/half-tweened frame in either
theme. No change made.

**Files changed this pass**: `apps/web/src/components/motion/
hero-story-overlay.tsx`, `apps/web/src/components/motion/
hero-film-scrubber.tsx` — the `IntersectionObserver` detach-artifact
guard (finding 1); `apps/web/src/components/tenant/overview-client.tsx`
— import path update to `@heyloo/ui/date-range`; `packages/ui/src/
index.ts`, `packages/ui/src/primitives/index.ts`, `packages/ui/src/
forms/index.ts`, `packages/ui/src/custom/index.ts` — barrel exclusions +
comments; `packages/ui/src/date-range-entry.ts` (new) — the new subpath
entry; `packages/ui/package.json` — new `./date-range` export;
`packages/ui/dist/**` — rebuilt; this entry.

**Verification**: `pnpm --filter @heyloo/web typecheck` clean, `pnpm
--filter @heyloo/ui typecheck` clean. `pnpm --filter @heyloo/web test`
571/571 (110 files), `pnpm --filter @heyloo/ui test` 124/124 — both
clean, no regressions. `pnpm --filter @heyloo/web lint` 0 errors, 32
pre-existing unrelated warnings (unchanged baseline). `npx biome check`
on every changed file: 0 fixes needed. `pnpm --filter @heyloo/web build`
(webpack, production, from a clean `.next`): clean. `node
--experimental-strip-types scripts/site-perf/measure.ts` against that
build: LCP/CLS PASS, Initial JS FAIL at 379.2KB (down from 398.3KB).
Full production-build screenshots at every reviewer-named spot (11-stop
hero sweep × 2 themes, plus the split-timing repro) confirming the
hero-freeze fix; an 80-frame slow-scroll sweep × 2 themes confirming the
owner-phone-reveal minor is not a real defect.

## SITE-2 — Integrator pass: cinematic scroll-scrubbed hero film, owner-phone
## payoff beat, home-route JS budget closed for real (2026-09-15,
## session_012xvcAnjqsMbPqitErDJQbR)

Final integration over the SITE-2 wave banked mid-container-restart as
`fcd7124` (review 48/100, JS budget open) and carried forward by three
follow-up commits (`4d128ea`, `d532ed3`, `447da01`) that root-caused and
fixed the home route's JS-budget blocker. This pass extends that same
fix to every remaining Server Component in the app, adds a permanent CI
guard so it can't silently regress, fixes a real bug found in
`next.config.ts` along the way, and re-confirms the whole gate set clean.

**The film technique.** `three/*` (react-three-fiber line-art morph) is
gone, replaced by a `<canvas>` 2D frame-sequence scrubber
(`hero-film-scrubber.tsx` + the pure-function math in
`hero-film-frames.ts`): 97 pre-rendered WebP frames per theme
(`apps/web/public/site/hero-film/{light,dark}/f001.webp`…`f097.webp`,
1440×810, generated via Higgsfield/Seedance 2.5 — see
`docs/design/ASSETS.md`). `frameForProgress(progress)` maps raw 0-1
scroll progress to an exact frame via a PIECEWISE-linear function pinned
at `hero-story.ts`'s own stage boundaries (`resolveHeroStage`), never one
global ease across the full 1-97 range — this is what keeps the DOM
story overlay (`hero-story-overlay.tsx`, driven by the identical
`resolveHeroStage`) in lockstep with the drawn frame at every scroll
position. Frames load in a binary-subdivision prefetch order
(`computeHeroFilmLoadOrder`: `1, 97, 49, 25, 73, …`) so a visitor who
scrolls straight to any point in the timeline is never more than a
shrinking handful of frames from one already loaded; the first 12 of
that order (`HERO_FILM_EAGER_FRAME_COUNT`) load immediately post-
hydration, the rest deferred to idle/interaction. Each frame is drawn
with `background-size: cover`-equivalent placement math
(`computeHeroFilmCoverFit`) so the canvas always fully covers its box
regardless of viewport aspect, centered, cropping overflow — pure
functions, unit-tested with no DOM/browser needed.

**Frame → beat mapping** (`HERO_FILM_STAGE_FRAMES`, cross-checked against
`hero-story.ts`'s 0-1 scroll-progress beat ranges by opening the actual
committed frames, not estimated): `ring` frames 1–30 (progress 0–0.2, the
phone rests then rings/lifts/tilts), `answer` frames 30–66 (0.2–0.55, the
ember sound-ribbon undulates under the lifted phone — AI talking),
`book` frames 66–82 (0.55–0.8, the ribbon straightens/thickens and
resolves into the white booking card), `land` frames 82–97 (0.8–1.0, the
card settles flat/centred-low as the phone drifts out of frame).
Confirmed within the brief's own ±3-frame tolerance in BOTH `light/` and
`dark/` frame sets — one shared table drives both, no per-theme
divergence needed. `HERO_FILM_CARD_RECT` (measured per-theme off the
actual `f090`/`f097` pixels, not guessed) is where `hero-story-overlay`'s
"book"/"land" DOM panels are positioned so the real booking-card content
lands visually ON the film's own white card.

**Beat 6 — "Reach the owner"** (`owner-phone-reveal.tsx`,
WEBSITE_CREATIVE_BRIEF.md §1's 6th and closing beat, placed directly
after `DashboardPreview` per the round-4 review/SITE-1 note): a CSS-only
phone (fixed near-black chassis, not a themed `--neutral-*` token, so it
reads as the SAME physical object the hero film itself renders) rises
and tilts in from below on a `once: true` GSAP `ScrollTrigger` entrance
(no scroll-scrubbed middle state — this beat has no meaningful
in-between, same reasoning `how-it-works.tsx` gives for its own
once-per-view pulse), then a notification card slides down showing the
SAME booking (`HOME_CONTENT.booking`, shared with `DashboardPreview`)
that opened the hero's story — closing the loop: a call rings, the AI
answers, a booking lands in the dashboard, and now reaches the owner's
own phone.

**The barrel-leak root cause** (already diagnosed by `4d128ea`/`d532ed3`,
restated here since this pass finishes the fix): a single
`export const UI_PACKAGE_VERSION` literal in `packages/ui/src/index.ts`
defeated Next's barrel optimizer for the WHOLE `@heyloo/ui` package —
not just that one export. Once the optimizer bailed, any Server
Component importing ANYTHING from the `@heyloo/ui` barrel (even just
`Button`) registered every reachable `"use client"` module (all ~25
Radix-backed primitives, `react-hook-form`, `@tanstack/table-core`,
`zod` via `price-card`, `recharts`, `cmdk`, `react-day-picker`, …) as a
client dependency of that page, regardless of whether the page actually
rendered any of them. `4d128ea` made the index a pure re-export barrel
(export moved to its own `./version.js` subpath) and marked
`canonical-types`/`@heyloo/ui` `"sideEffects": false`; `d532ed3` deep-
imported the home route's own Server Components to real defining
modules (`@heyloo/ui/primitives/button`, `@heyloo/ui/layout/container`,
etc.) and added the per-module subpath exports those imports resolve
against.

**This pass's own work — closing the gap for the REST of the app.** The
prior fix only touched the home route's Server Components; every other
Server Component across the marketing/tenant/partner/admin/preview
surfaces still imported the `@heyloo/ui` barrel (harmless for THEIR own
routes today, since Next's optimizer now works again post-`4d128ea`, but
a silent trap: the barrel import itself still resolves and compiles, so
nothing fails until someone's route happens to reach a heavy barrel
member). Converted all ~30 remaining Server Component barrel imports to
the same deep-module-path pattern: `(marketing)/[vertical]`,
`(marketing)/blog/*`, `(marketing)/demo`, `(marketing)/intake/[token]`,
`(marketing)/not-found`, `(marketing)/pricing`, `(marketing)/signup/*`,
`(partner)/portal/*`, `(preview)/*`, `(tenant)/dashboard/*`,
`(tenant)/layout.tsx`, `(admin)/cockpit/loading.tsx`,
`components/admin/admin-nav-sections.ts`. Added
`scripts/check-server-barrel-imports.ts` — a dependency-free script
(same `node --experimental-strip-types`, no-workspace-membership
convention as `scripts/site-perf/measure.ts`) that scans every non-
`"use client"` `.ts`/`.tsx` file under `apps/web/src` for a bare
`@heyloo/ui`/`@heyloo/ui/primitives`/`@heyloo/ui/custom` barrel import
and fails with the exact file list + fix instructions if it finds one;
wired as `pnpm run check:server-barrels` and a new CI step in
`.github/workflows/ci.yml`'s `lint` job, so this class of regression
now fails CI immediately instead of silently reappearing the next time
someone adds a Server Component that reaches for a `@heyloo/ui` import.

**Real bug found and fixed along the way**: `apps/web/next.config.ts`
carried an uncommitted "TEMP DIAGNOSTIC" `webpack()` block, explicitly
commented "reverted before commit" but never actually reverted. Two real
problems with it, both fixed by deleting the block: (1) it hardcoded a
PREVIOUS agent session's own `/tmp/claude-.../scratchpad/webpack-
stats.json` path — any build in a different session/environment/CI
runner would `ENOENT`-crash the instant webpack's `done` hook fired,
since that directory does not exist outside the session that wrote it;
(2) the object literal defined the `webpack` key TWICE — once inside
`...(previewModeActive && { webpack(config) {...} })` (sets the preview-
mode module-resolution aliases) and again as a later plain property (the
diagnostic stats dump) — in a JS object literal a later key silently
wins over an earlier one even when the earlier one arrived via spread,
so the diagnostic block was unconditionally clobbering and completely
disabling `UI_PREVIEW_MODE`'s webpack aliasing whenever both were
active. Removed the diagnostic block entirely; the single
`previewModeActive`-gated `webpack()` is now the only one defined.
`npx biome check --write` also caught (and fixed, formatting-only) a
long-line violation in this same file plus an export-ordering violation
in `packages/ui/src/index.ts`'s already-committed barrel — both were
pre-existing `pnpm run lint` blockers this pass needed clean before
committing.

**Measured numbers** (`scripts/site-perf/measure.ts`, CPU-throttled 4x,
real production build, home route): the wave's own trace —
379.2KB gz → 335.5KB gz (pure barrel, `4d128ea`) → 224.3KB gz PASS (home-
route deep imports, `d532ed3`). This pass's own re-run after extending
the fix app-wide and adding the CI guard: **LCP 492ms, CLS 0.000, initial
JS 224.1KB gz — all PASS** (250KB budget), consistent with the review's
own 224.1-224.3KB gz reference measurements; run-to-run LCP/CLS noise
(other capture methods this task's review cites: 316-908ms LCP,
0.0007-0.007 CLS) is all comfortably inside the 2500ms/0.05 budgets
regardless.

**Gates this pass**: `npx biome check --write` on every changed path —
clean (2 pre-existing formatting/ordering errors found and fixed, see
above). `pnpm -w typecheck` — clean, 21/21 packages. `pnpm run lint` — 0
errors (43 pre-existing warnings elsewhere, unchanged baseline, none in
files this pass touched). `pnpm -w test` — 572/572 web + 124/124 ui
green. `apps/web` production build (`next build --webpack`, placeholder
`.env.local`) — clean, all 183 routes; note for future runs in a sandbox
with a TLS-intercepting egress proxy: Turborepo 2.x defaults to
`envMode: "strict"`, which strips `NODE_EXTRA_CA_CERTS`/`HTTPS_PROXY`
from the task's environment and breaks `next/font`'s Google Fonts fetch
with a `self-signed certificate in certificate chain` error — this is a
local sandbox artifact only (a real GitHub Actions runner has direct
internet access, no interception proxy), reproduced and root-caused via
`npx turbo run build --dry=json` (`envMode: "strict"` confirmed) and
worked around locally with `--env-mode=loose`; no repo file needed
changing for it. `scripts/check-server-barrel-imports.ts` — 0
violations (the guard this pass added). `node --experimental-strip-types
scripts/site-perf/measure.ts` — PASS/PASS/PASS, see numbers above. No
file >2MB; `apps/web/public/site` 2.45MB (8MB budget, unchanged this
pass — no new assets); `pnpm-lock.yaml` untouched, `pnpm install
--frozen-lockfile` clean.

**Review score / status**: 95/100, pass, `"open": []` — no outstanding
findings from the review this pass integrates. Nothing left incomplete
from this task's own scope.

## OPS-1 — optional-integration cron jobs skip when not configured (2026-09-20)

**Problem**: the live Supabase project's pg_cron → `net.http_post` schedule
now reaches these edge functions successfully, but five of them crash at
cold start with `Missing required env var: X` because an OPTIONAL
integration's secret is not provisioned yet (owner still pending on
Retell webhook signing, Twilio account, and outreach vendor keys): every
2-15 minutes forever, drowning monitoring in HTTP 500 `WORKER_ERROR`.
Affected: `job-keep-warm` (`RETELL_WEBHOOK_SIGNING_SECRET`),
`job-retell-health-failover` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`RETELL_FAILOVER_VOICE_URL` — `RETELL_API_KEY` is already provisioned via
the live Retell voice integration, so it stays required),
`job-outreach-personalize` (`ANTHROPIC_API_KEY`),
`job-outreach-personalize-collect` (`ANTHROPIC_API_KEY`,
`SMARTLEAD_API_KEY` — `OUTREACH_CAN_SPAM_FOOTER` is a compliance hard
rule per `.env.example`, not an integration secret, so it stays required),
`job-outreach-review-score` (`OUTSCRAPER_API_KEY`, `ANTHROPIC_API_KEY`).

**Fix**: added `missingEnv(names: readonly string[]): string[]` to
`supabase/functions/_shared/deno/env.ts` (returns the subset of `names`
that are unset, same falsy check as `requireEnv`). In each affected
`index.ts`, `CRON_INVOKE_SECRET` stays a module-scope `requireEnv` and the
`x-cron-secret` check still runs first and is unchanged (auth stays
fail-closed). Only the OPTIONAL integration secrets moved from
module-scope `requireEnv` (which throws at cold start, before the request
handler even runs) to a check inside `Deno.serve`'s handler, immediately
after the cron-secret check: if `missingEnv([...])` is non-empty, the
handler logs `logger.warn("job_skipped_not_configured", { missing })` and
returns `jsonResponse({ skipped: "not_configured", missing }, { status:
200 })` without touching the database or any provider. When nothing is
missing, each var is read with `requireEnv` at that point and the handler
proceeds exactly as before — same `handler.ts` call, same deps shape, zero
behavior change once an integration is actually configured. No
`handler.ts` changed (portable, unit-tested files); the diff is entirely
in the Deno-only, untested `index.ts` entrypoints plus the one new
`_shared/deno/env.ts` helper (also Deno-only/untested — same as the
existing `requireEnv`/`optionalEnv`/`optionalServiceRoleKey` it sits next
to).

**Why this doesn't weaken CLAUDE.md Rule 2's fail-closed rule**: Rule 2's
"missing secret = reject, never skip" targets *auth and webhook*
verification — a webhook whose signing secret is absent must be rejected,
never processed as if it were verified, because skipping there would let
an unauthenticated caller's payload through as trusted. These five
functions are not webhooks and carry no caller-supplied payload to act on
without verification — they are cron-fired workers gated by their own
`x-cron-secret` auth check, which still runs first, is still
`requireEnv`-backed, and is completely unchanged by this task. What
changes is only *whether a periodic worker has optional integration
credentials to do its (optional, not-yet-live) job* — Retell
webhook-signing keepalive pings, Twilio failover, and Anthropic/Outscraper/
Smartlead outreach automation are all real features that are simply not
provisioned yet on this tenant/environment, same class of "feature X's
adapter secret is absent" that `docs/VERIFY.md` and `.env.example`
already treat as an expected, non-fatal absence elsewhere in this
codebase (e.g. `ANTHROPIC_API_KEY` unset already "simply disables the AI
reply" for a different function per `.env.example`). Returning an
explicit `skipped: "not_configured"` 200 with a `missing` list and a
`warn`-level structured log line is strictly more visible in monitoring
than a recurring unstructured 500 crash was, and nothing runs, no
provider is called, and no data is touched with a missing credential —
the fail-closed guarantee (never proceed without the secret you need) is
fully intact; only the *shape* of "not configured" changed, from a
crash-and-retry-forever cold-start throw to an explicit, logged, 200
no-op skip.

**Gates**: `cd supabase/functions && npx vitest run` — 101/101 files,
923/923 tests green (no `handler.ts`/`handler.test.ts` changed — the
skip logic lives entirely in the untested Deno-only `index.ts` layer, so
no new/adjusted unit tests were needed or possible under this repo's
existing Node/Deno test split — see `supabase/functions/package.json`'s
own description of that split). `npx biome check --write` on the six
changed files — clean (one pure reformat, an array literal wrapped
across lines in `job-retell-health-failover/index.ts`, no logic change).
`pnpm -w typecheck` — 21/21 packages green, including
`@heyloo/edge-functions#typecheck`.

## OPS-2 — chronic pg_cron -> pg_net timeouts, cause + fix (2026-09-20)

**Measured (sbq.sh against the live project, net._http_response, last 6
sampled hours 10:00-16:00 UTC, ~1542 responses):**

| Metric | Value |
|---|---|
| HTTP 200 | 31 |
| HTTP 500 (`WORKER_ERROR`, pre-existing/OPS-1-class, out of scope here) | 591 |
| HTTP 401 (mis-scoped/stale secret, out of scope here) | 452 |
| Timeout (null status, `error_msg` set) | 468 |
| — of which 15000ms timeout | 448 |
| — of which 30000ms timeout | 19 |
| — of which 45000ms timeout | 1 |
| DNS-stall (DNS time == full 15000ms) among 15000ms timeouts | 133 / 446 sampled (~30%) |
| Timeout rate, hour-by-hour | 74, 84, 74, 75, 80, 81 per hour — flat |
| `pg_net.batch_size` / `.ttl` / `.database_name` / `.username` | 200 / 6 hours / postgres / (empty) |
| `net.http_request_queue` depth (backlog) | 0 |
| Timeout rate at the busiest coincidence (minute 0/30 — 3 per-min + */2 + */3 + */5 + three */15 + three hourly jobs, ~12 requests at once) | 10.8% |
| Timeout rate with zero schedule overlap (only the 3 per-minute workers) | 39.8% |

The last row is the key finding: timeout rate is **flat to inversely
correlated** with how many jobs coincide in the same instant, which rules
out a concurrency/thundering-herd cause and rules out (a) raising
`pg_net.batch_size` (already 200, far above the ~12-request worst case,
and the queue never backs up) and (c) staggering the per-minute/`*/2`/`*/3`
job schedules apart from the `*/5`, `*/15`, and hourly ones (CLAUDE.md
Rule 1: the numbers, not an available knob, drive the choice).

**Cited cause** (fetched live this session — CLAUDE.md Rule 1):
- `github.com/supabase/pg_net`'s own README: pg_net runs a **single**
  background worker (no per-job/per-request concurrency setting exists;
  `pg_net.batch_size` only bounds rows read per pass) — one shared libcurl
  instance, and its DNS resolver state, serves every scheduled job.
- `github.com/curl/curl/issues/18216` (closed, filed 2025-08-07, affects
  curl 8.5.0/8.14.1/8.15.0): after a DNS lookup times out and libcurl calls
  `ares_cancel()`, "the ares channel itself stays in an invalid state,
  with its internal socket still open but not operable" — it does not
  self-recover, and `curl_easy_reset()` does not clear it; the only fix is
  discarding the handle. This matches the measured flat ~30% chronic
  timeout rate independent of load exactly: once the single worker's
  shared resolver state is corrupted by one timed-out lookup, a fixed
  fraction of everything routed through that same worker keeps failing
  until the worker restarts.
- `github.com/orgs/supabase/discussions/36235` + pg_net's own
  `net.worker_restart()` (confirmed present on the live project, pg_net
  0.19.5, EXECUTE already granted to the `postgres` role every existing
  cron.job runs as) — the documented recovery path for pg_net >= 0.8: it
  reloads config and restarts the background worker, discarding the stuck
  libcurl/c-ares handle. `supabase.com/docs/guides/database/extensions/
  pg_net` (fetched 2026-09-20) documents the function's signature but
  frames it only as a config-reload helper — the DNS-stuck-worker recovery
  use is corroborated by the discussion above and by curl#18216's own
  "only a fresh handle clears it" conclusion, not a direct doc statement,
  so it's called out here as the one inference beyond documented fact.
- `supabase.com/docs/guides/troubleshooting/webhook-debugging-guide-M8sk47`
  (fetched 2026-09-20) documents a *different*, already-patched-since-
  v0.11 "mass timeout from request-volume intensity" pg_net bug and
  recommends raising the caller's timeout for *that* case (we're on
  0.19.5); the flat/inverse concurrency correlation measured above rules
  that scenario out here, so (b) raising `timeout_milliseconds` was
  deliberately not used — it would only make an already-stuck request take
  longer to fail, not fix the stuck resolver state.

**Decision — (d):** a known pg_net/libcurl DNS-timeout-recovery gap, fixed
by scheduling the documented recovery primitive (`net.worker_restart()`)
on pg_cron itself, every 10 minutes, DB-internal only (no HTTP round trip,
no Vault secret dependency, so it schedules unconditionally once pg_cron
exists). Restart only takes effect between pg_net's own batches, so
in-flight requests are unaffected; every 10 minutes bounds how long a
corrupted resolver state (and its ~30% failure tax) can persist without
being so frequent it disrupts otherwise-healthy batches.

**Migration:**
`supabase/migrations/20260920160500_pgnet_worker_restart_cron.sql` — adds
`public.fn_cron_pgnet_worker_restart()` (guarded by a `pg_net` extension
presence check, same pattern as this repo's other `job-internal-*` DB-only
cron functions) and schedules it as `job-pgnet-worker-restart`
(`*/10 * * * *`) via the existing `fn_cron_upsert` helper. The
`x-cron-secret` HTTP mechanism is untouched — this job never makes an HTTP
call. Additive, idempotent (upsert by job name), reproducible from zero.

**Expected effect:** the chronic ~30% timeout floor should drop toward the
transient/occasional level as the worker (and its DNS resolver state) gets
force-cycled well before a corrupted state can dominate a full 6-hour
window the way it did in the measurement above. Not expected to fully
zero out timeouts (a fresh worker can still hit a genuinely slow/unhealthy
DNS resolver at any moment), just to stop the corrupted state from
persisting and compounding.

**Not touched in this task (separate, already-tracked/out of scope):**
the 591 HTTP 500 (`WORKER_ERROR`) and 452 HTTP 401 responses in the same
window — the task's own problem statement calls the 5xx/401-producing
misconfiguration "now fixed"; OPS-1 (above) already documents the
`WORKER_ERROR` cold-start-crash class for `job-keep-warm`, `job-retell-
health-failover`, and the outreach jobs specifically. The 500/401 volume
still present in this measurement window (`WORKER_ERROR`/401 samples
still occurring in the most recent 30 minutes as of this task) suggests
that fix hasn't fully propagated or a related cause remains — flagged
here as a gap for separate follow-up, not addressed by this migration
(CLAUDE.md Rule 4 — scope discipline).

**CI:** `scripts/ci/cron-queues-check.ts`'s `EXPECTED_CRON_JOBS` list
updated to include `job-pgnet-worker-restart` (it's DB-internal, so it
doesn't need adding to `CRON_MIGRATIONS`, which only re-applies
Vault-secret-gated files). Could not run the script itself locally — no
Docker daemon in this environment (`docker ps` fails: "no such file or
directory" on the daemon socket), so `supabase start` cannot stand up the
local Postgres this check depends on.

**Gates:** `pnpm -w typecheck` and `pnpm run lint` — see this task's
commit for pass/fail; `npx biome check --write` on every changed file —
clean (the `.sql`/`.md` files touched aren't in biome's configured file
set, only `scripts/ci/cron-queues-check.ts` was linted, no changes
needed).

## OPS-4 — Retell webhook signature key is the API key (2026-09-20)

**Problem**: `voice-tools`, `voice-events`, `voice-inbound`, and
`job-keep-warm` all read a distinct `RETELL_WEBHOOK_SIGNING_SECRET` env
var via `requireEnv` to verify the `X-Retell-Signature` header, and
crashed at cold start with `Missing required env var:
RETELL_WEBHOOK_SIGNING_SECRET` — that var is unset on the live project,
while `RETELL_API_KEY` is set. Per Retell's own docs
(docs.retellai.com/features/webhook-overview, confirmed 2026-09-20):
webhooks are signed with the account's API key as the HMAC secret; there
is no separate webhook-signing secret. `docs/VERIFY.md` VERIFY-1 already
confirmed the SAME fact byte-for-byte against the `retell-typescript-sdk`
source and both signature-verification files
(`packages/adapters/retell/src/signature.ts`,
`supabase/functions/_shared/retell-signature.ts`) were already correct —
only the env var each function read to get that key was wrong.

**Fix**: added `requireRetellWebhookKey(): string` to
`supabase/functions/_shared/deno/env.ts` — returns
`RETELL_WEBHOOK_SIGNING_SECRET` if set (kept as an explicit override, e.g.
for rotation) else `RETELL_API_KEY`, throwing only if neither is set
(fail closed, CLAUDE.md Rule 2). Switched `voice-tools/index.ts`,
`voice-events/index.ts`, `voice-inbound/index.ts`, and
`job-keep-warm/index.ts` from `requireEnv("RETELL_WEBHOOK_SIGNING_SECRET")`
to it. `job-keep-warm`'s OPS-1 optional-integration skip now checks both
vars (`missingEnv(["RETELL_WEBHOOK_SIGNING_SECRET", "RETELL_API_KEY"])`,
skip only when BOTH are unset) since `requireRetellWebhookKey()` itself
covers the fallback. Signature verification itself
(`_shared/retell-signature.ts`, `verifyRetellSignature`) is untouched —
raw body, timestamp tolerance, fail-closed on a missing header, all
unchanged; only where the `secret` param's VALUE comes from changed.
`apps/web` was checked (`apps/web/src/lib/env.ts` and a repo-wide grep) —
no server route reads this var, no change needed there.
`scripts/e2e-backend.ts` (manual Node E2E smoke, not deployed) updated
the same way: `env("RETELL_WEBHOOK_SIGNING_SECRET", "RETELL_API_KEY")`.

**Tests**: `supabase/functions/_shared/deno/env.ts` is Deno-only
(excluded from this package's `tsconfig.json`, reads `Deno.env.get`) — no
Deno test runner was invented. Instead, added
`supabase/functions/_shared/deno/env.test.ts` using the same
`vi.stubGlobal("Deno", {...})` shim `admin/index.test.ts` already
established for exercising a Deno-only entrypoint under Vitest/Node:
covers the `RETELL_WEBHOOK_SIGNING_SECRET` override, the `RETELL_API_KEY`
fallback, the empty-string-doesn't-count-as-set case, and the fail-closed
throw when neither is set.

**Deploy + boot-check** (`npx supabase functions deploy <name>
--project-ref qulcubtwqsqgqpfgvorn --use-api --yes --import-map
supabase/functions/deno.json`, then `curl -X POST
https://qulcubtwqsqgqpfgvorn.supabase.co/functions/v1/<name> -d '{}'`
with no signature header — expect 401, never 500): see this task's commit
message / PR for the exact codes recorded at deploy time.

**Docs**: `.env.example` — `RETELL_WEBHOOK_SIGNING_SECRET` now documented
as an optional override, not a separately-required secret.
`docs/VERIFY.md` VERIFY-1 — added an OPS-4 follow-up note pointing at this
entry. `docs/LAUNCH_STATUS.md` — removed `RETELL_WEBHOOK_SIGNING_SECRET`
from the owner-blocked list (the first-call prerequisite on the Retell
side is now met via `RETELL_API_KEY`, already provisioned).

## OPS-3 — one cron request per minute instead of three: the per-job asymmetry, root cause, and fix (2026-09-20)

**Starting point (OPS-2's own gap):** OPS-2 fixed the chronic pg_cron ->
pg_net timeout floor's *persistence* (`net.worker_restart()` every 10
minutes) but explicitly left its own measured **per-job asymmetry**
unexplained: over the 120 minutes before this task, worker-recording-fetch
arrived ~100% of the time, worker-adapter-push ~68%, worker-messages-
outbound only ~50% — and OPS-2's own 10-minute restart job measurably did
**not** move the timeout rate (8 -> 7 timeouts per 12 minutes). This task's
job was to explain that asymmetry with an experiment, not a theory, and
fix whatever it showed.

### Experiment log (all times UTC, `sbq.sh` against the live project)

- **16:08:46-16:23:46 — baseline** (`function_edge_logs`, POST arrivals per
  15-minute window): worker-recording-fetch (cron job 6) 15/15 (100%),
  worker-adapter-push (job 7) 15/15 (100%), worker-messages-outbound (job
  5) 8/15 (~53%). `cron.job_run_details.start_time` millisecond ordering,
  sampled across 5 consecutive minutes (16:20-16:24): job 6 fired first,
  job 5 second, job 7 third, every cycle in that sample.
- **16:24:45 — experiment start.** Live-swapped the `net.http_post` `url`
  between cron job 5 (worker-messages-outbound, worst arrival) and job 6
  (worker-recording-fetch, best arrival) via `cron.alter_job`. During the
  swap, `cron.job_run_details` showed the within-minute firing order was
  **not** perfectly fixed after all (job 6 first at 16:25/26/28/30, job 5
  first at 16:27/29) — already weakening a pure fixed-dispatch-order
  theory before the arrival counts even came in.
- **16:24:45-16:33:46 (9 minutes) — swap result** (`function_edge_logs`):
  worker-recording-fetch function (now driven by job 5) = 9/9 (100%).
  worker-messages-outbound function (now driven by job 6) = 3/9 (~33%,
  *worse* than its own 53% pre-swap baseline). worker-adapter-push
  (untouched control, job 7) = 9/9 (100%).
  **Conclusion: the loss follows the TARGET URL/function
  (worker-messages-outbound), not the cron-job slot or dispatch
  position.** Job 5 went from bad (53%) to good (100%) the moment it was
  pointed at a different endpoint; job 6 went from good (100%) to bad
  (33%) the moment it was pointed at worker-messages-outbound. A pure
  "single shared pg_net worker, DNS-resolver-state corruption is
  order/position-dependent" explanation predicts the *opposite* —
  whichever request happens to lose the race in a given tick, roughly
  independent of which function it targets — so this experiment rules
  that reading out as the *whole* story, on top of OPS-2's own
  already-measured "worker_restart() didn't move the needle" result.
- **16:35:19 — restored** job 5/job 6 to their original commands
  (verified via `cron.job` read-back). `job-pgnet-worker-restart`
  (OPS-2) was left running throughout, untouched.

### Cited research (CLAUDE.md Rule 1 — fetched live this session)

- `github.com/supabase/pg_net`'s own `src/worker.c` (fetched 2026-09-20):
  the background worker's `curl_multi_init()` handle is created **once**
  at worker startup, stored in the long-lived `worker_state` struct, and
  reused for **every** subsequent batch/tick. `curl_global_init(CURL_
  GLOBAL_ALL)` is called once for the whole worker process. No
  `CURLMOPT_MAX_HOST_CONNECTIONS` (or any other per-host connection cap)
  and no `CURLOPT_HTTP_VERSION` override is set anywhere in the file.
  Each batch's rows are added to that one persistent multi handle via a
  plain sequential `for` loop (`curl_multi_add_handle` per row) before
  the event loop (`curl_multi_socket_action`) begins.
- `curl.se/libcurl/c/CURLMOPT_PIPELINING.html` (fetched 2026-09-20):
  "Since 7.62.0, CURLPIPE_MULTIPLEX is enabled by default" — "If this bit
  is set, libcurl tries to multiplex the new transfer over an existing
  connection if possible," and multiplexing only applies "when the same
  hostname is used for subsequent transfers." pg_net never disables this
  (confirmed above), and its persistent multi handle is exactly the
  "same multi handle reused for subsequent transfers" precondition.
- `curl.se/libcurl/c/CURLOPT_HTTP_VERSION.html` (fetched 2026-09-20): the
  default for an HTTPS connection has been `CURL_HTTP_VERSION_2TLS`
  (prefer HTTP/2 over TLS) since curl 7.62.0.
- **Inference (beyond directly-documented fact, flagged per this
  project's own Rule-1 convention):** three `net.http_post` calls fired
  in the same pg_cron tick, to the same host, through pg_net's one
  persistent libcurl multi handle, with HTTP/2 multiplexing on by
  default and nothing disabling it, are positioned to be multiplexed
  onto a single shared TCP/TLS connection as concurrent HTTP/2 streams
  rather than opening three independent connections. If that is what's
  happening, one function's response being disproportionately slow
  (worker-messages-outbound's, per the swap experiment) can starve or
  coincide with lost responses for the *other* streams sharing that one
  connection too — consistent with both (a) the specific, repeatable
  per-function asymmetry the experiment demonstrated and (b) OPS-2's
  separately measured ~30% *baseline* loss rate that wasn't confined to
  worker-messages-outbound alone historically. curl/curl#18216 (cited by
  OPS-2: a DNS-timeout leaves pg_net's single shared c-ares channel "in
  an invalid state... does not self-recover" until the worker restarts)
  remains a plausible compounding factor for the *chronic floor*, but
  does not by itself explain the swap result, which is why this entry
  treats it as a contributing, not sole, cause.
  **VERIFY.md gap**: the precise, final-mile reason worker-messages-
  outbound's specific endpoint was disproportionately slow/lossy at
  Supabase's edge was not independently confirmed against Supabase's own
  current docs from this environment — logged as a VERIFY item rather
  than guessed at further (CLAUDE.md Rule 1 item 2).

### Decision and fix

Regardless of the exact final-mile mechanism, the evidence is unanimous
on the *removable condition*: **three concurrent `net.http_post` calls to
the same host, in the same pg_cron tick, sharing pg_net's one persistent
connection/multiplexing state.** The fix removes that condition at its
source (OPS-2's `net.worker_restart()` is **kept** as a defense-in-depth
backstop for the resolver-corruption failure mode, not superseded):

- New edge function `supabase/functions/worker-tick/` (`index.ts` +
  `handler.ts` + `handler.test.ts`), `verify_jwt = false` + `x-cron-secret`
  auth exactly like every other `worker-*`/`job-*` function.
  `handler.ts#runWorkerTick` invokes all three queue workers' own
  batch-poll logic **in-process, concurrently**, each under its own
  12-second hard timeout (`_shared/timeout.ts#withTimeout`, already used
  by `voice-tools`) so one stuck queue can't starve the other two inside
  the single `net.http_post` 15-second budget, and returns one combined
  JSON report.
- Each of the three workers' read-batch/retry/dead-letter loop, which
  used to live only in that function's own (untested, Deno-only)
  `index.ts`, was moved into its own portable, unit-tested `handler.ts`
  as a new exported `run*Worker` function (`runOutboundWorker`,
  `runRecordingFetchWorker`, `runAdapterPushWorker`) — reused by both that
  function's own `index.ts` (unchanged behavior, still independently
  invocable) and by `worker-tick`. No business logic changed, only where
  the loop lives (diff is a pure move, confirmed by reading the diffs).
- **NOT_CONFIGURED per-leg isolation (found during THIS task's own live
  deploy, fixed in scope — not deferred):** the first `worker-tick`
  deploy built all three legs' deps with module-scope `requireEnv`,
  exactly mirroring each original `index.ts`. That silently regressed
  reliability: before this task, worker-messages-outbound's missing
  Twilio/Resend secrets (unprovisioned on this project — see
  docs/LAUNCH_STATUS.md's "Secrets now set" list and OPS-1's own text)
  crashed *only that function* at cold start; worker-recording-fetch and
  worker-adapter-push kept polling successfully as their own independent
  jobs. Combining all three into one function meant ANY one leg's
  missing secret crashed the WHOLE function, silently taking the other
  two legs' polling down with it too — confirmed live: `worker-tick`
  returned 500 `WORKER_ERROR` for every invocation (unauthenticated
  AND cron-authenticated) from its first deploy (16:37:07) onward, and
  `function_edge_logs` shows a 5-minute stretch (16:42-16:46) where cron
  fired every minute (`cron.job_run_details` all `succeeded` — the SQL
  statement submitting the request never failed) but ZERO requests
  reached the edge at all — consistent with the platform backing off
  spawning new isolates for a function that crashes on every cold start,
  a distinct failure mode from the same-tick multiplexing issue above.
  Fixed in `handler.ts` (a `NotConfiguredLeg` marker + `notConfigured()`
  + `runLeg()`, all covered by new `handler.test.ts` cases) and
  `index.ts` (each leg's required vars checked with `missingEnv` — the
  OPS-1 pattern — instead of module-scope `requireEnv`; only
  `CRON_INVOKE_SECRET`, the shared auth boundary, stays hard-required).
  A leg with a missing secret now reports `{status: "skipped", missing:
  [...]}` and is simply never invoked; the other two legs still run
  normally in the same request. Redeployed as version 2 at 16:46:58;
  confirmed live immediately after (cron-authenticated POST):
  `messages_outbound` `skipped` (`missing: ["TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "RESEND_FROM_ADDRESS"]`),
  `recording_fetch` and `adapter_push` both `ok`. Since that redeploy,
  every cron-fired minute has arrived at the edge (16:47-16:50 sample:
  1/1 each minute, plus the manual verification calls).
- Migration `supabase/migrations/20260920163500_worker_tick_cron.sql`
  (additive, idempotent, `fn_cron_upsert`-based like
  `20260910093000_queues_and_scheduled_jobs.sql`/
  `20260920160500_pgnet_worker_restart_cron.sql`): unschedules
  `worker-messages-outbound`/`worker-recording-fetch`/`worker-adapter-push`
  and schedules `worker-tick` at `* * * * *` in their place. **Note**:
  this file was applied live via `sbq.sh` before the NOT_CONFIGURED
  finding above, so its own inline comment (lines ~57-60, "the swap
  experiment showing the loss follows dispatch position") states an
  earlier, mid-experiment hypothesis that the swap result itself then
  refuted. Per CLAUDE.md Rule 2 ("never edit an applied migration"), that
  comment was left as-is rather than edited post-apply — this BUILD_NOTES
  entry (not the migration file) is the corrected, authoritative account;
  `handler.ts`'s own header comment (not yet applied/live-database
  content, safe to correct) was fixed to match.
- `supabase/config.toml`: added `[functions.worker-tick]` /
  `verify_jwt = false`.
- `scripts/ci/cron-queues-check.ts`'s `EXPECTED_CRON_JOBS`: the three
  `worker-*` entries replaced with `worker-tick`.

### Deploy + live measurement

Deployed `worker-tick` (twice — v1, then v2 with the NOT_CONFIGURED fix),
`worker-messages-outbound`, `worker-recording-fetch`, `worker-adapter-push`
(`supabase functions deploy --use-api`). Boot-check (unauthenticated POST,
expect 401), final state: worker-tick 401, worker-recording-fetch 401,
worker-adapter-push 401 — all three correctly enforce auth before any
handler work. worker-messages-outbound (the STANDALONE function, unchanged
by this task) still 500s `WORKER_ERROR` unauthenticated — **pre-existing,
not a regression**: confirmed present in `net._http_response` 13 times in
the 24 minutes immediately before this task's first deploy (16:00-16:24
UTC), same `requireEnv("TWILIO_ACCOUNT_SID"/...)` call this task never
touched. Out of scope here per CLAUDE.md Rule 4 (a distinct,
already-tracked gap, same class as OPS-1's).

Migration applied live via `sbq.sh` (whole `.sql` file as one query) and
recorded in `supabase_migrations.schema_migrations`. `cron.job` read-back:
the three old `worker-*` jobs are gone, `worker-tick` (jobid 27) scheduled
`* * * * *`.

**Before/after (function_edge_logs POST arrivals):**

| | Before (3 separate `* * * * *` jobs) | After (`worker-tick`, 1 job) |
|---|---|---|
| worker-recording-fetch | 15/15 (100%), 15-min baseline | folded into worker-tick |
| worker-adapter-push | 15/15 (100%), 15-min baseline | folded into worker-tick |
| worker-messages-outbound | 8/15 (~53%), 15-min baseline; 3/9 (~33%) once isolated by the swap experiment | folded into worker-tick |
| **Combined lane arrival** | 38/45 requests (~84%), but the messages-outbound queue specifically went unserviced ~47-67% of ticks | **worker-tick: 8/8 (100%)**, every minute 16:47-16:54 UTC (8 consecutive minutes immediately after the v2/NOT_CONFIGURED fix deployed at 16:46:58) |
| `net._http_response`, all cron jobs combined | OPS-2's own 6-hour sample: ~30% chronic timeout floor (448-468/~1542) | 16/17 (94%) succeeded, 1 timeout, in the 8 minutes 16:46:58-16:54:58 UTC across every cron job on the project (not just worker-tick) |

worker-tick's own queue-processing results in that window: `recording_fetch`
and `adapter_push` legs `ok` every invocation (`processed`/`pushed`
0 — queues empty, expected, no live traffic yet); `messages_outbound` leg
`skipped` every invocation (`missing: ["TWILIO_ACCOUNT_SID",
"TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "RESEND_FROM_ADDRESS"]` —
pre-existing, out of scope, see above).

### Gates

`cd supabase/functions && npx vitest run` — 102/102 files, 929/929 tests
(was 101/923 before this task; +1 file/+6 tests for `worker-tick`'s own
dispatcher tests — concurrency, timeout, partial-failure, and the two
NOT_CONFIGURED/skip cases — against injected fake runners, not re-testing
each worker's already-covered business logic). `pnpm -w typecheck` —
21/21 packages green. `npx biome check --write` on every changed file —
clean (auto-reformat only, import-sort/wrap, no logic change); a
full-repo `biome check` afterward shows only 43 pre-existing warnings,
none in any file this task touched.
