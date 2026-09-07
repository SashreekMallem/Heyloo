# Heyloo — Build Agent Instructions

You are building a NEW multi-tenant voice-AI answering/booking SaaS from
scratch. The complete spec is `docs/SYSTEM_DESIGN.md` (authoritative), with
`docs/MASTER_PLAN.md` (business decisions), `docs/VERTICAL_RESEARCH.md`
(market data), `docs/BUILD_PLAN.md` (your task waves), and
`docs/AUDIT_2026-09.md` (why the old code was discarded). Old code lives in
`legacy/` — REFERENCE ONLY (API quirks, salvage list in SYSTEM_DESIGN §14).
Never import from, extend, or copy-paste legacy code.

## Rule 1 — Documentation-first, always (non-negotiable)

Before writing code against ANY external API (Retell, Supabase, Stripe,
Twilio, PayPal, Apollo, Smartlead/Instantly, Outscraper, Shopmonkey, ezyVet,
Square, Cloudbeds, Clio, Follow Up Boss, Airtable):

1. Fetch the official documentation for the exact endpoint/feature via
   WebFetch/WebSearch and verify field names, auth, limits, and error shapes
   against the CURRENT docs — never from memory or from this repo's research
   summaries alone (some were compiled from search snippets).
2. If the official docs are unreachable from this environment, write the
   integration against the researched shape, add a runtime Zod validator on
   the boundary, and mark the call site in `docs/VERIFY.md` (create/append:
   endpoint, assumed shape, doc URL to confirm) — never silently guess.
3. Supabase features (Auth hooks, RLS, Edge Functions, pgmq, pg_cron,
   Realtime broadcast, Storage, new API keys): follow supabase.com/docs
   current guidance; the repo targets the NEW publishable/secret key system,
   never legacy anon/service_role names.

## Rule 2 — Architecture invariants (violating these fails review)

- Provider isolation: nothing outside `packages/adapters/*` may import a
  provider SDK or reference provider-specific payload shapes. Core code
  sees only canonical types from `packages/canonical-types`.
- RLS on every table; tenant_id from JWT `app_metadata` only (Custom Access
  Token Hook); every secret-key edge function still explicitly filters by a
  verified tenant_id. The CI cross-tenant probe must stay green.
- Webhooks: verify signature against the RAW body first → idempotent insert
  into `webhook_events` (unique source+event id) → fast-ack → async work.
  Fail CLOSED (missing secret = reject, never skip).
- Money in integer cents / numeric. Phones normalized to E.164 at every
  boundary. Timestamps timestamptz.
- Bookings: GIST exclusion constraint + idempotency key. Never
  check-then-insert.
- Hot path (`/voice/tools`): p95 < 500ms budget — no ORM, module-scope
  client, lean handlers, aggressive timeouts with graceful fallback.
- Every agent greeting includes the compiled-in AI + recording disclosure.
  Tool authorization: `lookup_customer` scoped to caller's number;
  `transfer_call` destinations tenant-config only.
- Migrations: timestamped (YYYYMMDDHHMMSS_name.sql), additive, reproducible
  from zero. Never edit an applied migration.

## Rule 3 — Repo hygiene (the old repo died of these)

TypeScript strict; no committed build output, binaries, or `.env*` (real
values); no compiled-JS siblings; no dead files. Lint + typecheck + tests
must pass before commit. Small, described commits. Secrets only via env —
`.env.example` documents every variable with a comment.

## Rule 4 — Scope discipline

Build exactly your assigned BUILD_PLAN task. If you discover a gap or a
conflict with SYSTEM_DESIGN, append it to `docs/BUILD_NOTES.md` with your
task id and proceed with the documented decision — do not redesign.
