# Build Plan — End-to-End Execution Waves

Every task is an agent assignment. All agents obey `/CLAUDE.md` (docs-first
rule) and build to `docs/SYSTEM_DESIGN.md`. Tasks in the same wave touch
disjoint paths and run in parallel. A wave starts when its dependencies are
merged. Deliverable of the whole plan: a complete, tested, deployable
codebase on this branch + `docs/DEPLOY.md` so the owner can go live by
creating accounts and setting env vars (accounts/secrets are the only
things agents cannot do from this environment).

## Wave 0 — Foundation (sequential, one agent)
**T0 scaffold**: pnpm workspace + Turborepo monorepo skeleton
(`apps/`, `packages/canonical-types`, `packages/adapters`, `packages/ui`,
`supabase/`), root tsconfig (strict), lint/format config, Vitest, GitHub
Actions CI (typecheck · lint · test · build · migration check · RLS
cross-tenant probe placeholder), `.env.example`, new root README.
Frontend framework wiring lands in T5 once the stack decision doc merges.

## Wave 1 — Core backend (parallel, disjoint paths)
- **T1 schema** (`supabase/migrations/`): full data model from SYSTEM_DESIGN
  §6 + §5 DDL (tenants, memberships, phone_numbers, agent templates/configs,
  offerings/resources/availability_slots/bookings with exclusion constraint,
  customers, call_logs full spec, messages_outbound, webhook_events, all
  money tables, referral tables, outreach tables, admin_actions,
  platform_settings), RLS policies on everything, Custom Access Token Hook,
  seed/demo data per vertical, and the RLS cross-tenant probe test.
- **T2 canonical types + provider layer** (`packages/canonical-types`,
  `packages/adapters/retell`): VoiceProvider interface (per portability
  research), canonical agent template schema (prompt + tools + state graph),
  template compiler → Retell conversation-flow/multi-prompt/single-prompt,
  Retell adapter (create/update/publish agent, number import, webhook
  verify/parse, cost normalization), with compiled-in disclosure line and
  contract tests on fixture payloads.
- **T3 voice edge functions** (`supabase/functions/voice-*`): /voice/inbound
  resolver, /voice/tools hot path (availability/booking/customer/message,
  latency budget, circuit breaker, tool-level authorization), /voice/events
  (verify → dedup → fast-ack → recording archival <10min → cost ingestion →
  notification fan-out), nightly get-call reconciliation, Retell
  health-check failover job.

## Wave 2 — Product surfaces (parallel; needs W1 merged)
- **T4 billing + lifecycle functions**: Stripe Checkout/Meters integration,
  provisioning saga (tenant → agent compile → Twilio number → Retell import
  → billing), usage ledger + rollups + invoices, customer usage alerts,
  owner-test-call carve-out, dunning/pause, referral qualification +
  PayPal payout batch, A2P registration state machine.
- **T5 frontend apps** (`apps/web`, `apps/marketing` per the stack-decision
  doc): tenant dashboard (live feed via tenant-scoped broadcast, bookings,
  customers, agent settings incl. manual mode + persona name + AI special
  instructions, phone-setup wizard with verification status, delivery prefs,
  billing, refer-and-earn), admin cockpit (9 pages + alerts), partner
  portal, marketing site with per-vertical landing pages + demo-agent
  widget + signup flow (vertical price card at step 2), docs site.
- **T6 vertical templates** (`packages/templates`): the 8 vertical agent
  templates in canonical format (conversation specs from SYSTEM_DESIGN §4),
  red-team adversarial test suite, batch-simulation CI harness.

## Wave 3 — Growth + adapters (parallel; needs W2)
- **T7 adapters**: Shopmonkey, ezyVet, generic Google/Outlook Calendar,
  Square (restaurant port with legacy quirk knowledge), each with two-way
  sync + revocation handling + contract tests.
- **T8 outreach admin**: lead fetch (Apollo/Outscraper), Claude
  personalization pipeline, Smartlead/Instantly campaign API, reply webhook
  + intent classification, funnel/CAC views, suppression list.
- **T9 demo-agent generator**: URL scrape (sanitized) → seeded template →
  web-call widget + demo number flow.

## Wave 4 — Hardening (parallel; needs W3)
- **T10 ops**: Sentry wiring, status-page automation, admin impersonation +
  audit, feature flags, deploy draining, backup-restore runbook,
  `docs/DEPLOY.md` (every account to create, every env var, go-live
  checklist incl. Retell support questions + BAA + A2P + counsel items).
- **T11 E2E test pass**: Playwright flows (signup→provision→forwarding→
  booking→dashboard→billing), load test scripts for the hot path, full CI
  green.

## Standing rules
- Each task ends with: tests passing locally, committed and pushed to this
  branch, and a completion note in `docs/BUILD_NOTES.md`.
- Old system security triage (audit §7) is owner+agent work against the
  LIVE deployment and runs independent of these waves.
