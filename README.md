# Heyloo

Heyloo is a multi-tenant voice-AI answering/booking SaaS: small businesses
across eight verticals (auto shops, veterinary clinics, law firms, dental
practices, real estate, motels, restaurants, and a generic front-desk
template) forward their business line to a Heyloo number. A Retell-powered
AI agent, compiled from a canonical per-vertical conversation template,
answers, triages, and books — with every call backed by real-time
availability, a real booking record, and a compliant AI/recording
disclosure.

The complete spec is [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md)
(authoritative). See also [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md)
(business decisions), [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) (the
agent build waves this repo is being assembled from), and
[`CLAUDE.md`](CLAUDE.md) (binding rules for anyone — human or agent —
building against this repo).

## Monorepo map

```
apps/                    Frontend apps — empty until T5 (frontend stack
                          decision doc), see apps/README.md
packages/
  canonical-types/        Provider-agnostic types: agent state graph, tool
                           contracts, domain model — the only thing core
                           code is allowed to depend on
  adapters/                Provider isolation boundary — every third-party
                            SDK (Retell, Twilio, Stripe, PayPal, ...) lives
                            in its own packages/adapters/<provider>; see
                            packages/adapters/README.md for the rule and why
  ui/                       Shared components for the dashboard/admin/portal
  templates/                The 8 vertical agent templates (T6)
supabase/
  migrations/               Postgres schema + RLS (T1)
  functions/                Edge functions: voice hot path (T3), billing/
                             lifecycle (T4)
  config.toml               Supabase CLI project config
.github/workflows/ci.yml    typecheck · lint · test · build · migrations
                             check · RLS cross-tenant probe
```

## How to run

Requires Node.js ≥ 22 and pnpm (pinned via `packageManager` — enable
Corepack or install the matching pnpm version yourself).

```bash
pnpm install

pnpm run typecheck   # tsc -b across every package, via Turborepo
pnpm run lint        # biome check . (formatter + linter + import rules)
pnpm run build       # tsc -b build output for every package
pnpm run test        # vitest, per package
pnpm run dev         # turbo run dev (once an app exists — see apps/README.md)
```

`pnpm run lint:fix` and `pnpm run format` apply Biome's automatic fixes.

## Configuration

Copy [`.env.example`](.env.example) to `.env` and fill in real values —
every variable is commented with what it's for and which task wires it up.
Never commit a file with real secrets in it.

## Docs

Everything else — architecture, data model, security/compliance,
reliability, the vertical conversation designs, the admin panel, and the
full build order — lives in [`docs/`](docs/). Start with
[`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md).
