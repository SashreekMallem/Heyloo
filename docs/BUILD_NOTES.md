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
