# supabase/functions/

Empty by design. Edge functions land across T3 (voice hot path:
`voice-inbound`, `voice-tools`, `voice-events`, nightly reconciliation,
Retell health-check failover) and T4 (billing/lifecycle: Stripe webhooks,
provisioning saga, usage rollups, dunning, referral payouts, A2P
registration) — SYSTEM_DESIGN §5, §8, §9.

Rules for every function added from T3/T4 onward (CLAUDE.md Rule 2):

- Webhooks: verify signature against the RAW request body first, then
  idempotent insert into `webhook_events` (unique `source` + `event_id`),
  then fast-ack, then async work. Fail CLOSED — a missing signing secret is
  a rejection, never a skipped check.
- `/voice/tools` is the hot path: p95 < 500ms budget — no ORM, a
  module-scope Supabase client, lean handlers, aggressive timeouts with a
  graceful fallback (SYSTEM_DESIGN §5).
- No provider SDK imports here — call through `packages/adapters/*` (see
  that package's README for the isolation rule).
