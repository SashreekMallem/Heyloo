# Deploy Guide — Go-Live Runbook

This is the one document an owner (or a new engineer) needs to take this
codebase from "cloned repo" to "answering real phone calls, billing real
customers." Every account to create, every env var and where its value
comes from, the exact deploy sequence, which `docs/VERIFY.md` items need a
live test before the first real call, a counsel checklist, and a final
go-live smoke test. Read `docs/OPS_RUNBOOK.md` next — it covers what to do
*after* launch (monitoring, backups, incident response).

No build agent in this project can create accounts, click through vendor
dashboards, or sign legal agreements — everything in §1 is owner/human work.
Everything in §3-§4 is copy-paste-able commands once §1's accounts exist.

## Table of contents

1. [Accounts to create](#1-accounts-to-create) (in lead-time order)
2. [Environment variables — every var, where its value comes from](#2-environment-variables)
3. [Deploy sequence](#3-deploy-sequence)
4. [VERIFY.md resolution — what needs a live Retell sandbox test](#4-verifymd-resolution)
5. [Counsel checklist](#5-counsel-checklist)
6. [Go-live smoke checklist](#6-go-live-smoke-checklist)
7. [E2E test suite — what runs where](#7-e2e-test-suite)

---

## 1. Accounts to create

Ordered so the ones with real lead time (A2P brand registration, domain
warm-up, counsel review, BAA signing) get started first — some take days to
weeks and should not be the last thing blocking launch.

### 1.1 Twilio — start this first (A2P lead time)

1. Create a Twilio account, verify identity/business info.
2. **A2P 10DLC reseller brand registration** (SYSTEM_DESIGN §7 G4): Twilio
   Console → Messaging → Regulatory Compliance → Brand Registration. This
   product registers as a **reseller brand** — every tenant's own SMS
   traffic rides under this platform brand plus a per-tenant Campaign
   (`api-a2p-register` edge function, already built, does the per-tenant
   Campaign half programmatically against `TWILIO_A2P_BRAND_SID`). Brand
   review is **1–5 business days**; start this the same day you create the
   Twilio account, not after everything else is ready.
3. Create/confirm a **Messaging Service** is not needed at the platform
   level — `api-a2p-register` creates one **per tenant** lazily on first
   registration.
4. Two Trust Hub prerequisites `_shared/providers/twilio.ts`'s
   `createBrandRegistration` assumes but does not itself create (a manual,
   one-time Console step): a **Customer Profile bundle** and an **A2P
   Profile bundle** for the platform's own business identity. Complete
   these under Trust Hub before attempting the Brand Registration call.
5. Set `A2P_PRIVACY_POLICY_URL`/`A2P_TERMS_URL` (`.env.example`) to real,
   **live, publicly reachable** pages before registering any Campaign —
   Twilio's 2026-06-30 campaign-registration change made these required
   fields (`docs/VERIFY.md`'s T4 entry), and a placeholder/localhost URL
   will fail registration.
6. **Updated SIGNUP-1 (2026-09-21):** the real per-tenant provisioning
   saga (`api-provision`) no longer purchases a Twilio number at all — it
   buys the number directly through Retell's own `POST
   /create-phone-number` (confirmed live against docs.retellai.com,
   `docs/VERIFY.md`'s SIGNUP-1 entry), since this platform's own Twilio
   account was never going to be wired for that path. Twilio is still
   needed for everything ELSE in this section (A2P/SMS sending, the
   Messaging Service, and `job-offboarding`'s Twilio-side number release
   — none of those were touched, and none work yet for a Retell-purchased
   number specifically, a known follow-up gap). Item 6's own original
   text is struck through below for the history, not deleted:
   ~~Buy phone numbers as tenants provision (the provisioning saga,
   `api-provision`, purchases one Twilio number per tenant — no
   pre-purchasing needed) or pre-buy a small pool if you want zero-latency
   number assignment at signup.~~
7. Note the account SID/auth token and, if you'd rather scope credentials
   more tightly, create a **restricted API key** (`TWILIO_API_KEY_SID`/
   `TWILIO_API_KEY_SECRET` — preferred over the raw auth token per
   `.env.example`'s own comment) — but keep `TWILIO_AUTH_TOKEN` set too,
   since `X-Twilio-Signature` webhook verification signs with the primary
   Auth Token specifically, not a scoped API key (`_shared/twilio-
   signature.ts`).

### 1.2 Retell — the voice provider

1. Create a Retell account (retellai.com). Note the API key
   (`RETELL_API_KEY`).
2. **File a Week-0 support ticket** with the questions in §4 below before
   building anything further on top of Retell — several of this codebase's
   assumptions (VERIFY-1 through VERIFY-8) are reconstructed from
   third-party summaries because `docs.retellai.com` was egress-blocked in
   every build agent's environment; a human with real dashboard/support
   access can close these out in one ticket. Lead time: variable, but this
   ticket blocks the highest-risk remaining unknown in the whole codebase
   (VERIFY-8, the Conversation Flow wire schema) — file it immediately, not
   after everything else is ready.
3. **Sign the HIPAA BAA.** Retell offers a free self-serve BAA (per
   `docs/MASTER_PLAN.md`'s own research — re-confirm the current signing
   flow location in the dashboard, since dashboards change). This is
   required before onboarding the **dental** vertical (PHI in call audio/
   transcripts) — **veterinary is explicitly NOT HIPAA** (animal records
   aren't PHI, SYSTEM_DESIGN §4.3) so it does not need to gate on this.
   Confirm with the BAA whether it's workspace-wide (covers every tenant
   automatically) or needs a per-tenant acknowledgment — ask this in the
   same support ticket as §4 if the dashboard doesn't make it obvious.
4. Create a **separate staging/sandbox Retell account or workspace**
   (SYSTEM_DESIGN §8 G16 — "never test against prod agents"). Every
   `docs/VERIFY.md` confirmation in §4 below happens against this staging
   workspace first.
5. Set `RETELL_WEBHOOK_SIGNING_SECRET` — per VERIFY-1, this build's
   assumption is that the **webhook-badged API key itself** is the signing
   secret; confirm this against the support ticket's answer before
   go-live, since a wrong assumption here means every inbound Retell
   webhook fails signature verification (fails closed, so calls would
   simply stop routing — a loud failure, not a silent one, but still worth
   getting right in staging first).

### 1.3 Supabase

1. Create a Supabase project. **Region: pick the region closest to your
   primary tenant geography** (US tenants → a US region) — this directly
   affects the hot-path latency budget (SYSTEM_DESIGN §5, p95 < 500ms) once
   Vercel's own region is pinned to match (§3.4 below).
2. Project Settings → API: copy the **new key system** — `sb_publishable_...`
   and `sb_secret_...` (never the legacy `anon`/`service_role` names;
   Supabase is deprecating those by end of 2026, and this codebase was
   built exclusively against the new names — CLAUDE.md Rule 1.3).
3. Project Settings → Database: confirm **Point-In-Time-Recovery** is
   enabled (a paid-plan feature) — required for the quarterly restore
   drill in `docs/OPS_RUNBOOK.md` §5.
4. Generate a personal/CI **access token** (Account → Access Tokens) for
   `SUPABASE_ACCESS_TOKEN` (used by the Supabase CLI in CI and locally for
   `db push`/`functions deploy`) and note the **project ref** for
   `SUPABASE_PROJECT_ID`.
5. Auth → Providers: email/password is all this codebase's login flow
   needs (`apps/web/src/app/[locale]/login/page.tsx`) — no OAuth provider
   setup required.
6. Auth → MFA: confirm **TOTP** is enabled (it is by default) — the admin
   AAL2 step-up gate (`require-admin-session.ts`) depends on it.

### 1.4 Vercel

1. Create a Vercel project, connect this repo, set the **root directory**
   to `apps/web`.
2. **Region pinning**: Project Settings → Functions → Region — pin to a
   single region matching Supabase's region from §1.3 (co-locating the
   Next.js server functions with the database/edge functions is what makes
   the latency budget achievable; Vercel's default multi-region behavior
   works against this).
3. **Supabase integration**: install the official Vercel↔Supabase
   integration (Vercel Marketplace) OR set the env vars manually per §2
   below — either path ends at the same env vars, the integration just
   automates keeping them in sync across Preview/Production.
4. Build command: leave Vercel's default (`apps/web/package.json`'s own
   `build` script, `next build --webpack` — **not** the Turbopack default;
   see `docs/BUILD_NOTES.md`'s T5 entry for why `--webpack` is required
   here).
5. Set every `NEXT_PUBLIC_*`/server env var from §2 in Vercel's Environment
   Variables UI, scoped to Production (and Preview, with staging-safe
   values, if you want preview deploys to work against a real backend).

### 1.5 Stripe

1. Create a Stripe account, complete business verification (needed before
   real charges process).
2. Copy `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` (test mode first).
3. Set `STRIPE_METER_EVENT_NAME` (any stable string, e.g.
   `heyloo_call_minutes`) — this is the identifier
   `scripts/setup-stripe.ts` creates the Billing Meter under.
4. **Run `scripts/setup-stripe.ts`** (§3.5 below) — creates the platform
   Billing Meter plus, per vertical, a Product + licensed Price + metered
   Price, writing the resulting Stripe ids back onto each
   `platform_settings.price_card_<vertical>` row. Do this AFTER `supabase
   db push` (the table must exist) and BEFORE the first real
   `/api-checkout` call (it 500s with `stripe_not_configured` otherwise).
5. Register the webhook endpoint: Developers → Webhooks → Add endpoint,
   URL `https://<project-ref>.supabase.co/functions/v1/webhooks-stripe`,
   events: at minimum `checkout.session.completed`,
   `customer.subscription.updated`, `invoice.paid`,
   `invoice.payment_failed`. Copy the signing secret into
   `STRIPE_WEBHOOK_SIGNING_SECRET`.
6. Set `CHECKOUT_SUCCESS_URL`/`CHECKOUT_CANCEL_URL` to real
   `https://<your-domain>/signup/...` paths once the domain is live.
7. Confirm the pinned `STRIPE_API_VERSION` your integration targets
   (`docs/VERIFY.md`'s T4 entry flags `2025-08-27.basil` as a placeholder,
   not independently confirmed live) against Stripe's current API version
   in the dashboard before go-live.

### 1.6 PayPal (referral payouts)

1. Create a **PayPal Business** account.
2. Create a REST API app (developer.paypal.com) for
   `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`. Start in `sandbox`
   (`PAYPAL_ENV=sandbox`) and switch to `live` only once `job-referral-
   payouts` has been exercised against sandbox at least once.
3. Set up a webhook (Payouts events —
   `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`/`FAILED`/`BLOCKED`/`UNCLAIMED`) and
   copy the webhook id into `PAYPAL_WEBHOOK_ID` — **note:** no
   `/webhooks-paypal` consumer function exists in this codebase yet (a
   real, flagged gap — see `docs/LAUNCH_STATUS.md`); `job-referral-
   payouts`'s success today means "PayPal accepted the batch," not "every
   partner was paid." Wiring a consumer for these events is a recommended
   near-term follow-up, not done as part of this task (see that document
   for why it was scoped out here).

### 1.7 Resend (transactional email)

1. Create a Resend account, add and verify your sending domain (DNS
   records — SPF/DKIM, follow Resend's dashboard instructions for your
   registrar).
2. Set `RESEND_API_KEY` and `RESEND_FROM_ADDRESS` (must be an address on
   the verified domain).

### 1.8 Apollo (lead fetch — Organization plan)

1. Create an Apollo account on an **Organization plan** (People Search API
   access requires this tier — a free/individual plan will not have API
   access to the endpoints `_shared/providers/apollo.ts` calls).
2. Copy the API key into `APOLLO_API_KEY`.
3. Confirm the account's actual credit pricing before relying on the CAC
   dashboard's Apollo-enrichment cost figures — this codebase deliberately
   does NOT fabricate a dollar conversion for Apollo credits
   (`docs/VERIFY.md`'s T8 entry), so `pipeline_costs`/`cac_events` under-
   count true Apollo spend until this is wired.

### 1.9 Outscraper

1. Create an Outscraper account, copy the API key into
   `OUTSCRAPER_API_KEY`.
2. No special plan tier needed for the Google Maps Search endpoint this
   codebase calls (pay-as-you-go credits).

### 1.10 Smartlead (outreach sender) + sending domains

1. Create a Smartlead account, copy the API key into `SMARTLEAD_API_KEY`.
2. **Buy 2–3 dedicated sending domains** (not your primary business domain
   — cold-outreach sending domains should be disposable/separate to
   protect your primary domain's reputation). Connect them in Smartlead's
   dashboard (SPF/DKIM/DMARC — Smartlead's onboarding walks through the DNS
   records).
3. **Start domain warm-up immediately** — 4–6 weeks, per SYSTEM_DESIGN §11
   ("4–6 wk domain warm-up started day 1"). This has real lead time; start
   it the same day as Twilio's A2P registration (§1.1), both before
   anything else outreach-related.
4. Register a webhook (Smartlead dashboard → Webhooks, or let
   `_shared/providers/smartlead.ts`'s `createWebhook` do it programmatically
   once `admin-outreach`'s campaign-create path runs) pointed at
   `https://<project-ref>.supabase.co/functions/v1/webhooks-outreach`, and
   set `SMARTLEAD_WEBHOOK_SIGNING_SECRET` if Smartlead's dashboard exposes
   one for the webhook you create (confirm the current signing mechanism —
   `docs/VERIFY.md`'s T8 entry does not carry a confirmed signature scheme
   for Smartlead specifically).
5. `INSTANTLY_API_KEY`/`INSTANTLY_WEBHOOK_SIGNING_SECRET`: leave unset.
   MASTER_SPEC binds Smartlead as the chosen sender; the `admin-outreach`
   campaign-create route explicitly rejects `provider: 'instantly'` with
   `422 unsupported_provider` today (no adapter exists) — these vars exist
   in `.env.example` for a future Instantly adapter, not this deploy.

### 1.11 PostHog

1. Create a PostHog project (Cloud, US or EU region — pick to match your
   data-residency posture).
2. Set `NEXT_PUBLIC_POSTHOG_KEY`/`NEXT_PUBLIC_POSTHOG_HOST`.

### 1.12 Sentry

1. Create a Sentry project (Settings → Projects → Create — platform
   "Node" for the DSN the edge functions and `apps/web`'s server side share;
   `@sentry/nextjs` on the frontend uses the same DSN).
2. Copy the DSN into `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`. Set
   `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` for CI sourcemap
   upload if you want readable stack traces from the browser bundle.
3. Read `docs/OPS_RUNBOOK.md` §2 for what the edge-function side of this
   wiring actually does (env-gated, no SDK dependency, built T9) and the
   one manual verification step to run before trusting it.

### 1.13 Anthropic (outreach personalization + reply-intent classification)

1. Create an Anthropic account, copy the API key into `ANTHROPIC_API_KEY`.
2. Confirm current model ids are still valid before go-live —
   `_shared/providers/anthropic.ts` and `ANTHROPIC_DEMO_MODEL`
   (`.env.example`) reference specific model id strings that Anthropic can
   deprecate; check `docs.anthropic.com`'s current model list.

### 1.14 Airtable (partner portal sync)

1. Create an Airtable base for referral-partner data, generate a
   **personal access token** scoped to that base, set `AIRTABLE_API_KEY`
   and `AIRTABLE_BASE_ID`.

### 1.15 Domain + DNS

Register (or confirm ownership of) your production domain. Point it at
Vercel (§1.4) and Resend's sending-domain records (§1.7) — do this early,
since Resend's domain verification and any status-page CNAME (`docs/
OPS_RUNBOOK.md` §4) both have DNS-propagation lead time.

---

## 2. Environment variables

Every variable in `.env.example`, grouped the same way, with where its
value comes from. "Generated" means: produce it yourself (a random secret),
not fetched from a vendor dashboard.

| Variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase project Settings → API |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase project Settings → API (new key system) |
| `SUPABASE_SECRET_KEY` | Supabase project Settings → API (new key system, server-only) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same values as above, duplicated for Next.js's build-time `NEXT_PUBLIC_` inlining |
| `SUPABASE_PROJECT_ID` | Supabase project ref (URL slug / Settings → General) |
| `SUPABASE_ACCESS_TOKEN` | Supabase Account → Access Tokens (CLI/CI) |
| `SUPABASE_DB_URL` | Supabase project Settings → Database → Connection string |
| `RETELL_API_KEY` | Retell dashboard → API Keys |
| `RETELL_WEBHOOK_SIGNING_SECRET` | Retell dashboard (confirm exact source per §4 VERIFY-1 — this build assumes it equals `RETELL_API_KEY`'s webhook-badged key) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio Console → Account |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Twilio Console → Account → API keys (optional, scoped alternative to the auth token for non-webhook calls) |
| `TWILIO_WEBHOOK_SIGNING_SECRET` | Unused today — see `.env.example`'s own note; signature verification uses `TWILIO_AUTH_TOKEN` |
| `TWILIO_A2P_BRAND_SID` / `TWILIO_A2P_CAMPAIGN_SID` | Twilio Console, after §1.1's Brand Registration completes |
| `A2P_PRIVACY_POLICY_URL` / `A2P_TERMS_URL` | Your own live, public legal pages |
| `A2P_INTERNAL_SECRET` | Generated |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Stripe Dashboard → Developers → Webhooks, after registering the endpoint (§1.5) |
| `STRIPE_METER_EVENT_NAME` | Your own choice (any stable string) — `scripts/setup-stripe.ts` creates the Meter under it |
| `CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL` | Your own domain's signup-flow paths |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps |
| `PAYPAL_ENV` | `sandbox` until go-live, then `live` |
| `PAYPAL_WEBHOOK_ID` | PayPal Developer Dashboard → Webhooks |
| `ELEVENLABS_API_KEY` | Only if managing voices directly outside Retell's passthrough — optional |
| `APOLLO_API_KEY` | Apollo dashboard (Organization plan, §1.8) |
| `OUTSCRAPER_API_KEY` | Outscraper dashboard |
| `SMARTLEAD_API_KEY` | Smartlead dashboard |
| `SMARTLEAD_WEBHOOK_SIGNING_SECRET` | Smartlead dashboard, if exposed for the webhook (confirm current mechanism) |
| `INSTANTLY_API_KEY` / `INSTANTLY_WEBHOOK_SIGNING_SECRET` | Leave unset (§1.10) |
| `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` | Airtable → personal access token + base id |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry project Settings → Client Keys (DSN) |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` | Sentry account settings, for CI sourcemap upload |
| `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` | Your own choice — tags on edge-function Sentry events (T9, `docs/OPS_RUNBOOK.md` §2) |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | PostHog project settings |
| `SIGNUP_DRAFT_SECRET` | Generated (32+ random bytes) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `NODE_ENV` | `production` in every real deploy |
| `APP_BASE_URL` | Your production domain, e.g. `https://heyloo.app` |
| `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` | Resend dashboard, after domain verification (§1.7) |
| `GEOCODE_API_KEY` | Whichever provider you pick (Geocodio or Google — still an open `VERIFY:`, `docs/VERIFY.md`) |
| `CRON_INVOKE_SECRET` | Generated — shared secret every `worker-*`/`job-*` function checks on its `x-cron-secret` header |
| `PROVISION_INTERNAL_SECRET` | Generated |
| `ADMIN_AAL2_FRESHNESS_MINUTES` | `15` (the built-in default; only override if you have a reason to) |
| `VOICE_TOOLS_WEBHOOK_URL` | `https://<project-ref>.supabase.co/functions/v1/voice-tools` |
| `WEBHOOKS_TWILIO_SMS_URL` | `https://<project-ref>.supabase.co/functions/v1/webhooks-twilio-sms` |
| `WEBHOOKS_POS_SQUARE_URL` | `https://<project-ref>.supabase.co/functions/v1/webhooks-pos/square` |
| `OUTREACH_WEBHOOK_SECRET` | Generated (shared-secret header, until a real per-vendor HMAC scheme is confirmed) |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Square Developer Dashboard, once the Square adapter is live (`packages/adapters/square`) |
| `ANTHROPIC_DEMO_MODEL` | Leave as the pinned default unless Anthropic deprecates it |
| `DEMO_AGENT_ID` | The Retell agent id created for the public demo-call flow (create once in Retell, or let `api-provision`'s pattern guide a one-off manual create) |
| `DEMO_PHONE_E164` | A real Twilio number reserved for the shared demo-call phone flow |
| `PAYMENT_LINK_SUCCESS_URL` / `PAYMENT_LINK_CANCEL_URL` | Your own domain's payment-outcome pages |
| `RETELL_FAILOVER_VOICE_URL` | A TwiML Bin or your own small endpoint implementing "forward to owner cell, then voicemail" — build this before go-live, since `job-retell-health-failover` points a tenant's Twilio number here during a real Retell outage |
| `ANTHROPIC_TEXT_AGENT_MODEL` | Leave as the pinned default (Channels, `BACKEND_SPEC.md` §13) — SMS/web-chat text-agent replies, same Anthropic provider voice-tools/outreach already use |
| `WIDGET_TOKEN_SECRET` | Generated (32+ random bytes) — signs the embeddable widget's short-lived session token (Channels, `BACKEND_SPEC.md` §13.2). Needed by **both** `api-text-chat` (widget chat mode) and `api-widget-voice-token` (widget voice mode, `[functions.api-widget-voice-token]` in `supabase/config.toml`) — set it once, both functions read the same secret. `api-widget-voice-token` also needs `RETELL_API_KEY` (already listed above for the other Retell-touching functions) to mint the tenant's own web-call token, same as `api-tenant-test-call`/`api-demo-agent` (`docs/audit/CHANNELS_REQUESTS.md` item 6). |

Set every server-only var as an edge-function **secret**
(`supabase secrets set KEY=value`, or the dashboard's Edge Functions →
Secrets UI) — never in `supabase/config.toml` or committed anywhere.
`apps/web`'s vars go into Vercel's Environment Variables UI (§1.4).

---

## 3. Deploy sequence

Run once per environment (staging first, then production) after §1-§2 are
in place.

### 3.1 Link the Supabase project

```bash
supabase login                      # or set SUPABASE_ACCESS_TOKEN in CI
supabase link --project-ref <project-ref>
```

### 3.2 Push the schema

```bash
supabase db push
```

Applies every migration under `supabase/migrations/` in filename order.
This is additive-only per CLAUDE.md Rule 2 — there is nothing to "roll
back," only forward migrations. Seed data (`supabase/seed/seed.sql`, demo
tenants) does **not** run against a linked remote project via `db push` —
it only runs on `supabase start`/`db reset` locally per `supabase/
config.toml`'s `[db.seed]` block. Decide deliberately whether you want the
demo tenants in production (probably not) — if you do, apply
`supabase/seed/seed.sql` by hand via `psql "$SUPABASE_DB_URL" -f
supabase/seed/seed.sql` once.

Run §3.6's two `vault.create_secret` calls **before** this step (or accept
that the cron/queue migration will skip its HTTP-calling jobs until you
insert them and push again — see §3.6) — otherwise the ordering here
doesn't matter.

The four admin-cockpit views (`v_tenant_margin`, `v_call_cost_vs_billed`,
`v_usage_alerts`, `v_referral_pnl`) are `security_invoker` and revoked from
`anon`/`authenticated` as of `20260910090000_view_security_and_write_rls_
hardening.sql` (DB_AUDIT.md DB-B1 — they previously leaked every tenant's
revenue/cost/margin/referral-commission data to any publishable-key holder).
Nothing to configure here: the admin cockpit and `job-alert-evaluation`
both read these views over a raw `SUPABASE_DB_URL` Postgres connection
(`supabase/functions/_shared/deno/db.ts`), a role that bypasses RLS
regardless of this change — see that migration's header comment if you add
a new PostgREST-facing read path for these views later.

### 3.3 Set every edge-function secret

```bash
supabase secrets set \
  RETELL_API_KEY=... \
  RETELL_WEBHOOK_SIGNING_SECRET=... \
  TWILIO_ACCOUNT_SID=... \
  # ... every server-only var from §2's table
```

(Or set them one at a time / via the dashboard — order doesn't matter, but
every function's `requireEnv()` call throws at cold-start on a missing one,
so deploy secrets before deploying functions.)

### 3.4 Deploy every edge function

**If `packages/templates` changed since the last deploy (any vertical's
system prompt, states, transitions, global_intents, or tools), sync
`agent_templates` first, before this step** — CALL-3 (docs/BUILD_NOTES.md):

```bash
pnpm --filter @heyloo/templates build   # regenerate dist/templates.build.json
SUPABASE_PROJECT_REF=<project-ref> \
SUPABASE_ACCESS_TOKEN=<management-api-token> \
node --experimental-strip-types scripts/sync-agent-templates.ts
```

`SUPABASE_ACCESS_TOKEN` here is a Management API personal access token
(Supabase Dashboard → Account → Access Tokens), never a project anon/
secret key. The script upserts one `agent_templates` row per vertical,
idempotent on `(vertical, version)` — safe to re-run, and never overwrites
`voice_id`/`model`/`is_active` on a re-sync (those stay admin-editable via
`admin`'s template-edit route once set). Prints a per-vertical
ok/FAILED summary and exits non-zero if any vertical failed — do not
proceed to deploying functions on a non-zero exit, since a stale/missing
`agent_templates` row blocks every agent compile for that vertical
(CALL-1 gap #1). Confirm afterward with
`select vertical, version, count(*) from agent_templates group by 1,2;`.
`_shared/agent-template-seeds.ts`'s lazy per-vertical seed
(`api-admin-provision-test-tenant/handler.ts#ensureTemplateSeeded`) stays
in place as a fallback for an environment this script was never run
against — it already defers to a healthy existing DB row and only seeds
from its own bundled copy when none exists.

Run this before functions deploy so a template change and its compiled
agents land together — an already-deployed `admin`/`api-provision`
function reads `agent_templates` at request time (not something baked into
the function bundle at deploy), so the order relative to `supabase
functions deploy` itself doesn't strictly matter for correctness, but
doing it first means nothing serves a stale template even for the brief
window between the two commands.

`supabase/config.toml`'s `[functions.*]` blocks already declare the correct
`verify_jwt` per function (CLAUDE.md: "triple-check — the old repo died on
this inverted"). Deploy them all in one pass:

```bash
supabase functions deploy
```

This reads `verify_jwt` per function from `config.toml` automatically. If
you ever need to deploy one function at a time (e.g. a hot-path fix),
`supabase functions deploy voice-tools` respects the same config. The
current split (do not invert):

| `verify_jwt = false` (function does its own auth) | `verify_jwt = true` (Supabase verifies the bearer JWT; function then checks decoded claims itself) |
|---|---|
| `voice-inbound`, `voice-tools`, `voice-events` (Retell HMAC) | `admin` (platform_admin + AAL2) |
| `webhooks-stripe`, `webhooks-twilio-sms`, `webhooks-outreach`, `webhooks-pos` (each vendor's own HMAC) | `api-provision` (tenant_id + role) |
| `api-demo-agent` (public marketing flow) | `api-checkout` (authenticated user's own JWT `sub`) |
| `worker-messages-outbound`, `worker-recording-fetch`, `worker-adapter-push` (cron secret) | `api-a2p-register` (tenant-owner JWT or internal secret) |
| `job-reconciliation`, `job-billing-cycle`, `job-reminder-scheduler`, `job-review-request`, `job-retell-health-failover`, `job-alert-evaluation`, `job-referral-payouts` (cron secret) | `forwarding-verify` (tenant_id + role) |

### 3.5 Run `scripts/setup-stripe.ts`

```bash
STRIPE_SECRET_KEY=... \
STRIPE_METER_EVENT_NAME=heyloo_call_minutes \
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SECRET_KEY=... \
node --experimental-strip-types scripts/setup-stripe.ts
```

Idempotent — safe to re-run. Confirms each vertical's `platform_settings`
price-card row now carries real `stripe_*_id` fields (spot-check via the
Supabase Table Editor or a quick `select` if you want to be sure before the
first real checkout).

### 3.6 Insert the two Vault secrets the cron/queue migration reads

**This used to be a manual, copy-pasteable `cron.schedule`/`pgmq.create`
script run by hand against the SQL Editor — it is not anymore.**
`supabase/migrations/20260910093000_queues_and_scheduled_jobs.sql` now
registers every queue, dead-letter queue, and `cron.schedule` entry
(BACKEND_SPEC §8/§9 cadences) itself, idempotently, as part of `supabase db
push` (§3.2) — see that migration's own header comment for exactly which
jobs it registers and why (DB_AUDIT.md DB-B2/DB-B3). It reads the Postgres
job base URL and the shared cron-invoke secret from **Supabase Vault**
rather than having them hardcoded into a script, so **run this once, before
`supabase db push`**, via the Supabase SQL Editor or `psql
"$SUPABASE_DB_URL"` (replace `<project-ref>` and `<CRON_INVOKE_SECRET>`
with your real values — the exact same secret you also set as the
`CRON_INVOKE_SECRET` edge-function secret in §3.3):

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1',
  'cron_functions_base_url'
);
select vault.create_secret(
  '<CRON_INVOKE_SECRET>',
  'cron_invoke_secret'
);
```

Then run `supabase db push` (§3.2) as normal — the migration creates the
four queues + four dead-letter queues (`pgmq.create`, skipped per-queue if
it already exists) and registers every `cron.schedule` entry (upserted by
job name, so safe to re-run/re-push). If you run `db push` **before**
inserting these two secrets (e.g. on a fresh project where you haven't
reached this step yet), the migration does not fail — it creates the
queues and the four DB-internal jobs (availability roll-forward, usage
rollup, internal retention sweep, referral qualification — these need only
`pg_cron`, not Vault/`pg_net`) and skips every HTTP-calling job with a
`NOTICE`, logged to the migration output. Insert the two secrets above and
re-run `supabase db push` (or re-apply just that migration file, and each of
`20260910100500_new_job_cron_schedules.sql` /
`20260910100600_job_keep_warm_cron_schedule.sql`) afterward to pick up the
rest — nothing needs to be dropped or undone first.

Confirm the result:

```sql
select jobname, schedule, active from cron.job order by jobname;
select queue_name from pgmq.list_queues() order by queue_name;
```

You should see 8 queues (4 primary + 4 `_dlq`) and 21 cron jobs: 4
DB-internal (`job-internal-availability-rollforward`,
`job-internal-usage-rollup`, `job-internal-retention-sweep`,
`job-internal-referral-qualification` — DB_AUDIT.md DB-M1's
webhook_events/tool_health retention fix rides along here too, distinct
from the Storage-recording retention sweep below) plus 17 HTTP-calling jobs:
3 `worker-*`, the original 7 `job-*` rows from BACKEND_SPEC §8's table
(`job-retell-health-failover`, `job-alert-evaluation`,
`job-reminder-scheduler`, `job-review-request`, `job-billing-cycle`,
`job-reconciliation`, `job-referral-payouts`), the 2-stage
outreach-personalize pipeline, cluster F's four jobs (`job-churn-scoring`,
`job-value-email`, `job-offboarding`, `job-retention-sweep` — the
Storage-recording sweep that actually deletes `recordings/{tenant}/*`
Storage objects past `tenants.retention_days` and nulls `call_logs`'s
recording-URL columns, distinct from the DB-internal retention job above),
and `job-keep-warm`
(`20260910100600_job_keep_warm_cron_schedule.sql`) — every job-table row in
BACKEND_SPEC §8 is now scheduled; none remain "not yet covered" here.

`pgmq`/`pg_cron`/`pg_net`/Vault's exact function signatures the migration
relies on were confirmed against each extension's own current GitHub
source (`supabase.com/docs` itself returned egress-blocked from every build
agent's environment) — see that migration file's header comment for the
specific signatures and sources. Still worth a final live check before
go-live: re-verify `cron.job`/`pgmq.list_queues()` yourself against your own
project's actual extension versions, per that same header's own caveat.

**OUTREACH-2 addendum:** `20260911140100_job_outreach_review_score_cron_
schedule.sql` (same follow-up pattern as `job-keep-warm` above, applied
automatically by the same `supabase db push` once the two Vault secrets
above exist) adds one more HTTP-calling job, `job-outreach-review-score`
(hourly, `0 * * * *`) — the phone-complaint review-scoring pass. The job
count in this section predates several other jobs added since it was
written (`job-lead-callback-retry`, `job-commission-accrual`,
`job-motel-deposit-hold-expiry` are also missing from the "17 HTTP-calling
jobs" tally above) — treat `select count(*) from cron.job` against your
own project as the source of truth rather than recomputing this doc's own
running total; not re-derived here (out of this task's scope, flagged in
docs/BUILD_NOTES.md OUTREACH-2).

### 3.7 Deploy `apps/web` to Vercel

**Build `packages/widget` before `apps/web`** (`docs/audit/
CHANNELS_REQUESTS.md` item 6). `apps/web/src/app/widget.js/route.ts` and
`.../widget-voice.js/route.ts` — the two routes that serve the embeddable
widget's script tags — read `packages/widget/dist/{widget,voice-runtime}
.global.js` **from disk at request time**, never via an `import`, so they
404 if that package hasn't been built into the same deploy:

```bash
pnpm --filter @heyloo/widget build
```

Two things already wire this in so a normal `turbo run build` (or Vercel's
own build command, if it invokes turbo) gets the order right without a
manual step: `apps/web/package.json` lists `@heyloo/widget` as a
`devDependency` (unused in code — added purely so turbo's `build: {
dependsOn: ["^build"] }` graph in `turbo.json` builds the widget package
first), and `apps/web/next.config.ts`'s `outputFileTracingIncludes` pins
both dist files into a standalone build's traced output. Still worth the
explicit step above if you ever build/deploy `apps/web` in isolation
(e.g. a Vercel project scoped to just that app's directory, bypassing
turbo's own dependency graph) — verified working via a real `next build
--webpack` including this dependency, not just asserted.

Push to the branch Vercel's project is connected to (or `vercel deploy
--prod` directly). Confirm the build succeeds and the deployed site's
`/api/signup/draft` route returns `200` (a quick `curl -X POST` smoke —
this route needs no auth and confirms the deployment's env vars are wired).
Also smoke-test `/widget.js` and `/widget-voice.js` return `200` with a
`content-type: application/javascript` body, not a 404 — the one symptom
of skipping the widget build above.

### 3.8 Point Retell agents at the deployed webhook URLs

Every tenant's agent gets `voice_tools_webhook_url`/`call_events_webhook_
url` set at provisioning time by `api-provision` from `VOICE_TOOLS_
WEBHOOK_URL` (§2) — confirm that env var is the real deployed URL before
the first real tenant provisions, since a wrong URL here silently breaks
every tool call for every tenant provisioned before it's fixed.

---

## 4. VERIFY.md resolution

`docs/VERIFY.md` lists every external-API shape this codebase built from
research/third-party summaries because vendor doc sites were egress-blocked
from every build agent's environment (CLAUDE.md Rule 1 item 2's documented
fallback). Some are low-risk (long-stable, independently-corroborated
public contracts, e.g. Stripe/Twilio signature schemes). **These need a
real, live confirmation before go-live**, roughly in priority order:

### 4.1 File one Retell support ticket covering all seven of these

(§1.2 step 2 — file this immediately, it has the longest turnaround of
anything in this list)

1. **What is the current per-workspace agent-count ceiling and the
   per-endpoint rate limits** for `create-agent`/`update-agent`/
   `publish-agent-version`? (`docs/VERIFY.md` VERIFY-6 — undocumented
   anywhere this build could reach.)
2. **Confirm the exact publish endpoint and response shape**:
   `POST /publish-agent-version/{agent_id}` returning `{agent_id,
   version}` — or a different path/shape? (VERIFY-6.)
3. **The single highest-risk item**: request a current sample
   Conversation-Flow/Retell-LLM JSON payload (or point at the current API
   reference) so this codebase's own compiler output
   (`packages/adapters/retell/src/compiler/*`,
   `supabase/functions/_shared/compiler/template-compiler.ts`) can be
   field-name-diffed against it before the first real template publish.
   (VERIFY-8 — this codebase's structural modeling is internally
   consistent but the exact wire field names were never independently
   confirmed.)
4. **Confirm the webhook signature scheme**: is `RETELL_API_KEY` really
   the same key that signs `X-Retell-Signature`, or is there a distinct
   webhook-signing secret in the current dashboard? (VERIFY-1 — get this
   wrong and every inbound Retell webhook fails closed.)
5. **What region does Retell's webhook egress originate from**, and is
   there a documented health/status endpoint better suited to synthetic
   monitoring than this build's fallback (`GET /list-agents?limit=1`,
   `job-retell-health-failover`)?
6. **Confirm the units and full enum** of `call_cost.product_costs[].cost`
   (integer cents vs. fractional dollars — a real billing-accuracy risk,
   not just cosmetic) and the complete `disconnection_reason` enum.
   (VERIFY-4/VERIFY-5.)
7. **The HIPAA BAA** (§1.2 step 3): is it self-serve on every plan as
   researched, and is it workspace-wide or does each tenant (e.g. every
   dental-vertical tenant) need its own acknowledgment?

### 4.2 Test each answer against the Retell staging workspace (§1.2 step 4)

before touching production:

1. Fire one real inbound test call at a staging agent pointed at a logging
   endpoint (a webhook.site URL or a temporary edge function that just logs
   the raw body) — capture the actual `call_inbound` body and diff against
   `zRetellInboundCallWebhook` (VERIFY-2).
2. Attach one custom-function tool to that staging agent and trigger it —
   capture the real tool-call webhook envelope and diff against
   `zRetellToolCallWebhook`/`extractCallerNumber` (VERIFY-3).
3. Let that same call end normally — capture the real `call_ended` payload
   including `call_cost`/`call_analysis` and diff against
   `zRetellCallObject`/`normalizeCostBreakdown` (VERIFY-4/VERIFY-5).
4. Publish one real template through the staging workspace end to end
   (`admin-templates/:id/publish`, already built) and diff the actual
   Retell-side agent/flow it created against this codebase's compiler
   output — this is the VERIFY-8 confirmation in practice, not just in a
   support ticket's answer.
5. Import one real phone number (`POST /import-phone-number`) against
   staging and confirm the response shape matches
   `zRetellImportPhoneNumberResponse` (VERIFY-7).

### 4.3 Other vendor items worth a quick live confirmation

(lower risk, but still unverified against a live account per
`docs/VERIFY.md`): Square's webhook signature scheme (carried forward from
legacy salvage notes, explicitly flagged low-confidence), Smartlead's
`EMAIL_REPLY` reply-body field name (tried in priority-ordered fallback,
never confirmed), and Supabase Auth Admin's `generate_link` response field
nesting (`_shared/providers/supabase-admin.ts` checks both shapes
defensively) — fire one real test of each before depending on the code path
that uses it (tenant impersonation, for the last one).

---

## 5. Counsel checklist

File these with counsel **before** the first real tenant call, not after —
BIPA/consent posture affects product copy (the disclosure line itself,
SYSTEM_DESIGN §4.5) which is compiled into every agent template, so a late
change means recompiling and republishing every tenant's agent.

- [ ] **BIPA posture** (SYSTEM_DESIGN §7 G3): review the voice-processing/
  recording pipeline as implemented (Retell records, this codebase archives
  to a private Storage bucket, `docs/spec/BACKEND_SPEC.md` §7.3's <10min
  archival window). Confirm the **recording retention window** — this
  build ships no hard default in code (an explicit open item,
  `docs/SYSTEM_DESIGN.md` §15 "Recording retention default (30 vs 90 days)
  pending BIPA counsel input") — counsel's answer becomes a
  `platform_settings` value or a `tenants` column a follow-up migration
  adds; it is not yet wired anywhere in this codebase.
- [ ] **Recording consent wording** for every two-party-consent state your
  tenants operate in — the compiled-in disclosure line
  (`{{business_name}}... this call may be recorded`) is intentionally
  generic; confirm it satisfies two-party consent everywhere you'll sell,
  or whether a per-state variant is needed (SYSTEM_DESIGN §4.5 notes
  wording is an owner decision, presence is not).
- [ ] **AI-disclosure law compliance** (e.g. CA AB 2905 and similar) — same
  disclosure line, confirm it satisfies the specific statutory language
  requirements in every state you'll operate in.
- [ ] **HIPAA BAA chain** for the dental vertical: Retell's BAA (§1.2) plus
  this codebase's own tenant-facing BAA at dental onboarding (SYSTEM_DESIGN
  §7 — "tenant-facing BAA at dental onboarding, G22, independent of the
  Retell BAA") — this codebase does not generate or track a signed
  tenant-facing BAA anywhere; that flow needs building (frontend + a
  signed-document record) before onboarding a real dental tenant.
- [ ] **TCPA posture** for outbound reminder calls/SMS (MASTER_SPEC §3.6) —
  confirm the "transactional only, only with captured consent, never
  marketing, never cold" implementation (the `consent` capture at booking
  time, `job-reminder-scheduler`'s quiet-hours enforcement) actually
  satisfies TCPA as built, not just as designed.
- [ ] **CAN-SPAM** for the outreach engine (SYSTEM_DESIGN §11) — confirm
  the CAN-SPAM footer requirement (enforced server-side, `admin-outreach`
  won't create a campaign without one configured) and the 0.3%-complaint
  auto-pause threshold match counsel's read of the statute; note the
  real, flagged gap that Smartlead's webhook catalog has no distinct
  spam-complaint event today (`docs/VERIFY.md`'s T8 entry) — the auto-pause
  *logic* is built and tested, but nothing live can trigger it yet.
- [ ] **PCI stance** for phone payments (MASTER_SPEC §3.2, SYSTEM_DESIGN §7
  G20): confirm "no card numbers ever spoken/stored, Stripe Payment Links
  only" satisfies your PCI scope as implemented — no real-time audio
  card-number redaction exists in this codebase (SYSTEM_DESIGN §7 names
  this as a requirement for restaurant/motel phone payments; it is not
  built here — the payment-link flow avoids the issue by design instead of
  needing redaction, but confirm that's an acceptable substitute with
  counsel/your PCI assessor, not just an engineering assumption).
- [ ] **Referral program FTC disclosure** (SYSTEM_DESIGN §10) — confirm the
  partner-portal disclosure-gate copy satisfies FTC affiliate-disclosure
  requirements; note `docs/VERIFY.md`'s T5 entry flags that the exact
  `referral_partners` FTC-disclosure columns the frontend expects were not
  found in the schema at build time — confirm the disclosure flow as it
  actually renders today, not just as specced.
- [ ] **W-9 / 1099-NEC** — confirm the partner-portal W-9 capture at signup
  and the $2k/yr auto-1099-NEC threshold (SYSTEM_DESIGN §10) match your
  actual tax-reporting process; this codebase captures W-9 data but does
  not itself file 1099s.
- [ ] **DPA** (Data Processing Agreement, since this platform processes the
  SMB's own customers' PII) — confirm the legal pages under `apps/web/
  content/legal/` (ToS, privacy policy, DPA) are counsel-reviewed final
  copy, not placeholder text, before go-live.

---

## 6. Go-live smoke checklist

Run this once, start to finish, against the **production** deploy (after
§3's sequence and at least one staging-workspace VERIFY pass from §4) —
this is the single end-to-end proof the whole system works together, not
just each piece in isolation.

1. **Sign up** as a real (or clearly-marked internal test) tenant through
   the actual marketing site signup flow, picking a vertical, completing
   Stripe Checkout with a real card (or Stripe's test-mode card in a
   staging pass).
2. **Confirm provisioning completes**: the dashboard's provisioning-poll
   screen reaches "ready," a real Twilio number is visible in
   phone-setup, and the tenant's Retell agent shows as published (check
   the Retell dashboard directly, staging or prod workspace).
3. **Complete the forwarding wizard** and place a **test call** to the
   tenant's forwarded number from a real phone. Confirm: the AI answers
   with the disclosure line intact, completes a booking end to end
   (`check_availability` → `create_booking`), and hangs up cleanly.
4. **Confirm the booking landed**: the tenant dashboard's Bookings page
   shows the new booking within a few seconds (realtime broadcast — no
   manual refresh needed).
5. **Confirm SMS**: the test caller receives the booking-confirmation SMS
   (`send_sms_confirmation` tool → `worker-messages-outbound` →
   `messages_outbound`).
6. **Confirm the dashboard's live call feed**: the just-completed call
   appears on `/dashboard/calls` with its classification populated (may
   take up to the nightly reconciliation window for post-call-analysis
   fields — the in-call fields like caller number/duration should be
   immediate).
7. **Confirm a margin-cockpit row exists**: as the platform admin, check
   `/cockpit/margin`'s per-call-cost view shows this exact test call with
   a real `cost_cents` figure (confirms the `call_ended` webhook's cost
   ingestion actually reached the DB, not just that the call connected).
8. **Confirm billing**: wait for (or manually trigger, in staging)
   `job-billing-cycle` and confirm a `billing_invoices` row was created
   with the right included-minutes/overage math for this tenant's
   vertical.
9. **Confirm the uptime monitor** (`docs/OPS_RUNBOOK.md` §3) is actually
   live and its expected-status check passes against the real production
   URL, not just staging.
10. **Confirm the status page** (`docs/OPS_RUNBOOK.md` §4) shows "all
    systems operational" and is publicly reachable.

If every step above passes, the platform is genuinely ready to take real
tenants — this is the bar, not "the code compiles and the tests pass."

---

## 7. E2E test suite

`apps/web/tests/e2e/` (Playwright) has two tiers:

- **Unauthenticated specs** (`role-guards.spec.ts`, `signup-checkout.spec.ts`,
  the unauthenticated half of `admin-aal2.spec.ts`) — run anywhere, no
  backend needed. CI's `e2e` job (`.github/workflows/ci.yml`) runs these on
  every push/PR.
- **Authenticated specs** (`dashboard-realtime.spec.ts`,
  `forwarding-wizard.spec.ts`, `admin-aal2-authenticated.spec.ts`) — need a
  **real local Supabase instance** (`supabase start`). They self-skip
  cleanly when one isn't reachable (`apps/web/tests/e2e/support/
  auth-state.ts`'s `isLocalSupabaseReachable()`), which is why they're safe
  to leave in CI's default run without wiring `supabase start` there too.
  To run the full authenticated suite for real (locally, or in a future CI
  job — see that file's own comment for what wiring `supabase start` into
  CI would need):

  ```bash
  supabase start                      # Docker required
  # in a second terminal:
  supabase functions serve --env-file .env
  # back in the first terminal, from apps/web/:
  SUPABASE_URL=http://127.0.0.1:54321 \
  SUPABASE_SECRET_KEY=<from `supabase status`> \
  pnpm exec playwright test
  ```

  The "setup" project (`auth.setup.ts`) provisions real test users (a
  tenant owner, a platform admin with no MFA factor yet) against that local
  instance and logs each in through the real `/login` form before the
  dependent specs run.

- **`scripts/e2e-backend.ts`** — a separate, non-Playwright backend smoke:
  real signed Retell webhook requests against `/voice-tools`/`/voice-events`
  over HTTP, asserting real Postgres state afterward (booking idempotency,
  webhook dedup, cost ingestion). Requires `supabase start` +
  `supabase functions serve`, same as above:

  ```bash
  SUPABASE_URL=http://127.0.0.1:54321 \
  SUPABASE_SECRET_KEY=<from `supabase status`> \
  RETELL_WEBHOOK_SIGNING_SECRET=<whatever you started functions serve with> \
  node --experimental-strip-types scripts/e2e-backend.ts
  ```

Neither of these could be executed inside the build-agent sandbox that
authored them (no Docker, and `cdn.playwright.dev`/browser installs are
network-blocked there — confirmed directly, see `docs/BUILD_NOTES.md`'s T9
entry) — both were instead validated by careful line-by-line
cross-referencing against the real handler source (exact response shapes,
exact redirect targets, exact table/column names) rather than executed.
Run them for real, here, before trusting them as a release gate.
