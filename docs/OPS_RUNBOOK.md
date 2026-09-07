# Ops Runbook

Solo-founder-friendly operational procedures: structured logging, error
reporting, uptime monitoring, backup/restore drills, incident communication,
and break-glass continuity (SYSTEM_DESIGN §8, gap register G17/G18/G19).
Read alongside `docs/DEPLOY.md` (accounts + one-time setup) — this document
is the *ongoing* half: what to do on day 2, day 90, and the day something
breaks.

## 1. Structured logging conventions

Every edge function constructs its logger the same way:
`createLogger({ fn: "<function-name>" })` (`supabase/functions/_shared/
logger.ts`). Follow these conventions for every new `logger.*()` call site:

- **`msg` is an event name, not a sentence.** `snake_case`,
  `<subject>_<verb_past_tense>` — e.g. `voice_tools_dispatch_error`,
  `booking_created`, `webhook_signature_rejected`. This is what you filter
  and dashboard on; a free-form sentence defeats that. Never interpolate
  variable data into `msg` itself — put it in `fields`.
- **`fields` split into low- and high-cardinality.** A field whose value
  comes from a small fixed set (a tool name, an event type, a disconnection
  reason, a boolean) is low-cardinality — safe to eventually promote to a
  dashboard facet/Sentry tag. A field that's unique per call (a call id, a
  phone number, a stack trace) is high-cardinality — fine to log, never
  turn into a tag/facet (cardinality explosion). The Sentry wiring below
  encodes this split automatically: a logger's fixed `base` fields (set
  once at construction, e.g. `{ fn: "voice-tools" }`) become Sentry `tags`;
  the per-call `fields` passed to an individual `.error()` call become
  Sentry `extra` context.
- **Level discipline:** `debug` for anything only useful while
  actively debugging one call; `info` for a normal lifecycle event worth
  keeping (booking created, webhook processed); `warn` for a handled,
  expected-but-notable condition (signature rejected, circuit open,
  fallback returned) — NOT an error, since it didn't fail anything;
  `error` for something that actually failed and needs a human's attention
  eventually. **Only `error()` triggers Sentry reporting** (below) — do not
  downgrade a real failure to `warn` just to keep it out of Sentry, and do
  not upgrade routine rejections to `error` just to get paged.
- **Never log:** raw webhook signing secrets, full card numbers (should
  never reach a handler at all — SYSTEM_DESIGN §7 PCI stance), a caller's
  full recording/transcript text as a log line (it already lives in
  `call_logs`/Storage with RLS; logs are a different, wider-access-radius
  surface with a shorter retention window — CLAUDE.md Rule 2's PHI/PII
  discipline extends to logs, not just database columns).
- **One JSON line per event** — the logger already guarantees this
  (`JSON.stringify` once, `console.log`/`warn`/`error` — never
  `console.log` a second, unrelated value on the same call, since Supabase
  ingests each `console.*` invocation as one structured line).

## 2. Sentry (error reporting)

**Setup (one-time, per environment — see `docs/DEPLOY.md` §"Sentry"):**
create a Sentry project (platform: "Node" or generic), copy its DSN, set
`SENTRY_DSN` in every edge function's environment (`supabase secrets set
SENTRY_DSN=...` — see DEPLOY.md's exact command) and `NEXT_PUBLIC_SENTRY_DSN`
/`SENTRY_DSN` for `apps/web` (already wired via `@sentry/nextjs`,
`apps/web/instrumentation.ts`/`instrumentation-client.ts` — unrelated to the
edge-function wiring below, already built by T5).

**How the edge-function side works** (`supabase/functions/_shared/sentry.ts`
+ `logger.ts`, built T9): every `logger.error(msg, fields)` call
automatically posts a Sentry event over the public Envelope HTTP API — no
`@sentry/*` SDK dependency (Deno can't cleanly pull one in without a
bundling step this codebase doesn't add; see `_shared/providers/*.ts`'s
identical rationale). Entirely **env-gated and fail-open**: unset
`SENTRY_DSN` → zero network calls, zero behavior change (every existing
test runs this way); a bad DSN, a Sentry outage, or a network failure is
swallowed silently — an observability sink must never become a new failure
mode for the request it's reporting about. Delivery for a call that happens
inside a background task (`runInBackground`/`EdgeRuntime.waitUntil` — most
`.error()` calls in webhook/job/worker handlers) is reliable; delivery for
an `.error()` call on the synchronous hot path (`voice-tools`, right before
the response returns) is best-effort only — acceptable for an
observability signal, never a correctness concern (see `_shared/sentry.ts`'s
own header comment).

**Verify it end to end before go-live:** set a real `SENTRY_DSN`, deploy any
one function, trigger a real error path (e.g. POST an unsigned request to
`/voice-tools` to get a rejected-signature `warn` — that alone won't fire
Sentry; instead force a genuine `.error()` path, such as temporarily
pointing `RETELL_WEBHOOK_SIGNING_SECRET` at a wrong value and calling a tool
so `voice_tools_dispatch_error` fires) and confirm the event lands in the
Sentry project's Issues stream within a minute. This is also VERIFY-worthy
(`docs/VERIFY.md`'s T9 entry): the envelope wire format was built from
Sentry's own publicly-documented protocol (egress-blocked from this build
environment, so not first-party-fetched) — this manual check is the
first-party confirmation.

**Alert routing:** configure Sentry's own project alert rules (Settings →
Alerts) to notify the owner's email/Slack on a new issue or a spike —
Sentry's alerting is the "did something break" channel; `job-alert-
evaluation`'s `alerts` table (admin cockpit) is the separate "is the
business healthy" channel (margin drift, usage spikes, tool-failure rate).
Both matter; neither substitutes for the other.

## 3. Uptime monitoring

**What to monitor first:** `/voice-inbound` (the first hop of every real
phone call — if this is down, the business is down). It is POST-only and
requires a real Retell-shaped signed body to return `200`
(`supabase/functions/voice-inbound/index.ts`), so a plain unauthenticated
`GET` from an uptime pinger will correctly get `405`, and an unsigned `POST`
will get `401` — **this repo does not ship a dedicated `GET /health`
endpoint today** (a real, flagged gap — see `docs/LAUNCH_STATUS.md`'s
known-gaps list). Until one exists, configure the pinger to expect a
**stable, fast `401`** (not `200`) as the "up" signal:

```
Method:          POST
URL:             https://<project-ref>.supabase.co/functions/v1/voice-inbound
Body:            {}
Headers:         Content-Type: application/json
Expected status: 401  (missing/invalid x-retell-signature — proves the
                       function is deployed, reachable, and its signature
                       check ran, without needing a real Retell payload)
Expected latency: < 1s (well inside the p95 < 300ms hot-path budget with
                       headroom for network/TLS)
Interval:        1–5 minutes
```

A response of anything OTHER than `401` (timeout, `5xx`, connection
refused) is the actual outage signal — alert on that, not on the specific
status code drifting.

**Recommended tool (pick one, ~5 minutes to set up, free tier covers this):**
Better Stack (Better Uptime), UptimeRobot, or Pingdom — any HTTP monitor
that supports a custom method/body/expected-status and SMS/email/Slack
alerting on failure. Point it at the URL above. Also add a second, simpler
monitor on `https://<project-ref>.supabase.co/functions/v1/webhooks-stripe`
(or any other `verify_jwt: false` webhook function) expecting `401` the
same way — a second independent signal that the whole Edge Functions
deployment (not just one function) is up.

**Recommended follow-up (not built here, small and safe for a later task):**
add a trivial `GET`-only `health` edge function (no auth, returns
`{status:"ok", ts}` plus perhaps one fast `select 1` against the DB) so
monitoring doesn't depend on a signature-rejection side effect. Track this
in `docs/BUILD_NOTES.md`'s T9 entry / `docs/LAUNCH_STATUS.md`.

**Also monitor:** `apps/web`'s deployed URL (`GET /`, expect `200`) via the
same tool, and Vercel's own deployment-failure notifications (Project →
Settings → Notifications) as a second, independent channel.

## 4. Incident communication / status page automation (G19)

Goal: **under 5 minutes from an incident to a public status update** — the
published support SLA (G19) depends on this being automatic, not something
the (solo) founder has to remember to do by hand at 2am.

1. Create a status page (Better Stack Status Pages, or a hosted alternative
   — most uptime tools from §3 bundle one). Add one component per monitored
   surface ("Voice / phone calls", "Dashboard", "SMS").
2. Wire the uptime monitors from §3 directly to that status page's
   incident-automation feature (built into Better Stack/UptimeRobot/etc. —
   a monitor going down automatically opens an incident and flips the
   component to "Degraded"/"Down"; recovery auto-resolves it). This is the
   piece that gets you under 5 minutes without a human in the loop.
3. Separately, `job-retell-health-failover` (BACKEND_SPEC §8, G5) already
   detects a Retell outage server-side and flips Twilio routing to
   forward-to-owner-cell + SMS's the tenant directly
   (`supabase/functions/job-retell-health-failover/`) — this is
   business-continuity automation, independent of the public status page,
   and already built. Link the status page's "Voice / phone calls"
   component in its description to mention this fallback, so a status-page
   visitor understands calls are still being answered (by a human) during
   a Retell outage, not silently dropped.
4. Publish the status page URL on the marketing site footer and in the
   tenant dashboard (a `<footer>` link is enough for launch — FRONTEND_SPEC
   doesn't currently wire one; add it when this is set up).
5. Write (once) a short incident-response text template for the founder to
   paste into the status page's manual-update field for anything the
   automation doesn't cover (a billing provider outage, a bad deploy):
   "We're aware of an issue affecting <X> and are working on it. Updates
   here as we have them." — havings this pre-written removes the "what do I
   even say" friction at 2am.

## 5. Backup / restore drill (quarterly, SYSTEM_DESIGN §8 "PITR on")

**Prerequisite (one-time, in DEPLOY.md):** confirm Point-In-Time-Recovery
is enabled on the production Supabase project (Settings → Database →
Backups — a paid-plan feature; confirm current retention window, e.g. 7/14
days, against the plan actually purchased).

**Drill steps (run once per quarter, ~30–45 minutes, do NOT skip this —
an untested backup is not a backup):**

1. In the Supabase dashboard, create a new **scratch** project (never restore
   into anything a real tenant could reach) in the same organization.
2. From the production project's Backups page, pick a recent PITR point
   (or the nightly backup) and restore it into the scratch project —
   Supabase's dashboard flow handles this; note the exact restore-point
   timestamp used.
3. Once restored, run the RLS/schema sanity checks against the scratch
   project exactly like CI's own `migrations-check`/`rls-probe` jobs do —
   easiest path: point `SUPABASE_URL`/`SUPABASE_SECRET_KEY`/
   `SUPABASE_PUBLISHABLE_KEY` at the scratch project and run
   `node --experimental-strip-types scripts/ci/rls-cross-tenant-probe.ts`
   locally (it creates its own fresh tenant fixtures, so a restored
   snapshot's existing data doesn't interfere). A clean pass is real
   evidence the restored database is structurally sound and RLS still
   holds — not just "the restore didn't error."
4. Spot-check one or two real (restored) tenants' `bookings`/`call_logs`
   rows are present and look right for the chosen restore point.
5. Deploy edge functions to the scratch project (`supabase functions deploy
   --project-ref <scratch-ref>`, see DEPLOY.md) and fire one real signed
   `/voice-inbound` request (reuse `scripts/e2e-backend.ts`'s signing helper
   as a reference) to confirm the app tier reconnects to a freshly-restored
   database with no code changes needed.
6. **Tear down the scratch project** when done (Settings → General →
   Delete Project) — it now holds a copy of real tenant PII and must not
   linger.
7. Log the drill's date, restore-point timestamp, and pass/fail in
   `docs/LAUNCH_STATUS.md`'s (or a private ops log's) running history — the
   point of a *quarterly* drill is a paper trail proving it stayed working
   as the schema evolved, not a one-time checkbox.

## 6. Break-glass continuity (solo-founder, G18)

If the founder is unreachable (medical emergency, lost device, etc.), a
**trusted contact** (co-founder, spouse, accountant — pick one person, name
them explicitly) needs a documented, narrow path to keep the business
answering calls and billing correctly, without needing to reconstruct
everything from scratch.

**What to prepare (do this once, before go-live, and re-confirm quarterly
alongside the backup drill above):**

1. A password-manager vault (1Password/Bitwarden "Emergency Access" or
   equivalent) shared with the trusted contact, containing: the Supabase
   project owner login (or at least a documented path to request access —
   Supabase support can transfer/add an org member given proof of
   identity), the Vercel account login, the domain registrar login (DNS —
   without this, nothing is recoverable if the domain lapses or needs
   re-pointing), Twilio and Stripe account logins, and this repository's
   GitHub access.
2. A one-page "if I'm gone" doc (store it in the same vault, not in this
   repo — it names real account credentials/paths) covering: how to pause
   billing (Stripe dashboard → pause subscriptions, or nothing — the
   product keeps running and charging correctly on its own; only *manual*
   intervention like a refund needs a human), how to reach Retell/Twilio/
   Stripe support if something needs escalating, and where the status page
   (§4) is so the trusted contact can post an update ("under new/temporary
   management, service continues normally").
3. Confirm the trusted contact can actually log in to at least the
   password manager and Supabase (a real login test, not just "I sent them
   an invite") — the same quarterly cadence as the backup drill is a
   natural pairing (do both in one sitting).
4. This is deliberately NOT a second full-access admin account created
   inside the product (a standing extra platform_admin credential is its
   own attack surface — G15's audit/impersonation logging exists to make
   *any* admin action attributable, and a break-glass credential should stay
   outside that surface, used only in the documented emergency path above).

## 7. Related VERIFY items

`docs/VERIFY.md` carries the vendor-API-shape unknowns this runbook's
setup steps depend on (Sentry envelope format — new, T9; Supabase backup/
restore mechanics referenced only generally above, confirm the current
dashboard flow against `supabase.com/docs` before the first real drill,
since this build environment could not reach that site to verify the exact
click-path).
