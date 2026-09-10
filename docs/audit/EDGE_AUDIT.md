# Edge Functions Production-Readiness Audit

Date: 2026-09-09
Scope: `supabase/functions/**` (27 functions + `_shared`) only. Database
schema/RLS and `apps/web` are explicitly out of scope (owned by other agents)
and are referenced below only where an edge-function behavior depends on an
assumption about them.

Method: read every file under `_shared` that every webhook/tool touches
(signature verification, crypto, dedup, circuit breaker, queue, idempotency,
sentry, db client), then did a deep read of the 8 functions named in scope
(`voice-tools`, `voice-events`, `voice-inbound`, `webhooks-stripe`,
`api-checkout`, `api-provision`, `job-billing-cycle`,
`worker-messages-outbound`) plus every other webhook entrypoint
(`webhooks-twilio-sms`, `webhooks-pos`, `webhooks-outreach`), `admin`,
`job-retell-health-failover`, and `worker-recording-fetch`. All file:line
references below are exact.

---

## BLOCKER

### B1. `create_booking` does not verify the tool-supplied `resource_id`/`offering_id` belong to the caller's tenant

`supabase/functions/voice-tools/tools/create_booking.ts:34-92` inserts
directly:

```ts
insert into public.bookings (
  tenant_id, resource_id, offering_id, customer_id, start_at, end_at, ...
) values (
  ${ctx.tenantId}, ${args.resource_id}, ${args.offering_id ?? null}, ...
)
```

`args.resource_id`/`args.offering_id` come straight from the Retell tool-call
`args` (only Zod-shape-validated, not ownership-validated). There is no prior
`select ... from resources where id = args.resource_id and tenant_id =
ctx.tenantId` (contrast with every other tool in this same directory —
`update_booking.ts:34-44`, `cancel_booking.ts:30-42`, `create_order.ts:73-79`,
`send_payment_link.ts:41-44` all scope every referenced id by
`ctx.tenantId` before writing). `bookings.resource_id` FKs to `resources(id)`
globally, not `(tenant_id, resource_id)`, so nothing at the DB layer catches
this either.

Impact: a call on Tenant A's agent that (via a manipulated/adversarial
transcript, or simply a leaked/guessed UUID) supplies Tenant B's
`resource_id` creates a `confirmed` booking tagged `tenant_id = A` against
Tenant B's resource. The availability-invalidation trigger (BACKEND_SPEC
§3.5) then flips Tenant B's slot to unavailable — a genuine cross-tenant
integrity/DoS hole, and a direct violation of CLAUDE.md Rule 2 ("every
secret-key edge function still explicitly filters by a verified tenant_id")
and this audit's own checklist item 2 ("booking tools validate tenant
ownership of every referenced id").

**Fix:** before the idempotency-key check, `select 1 from resources where id
= args.resource_id and tenant_id = ctx.tenantId and active` (and similarly
for `offering_id` when present) and return `{confirmed:false,
reason:"item_not_found"}`-equivalent on a miss, exactly as `create_order.ts`
already does for `offering_id`.

### B2. Provisioning saga's `compileTemplate` is a stub that never compiles the disclosure line — agents can go live without the AI/recording disclosure

`supabase/functions/api-provision/index.ts:90-107`:

```ts
async compileTemplate(tenantIdForCompile: string) {
  // T2's `packages/adapters/retell` compiler ... isn't importable from Deno
  // ... resolves the tenant's active template row directly here as a
  // stand-in until that wiring lands.
  const rows = await sql`select at.id, at.version from public.agent_templates at ...`;
  return {
    templateId: template?.id ?? "",
    templateVersion: template?.version ?? 0,
    compiledConfig: { tenant_id: tenantIdForCompile },
  };
},
```

`compiledConfig` is sent straight to Retell's create-agent call
(`api-provision/handler.ts:122-127`) as the entire agent definition. It is
never run through the real template compiler, so `disclosure_line` (compiled
in from `agent_templates.disclosure_line`, BACKEND_SPEC §1.3) is never
injected, and the compiler's own publish-time gate ("refuses to publish a
template whose compiled output does not contain `disclosure_line` verbatim in
the first agent turn") never executes for any tenant provisioned through this
code path. This directly contradicts CLAUDE.md Rule 2 ("Every agent greeting
includes the compiled-in AI + recording disclosure") — a non-negotiable,
explicitly called out invariant.

This gap is self-documented in the code/BUILD_NOTES.md as a known T2/T3
coordination seam, not a silent bug — but as shipped, `runProvisioningSaga`
will happily publish (`handler.ts:262-280`, `publishAgentVersion`) an agent
built from `{tenant_id: "..."}` alone. Until the real compiler is wired in,
**this saga must not be allowed to run in production** — it will produce
agents that violate the mandatory disclosure requirement (and have no tools,
no prompt, no voice_id).

**Fix:** gate `publish_agent` (or the whole saga) behind a check that
`compileTemplate`'s output actually came from the real compiler (e.g. refuse
to publish when `compiledConfig` doesn't contain a non-empty
`disclosure_line`), and track the real T2→T3 wiring as a release blocker, not
a follow-up.

---

## HIGH

### H1. `worker-messages-outbound` never retries a provider-level send failure and never populates the documented DLQ for it

BACKEND_SPEC §9: `messages_outbound_queue` — "after 5 attempts, row status →
`failed`, moved to `messages_outbound_dlq` ... for manual admin review."

Actual behavior: `processOutboundMessage`
(`supabase/functions/worker-messages-outbound/handler.ts:49-139`) handles
every provider failure (Twilio non-2xx at `:96-99`, Resend failure at
`:120-123`, `no_sending_number` at `:86-89`, `no_recipient_email` at
`:110-113`, unimplemented channel at `:132-138`) by **directly setting
`status='failed'` in the DB and returning a string** — it never throws.

The caller loop (`supabase/functions/worker-messages-outbound/index.ts:68-82`)
is:

```ts
try {
  await processOutboundMessage(sql, row.message.message_id, deps);
  await deleteMessage(sql, QUEUE_NAMES.messagesOutbound, row.msg_id);
  processed += 1;
} catch (err) {
  ... if (row.read_ct >= MAX_ATTEMPTS) await moveToDeadLetter(...);
}
```

Since `processOutboundMessage` doesn't throw for a handled provider failure,
the `catch` (and therefore `moveToDeadLetter`, `queue.ts:90-98`) is
**unreachable for the failure modes that actually happen** (a transient
Twilio 5xx, Resend outage, etc.) — the pgmq message is `delete`d on the very
first attempt regardless, right after the row was marked `failed`. There is
no retry/backoff (confirmed: `_shared/providers/twilio.ts` `sendSms`/
`twilioRequest` at `:18-48` is a single `fetch`, no retry loop) and the
`messages_outbound_dlq` queue this same file's `moveToDeadLetter` helper
targets is never actually populated by this worker. A single transient
Twilio/Resend blip permanently drops a booking-confirmation/cancellation SMS
with no retry and no admin-visible DLQ entry — only the `messages_outbound`
row's own `status='failed'` (which nothing currently surfaces to an admin per
this function).

**Fix:** on a handled provider failure, increment/inspect an attempt counter
on the `messages_outbound` row (or rely on `row.read_ct` and re-throw instead
of writing `status='failed'` directly) so the pgmq visibility-timeout retry
and the `MAX_ATTEMPTS`/`moveToDeadLetter` path in `index.ts` actually engage,
matching BACKEND_SPEC §9's contract.

### H2. Retell health-failover's recovery path is a no-op — numbers never actually get restored

`supabase/functions/job-retell-health-failover/handler.ts:147-158`:

```ts
async function restoreNumbers(sql: SqlClient, deps: FailoverDeps): Promise<void> {
  // Restoring "Retell-import" routing on recovery is Retell's own concern
  // ... this job's role in restoration is limited to clearing the incident flag
  const numbers = await sql`select twilio_sid from public.phone_numbers where released_at is null`;
  deps.logger.info("retell_health_recovery_detected", { numbers_affected: numbers.length });
}
```

`failoverNumbers` (`:131-145`) does flip every tenant's Twilio
`VoiceUrl` to the fallback (owner-cell/voicemail) number via
`updateIncomingPhoneNumberVoiceUrl`. `restoreNumbers` only logs — it never
calls the Twilio API to flip `VoiceUrl` back to the Retell-routing
configuration. BACKEND_SPEC §8's Retell-health job entry: "on recovery,
auto-restores" (also G5). As shipped, once a failover triggers, **every
tenant's calls stay permanently routed to the fallback voicemail number**
even after Retell recovers, until a human manually re-runs the
Twilio/Retell number-import step — the opposite of the auto-restore
guarantee the job's own health-check half implements.

**Fix:** either store the pre-failover `VoiceUrl`/SIP config per number (so
`restoreNumbers` can flip it back verbatim) or re-run the Retell
number-import call recorded in `provisioning_runs`; either way this needs a
real Twilio API call, not a log line, before this job can be trusted in
production.

### H3. `checkout.session.completed` never triggers the provisioning saga

BACKEND_SPEC §7.4 lists `checkout.session.completed` → "mark tenant
`status='active'` ... kick off the provisioning saga (§7.9) **if not already
started**." `supabase/functions/webhooks-stripe/handler.ts:18-53` only
updates `tenants.status`/`stripe_customer_id`/`stripe_subscription_id`; it
never calls `/api-provision` (confirmed — no reference to
`PROVISION_INTERNAL_SECRET`/`x-internal-secret`/`runProvisioningSaga` appears
anywhere in `webhooks-stripe/**`). `api-provision/index.ts:61-71` does
support a `service_role`-style internal-secret bypass specifically for this
purpose, but nothing calls it.

This may be intentional (the frontend calls `/api-provision` directly from
the Stripe success-redirect page — `apps/web` is out of scope for this
audit), but as far as the edge-functions layer alone is concerned, a tenant
whose Checkout Session completes with no frontend follow-through (closed tab,
webhook arrives before redirect, etc.) is marked `active`/billable with **no
phone number, no agent, no Retell import** and no scheduled job that would
ever notice and retry. Given BACKEND_SPEC explicitly names the webhook as an
acceptable trigger path, this looks like a dropped requirement rather than a
deliberate simplification.

**Fix:** either have `webhooks-stripe`'s `checkout.session.completed` branch
call `/api-provision` with the internal secret when `metadata.tenant_id` is
present and no `provisioning_runs` row exists yet, or explicitly record in
`docs/BUILD_NOTES.md` that provisioning is frontend-triggered-only and add a
reconciliation job that alerts on a tenant stuck `active` with no
`phone_numbers` row past a timeout.

---

## MEDIUM

### M1. `send_sms_confirmation`/order-confirmation paths store cross-tenant-uncheck `booking_id`/`order_id` references

`supabase/functions/voice-tools/tools/send_sms_confirmation.ts:32-40,52-54`
takes `args.booking_id`/`args.order_id` straight from the tool call and
writes them into `messages_outbound.related_booking_id`/`related_order_id`
(and uses `booking_id` in the idempotency soft-check at `:33-36`) with no
`select ... where tenant_id = ctx.tenantId` check that the id actually
belongs to this tenant. Lower severity than B1 (no data is read back to the
caller, and the FK — if one exists — would only fail on a genuinely
nonexistent id, not a cross-tenant one, since `bookings`/`orders` ids are
global uuids), but it's an inconsistency worth closing: every other write
path in this same directory (`cancel_booking`, `update_booking`,
`create_order`, `send_payment_link`) does the tenant-scoped lookup first.
**Fix:** add the same `where id = ... and tenant_id = ctx.tenantId` guard
before using `args.booking_id`/`args.order_id`.

### M2. `voice-tools`' hard-abort timeout doesn't cancel the in-flight query — pool exhaustion risk under sustained slow queries

`supabase/functions/voice-tools/index.ts:30-44,92-109`: `withTimeout` races
`dispatchTool(...)` against a 1.5s timer and returns the fallback envelope on
timeout, but the losing `dispatchTool` promise (and its underlying
`postgres.js` query) is never aborted — it keeps running against the shared
module-scope pool. `_shared/deno/db.ts:27-34` configures `max: 5` connections
per warm instance. Under a sustained slow-query condition (e.g. a lock wait,
not just per-call jitter), each hung call consumes one of only 5 pool slots
for its full duration even though the caller already got a 200 back — five
concurrent hangs stalls every other tool call on that instance, which is
precisely the hot-path failure mode CLAUDE.md Rule 2/SYSTEM_DESIGN §5 are
trying to prevent. **Fix:** thread an `AbortSignal`/statement_timeout into
the query path so a hard-abort actually cancels server-side work, not just
the response the caller sees.

**Status: FIXED, verified-by-test (not just doc-citation).** `getSql`
(`_shared/deno/db.ts`) now takes `statementTimeoutMs`, threaded as a
Postgres `connection.statement_timeout` startup GUC via the new pure
`_shared/db-options.ts#buildConnectionOptions`; `voice-tools/index.ts` is
the sole caller passing it (`1200`ms, under its own 1.5s hard-abort). Three
independent layers of test now cover this, closing the "zero automated
test coverage" gap this entry originally had:
- `_shared/timeout.test.ts` — the extracted, Deno-global-free
  `_shared/timeout.ts#withTimeout` (re-exported from `voice-tools/index.ts`)
  under Vitest fake timers: race-winner + timer-cleared, timeout-rejection,
  and no-dangling-timer-after-either-branch assertions.
- `_shared/db-options.test.ts` — pins the actual `connection.statement_timeout`
  wiring `buildConnectionOptions` produces (present when
  `statementTimeoutMs` is given, entirely absent otherwise).
- `_shared/statement-timeout-check.ts` — a real integration check, run as a
  new step in the `migrations-check` CI job against the REAL local Postgres
  that job's `supabase start` already spins up: connects with
  `connection: { statement_timeout: 500 }`, confirms `select pg_sleep(2)`
  is actually canceled server-side (SQLSTATE `57014`) well under 2s, and
  that the same connection still serves `select 1` afterward — the literal
  "pool cannot be exhausted" claim, demonstrated against a real server
  rather than inferred from postgres.js's README.

### M3. Hand-decoded JWTs in `api-checkout`, `api-provision`, `api-adapter-connect`, `admin` have no defense-in-depth against a `verify_jwt` config regression

`api-checkout/index.ts:16-27`, `api-provision/index.ts:34-45`,
`api-adapter-connect/index.ts:13-23`, and `admin/index.ts:64-74` all
base64-decode the JWT payload directly (no signature check in that code)
and trust `app_metadata`/`sub` from it. This is safe **only** because
`supabase/config.toml` currently sets `verify_jwt = true` for all four
functions (confirmed at `config.toml:104-121`), meaning Supabase's platform
gate rejects an invalid/missing token before this code ever runs. There is no
test or CI check tying the code's trust assumption to that config value, so a
future accidental `verify_jwt = false` flip (a copy-paste across the
config-per-function block, or a Supabase CLI config-merge mistake) would
silently turn every one of these into a full auth bypass — exactly the class
of bug CLAUDE.md's own config.toml comment warns about ("the OLD repo died by
getting this inverted"). **Fix:** add a small CI assertion that parses
`config.toml` and fails the build if any function in this hand-decode set has
`verify_jwt` anything but `true` (or, more robustly, verify the JWT signature
in code too and stop relying solely on the platform flag).

### M4. Hand-rolled Stripe/Twilio signature schemes are explicitly unverified against live docs

`_shared/stripe-signature.ts:14-26` and `_shared/twilio-signature.ts:7-25`
both carry `VERIFY (docs/VERIFY.md)` headers stating the signing scheme was
reconstructed from training knowledge/third-party summaries because
`docs.stripe.com`/`twilio.com` were egress-blocked during this build, not
fetched live per CLAUDE.md Rule 1. The implementations look correct against
each provider's long-documented, stable scheme, but per Rule 1 this must be
confirmed against current live docs (and ideally a real signed test request)
before the first production webhook is trusted — a subtle mismatch here (e.g.
Twilio's exact parameter-concatenation rule for non-ASCII `Body` values) fails
closed (rejects everything) rather than open, so the practical risk is "SMS
webhook never verifies in prod," not a security hole, but it blocks
`webhooks-twilio-sms` from working at all until confirmed.

---

## LOW

- **L1.** `_shared/sentry.ts`'s envelope shape is also flagged
  `VERIFY`/unconfirmed against live Sentry docs (egress-blocked); it fails
  open correctly (`sendToSentry` swallows all errors, `sentry.test.ts`
  presumably covers this) so a bad DSN/shape only means "silently no
  alerting," never a crash — still worth one live smoke-test delivery before
  relying on it.
- **L2.** `voice-tools/tools/create_order.ts:117-156` reads
  `agent_configs.dynamic_variable_overrides.tenant_geocode` for the delivery
  radius check — the file's own comment admits this column placement is a
  guess ("VERIFY.md, since neither spec pins a column for it"); low risk
  (delivery-radius check degrades to "skipped, logged" when absent, never a
  false-accept) but worth resolving so the radius check actually fires for
  verticals that need it.
- **L3.** `job-retell-health-failover`'s `probeRetellHealth`
  (`handler.ts:44-60`) and the failover Twilio call both assume flipping
  `IncomingPhoneNumbers.VoiceUrl` is sufficient to route away from a
  Retell-imported number; the file's own comment flags this may need a SIP
  trunk-level change instead if Retell-imported numbers route via a trunk,
  not a webhook — unconfirmed, same family of issue as H2's missing restore.
- **L4.** `webhooks-outreach`'s CAN-SPAM 0.3%-complaint auto-pause rule
  (BACKEND_SPEC §7.5/§11) has no live trigger: `index.ts:25-38`'s own comment
  notes Smartlead's documented webhook catalog has no distinct
  spam-complaint event, so `campaigns.complaint_rate`-based auto-pause never
  fires from this handler as built — flagged in-repo already, listed here so
  it isn't lost.

---

## What's solid (no action needed)

- **Webhook signature verification** (`_shared/retell-signature.ts`,
  `stripe-signature.ts`, `twilio-signature.ts`, and the per-adapter
  `square.ts`/`shopmonkey.ts`/`google-calendar.ts` checks in `webhooks-pos`):
  every one fails closed on a missing secret/header/malformed value, verifies
  against the **raw** body before any JSON parsing, and uses the shared
  `timingSafeEqual` (`_shared/crypto.ts:51-60`) — a real constant-time
  compare (walks full length, folds length-mismatch into the same branch),
  not a `===`. `webhooks-outreach` and every `job-*`/`worker-*` cron/queue
  entrypoint use the same `timingSafeEqual` against a shared-secret header
  (`CRON_INVOKE_SECRET`) — verified present and enforced identically across
  all 12 job/worker functions.
- **Dedup-before-side-effect**: `_shared/webhook-dedup.ts`'s
  `insertWebhookEventIfNew` (unique `(source,event_id)`, `on conflict do
  nothing returning id`) is used consistently by `voice-events`,
  `webhooks-stripe`, `webhooks-twilio-sms`, `webhooks-pos` (all three
  adapters), and `webhooks-outreach`, always before any DB side effect, and
  every handler fast-acks (`200`) immediately after the dedup insert,
  deferring real work to `runInBackground`/`EdgeRuntime.waitUntil`
  (`_shared/deno/background.ts`) exactly per BACKEND_SPEC §7.3's pipeline.
  Out-of-order Retell delivery (`call_ended` before `call_started`) is
  explicitly handled (`voice-events/handler.ts:90-116`).
- **Hot path** (`voice-tools`): module-scope DB client and circuit breaker
  (`getSql()`, `ToolCircuitBreaker` constructed once at module scope,
  `index.ts:16,26`), no ORM, a real per-tool rolling-window circuit breaker
  that opens on >20%/min error rate and half-opens after a 30s cooldown
  (`_shared/circuit-breaker.ts`, unit-tested), and a genuine 1.5s hard-abort
  that always returns the documented fallback envelope rather than an error
  or silence (modulo M2's non-cancellation caveat). `lookup_customer`'s G6
  caller-scope check is enforced in code exactly as specced
  (`tools/lookup_customer.ts:42-55`), and every other tool but
  `create_booking` (B1) and the `send_sms_confirmation` references (M1)
  correctly scopes every referenced id by `ctx.tenantId` before writing.
  `check_availability` is a single indexed range query, no N+1.
- **Money/idempotency**: `bookings`/`orders` inserts never check-then-insert
  — they rely on the DB exclusion/unique constraint and catch
  `23P01`/`23505` to return the existing row (`create_booking.ts:81-128`,
  `create_order.ts:172-198`), matching CLAUDE.md Rule 2 exactly. Idempotency
  keys are deterministic (`_shared/idempotency.ts`) and never based on a
  check-then-insert race.
- **Admin auth**: `admin/handler.ts:1113-1115` gates *every* route on
  `isPlatformAdmin(ctx.claims)` before dispatch, and the impersonation route
  additionally requires AAL2 (`:172-173`) — `_shared/admin-auth.ts` correctly
  flags that it only checks session-level AAL2, not BACKEND_SPEC's proposed
  15-minute freshness window (an honest, documented gap, not a silent one).
- **No dynamic SQL / injection surface**: every query across the audited
  functions is a `postgres.js` tagged-template literal; no
  `sql.unsafe`/string-concatenated SQL appears anywhere in
  `supabase/functions/**`.
- **Error responses never leak internals**: every handler reviewed returns a
  short `{error: "..."}` string to the caller and only logs
  `String(err)`/stack detail server-side (`logger.error`) — confirmed across
  `voice-tools`, `voice-events`, `voice-inbound`, `webhooks-stripe`,
  `api-checkout`, `api-provision`.
- **Sentry wiring**: fully env-gated and fail-open by construction
  (`_shared/sentry.ts`'s `sendToSentry` always swallows fetch failures; a
  missing/malformed DSN returns `undefined` from `buildErrorEnvelope` rather
  than throwing) — will never crash or delay a response when `SENTRY_DSN` is
  unset, which is every environment today.
- **Leanness**: the edge-functions workspace has exactly two runtime deps
  (`zod`, `postgres`) per `supabase/functions/package.json` — no unused
  provider SDKs, no dead files found, only two informational `TODO`s in the
  whole tree (`worker-adapter-push/index.ts:83`, `_shared/providers/
  square.ts:207`), both scoped/dated to a named future wave, not
  forgotten debt.

---

## Verdict

**Not yet production-grade.** The webhook-security layer, the hot-path
circuit-breaker/timeout/idempotency discipline, and the admin auth gate are
all genuinely solid — better than most first builds, and CLAUDE.md Rule 2's
invariants are honored almost everywhere. But two BLOCKERs sit on the
critical path to a real launch: **B1** is a live cross-tenant data-integrity
hole in the single most-exercised booking tool, and **B2** means the
provisioning saga as shipped can publish an agent with no compiled
disclosure line, no tools, and no real prompt — a direct violation of the
one rule CLAUDE.md calls non-negotiable. Layered on top, **H1** (no real
retry/DLQ for outbound SMS/email) and **H2** (failover never actually
restores) mean two of the platform's own resilience guarantees (G4/G5-style
"never silently fail," "auto-restore on recovery") are currently no-ops.
None of these are hard to fix — each has a narrow, already-established
pattern elsewhere in the same codebase to copy — but none should ship as-is.
Fix B1/B2 before any real tenant traffic; fix H1/H2/H3 before relying on the
platform's own stated resilience/onboarding guarantees.
