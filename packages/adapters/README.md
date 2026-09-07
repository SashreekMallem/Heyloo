# packages/adapters — provider isolation boundary

This directory is the **only** place in the monorepo allowed to import a
third-party provider SDK or reference a provider-specific payload shape
(CLAUDE.md, Rule 2 — "Architecture invariants"; SYSTEM_DESIGN §3 "Stack
decisions").

## The rule

- Core code (edge functions, `packages/canonical-types`, `packages/ui`,
  `packages/templates`, the dashboard/admin apps) sees only the canonical
  types exported from `@heyloo/canonical-types` — never a provider's raw
  request/response type, webhook payload, or client object.
- Every external integration gets its own package here,
  `packages/adapters/<provider>`, that:
  1. Imports the provider SDK (or calls its REST API directly) — this is the
     only place that dependency may appear in `package.json`.
  2. Implements one of the canonical interfaces from
     `@heyloo/canonical-types` (e.g. `VoiceProvider` for voice, a
     `CalendarProvider` shape for scheduling adapters in T7).
  3. Normalizes the provider's payloads (webhooks, cost line items, error
     shapes) into canonical types at the boundary — translation happens
     once, here, not scattered across call sites.
  4. Ships contract tests against fixture payloads captured from the real
     API (never invented shapes — see CLAUDE.md Rule 1).
- Nothing outside this directory may `import` a provider SDK package. This
  is enforced in CI by the lint rule in the root Biome config
  (`noRestrictedImports`, see `biome.json`) — it names each SDK package as
  it is adopted.

## Why

Provider flow builders, webhook shapes, and cost line items are mutually
untranslatable and change on the vendor's schedule, not ours. Isolating
them here means a provider swap (Retell → another voice engine, a new
calendar system in T7) is a new adapter package plus a compiler/mapper
change, never a rewrite of core business logic.

## Planned adapters (populated by later waves — do not scaffold ahead of the owning task)

| Package | Provider(s) | Wave / Task |
|---|---|---|
| `packages/adapters/retell` | Retell (voice) | T2 |
| `packages/adapters/twilio` | Twilio (telephony numbers, A2P 10DLC) | T2/T3/T4 |
| `packages/adapters/stripe` | Stripe (Checkout, Billing Meters) | T4 |
| `packages/adapters/paypal` | PayPal Payouts (referrals) | T4 |
| `packages/adapters/shopmonkey` | Shopmonkey (auto shop PMS) | T7 |
| `packages/adapters/ezyvet` | ezyVet (vet PMS) | T7 |
| `packages/adapters/calendar` | Google Calendar / Outlook | T7 |
| `packages/adapters/square` | Square (restaurant POS) | T7 |
| `packages/adapters/apollo` | Apollo (lead fetch) | T8 |
| `packages/adapters/smartlead` | Smartlead/Instantly (outreach campaigns) | T8 |
| `packages/adapters/outscraper` | Outscraper/Apify (lead fetch) | T8 |
| `packages/adapters/sentry` | Sentry (error/perf monitoring) | T10 |

Each row above is a `no-restricted-imports` entry waiting to be added to
`biome.json` as its adapter package is created — see the `TODO` comment
there.
