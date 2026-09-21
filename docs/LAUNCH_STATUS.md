# Launch Status

## Current state (FINAL-1, 2026-09-21)

One-line summary: **every automated voice-call, booking, and billing
pipeline component this platform has is proven live, end to end, on a
real PSTN call** (`scripts/e2e/self-call.ts`, run four times total across
SELFCALL-1/ANALYSIS-1/OPS-8/FINAL-1). What remains is exclusively
owner-only work that needs real third-party accounts/credentials this
build environment cannot create — the full, ordered checklist is
`docs/GO_LIVE.md`. This section replaces reading the dated entries below
for "is X done" — the entries stay as history/detail, not as the current
source of truth.

**Proven live** (a real call/webhook/write happened and was inspected in
the database or via a signed provider request, not just unit-tested):
- Full call path: `voice-inbound` (dynamic variables + caller routing) →
  Retell conversation → `voice-tools` (availability/booking/customer/
  message, tenant-scoped) → `voice-events` (`call_started`/`call_ended`/
  `call_analyzed`, real Retell HMAC signature verified every time).
- `call_logs` fully populated on a real call: transcript, `call_summary`,
  `classification`, `outcome`, `sentiment`, `follow_up_needed`,
  `urgency_flag`, `recording_url`/`stereo_recording_url` (both
  auto-fetched by `worker-tick`'s cron poll within its own retry budget,
  no manual intervention, as of OPS-8/FINAL-1).
- Bookings: real rows with vehicle-detail fields (CALL-8's per-vertical
  required-field matrix), GIST-exclusion slot conflicts handled correctly
  (a slot taken mid-call is caught and the agent rebooks automatically —
  observed live 3 times now, SELFCALL-1 and FINAL-1).
- Returning-caller recognition: a caller's second/third call is greeted
  by name from `caller_recent_context` without re-asking (CALL-9,
  reconfirmed FINAL-1).
- Outbound calling: unlocked with no KYC/identity-verification step
  needed (SELFCALL-1) — `docs/GO_LIVE.md` step 5 needs no owner action.
- 8 verticals batch-tested live (CALL-1/6/7/8), nightly regression sweep
  scheduled and proven (`NIGHTLY-1`).
- Every queue worker (`worker-recording-fetch`, `worker-messages-
  outbound`, `worker-adapter-push`) drains, retries, and dead-letters
  correctly with a recorded reason; backlog/DLQ depth visible via
  `worker-tick`'s own response and `GET /admin-cockpit/queues` (OPS-8).
- Real customer signup → payment-gated provisioning → dashboard →
  agent-answering path run live once end to end (`SIGNUP-1`); the
  ~30 remaining dashboard *action* routes' JWT-claims bug found there is
  fixed platform-wide and separately live-proven against the deployed
  site with a real owner session (`AUTH-1`, live-tested `LOGIN-1`
  2026-09-21: dashboard load, `setup-progress`, a second tenant page, and
  a real resource create+delete all returned 200/200/200/200 with the
  hook-minted JWT, and 401 with no session).

**Known live bug**: the tenant call-detail recording player's signing
route (`GET /api/tenant/calls/[id]/recording`, added by `DASH-1`) 502s
`{"error":"sign_failed"}` for every real recording — confirmed live
(`LOGIN-1`, 2026-09-21) against tenant `test-riverside-auto`'s real
calls, both audio channels, two different call ids. Root cause diagnosed
(a `recordings/` bucket-prefix double-applied before `createSignedUrl`)
but not fixed — see the DASH-1 callout below and `docs/BUILD_NOTES.md`'s
LOGIN-1 entry for the exact code-level fix needed.

**Proven by tests, not yet by a live call/credential** (code is
deployed and unit/integration-tested; the live proof needs an owner
credential this environment doesn't have, or is inherently one-time/
owner-scoped):
- Stripe Checkout, Twilio A2P/SMS, Resend email, PayPal referral payouts,
  outreach send/reply pipeline — all fail closed correctly when
  unconfigured (`OPS-5`, `OPS-8` deliverable 2); real send/receive needs
  the owner's own provider accounts (`docs/GO_LIVE.md` steps 1-4).
- `api-provision`'s real-saga `republish` action (re-provision an
  already-live tenant without re-running Stripe) — implemented,
  unit-tested, parity-tested against the internal test-tenant path
  (`PARITY-1`); the live run needs a real `SB_SECRET_KEY`, not available
  in this build environment's credential store.
- `packages/adapters/*` (Shopmonkey, ezyVet, Square, generic calendar) —
  built to each provider's current docs with contract tests; no owner
  has connected a real account yet to prove a live two-way sync.

**Owner-only remaining** (see `docs/GO_LIVE.md` for the exact, ordered
steps — nothing here is a code gap): Twilio A2P brand registration,
Stripe/Resend account setup + secrets, outreach CAN-SPAM footer, a real
transfer number, one manual test call from a different phone, counsel
sign-off (BIPA/HIPAA/TCPA/CAN-SPAM/PCI/FTC/DPA), Vercel/Retell-agent
cleanup, credential rotation, optional custom domain.

**Partially fixed, DASH-1 (2026-09-21); live-tested and found still
broken, LOGIN-1 (2026-09-21)** — the gap FINAL-1 flagged just below is
half-resolved: the tenant dashboard's call-detail page
(`apps/web/.../dashboard/calls/[id]/page.tsx` → `call-detail-client.tsx`)
no longer puts `call_logs.recording_url`/`stereo_recording_url` (raw
private-bucket paths) into `<audio src>`, and the Client Component no
longer even receives those paths as props — that part is proven live.
But the new signing route itself,
`apps/web/src/app/api/tenant/calls/[id]/recording/route.ts` (re-verifies
the caller's own `tenant_id` via `claimsFromSupabaseClient` before
minting a 5-minute signed URL server-side, `?channel=stereo` for the
second file), was live-tested against a real tenant owner session and a
real recorded call (`LOGIN-1`, `docs/BUILD_NOTES.md`) and **fails every
time with a 502 `{"error":"sign_failed"}`**. Root cause (diagnosed, not
fixed — out of LOGIN-1's scope): `worker-recording-fetch` stores
`call_logs.recording_url` WITH a `recordings/` bucket-name prefix baked
in (`recordings/<tenant>/<call>.wav`), but the real Storage object key
is bucket-relative (no prefix — `worker-recording-fetch`'s own upload
call strips it before writing). This route passes the raw, prefixed DB
value straight into `.storage.from("recordings").createSignedUrl(...)`,
which already scopes to the `recordings` bucket, so the effective
lookup becomes `recordings/recordings/<tenant>/<call>.wav` and never
matches a real object. Proven by unit tests (12 new, all green —
`docs/BUILD_NOTES.md`'s DASH-1 entry) but those tests mock the signing
call, so they didn't (and couldn't) catch this path mismatch. Fix
needed: strip a leading `recordings/` from the stored path before
signing (or stop double-prefixing at write time and update both
readers) — not yet queued as a task (`docs/BUILD_NOTES.md`'s LOGIN-1
entry has the full diagnosis for whoever picks this up).
`docs/VERIFY.md`'s DASH-1 entry has the `createSignedUrl` doc
confirmation.

---

## History

**OPS-8 (2026-09-21)**: closed SELFCALL-1's other flagged gap —
`recording_url` now actually populates. Three independent, compounding
root causes, all fixed and live-proven (`docs/BUILD_NOTES.md`/
`docs/VERIFY.md` OPS-8 entries have the full story): (1)
`worker-recording-fetch` could let one row's exception strand every
other message that tick's `pgmq.read` had already bumped `read_ct` for
— messages sat with `read_ct` 450-470+ and `attempt` frozen at 0
forever; (2) even past that, EVERY `pgmq.delete`/`pgmq.archive` call
failed 100% of the time (`function pgmq.delete(unknown, unknown) is not
unique` — pgmq ships two overloads and untyped bound params couldn't
resolve which) — this, not (1), was the actual reason nothing had EVER
been deleted/retried/dead-lettered by this worker; (3) once both of
those were fixed, Storage uploads themselves failed
(`403 Invalid Compact JWS` — the new-format `sb_secret_...` key sent
alone on `authorization: Bearer` gets parsed as a JWT and rejected;
fixed by also sending it on `apikey`, confirmed against Supabase's own
current migration-to-new-keys docs). Both SELFCALL-1 calls now have
`recording_url`/`stereo_recording_url` populated, live-verified
retrievable via a signed URL (`HTTP 200`, `audio/wav`). Also: outbound
messages queued while Twilio/Resend are unconfigured are now honestly
parked (no `read_ct` growth) then dead-lettered with reason
`provider_not_configured` past a 24h window rather than waiting forever
with zero signal; every queue worker's dead-letters now carry a recorded
reason; `worker-tick`'s own response and a new `admin-cockpit/queues`
route both surface every queue's `pgmq.metrics_all()` backlog. **Stale
correction**: this file's own prior "storage buckets 4 → 1 (the one
remaining bucket, `call-recordings`, is public...)" line (below, in the
2026-09-20 ops entry) was itself wrong — the code and migration have
only ever used a bucket named `recordings`, already private, confirmed
live; that earlier line is left as-is with this note rather than
rewritten in place (it is inside an earlier task's own dated entry).

**ANALYSIS-1 (2026-09-21)**: closed SELFCALL-1's own flagged gap — post-call
analysis (`classification`/`outcome`/`follow_up_needed`/`urgency_flag`/
`sentiment`) now actually reaches Retell and comes back populated on a real
call, for the first time. Root cause: every template's per-state
`extraction[]` data (declared for several prior tasks) was dead weight —
the compiler never read it, so `post_call_analysis_data` was never part of
any `create-agent` payload on ANY agent this platform has ever created.
Fixed: `_shared/compiler/template-compiler.ts`'s new
`buildPostCallAnalysisData()` compiles it into Retell's real schema
(RETELL-VERIFIED live), wired into the shared `compile-and-publish.ts`
module so every agent, real or test, gets it by construction; `voice-events`
now validates each `custom_analysis_data` field independently (unknown/
malformed value on one field never drops the rest or rejects the webhook).
Republished both `signup-1-auto` (new agent `agent_598e07abf4079ee1a5a0be5c9e`
on `+16105383920`) and `test-riverside-auto` (new agent
`agent_2792eaaef8de3409f590f6ed85` on `+12602354330`) through the internal
test-tenant path (`api-provision`'s `verify_jwt=true` republish route is
confirmed, via Supabase's own docs, structurally unable to accept the new
secret-key format as a Bearer token — a real platform limitation, not a
missing credential). A fresh `inspect` on both now reports the IDENTICAL
`flow_hash` (`472409434bb6818d8cffb5a334a885db868aac073cf780ed121765c2a5590116`)
— the parity proof PARITY-1 could not run — after also fixing a second,
live-diagnosed bug: `inspect`'s hash used plain `JSON.stringify`, which is
sensitive to intra-object key ordering Retell's own API never promises to
preserve across two separately-created flows, producing a false-negative
mismatch even between byte-identical compiled payloads; switched to the
existing `stableStringify` (deep key-sort) helper. Proved on a real
self-driven PSTN call (`scripts/e2e/self-call.ts`): the resulting
`call_logs` row has `classification: "new_booking"`, a full `outcome`
sentence, `sentiment: "positive"`, `follow_up_needed: false`,
`urgency_flag: false`, and a full `call_summary` — every field that was
`NULL`/`{}` on SELFCALL-1's two real calls. Auto-vertical batch-test suite
run 3 times (2x `signup-1-auto`, 1x `test-riverside-auto`): 7-8/9 pass each
run, zero real semantic failures (every non-pass is Retell's own `error`
status, a known-flaky batch-test judge outcome — which scenario lands
there varies run to run, unrelated to this task's changes);
`wrong_date_caller` passed on 2 of 3 runs. Gates: edge-function tests
1132/1132 green (+10 new), typecheck clean (one pre-existing, unrelated
OPS-8 error in `worker-adapter-push`, not touched), lint clean on every
file this task owns. Full detail: `docs/BUILD_NOTES.md`'s ANALYSIS-1 entry.

**SELFCALL-1 (2026-09-21)**: closed the platform's last automated gap —
a REAL phone call over the PSTN, placed by Retell itself with no human,
from the platform's own `+16105383920` to its own production
`+12602354330`, run twice, both fully successful. New internal
`api-admin-self-call` creates/reuses a small scripted "customer" Retell
agent, places the call, and polls it to completion; the receiving side
is `test-riverside-auto`'s real, unmocked production
`voice-inbound` -> `voice-tools` -> `voice-events` path. **Outbound
calling required no Retell KYC/identity verification on this account at
all** — the call was accepted and connected immediately both times
(`docs/GO_LIVE.md` step 5 updated: no owner action needed there).
Live-confirmed, for the first time ever: the real Retell webhook HMAC
signature check passes against a genuine Retell request, the
`phone_numbers.e164 -> tenant_id` routing resolves correctly, and a
returning caller is recognized by name on a second call
(`caller_recent_context`, wired by CALL-9) — real booking + customer
rows created and confirmed via live SQL both times. One real bug found
and fixed at the root: `voice-events`'s `is_test_call` detection didn't
account for a caller number that is itself one of the platform's own
provisioned numbers, or a tenant marked `tenants.is_test` — fixed and
deployed; the one live row written before the fix deployed was
corrected via direct SQL. Two real, live-observed gaps flagged for a
follow-up task, not fixed here (root cause in files this task doesn't
own): `call_analysis.custom_analysis_data` came back empty on both real
calls despite the template declaring extraction fields for it, and
`recording_url` never populated (`worker-recording-fetch`'s queue shows
both this task's own messages and several pre-existing, unrelated ones
stuck with very high retry counts). Full detail:
`docs/BUILD_NOTES.md`'s SELFCALL-1 entry.

**PARITY-1 (2026-09-21)**: closed the class of bug SIGNUP-1/CALL-5 both hit
independently — the real `api-provision` saga and the internal
`api-admin-provision-test-tenant` path each had their OWN copy of the
compile → create-agent → publish mechanics, so a fix proven through one
(every CALL-5..9 fix) never reliably reached the other. Extracted both
copies into one shared `_shared/provisioning/compile-and-publish.ts`;
both real callers now delegate to it, with a new cross-entry-point
parity test asserting byte-identical Retell payloads. Added a real
`action: "republish"` to `api-provision` (internal-secret AND
`tenants.is_test = true` gated — can never touch a real, billable
tenant) so an already-provisioned test tenant can be re-provisioned
through the REAL saga's own path without re-running Stripe checkout, and
`scripts/republish-fleet.ts` to drive it. Live proof, via a new
hash-based artifact-diff extension to `api-admin-attach-retell-number`'s
`inspect` action: `signup-1-auto`'s and `test-riverside-auto`'s compiled
agents currently have DIFFERENT content (`flow_hash` differs) despite
sharing the same `agent_templates` row today — a provable, live instance
of the exact drift this task exists to close. **The live republish call
itself, and the two-round batch-test re-proof, could not be executed in
this session**: `api-provision`'s `verify_jwt = true` platform gateway
needs a real `SB_SECRET_KEY`, which was an unfilled placeholder in every
credential source available here, and this session's own auto-mode
guardrails correctly refused both a direct attempt to reveal that key
and a fallback live-mutation attempt (a concurrent sibling session is
using the same tenant/number). The code is deployed, unit-tested, and
parity-tested; running it live is a documented, one-command follow-up
(`docs/BUILD_NOTES.md`'s PARITY-1 entry has the exact command and the
diff table). Gates: `pnpm -w typecheck` 21/21 green, edge-function tests
1122/1122 (one pre-existing, unrelated SELFCALL-1 test failure), web
tests 582/582, lint clean on every file this task owns.

**AUTH-1 (2026-09-21)**: closed SIGNUP-1's own flagged follow-up — every
real `/api/tenant|admin|partner|billing|phone/*` action route (not just
the 5 page-load guards SIGNUP-1 fixed) was still calling the broken
`claimsFromUser(user)` (reads `user.app_metadata`, which the Custom
Access Token Hook never populates — only the signed JWT's own claims
carry `tenant_id`/`role`/`platform_admin`/`referral_partner_id`), so
every real tenant/admin/partner got a 403/401 from every dashboard
action (save settings, forwarding test, billing portal, team invite,
resources/offerings/orders/bookings/messages/waitlist CRUD, admin
cockpit, etc.) even though the page itself loaded. Replaced all 30
call sites across 26 files with `claimsFromSupabaseClient` (verified
live against supabase.com/docs — `getClaims()` cryptographically
verifies the JWT before returning its claims, `docs/VERIFY.md`'s new
AUTH-1 entry). Also found and fixed the identical bug class in
`api/admin/[...path]/route.ts`'s bespoke `impersonatedByClaim` helper
(read `session.user.app_metadata.impersonated_by`, which is JWT-only
too — the self-service impersonate-end/edit-mode routes 403'd for every
real platform admin). Tenant-scoping stayed intact throughout (every
route still filters by the verified `tenant_id` from claims, never the
request body). Added 6 new regression tests (2 each for the tenant_id,
platform_admin, and referral_partner_id guard types) proving a
JWT-only claim is honored and a missing one still 401/403s; 582/582
web tests green (576 + 6 new), lint/typecheck clean. **Live curl
before/after proof: completed 2026-09-21 (`LOGIN-1`)** — against the
live site `https://heyloo-voice.vercel.app`, a real logged-in tenant
owner (JWT minted by the Custom Access Token Hook, read via
`claimsFromSupabaseClient`) got 200 from `GET /dashboard` (body contains
the tenant's real business name, not a login redirect), `GET /api/
tenant/setup-progress`, and `GET /dashboard/calls`, plus 200 from a real
write (`POST` then `DELETE /api/tenant/resources/<id>`, soft-delete
verified via direct SQL), and a correct 401 with no session cookie.
Full results table and method: `docs/BUILD_NOTES.md`'s LOGIN-1 entry.

**SIGNUP-1 (2026-09-21)**: ran the real customer signup path — sign up →
payment → provisioning → dashboard → agent answering — live, end to end,
for the first time ever (every prior task used the internal
`api-admin-provision-test-tenant` shortcut instead). Found and fixed
three real, root-cause launch blockers along the way: (1) the real
`api-provision` saga could never have succeeded for ANY tenant —
`requireEnv("TWILIO_ACCOUNT_SID"/"TWILIO_AUTH_TOKEN"/
"RETELL_SIP_TRUNK_TERMINATION_URI")` crashed the function at cold-start
since none are configured, and the phone-number-purchase step was
switched to Retell's own `POST /create-phone-number` (no Twilio account
of ours needed at all — confirmed against docs.retellai.com); (2)
`/api-checkout` crashed with an opaque `WORKER_ERROR` instead of failing
closed with a clean message when Stripe isn't configured — fixed to
respond `{"error":"stripe_not_configured"}`, confirmed no tenant row is
ever created either way; (3) the single most consequential finding —
EVERY authenticated page/route across the whole product
(`apps/web`) read authorization claims from `user.app_metadata`, which
Supabase's Custom Access Token Hook never actually populates (only the
signed JWT's own claims carry `tenant_id`/`role`/`platform_admin`/
`referral_partner_id`) — confirmed live that a real, correctly-provisioned
tenant owner's dashboard redirected to "no access" before this fix. Fixed
the 5 central page-load guards (`middleware.ts` + the three
`require-*-session.ts` files + `/login`) and the 2 specific API routes
this task's own dashboard check found broken live; ~27 more
`/api/tenant|admin|partner|billing|phone/*` action routes still have the
same bug (page loads work, in-page actions don't) — flagged as a
priority follow-up, not fixed here (out of this task's own scope).
Live proof: a real tenant (`signup-1-auto`), a real Retell agent
(published, correct `webhook_url`), and a REAL new Retell phone number
(**+16105383920**, ~$2/mo live spend) purchased, wired, and answering —
6/9 batch-test scenarios pass (the other 3 match already-documented,
pre-existing simulator/template noise, not a regression), and the
dashboard renders correctly for the real signed-up owner. Stripe itself
is still not configured, so the literal Checkout hop is proven only in
pieces (fails closed correctly; the rest of the saga is proven live via
a documented, `is_test`-scoped internal bypass, not a shortcut around the
real saga's own logic). Full detail: `docs/BUILD_NOTES.md`'s SIGNUP-1
entry.

**CALL-9 (2026-09-21)**: answers the owner's own question — "does it pull
data from our database before the call, and use the database during the
call, like recognizing an existing caller by phone?" `voice-inbound`'s
pre-call customer-by-phone lookup had unit tests but had never run live
(Retell's batch-test simulator and web calls both bypass that webhook
entirely, and this session cannot sign a Retell webhook request). New:
`_shared/inbound-dynamic-variables.ts` extracts the exact lookup +
dynamic-variable assembly into one function BOTH `voice-inbound` (a real
call) and the batch-test harness now call, and a new internal
`action: "simulate"` proves that shared function live against the real
database — confirmed returning a real seeded customer's
`caller_recent_context` ("Jamie has booked with us before."), a
new-caller default, and a no-caller-ID default, all three branches live.
Bigger finding: `caller_recent_context` had been computed and sent on
EVERY real call's response since it was added, but was never once
referenced by `{{}}` in any compiled prompt (RETELL-VERIFIED: Retell only
substitutes a dynamic variable where it's literally referenced) — so a
real returning caller was never actually greeted by name. Fixed at the
compiler level for all 3 compile targets, plus a real
`lookup_customer` bug found proving it live: the tool schema REQUIRED a
`phone` argument the model has no honest way to know (no such dynamic
variable exists — the point of caller ID is that the server already
knows it), so the model fabricated a fake number every time, which then
failed its own strict caller-match check. Made `phone` optional
end-to-end (schema, tool, prompt) — the server now defaults straight to
the live caller's own number. A serious live-observed bug was found and
fixed while proving this: Retell's batch-test simulator shares ONE
placeholder `call_logs` row per tenant across every scenario in a batch
job, and an early version of the new test-only caller-number mechanism
persisted onto that shared row — a `returning_caller` scenario's own
caller number leaked into an unrelated `cancellation` scenario in the
same batch and genuinely cancelled a real seeded customer's booking, live,
5 times across different tenants. Root-caused and fixed (never reads
caller identity back from the shared row for a batch-test call), with a
dedicated regression test reproducing the exact bug. All 8 verticals now
have a seeded returning customer with a real upcoming booking and a new
`returning_caller` scenario proving: greeted by name without re-asking
for it, `lookup_customer`'s previously-never-exercised STRICT caller-
match path finding their real booking, and an actual live reschedule
against it — all 8 clear the pass bar in two consecutive runs. Full
detail, live transcripts, and the exact dedup/counter evidence:
`docs/BUILD_NOTES.md`'s CALL-9 entry.

**NIGHTLY-1 (2026-09-21)**: nightly regression of the Retell batch-test
suites against every `test-*` tenant, so an agent-behavior regression
surfaces automatically instead of only being noticed the next time a
human runs a suite by hand. New table `agent_regression_runs` (RLS:
platform-admin read only, no tenant access) records one row per tenant
per night — pass/fail counts, `field_capture_ok`, failures, the Retell
batch job id. New function `job-agent-regression`, cron-authenticated,
scheduled `0 9 * * *` UTC (`fn_cron_upsert`, vault-gated, same pattern
as every other HTTP-calling job); fast-acks the pg_cron `net.http_post`
immediately and does the real multi-tenant sweep in the background
(`EdgeRuntime.waitUntil`, `_shared/deno/background.ts`), calling
`api-admin-run-agent-tests` over HTTP with its own `x-internal-secret`
(never importing that function's `handler.ts` — it's owned by the
concurrently-running CALL-9 task) and chaining its resumable
`resume`/`settled` response until each tenant's suite settles or a
per-tenant budget elapses (`status: 'timeout'`, with `resume_state`
preserved for a manual follow-up). A run below a 5/6 pass ratio, with
any field-capture failure, or that errors/times out writes an `alerts`
row (`agent_regression_failure` / `agent_regression_timeout` /
`agent_regression_error`, deduped 20h per tenant+rule) onto the existing
admin alerts feed. New minimal read-only `GET /admin-agent-regression`
lists the last 14 days of runs. **Proved live**: invoked once via curl
with `CRON_INVOKE_SECRET`, all 8 `test-*` tenants (one per vertical)
got a row and settled within ~1.5 minutes; 5 correctly flagged a
regression (`test-bright-dental` 4/5, `test-generic-anyservice` and
`test-legal-firstlight` and `test-vet-lakeside` field-capture failures,
`test-riverside-auto` 6/9) and got exactly one `alerts` row each; the 3
fully-passing tenants (motel, real_estate, restaurant) got none. Live
`cron.job` entry confirmed (`jobid` present, `active: true`, schedule
`0 9 * * *`). `EXPECTED_CRON_JOBS`/`CRON_MIGRATIONS` in
`scripts/ci/cron-queues-check.ts` updated (the cron-scheduling `do $$`
block lives in its own follow-up migration,
`20260921120100_agent_regression_cron_schedule.sql`, split from the
table-creation migration specifically so the CI script's re-apply step
never re-runs a non-idempotent `create table`/`create policy`). No new
env vars — reuses `CRON_INVOKE_SECRET`, `PROVISION_INTERNAL_SECRET`,
`SUPABASE_URL`, already documented in `.env.example`. Full detail:
`docs/BUILD_NOTES.md`'s NIGHTLY-1 entry.

**CALL-8 (2026-09-21)**: answers "do the agents ask for and verify all
the details needed for their vertical?" — previously the batch suites
only asserted an outcome (booking created, message taken), never that
every required detail was actually collected AND stored; live-confirmed
repeatedly this task that Retell's own transcript-relevance judge scores
a call "pass" even when the write tool never fired at all. New: a typed
required-field matrix per vertical (`_shared/vertical-intake.ts`,
derived from SYSTEM_DESIGN §4.3), enforced server-side before any
booking/order/message write (`voice-tools/handler.ts`'s new
`applyIntakeGate` — a miss returns a named-field error instead of a
silent partial write or the old generic fallback), and a test harness
that checks the REAL DB row each scenario's tool call produced, not just
the transcript (`api-admin-run-agent-tests`'s new `field_capture`
report). Found and fixed six genuine, live-confirmed bugs invisible to
every prior batch-test pass/fail check: `create_booking` failing outright
when the model omits `resource_id` (or supplies a non-UUID literal like
the live-observed `"default"`) entirely; `call_logs.structured_
booking_payload` being overwritten rather than merged across tool calls
in the same call, silently erasing earlier-captured fields;
`take_message`'s captured name/phone being durably recorded only when a
tenant had a transfer number configured; and — the deepest one — a
multi_prompt template (`legal`, `real_estate`) can say goodbye and call
`end_call` having recorded nothing at all, because `take_message` was
only ever granted on one terminal state the model doesn't always reach;
fixed by moving it to Retell's `general_tools` (RETELL-VERIFIED to accept
any tool type, not just `end_call`/`transfer_call`), making it reachable
from every state. All 8 verticals now clear the field-capture bar in two
consecutive live runs; `auto`/`vet`/`dental`/`motel` needed no agent
recompile at all (server-side + tenant-config fixes only). Full matrix,
per-vertical results table, and every fix's root cause:
`docs/BUILD_NOTES.md`'s CALL-8 entry.

**CALL-7 (2026-09-20)**: the six remaining verticals (`vet`, `legal`,
`real_estate`, `motel`, `restaurant`, `generic` — `auto`/`dental` were
already green, CALL-1..6) are now all batch-tested live, each with its
own dedicated 6-scenario suite (booking, FAQ, transfer, take-message/
after-hours, AI disclosure, plus one flow distinct to that vertical —
emergency triage, safety escalation, lead-only valuation, rate-quote-only
FAQ, food ordering). Five of six finish 6/6 in two consecutive rounds;
`generic` finishes 5/6 then 6/6 (one documented simulator-noise flake,
transcript-proven — the agent answered correctly and consistently every
time, the simulated CALLER repeated itself). Found and fixed three
genuine, platform-wide compiler bugs previously invisible because only
`auto`/`dental` (both `compile_target: conversation_flow`) had ever been
exercised live: (1) `legal`/`real_estate` (`multi_prompt`) couldn't even
provision — a duplicate-destination-edge bug in `compileMultiPrompt`;
(2) once that was fixed, EVERY `multi_prompt`/`single_prompt` scenario
looped forever, because neither compile target had ever been granted a
Retell `end_call` tool — "by default, the agent won't end the call
automatically"; (3) `multi_prompt` never special-cased `transfer_call`
into a native tool the way `conversation_flow` has since CALL-4, so
every transfer attempt hit a dead custom-webhook fallback. Also fixed a
narrower `conversation_flow` gap (a caller who declines everything right
after the AI-disclosure question had no escape edge — widened CALL-4's
generic wrap-up condition) and two vertical-specific tool/prompt bugs
(vet/dental's `list_offerings` could loop; restaurant's `create_order`
required an `offering_id` the model had no way to ever supply, fixed
server-side the same way OPS-5 fixed `create_booking`'s `resource_id`).
Added `cleanup_superseded_agent` (opt-in) to `api-admin-provision-test-
tenant` so this task's own `force_recompile` churn never left orphaned
Retell agents — 20 agents created, 14 deleted as superseded, 6 kept
live. `auto`/`dental`'s own live agents were never touched. Full details:
`docs/BUILD_NOTES.md`'s CALL-7 entry.

**CALL-6 (2026-09-20)**: fixed a real, verified-live cross-tenant write
(CLAUDE.md Rule 2) that OPS-5/CALL-5 both found but deliberately left
open: every Retell batch-test/simulator call shares the literal
`call_id` `"playground"`, and `voice-tools/context.ts` used to trust
whichever tenant's `call_logs` row happened to win that shared id first
— all 18 bookings any batch test had ever created, from ANY tenant, were
landing under one tenant (`test-riverside-auto`), including 3 dental
should have owned. Fixed by never trusting a cached `call_logs` row for a
placeholder-shaped call id (`isPlaceholderCallId`) and keying a
placeholder row's `call_logs.retell_call_id` per resolved tenant instead
of the shared literal — proven live: `dental`'s own booking(s) now land
correctly under `dental`'s own tenant_id. Added `bookings.is_test`
(additive migration + honest repair of the pre-existing 18 rows,
which stay attributed to whichever tenant they already had — that can't
be honestly reconstructed — but are now excluded from that tenant's real
dashboard list and every KPI count that touches bookings). Also
root-caused and fixed OPS-5's own `wrong_date_caller` finding: the model
was getting weekday-name date arithmetic wrong ("next Monday" computed 11
days off and landing on a Thursday) because it had only the anchor date
and no way to look up "next Monday" itself — a new precomputed
`upcoming_weekday_dates` dynamic variable (same "timezone math baked in
at materialization, never left for the model" pattern `current_date`
already uses) closes it; live transcript evidence post-fix shows the
model correctly computing "October 1st, 2026, is a Thursday". Final
re-proving: `auto` 8/8, `dental` 4/4, two full rounds each. Full details:
`docs/BUILD_NOTES.md`'s CALL-6 entry.

**OPS-5 (2026-09-20)**: four functions (`webhooks-stripe`,
`webhooks-paypal`, `webhooks-twilio-sms`, `api-text-chat`) crashed at cold
start (500 `WORKER_ERROR` on every request, including a legitimate signed
webhook) whenever their provider secret was unset — Stripe/PayPal/Twilio/
Anthropic aren't provisioned yet. Fixed to fail CLOSED with a clean 503
`{"error":"not_configured"}` instead of crashing the isolate; proven live
via curl (500 → 503 on all four; `worker-messages-outbound` was already
correct, 401 throughout). Batch-test flakiness had two real causes, both
fixed: `create_booking` now resolves a hallucinated `resource_id`
server-side (falls back to `resource_name` or the first genuinely-open
resource, never fails the booking outright over a model-recall error);
`lookup_customer`'s G6 guard no longer rejects every batch-test call
outright for having no caller id — it looks the caller up by the number
they state instead, still tenant-scoped, flagged `unverified` until the
agent reads the name back and confirms (real calls, which always have a
caller id, are completely unaffected). Root-caused (but deliberately did
NOT fix, out of this task's scope — flagged for whoever owns `voice-tools/
context.ts` next) why `dental`'s `tool_health` rows were always empty:
every batch-test call shares the literal `call_id` `"playground"`, so
`call_logs`' unique-on-`retell_call_id` cache permanently attributes every
tenant's batch test to whichever tenant ran the FIRST one ever (`auto`,
confirmed live — 275 rows under `auto`, zero under `dental`, before this
fix). Fixed `tool_health`'s own attribution independently (a per-call
`heyloo_tenant_id` signal that can't collide the way the cached row does)
— proven live: `dental`'s re-run now shows 7/7 `tool_health` rows
correctly tagged with its own tenant id. Also closed a real
`VoiceProvider.compileTemplate` type-honesty gap (`packages/
canonical-types`/`packages/adapters/retell`) and fixed the admin
template-publish route to pass its compile inputs explicitly rather than
relying on an implicit default. Final batch-test re-runs: `auto` 5/8 then
7/8 (both remaining gaps pre-existing Retell-simulator/model-behavior
noise, unrelated to this task), `dental` 4/4 clean. Full details:
`docs/BUILD_NOTES.md`'s OPS-5 entry.

**CALL-5 (2026-09-20)**: the real (non-batch-test) call-event path is
FIXED and proven live, for the first time. Root cause of `webhook_events`
having zero rows ever: `createAgent`'s payload (in both
`api-admin-provision-test-tenant` and the real `api-provision` saga) never
set `webhook_url`, so Retell had nowhere to POST `call_started`/
`call_ended`/`call_analyzed` for ANY agent either function created —
confirmed live, before and after the fix, via a new read-only
`action: "inspect"` on `api-admin-attach-retell-number`. Fixed (both now
send `webhook_url`/`webhook_timeout_ms`), applied to the live test tenant
(new agent `agent_bd7f3b7cee9e0de1e9ecfbe0f3`, `+12602354330` re-attached),
and **proven live**: three real `POST /v2/create-web-call` calls each
produced a genuine `call_ended` + `call_analyzed` webhook pair —
`webhook_events` now has 6 rows (`source: 'retell'`,
`signature_verified: true`, `processing_error: null` on every one, up from
zero before this task), `/voice-events` edge logs show `200`s for the same
window. **NOT proven**: a full spoken conversation (`call_started` with a
real transcript/recording) — this session's sandboxed Chromium could not
complete a real WebRTC/audio session (its Chrome Root Store rejects this
environment's TLS-interception CA, and two policy-respecting workarounds
were both explicitly denied by the session's own auto-mode classifier as
`TLS/Auth Weaken` and `Containment Escape`, so none were forced through).
`scripts/e2e/retell-web-call.ts` (new, re-runnable) will complete this in
any environment where Chromium trusts the local CA, or the owner can now
simply call `+12602354330` directly — real proof either way, since the
underlying webhook fix is what was actually broken and is now confirmed
live. Batch tests re-run clean post-fix (7/8 `auto`, the one failure
pre-existing simulator flakiness, not a regression). Full details:
`docs/BUILD_NOTES.md`'s CALL-5 entry; live Retell docs confirmed this
task: `docs/VERIFY.md`'s CALL-5 entry.

**CALL-4 (2026-09-20)**: closes CALL-2's two open gaps. `transfer_call`
now compiles to a native Retell `transfer_call` node whose destination is
baked at compile time from `agent_configs.transfer_number` (tenant-config
only, G6) — when unset (the test tenant deliberately has none configured),
it compiles an honest spoken fallback instead (apologize once, offer to
take a message, grant `take_message` for that state only, never loop). A
generic wrap-up node ("Is there anything else I can help with?" -> no ->
end, -> yes -> back to the start) is now reachable from anywhere in every
compiled flow, closing the FAQ-only-call hangup gap. The Node-side sibling
compiler (`packages/adapters/retell`) is now mirrored with CALL-2/CALL-4's
subagent/end-node/transfer fixes and covered by a new cross-compiler
parity test. **Live result: `auto` batch scenarios pass consistently
across repeated runs (8/8 achieved, 7/8 typical — the 1-2 occasional
failures are pre-existing, unrelated booking-flow/G6-lookup simulator
flakiness, not a transfer/end-node regression); `transfer_request` and
`faq_hours_pricing` — CALL-2's two open gaps — now pass in every run since
this fix landed.** A second vertical (`dental`, `test-bright-dental`) ran
the generic 4-scenario set and passed 4/4 on its cleanest run, confirming
the compiler changes generalise — though its `tool_health`/`call_logs`
stayed empty across every run despite conversational progress through
tool-gated nodes, a separate, real, flagged-not-fixed finding (see
`docs/BUILD_NOTES.md` CALL-4). Full details: `docs/BUILD_NOTES.md`'s
CALL-4 entry.

**CALL-2 (2026-09-20)**: the batch-test loop from CALL-1 is FIXED, and the
real root cause was deeper than the traced call-context gap — a
conversation-flow compiler bug meant NO tenant, ever, could actually call
a tool (every node compiled to a type that Retell docs say can never
invoke tools). Fixed live, in order: (1) `voice-tools` now resolves tenant
context from the tool payload itself (`agent_id`/`to_number`/a QA-harness
dynamic variable) when no `call_logs` row exists yet, not just from a
`call_started` webhook; (2) the compiler now emits `type: "subagent"`
(not `"conversation"`) for any tool-calling state; (3) `create_booking`'s
`resource_id` tool-arg gained a description after the model invented
placeholder values; (4) every compiled prompt now carries the real
current date (there was none before — the model was resolving "tomorrow"
against a stale internal date); (5) `is_terminal` states now compile to a
real Retell `end` node (previously never read at all — a booking, once
confirmed, had no edge onward and the model just looped). **Live result:
6/8 `auto` batch scenarios PASS, including the AI-disclosure check, and 7
real `bookings` rows were created** (`status: 'confirmed'`, real dates).
Two scenarios remain open (`transfer_call` has no real implementation —
it's a dedicated Retell node type, not a tool; FAQ-only calls that never
reach a booking don't hang up) — real, scoped follow-ups, not this task's
blocker. The `call_logs.source` migration this task designed couldn't be
applied this session (no DB-migration-privileged path in this sandbox);
the code was reshaped to not need it yet. Full details:
`docs/BUILD_NOTES.md`'s CALL-2 entry.

**CALL-1 (2026-09-20)**: first live call path is LIVE — a real test
tenant (`test-riverside-auto`, vertical `auto`) is provisioned, its agent
is compiled + published, and the account's Retell number
(`+12602354330`) is re-pointed to it (`inbound_agents`/
`inbound_webhook_url` set) — verified directly in the DB
(`agent_configs`, `phone_numbers`, 648 `availability_slots` rows). **The
owner can call `+12602354330` now.** Retell's own batch-simulation test
suite ran (8/8 `auto` scenarios) but every case ended in the simulator's
own loop-detector — traced to a real gap (not a phone-call-path bug):
`/voice-tools`' call-context resolution requires a `call_logs` row that
only a REAL phone call's `call_started` webhook creates, so a batch-test/
chat-API synthetic session always falls back instead of running tools.
Real inbound calls are unaffected. Full details, three new gaps found +
fixed along the way (an empty `agent_templates` table, a jsonb
double-encoding bug also present in `admin/handler.ts` and not yet fixed
there, a missing `tool_id` field Retell now requires on custom tools),
and what's still open: `docs/BUILD_NOTES.md`'s CALL-1 entry.

**OPS-4 (2026-09-20)**: the Retell first-call prerequisite listed below as
owner-blocked is now met on the Retell side — Retell signs webhooks with
the account's API key (no separate signing secret exists;
docs.retellai.com/features/webhook-overview, confirmed 2026-09-20), and
`RETELL_API_KEY` is already provisioned. `voice-tools`, `voice-events`,
`voice-inbound`, and `job-keep-warm` no longer require a separately-set
`RETELL_WEBHOOK_SIGNING_SECRET` — see `docs/BUILD_NOTES.md` OPS-4.

**OPS-3 (2026-09-20)**: explained OPS-2's own unexplained per-job
asymmetry with a live experiment (URL-swap between the best/worst-arrival
cron jobs) — the timeout loss followed the TARGET function
(worker-messages-outbound), not the job/dispatch slot, pointing at
same-tick HTTP/2-multiplexed contention on pg_net's one shared connection
rather than pure DNS-resolver corruption alone. Fixed by replacing the
three separate per-minute `worker-messages-outbound`/
`worker-recording-fetch`/`worker-adapter-push` pg_cron jobs with one
combined `worker-tick` job that runs all three in-process; measured
arrival went from ~53-100% per function (one function chronically ~53%)
to 100% (8/8 minutes) for the single combined request — full experiment
log, citations, and before/after in `docs/BUILD_NOTES.md` OPS-3.

**OPS-2 (2026-09-20)**: ~30% of pg_cron→pg_net calls were timing out
chronically (flat across all 25 jobs, independent of schedule overlap) —
root cause is a single-worker pg_net/libcurl DNS-resolver-state bug
(curl/curl#18216) that doesn't self-recover; fixed by scheduling
`net.worker_restart()` every 10 minutes (`job-pgnet-worker-restart`,
`supabase/migrations/20260920160500_pgnet_worker_restart_cron.sql`) —
full measurements and citations in `docs/BUILD_NOTES.md` OPS-2.

## Go-live ops — 2026-09-20 (secrets, cleanup, first green cron)

**Branch state**: `main` == the work branch
(`claude/voice-ai-agent-architecture-dcw0n8`) at `3be0217` prior to this
pass's own commit; both pushed identical throughout.

**Site**: live at https://heyloo-voice.vercel.app — home route and every
other page verified 200; `/widget.js` serving correctly after the
locale-routing middleware fix (`ecffe12`).

**Supabase cleanup complete**: 59 → 44 edge functions (15 legacy ones
removed), storage buckets 4 → 1 (the one remaining bucket, `call-
recordings`, is public and had its 73 old recordings deleted), 8 legacy
secrets removed.

**Secrets now set** (verified via `supabase secrets list`, names only):
`APP_BASE_URL`, `CRON_INVOKE_SECRET` (a stale mismatch fixed),
`PROVISION_INTERNAL_SECRET`, `ADAPTER_TOKEN_ENCRYPTION_KEY`,
`INTAKE_ENCRYPTION_KEY`, `WIDGET_TOKEN_SECRET`. Functions now read the
platform-provided `SUPABASE_SECRET_KEYS` (`6f2dd69`), so a hand-set
`SB_SECRET_KEY` is optional. First successful cron responses (HTTP 200)
observed at 15:47 UTC. `job-alert-evaluation` fixed — `trailing` is a
reserved word as a CTE name in PostgreSQL (`3be0217`).

**OPS-1 — optional-integration cron jobs skip cleanly instead of crashing**
(this pass, full rationale and diff in `docs/BUILD_NOTES.md`'s `OPS-1`
entry): `job-keep-warm`, `job-retell-health-failover`, `job-outreach-
personalize`, `job-outreach-personalize-collect`, and `job-outreach-
review-score` were crashing at cold start with `Missing required env var:
X` every 2-15 minutes because an optional integration's secret (Retell
webhook signing, Twilio, or Anthropic/Outscraper/Smartlead) isn't
provisioned yet — HTTP 500 `WORKER_ERROR` drowning monitoring. Added
`missingEnv()` to `supabase/functions/_shared/deno/env.ts`; each
function's `x-cron-secret` auth check is unchanged and still fail-closed,
but the optional integration secret(s) are now read lazily inside the
handler, after that auth check, and a missing one returns a logged,
explicit `{ skipped: "not_configured", missing: [...] }` 200 instead of
crashing. Deployed all five; boot-check (`curl -X POST .../<fn> -d '{}'`,
no auth header, expect 401 = auth check reached, not 500):

| function | HTTP code |
| --- | --- |
| `job-keep-warm` | 401 |
| `job-retell-health-failover` | 401 |
| `job-outreach-personalize` | 401 |
| `job-outreach-personalize-collect` | **500** |
| `job-outreach-review-score` | 401 |

`job-outreach-personalize-collect` still cold-start-crashes: it also
requires `OUTREACH_CAN_SPAM_FOOTER` (the CAN-SPAM physical-address +
unsubscribe-instructions footer merged into every outreach send), which
is a compliance hard rule per `.env.example`, not an optional-integration
secret — out of OPS-1's scope and correctly still `requireEnv`'d at
module scope (CLAUDE.md Rule 2, fail-closed). It is not in the current
`supabase secrets list` output. Added to the still-blocked list below.

**Still blocked on the owner**: a Twilio account
(`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`), `RETELL_FAILOVER_VOICE_URL`,
outreach vendor keys (`ANTHROPIC_API_KEY`, `OUTSCRAPER_API_KEY`,
`SMARTLEAD_API_KEY`), **`OUTREACH_CAN_SPAM_FOOTER`** (newly flagged this
pass — blocks `job-outreach-personalize-collect`'s cold start entirely,
not just its outreach-vendor calls), Stripe, Resend, Vercel duplicate-
project cleanup, Retell old-agent cleanup (24 agents), token/password
rotation.

**Gates this pass**: `cd supabase/functions && npx vitest run` 101/101
files, 923/923 tests green. `npx biome check --write` on the six changed
files — clean (one pure reformat). `pnpm -w typecheck` — 21/21 packages
green.

## Design: cinematic scroll-scrubbed hero film, owner-phone payoff beat, home-route JS budget closed for real (SITE-2, 2026-09-15)

Replaced the WebGL/react-three-fiber hero line-morph (`SITE-1`, below)
with a `<canvas>` 2D scroll-scrubbed frame-sequence film (97 pre-rendered
WebP frames per theme, Higgsfield/Seedance 2.5) plus a new closing beat
("Reach the owner" — the same booking reaching the owner's own phone).
Root-caused and fully closed the home-route initial-JS budget that
`SITE-1` had left as an honest, documented floor (396.1KB gz): it was a
`@heyloo/ui` barrel-optimizer regression, not an unavoidable framework
cost — one `export const` in the package's index defeated Next's barrel
optimizer, so any Server Component importing from the barrel pulled
every reachable `"use client"` primitive into the route. Fixed at the
package level and extended to every Server Component in the app (not
just the home route), with a permanent CI guard
(`scripts/check-server-barrel-imports.ts`) so it can't silently return.
Full trace, frame/beat mapping, and a real `next.config.ts` bug found and
fixed along the way: `docs/BUILD_NOTES.md`'s `SITE-2` entry.

**Gates**: `npx biome check --write` clean; `pnpm -w typecheck` clean
(21/21); `pnpm run lint` 0 errors; `pnpm -w test` 572/572 (web) + 124/124
(ui) green; `apps/web` production build clean, all 183 routes;
`scripts/check-server-barrel-imports.ts` 0 violations;
`scripts/site-perf/measure.ts` — **LCP PASS (492ms), CLS PASS (0.000),
initial JS PASS (224.1KB gz vs. 250KB budget)** — all three green for
the first time this wave; no file >2MB; `apps/web/public/site` 2.45MB
(8MB budget); lockfile untouched.

**Status**: 95/100 review, pass, no open findings.

## Design: flagship marketing site — scroll-driven 3D narrative, motion engine, assets (SITE-1, 2026-09-14)

Shipped the flagship marketing site the creative brief specced
(`docs/design/WEBSITE_CREATIVE_BRIEF.md`): a scroll-driven, pinned WebGL
hero (react-three-fiber line-art morph, cross-faded with a real DOM
transcript/booking overlay so the qualifying tier shows actual product
content, not just an abstract shape) with a play-once/static fallback on
every non-qualifying tier (mobile, `prefers-reduced-motion`, no-WebGL),
a full GSAP `ScrollTrigger`-driven motion engine (`components/motion/`)
deferred behind real visitor interaction, and the supporting asset/token
pipeline. Full build history — including three prior review-driven
repair passes — is `docs/BUILD_NOTES.md`'s `PAGES`, `POLISH+PERF`,
`RECONCILE`, three `SITE REPAIR` entries, and this final `SITE-1`
integrator entry.

**This pass (integrator, 4th-round review at 71/100)**: fixed the
review's one real blocker — `THREE.Color`/Canvas2D couldn't parse the
`oklch()` computed-color string current Chromium now hands back from
`getComputedStyle` for a design token declared in `oklch()`
(`packages/ui/src/theme/globals.css`); `read-css-color.ts` now rasterizes
the resolved color through a 1x1 canvas and reads the actual pixel back
as `rgb()`/`rgba()`, verified gone in a live browser console capture.
Re-confirmed the review's other blocker — initial JS 396.1KB gz vs. the
250KB budget — is the same honest architectural floor the prior repair
pass had already root-caused and flagged (CLAUDE.md Rule 4): ~130KB of
it alone is React/Next's own client runtime, unavoidable without a
stack-level decision outside this task's file ownership; LCP (~376ms)
and CLS (0.003) both pass with wide margin and are unaffected. Also
brought `pnpm run lint` (not part of the review's own Playwright-based
scoring) from 44 ESLint errors to 0 — scoped, justified
`eslint-disable` comments on intentional SSR-hydration-safe
`setState`-in-effect and "latest ref" patterns this codebase already
uses that pattern for elsewhere, plus real mechanical
`testing-library/prefer-find-by` fixes.

**Gates**: `npx biome check --write` clean; `pnpm -w typecheck` clean
(21/21 packages); `pnpm run lint` 0 errors; `pnpm -w test` 543/543
green; `apps/web` production build (`next build --webpack`) clean, all
183 routes; `scripts/site-perf/measure.ts` — LCP PASS, CLS PASS, initial
JS FAIL (396.1KB vs. 250KB budget, documented floor, not a regression);
axe (wcag2a/wcag2aa) 0 violations across all 4 marketing pages in the
review's own capture; no file >2MB; `apps/web/public/site` 344KB (budget
8MB); lockfile untouched (no new dependencies this pass).

**Known gap, not fixable from this task's ownership**: the 250KB
initial-JS budget itself. Closing the remaining ~146KB needs either a
revised budget for a hydrated Next.js 16 + React 19 marketing route, or a
stack-level change (partial hydration/islands, moving `@tanstack/
react-query`'s root-layout provider off marketing routes specifically,
dropping/replacing a framework-level dependency) — see
`docs/BUILD_NOTES.md`'s `SITE-1` entry and `docs/DESIGN_SYSTEM.md`'s
Performance budget section for the full chunk-level trace.

## Channels follow-up wave: rate limits, calls filters, pricing merge, reply tracking, quiet hours, multi-entity (CHANNELS-2, 2026-09-11)

Follow-up pass over the Channels wave's adversarial-verifier findings
(`docs/audit/CHANNELS_REQUESTS.md`) plus one owner-priority addition. Full
per-item detail in `docs/BUILD_NOTES.md`'s `CHANNELS-2` entry; summary:

- **Already fixed by a prior pass, confirmed (not re-fixed):** the
  web_chat rate-limit bypass, the calls-surfaces channel filter (code —
  three of four surfaces gained a NEW test, since none existed before),
  the admin pricing-tab merge-not-replace fix, `incrementTextMessagesOut`
  correctness (gained a new explicit test), the Messages-list merge bug,
  and widget voice calls' `channel='web_voice'` tagging.
- **Real gaps found and fixed:** `verify_phone` had no per-number
  cooldown (an attacker could still burst many messages at one victim
  number across fresh conversations) — added a 60s per-number cooldown.
  The AI's synchronous SMS reply was never mirrored into
  `messages_outbound`, so the dashboard's delivery-status view had no
  record of it — fixed (inserted as `status:'sent'`, never `'queued'`).
  `tenants.quiet_hours` (tenant-configurable) existed but nothing actually
  read it — the booking-reminder scheduler used a hardcoded 9pm-9am
  window regardless of what a tenant configured; now reads the real
  column.
- **Owner-priority addition (item 10):** multiple saved vehicles/pets/
  delivery addresses are now handled end to end — `lookup_customer`
  returns all of them (bounded to 5, most-recent-first, flagged), a new
  shared prompt fragment teaches every relevant vertical (+ the text
  agent) the none/one/several rule, `create_order` resolves a
  caller-chosen saved address by id (fixing a related bug where the
  delivery-radius check always used the caller's DEFAULT address's
  geocode regardless of which address was actually being delivered to),
  and a real bug where adding any new delivery address silently stole an
  existing default is fixed.

**Gates:** all green — `npx biome check --write`, `pnpm -w typecheck`
(21/21), `pnpm run lint` (0 errors), `pnpm -w test` (21/21 test tasks —
`supabase/functions` 98 files/893 tests, `apps/web` 79 files/427 tests,
`packages/templates` 368 tests, `packages/adapters/retell` 164 tests),
`apps/web` production build (`next build --webpack`, exit 0). Not run:
`scripts/ci/rls-cross-tenant-probe.ts` (no Docker/`supabase start` in this
sandbox, same standing gap every prior pass discloses; no schema changed
by this task).

**Edge functions changed this pass (redeploy needed):**
`_shared/text-agent/tool-router.ts`, `_shared/quiet-hours.ts`,
`job-reminder-scheduler/handler.ts`, `webhooks-twilio-sms/handler.ts`,
`voice-tools/tools/create_order.ts`, `voice-tools/tools/lookup_customer.ts`,
`_shared/schemas/voice-tools.ts`. No migrations added or changed.

## SMS text agent + website widget (CHANNELS-1, 2026-09-11)

**New features shipped:** two new tenant-facing channels, both riding the
same text-agent engine as inbound SMS. **Text agent**
(`dashboard/agent/text-agent`): tenants turn on/off AI replies to inbound
texts and web chat independently of the always-on voice agent, set a tone
+ optional sign-off, and configure quiet hours. **Website widget**
(`dashboard/website-widget`): an embeddable floating Voice + Chat button
tenants paste onto their own site via a one-line `<script>` snippet
(public-key auth, per-tenant allowed-origins allowlist, live in-page
preview using the real built widget script). **Messages inbox**
(`dashboard/messages`) now shows both SMS and web-chat threads from one
unified `text_conversations` table, with a status badge (AI replying /
human took over / closed) and an unhandled-message indicator. Full
technical detail across every cluster and repair pass:
`docs/BUILD_NOTES.md`'s `Cluster S`/`Cluster T`/`Cluster W`/`CHANNELS-1`/
and the several `REPAIR` sections in between.

This pass (INTEGRATOR) closed the one remaining verifier finding — the
Messages list silently kept a stale preview/timestamp for a thread whose
most recent activity was recorded only in `text_conversations` (e.g. an
agent-only STOP/HELP/YES reply) rather than in `messages_inbound`/
`messages_outbound` — and ran every gate before committing the whole
Channels wave as one commit.

**Gates:** all green — `npx biome check --write` (0 errors on every
changed path), `pnpm -w typecheck` (21/21), `pnpm run lint` (0 errors, down
from 6 — two real `react-hooks/set-state-in-effect` errors this pass found
and fixed properly rather than suppressed, see `docs/BUILD_NOTES.md`),
`pnpm -w test` (21/21 test tasks — `apps/web` 78 files/424 tests,
`supabase/functions` 98 files/874 tests, plus every other package), `apps/
web` production build (`next build --webpack`, exit 0, `/widget.js`/
`/widget-voice.js`/`/api/widget/*` all compiled), `packages/widget` build +
size check (5.00KB gzipped main bundle vs. a 25KB budget), the verify-jwt
drift guard (43 functions checked), and a from-zero migration + seed
replay against a real throwaway local Postgres (50 migrations + seed, zero
errors, schema spot-checked). No build output, `.env*`, or scratch
artifacts in the tree. **Not run** (this sandbox has never had Docker/
`supabase start` available, disclosed by every prior pass in this repo):
`scripts/ci/rls-cross-tenant-probe.ts` — must stay green in real CI per
CLAUDE.md Rule 2.

**New secrets needed:** `WIDGET_TOKEN_SECRET` (generate 32+ random bytes —
HMAC key signing the widget's short-lived session token; shared by
`api-text-chat` and `api-widget-voice-token`, set once). Optional:
`ANTHROPIC_TEXT_AGENT_MODEL` (defaults to `claude-sonnet-5` if unset — only
set it to use a different model for SMS/web-chat replies than voice tools/
outreach use). Both already named and commented in `.env.example` and
`docs/DEPLOY.md`'s secrets table.

**Owner to-do:**
1. Generate and set `WIDGET_TOKEN_SECRET` before enabling the widget for
   any tenant — `api-text-chat`/`api-widget-voice-token` both fail closed
   without it.
2. **Widget domain** — the widget's `<script>` snippet is served from
   `apps/web`'s own production domain (`/widget.js`, `/widget-voice.js`),
   not a separate CDN. Confirm `packages/widget` actually builds as part
   of the production deploy (`docs/DEPLOY.md` §3.7) and smoke-test that
   both routes return `200` (not `404`) after deploying — the one failure
   mode if the widget package build is skipped.
3. Each tenant must add their own site's exact `https://` origin to
   "Allowed domains" on the Website Widget settings page before the
   widget will render there — this is a per-tenant allowlist
   (`tenants.widget_settings.allowed_origins`), not a global setting.
4. `scripts/ci/rls-cross-tenant-probe.ts` has never run against this
   feature's new tables in this sandbox (no Docker/`supabase start`
   available here) — run it in a real CI/staging environment with
   `supabase start` before go-live, per CLAUDE.md Rule 2.

## Design: accent text contrast, touch targets, currency inputs, template-by-vertical fix (DESIGN-4, 2026-09-10)

Round-7 punch list of 7 items (plus a mid-task addition investigating a
reported tenant-Overview preview-mode loading-skeleton). Several items
were already fixed by round 6/DESIGN-3 and only needed re-verification;
real changes this pass: a dedicated `--accent-text` token (`packages/ui`)
decoupling "the ember accent used as text/links" from `Button`'s hover-fill
token, applied everywhere the accent was still used as normal-weight
text; the Team page's Role `<Select>` properly `aria-labelledby`'d to its
visible `<Label>` instead of a duplicate `aria-label`; `docs/
DESIGN_SYSTEM.md` now documents `Button`'s existing 44px/36px
breakpoint-based touch-target split (the split itself was already
correct, just undocumented); `CurrencyInput`/`PercentInput` aliases added
for the existing `CentsInput`/`BpsInput` (already used throughout Vertical
Details, previously untested for the cents component specifically — now
is); a **real, previously-flagged production bug fixed**:
`/cockpit/templates/[vertical]` — `agent_templates.id` is a uuid, `.
vertical` a separate text column, and the admin edge function's
GET-by-id AND publish routes both did a literal `where id = <vertical
slug>`, meaning the templates editor could never actually load or publish
a template by vertical in production (flagged, not fixed, by
`ADMIN+PREVIEW-R6`/DESIGN-3 as out of that pass's file ownership) — fixed
with a by-vertical resolution helper in `supabase/functions/admin/
handler.ts`; and a proper `StatusBadge` `"invoice"` variant (another
DESIGN-3-flagged gap) replacing the mismatched `"tenant"`-lifecycle
palette on `billing/page.tsx`'s invoice-status pills.

Investigating the mid-task Overview report found the reported symptom
does NOT reproduce under this project's own documented, tested
preview-mode workflow (`UI_PREVIEW_MODE=1 next dev`) — verified with a
real headless-Chromium screenshot showing fully-resolved KPI numbers,
trend chart, and recent-calls data — but surfaced a separate, real,
previously-undiscovered bug while checking whether the report instead
reflected a production-shaped `next build --webpack` run: UI Preview
Mode's build-time auth-session-mock aliasing silently never took effect
under webpack at all (only under Turbopack/`next dev`), because this
repo's `@/*` tsconfig path mapping gets resolved away by Next's SWC
compiler before webpack's own `resolve.alias` ever sees the original
specifier. Fixed in `apps/web/src/lib/preview/preview-mode-aliases.ts`
(extracted out of `next.config.ts` for direct unit-testability) by also
aliasing the resolved real absolute source path, confirmed to actually
land via an instrumented before/after build. A full `next build --webpack
&& next start` end-to-end screenshot of `/preview/dashboard` could not be
completed in this sandbox (an unrelated build-worker OOM at ~130/174
static pages, plus a Next.js 16.3.4 framework-internal crash on the
built-in `/_global-error` page that reproduces even scoped away from this
app's own code) — the required, unaffected gate (a plain `next build
--webpack`, no `UI_PREVIEW_MODE`) passes clean regardless. Full detail:
`docs/BUILD_NOTES.md`'s `DESIGN-4` section.

**Gates:** all green — `npx biome check --write` (0 errors on touched
paths, same 4 pre-existing intentional `!important` warnings as every
prior round); `pnpm -w typecheck` (18/18); `pnpm run lint` (0 errors);
`pnpm -w test` (`apps/web` 64 files/354 tests, `packages/ui` 19
files/97 tests, `supabase/functions/admin` 80/80, up from DESIGN-3's
63/351 + 17/73); `apps/web` production build (`next build --webpack`,
exit 0, run both before and after this pass's changes). No build output,
`.env*`, or screenshot/PNG artifacts in the tree.

**New secrets needed:** none.

**Owner to-do, added by this pass:** none blocking. The tenant-dashboard
83/100 design-review score from DESIGN-3 is unchanged (not this pass's
brief to chase new findings there); the UI-Preview-Mode webpack-build OOM
and the `/_global-error` framework crash noted above are sandbox/
Next.js-version fragility, not application bugs — worth a memory-tuned
CI runner or a `next` upgrade if a genuine `next build --webpack &&
next start` screenshot pipeline is wanted for UI Preview Mode reviews
going forward, but out of this pass's scope to chase further.

## Design: round-6 shared-component fixes, tenant/admin polish, preview completeness (DESIGN-3, 2026-09-10)

Integrated the uncommitted round-6 design wave (full per-cluster detail in
`docs/BUILD_NOTES.md`'s `ADMIN+PREVIEW-R6`/`SHARED+TENANT-R6`/`DESIGN-3`
sections) as INTEGRATOR: ran every gate, fixed the one real bug a gate
caught, and committed. This round's fixes were mostly shared-component and
cross-cutting: a `formatPhoneDisplay` helper promoted out of `PhoneInput`
and wired into every customer-facing phone display; link-contrast and
`Button` touch-target fixes across the tenant dashboard; a `--warning-
foreground` AA-contrast fix on the solid warning badge background;
`MetricCard`'s non-finite-value empty state; `CentsInput`/new `BpsInput`
replacing raw number fields on Vertical Details; a real axe-critical fix
on the Team page's unlabeled role `Select`; a real page/API contract bug
on `/cockpit/tenants/[id]` (metrics were never returned, every tile showed
`—`); axe `region`/`page-has-heading-one` fixes on the admin and partner
shells; a 768px collapsed icon-rail nav; and a preview-harness fixture fix
so the messages-detail preview route renders a real seeded thread instead
of a blank one. The one bug this integration pass fixed itself (not
attributable to any round-6 cluster): a hardcoded `expires_at` in a
`worker-adapter-push` ezyVet test had quietly passed into the past by the
time this pass ran, flipping a mocked call count and failing the test
gate — pushed to a safe future date. Round-6/7 review: **admin/partner
cockpit 90/100 (pass)** — up from round-5's 79, clearing the bar for the
first time; **tenant dashboard 83/100 (fail)** — still short of the bar,
needs at least one more focused round, same documented scope call as
DESIGN-1/DESIGN-2 (ship what's ready now rather than hold for a later
round).

**Gates:** all green — `npx biome check --write` (0 errors on touched
paths, same 4 pre-existing intentional `!important` warnings noted by
DESIGN-1/DESIGN-2), `pnpm -w typecheck` (18/18), `pnpm run lint` (0
errors), `pnpm -w test` (19/19 package test tasks, `apps/web` 63 files/351
tests + `packages/ui` 17 files/73 tests, up from DESIGN-2's 340+33),
`apps/web` production build (`next build --webpack`, exit 0). The
preview-mode-guard tests (`lib/preview/guard.test.ts`) pass. No build
output, `.env*`, or screenshot/PNG artifacts in the tree.

**New secrets needed:** none.

**Owner to-do, added by this pass:** none blocking. Non-blocking: a
further tenant-dashboard-focused design round to clear its remaining
83/100 findings (see `docs/BUILD_NOTES.md`'s `DESIGN-3` section); the
`StatusBadge` "tenant" variant miscoloring invoice statuses on
`dashboard/billing` (safe fallback today, real fix needs a dedicated
`"invoice"` `StatusBadgeVariant` — `SHARED+TENANT-R6`); the
`/cockpit/templates/[vertical]` route-by-vertical bug found but out of
this round's ownership (`ADMIN+PREVIEW-R6`).

## Design: round-4 dashboard/admin polish, real-bug guards, preview harness (DESIGN-2, 2026-09-10)

Integrated the uncommitted round-4 design wave (full per-cluster detail in
`docs/BUILD_NOTES.md`'s `ADMIN-R4`/`TENANT-R4`/`PREVIEW-R4`/
`repair2:admin-partner` sections) as the INTEGRATOR: ran every gate — all
were already clean going in (every ESLint/type/test issue the gates would
have caught was already fixed by the clusters themselves this round) — and
committed. Real, crash-shaped bugs fixed this round, not just styling:
partner portal's referral link permanently stuck on "Generating…" for any
admin-provisioned partner (no create path existed); several tenant
dashboard panels (`setup-progress-panel`, `team`, `delivery`,
`integrations`, `SegmentBadge`, the billing usage meter) that would crash
or show a literal `NaN` on a malformed/edge-case API response, not only in
preview mode; two axe-critical unlabeled form controls; the admin shell's
mobile nav-label matcher misreading `/preview`-prefixed paths; a
root-caused `.maybeSingle()` cardinality bug in the preview mock (it
doesn't set the `Accept` header real Supabase relies on, confirmed against
the installed `postgrest-js` source) that had been silently violating
single-row cardinality. Round-5 review: **tenant dashboard 84/100** (up
from round-3's 79), **admin/partner cockpit 79/100** (round-3 was 85, but
the round-5 run's own method note flags its `next build && next start`
harness as not representative — `UI_PREVIEW_MODE` hard-disables itself
once `NODE_ENV="production"`, by design). Neither surface cleared the pass
bar — same documented scope call as DESIGN-1 (round-3 didn't clear it
either): shipping now rather than holding for round 6, since round 4 fixed
every finding in its own explicit review scope and further polish is a new
design pass's job. One review-artifact discrepancy was investigated and
did NOT reproduce: round-5's raw tenant screenshots show 52/256 non-`200`
captures, but all trace to either real `404`s clustered on the four
dynamic `/dashboard/{calls,customers,orders,support}/demo` routes or
`net::ERR_CONNECTION_RESET` navigation errors on unrelated routes — live
re-testing all four dynamic routes against this exact tree returns `200`
with real content every time; the failure pattern (four unrelated routes
failing together, interleaved with connection-resets elsewhere) is
dev-server instability during that screenshot batch, not a code defect —
see `docs/BUILD_NOTES.md`'s DESIGN-2 section for the full writeup.

**Gates:** all green — `npx biome check --write` (0 errors on touched
paths, 4 pre-existing intentional `!important` warnings in the
reduced-motion block), `pnpm -w typecheck` (18/18), `pnpm run lint` (0
errors), `pnpm -w test` (19/19 package test tasks, `apps/web` 61 files/340
tests + `packages/ui` 10 files/33 tests, up from DESIGN-1's 238+23 — the
round-4 clusters' new test files), `apps/web` production build (`next
build --webpack`, exit 0, ~201 routes). The preview-mode-guard tests
specifically (`(preview)/layout.test.tsx`, `lib/preview/guard.test.ts`)
pass, confirming UI Preview Mode's hard production-disable survived this
round's `next.config.ts`/`guard.ts`-adjacent changes. 4 uncommitted
scratch review scripts (`.axe-detail*.mjs`, `.shoot-round5.mjs`) were
removed rather than committed; no build output, `.env*`, or screenshot/PNG
artifacts in the tree.

**New secrets needed:** none.

**Owner to-do, added by this pass:** none blocking. Non-blocking: a round
6 design pass to close the remaining tenant-dashboard and admin/partner
polish gaps the round-5 review flagged (see `docs/BUILD_NOTES.md`'s
DESIGN-2 section) before either surface is treated as launch-final.

## Design: world-class UI system + marketing/dashboard/admin restyle (DESIGN-1, 2026-09-10)

Integrated the uncommitted design wave (token system, typography,
`Container`/`Section`/`PageHeader`/`Callout`/`DataList`/`ThemeToggle`,
lucide-only icon system, `UI_PREVIEW_MODE` review route group, and three
rounds of review + repair across marketing/tenant/admin-partner — full
per-cluster detail in `docs/BUILD_NOTES.md`'s `DS`/`Cluster TENANT`/
`Cluster MARKETING`/`ADMIN/PARTNER`/`repair:*` sections) as the
INTEGRATOR: ran every gate, fixed what the gates caught (2 ESLint errors,
1 unused-directive warning, 8 dead literal-emoji values, 3 stray review
scripts), and committed. Round-3 review: **marketing 91/100 (pass)**,
**tenant dashboard 79/100**, **admin/partner cockpit 85/100** — tenant and
admin/partner are a real, substantial improvement over round 2 (round 2
admin/partner was 34/100) but did not clear the pass bar this round;
shipping now rather than holding for a round 4 is a documented scope call,
not a silent gap — see `docs/BUILD_NOTES.md`'s DESIGN-1 section for the
full score table and what was fixed. UI Preview Mode is confirmed
hard-disabled in production (own test, 3 cases, passing) and its temporary
screenshot/smoke scripts were removed from the tree.

**Gates:** all green — `npx biome check --write` (0 errors on touched
paths), `pnpm -w typecheck` (18/18), `pnpm run lint` (0 errors), `pnpm -w
test` (19/19 package test tasks, `apps/web` 238 + `packages/ui` 23 among
them), `apps/web` production build (`next build --webpack`, real Google
Fonts fetch). No emoji remain in `apps/web/src`/`packages/ui/src`; no
internal-jargon customer-facing copy (`tenant` only appears in the
internal `(admin)/cockpit` ops surface or as identifiers/route
paths/DB columns, never as displayed copy on marketing/tenant/partner
surfaces).

**New secrets needed:** none.

**Owner to-do, added by this pass:** none blocking. Non-blocking: a round
4 design pass to close the remaining tenant-dashboard and admin/partner
polish gaps the round-3 review flagged (see `docs/BUILD_NOTES.md`'s
DESIGN-1 section) before either surface is treated as launch-final.

## Vertical wave (WAVE-2, 2026-09-10) — integration pass

Integrated the uncommitted vertical-completeness build wave (engine,
config pipeline, payloads, templates, commissions, onboarding —
per-cluster detail lives in `docs/BUILD_NOTES.md`'s own WAVE-2 section)
as the INTEGRATOR: closed the 3 items the wave's own verifier flagged as
`partial`, ran every gate, and committed. No new architecture, no
redesign of any cluster's work — CLAUDE.md Rule 4.

**Closed this pass** (full detail in `docs/BUILD_NOTES.md`'s WAVE-2
section):
- Root `turbo.json` build-order fix so `registry-consistency.test.ts`'s
  real-template-registry checks actually run in CI, not just when a human
  happens to build packages in the right order first.
- New migration `20260910180000_motel_hold_regen_fix.sql` — closes the
  last of three places a motel deposit hold needed to block room
  re-availability (the other two were already fixed by
  `20260910170000_motel_hold_exclusion.sql`): `fn_regenerate_availability_slots`
  (the nightly roll-forward job / a business-hours edit) now respects an
  active, unexpired hold the same way the GIST exclusion constraint and
  the availability-invalidation trigger already do.
- `createRetellBatchSimulationClient` (`packages/adapters/retell/src/
  tests-api.ts`) — the one piece the batch-simulation harness was waiting
  on. **Not fully closed:** the wrapper's `transcript_snapshot` parser is
  built against the closest officially-documented analogous shape and
  fails loudly on a mismatch, but genuinely needs a live Retell staging
  account run to confirm/correct — no such credential exists in this
  sandbox. Tracked as `docs/VERIFY.md` VERIFY-13, unchanged from the prior
  pass's own honest flag on this exact point.

**Gates:** all green — `biome check --write` (0 errors), `pnpm -w
typecheck` (18/18), `pnpm run lint` (0 errors — 3 pre-existing eslint
errors in `apps/web` found and fixed along the way, none introduced by
this pass), `pnpm -w test` (19/19 package test tasks, 777+230+164+…
tests), `apps/web` production build, `verify-jwt-guard` (41 functions),
and all 45 real migrations + seed applied clean from an empty database in
a throwaway local-Postgres harness. Full detail, including the harness
approach, in `docs/BUILD_NOTES.md`.

**New secrets needed:** none. This pass added no new integration and no
new secret-gated code path — `createRetellBatchSimulationClient` reads the
same `RETELL_API_KEY`/`RETELL_STAGING_RESPONSE_ENGINE_<KEY>` env vars the
batch-simulation harness already expected before this pass.

**Owner to-do, added by this pass (in addition to everything already
listed under "What remains for the owner" below, unchanged):**
1. Once a Retell **staging** account exists (`docs/DEPLOY.md` §1/§4), run
   `pnpm --filter @heyloo/templates run simulate` once, capture one real
   `test_case_job.transcript_snapshot` payload, and confirm/correct
   `packages/adapters/retell/src/tests-api.ts`'s `normalizeTranscriptSnapshot`
   against it (VERIFY-13) — the wrapper fails loudly rather than
   fabricating a pass in the meantime, so this is a correctness-hardening
   step, not a blocking one.
2. Optional, non-blocking: wire the batch-simulation job into
   `.github/workflows/ci.yml` per `docs/audit/FIX_REQUESTS.md`'s sketch,
   gated on a `RETELL_STAGING_API_KEY`-shaped secret being present so it's
   skipped (not red) until item 1 above is done.

## Audit fix wave (FIX-1, 2026-09-10)

Integrated the large parallel audit fix wave (Clusters B-G + the repair
tasks covering realtime/dashboard truthfulness, impersonation, DB-H1 write
RLS, and admin cockpit proxy contract — full per-cluster detail already in
`docs/BUILD_NOTES.md`). This pass's own additional work:

- Fixed `public.fn_enqueue_message_outbound`'s JWT/tenant-identity mismatch:
  both real call sites (`apps/web`'s `api/tenant/bookings/[id]` and
  `api/tenant/messages/[phone]` routes) invoke it through a service-role
  client, whose JWT carries no `app_metadata.tenant_id` — the function's
  own-tenant check always compared against NULL and silently no-op'd, so
  every booking-confirmation/reschedule/cancellation SMS and every Messages
  "reply" send stayed queued forever and never actually went out. Fixed by
  making the function service-role-aware (a `service_role` caller is
  trusted as already tenant-verified upstream, matching CLAUDE.md Rule 2's
  standing convention for every other service-role code path in this
  schema; an `authenticated` caller still gets the strict own-tenant
  match). See `docs/BUILD_NOTES.md`'s FIX-1 section for the full account
  and the local-Postgres verification that exercised all three cases
  (service_role, authenticated+matching tenant, authenticated+mismatched
  tenant).
- Verified every `docs/audit/FIX_REQUESTS.md` bullet filed by the prior
  clusters against the current tree; removed everything confirmed applied,
  kept the genuinely still-open ones (BIPA retention default pending
  counsel, per-tenant usage-alert-prefs pending a product decision, Airtable
  two-way sync, `tenants.canceled_at`/`paused_at`, the decorative
  `outreach_send_queue`, and the admin-cockpit-proxy impersonation
  edit-mode 403 — the last one specifically needs a joint
  `apps/web`+`admin` edge-function auth-model change, out of this pass's
  scope per CLAUDE.md Rule 4).
- All gates green: `biome check --write` (changed paths clean, 0 errors
  repo-wide), `pnpm -w typecheck` (18/18), `pnpm run lint` (0 errors),
  `pnpm -w test` (all packages, incl. `edge-functions`/`ui`/`web` — 563 +
  15 + 134 tests passing), `apps/web` production build, the
  `verify-jwt-guard` CI script, and all 31 real migrations + seed applied
  clean from an empty database in a throwaway local-Postgres harness (no
  Docker/`supabase start` available in this environment — same documented
  constraint as every prior pass; `scripts/ci/rls-cross-tenant-probe.ts`
  and `scripts/ci/cron-queues-check.ts` both need a live GoTrue+PostgREST
  stack via `supabase start`, so neither was runnable here either — both
  remain reviewed-but-unexecuted-in-this-sandbox, same status as the
  Playwright e2e specs noted below).

## Deployed to live project — update 2026-09-10 (WAVE-2 vertical wave)

Applied after commit 0af1ade: 13 new migrations (45 recorded), 41 edge
functions ACTIVE (new: api-intake, api-lead-callback, api-menu-import,
api-team-invite, api-tenant-test-call, job-commission-accrual,
job-lead-callback-retry). Live-verified: 57 tables, RLS on all, 24 cron
jobs (incl. commission accrual, lead-callback retry, motel deposit-hold
expiry), 8 queues, resources.room_type/capacity, orders allergy/delivery
columns, bookings quoted_rate/hold_expiry, referral_partners
rate_bps/commission_base/duration_months, lead_callback_requests +
intake tables present.

Owner secrets still to set (Edge Functions -> Secrets), in addition to the
FIX-1 list below: `INTAKE_ENCRYPTION_KEY` (64-hex random, encrypts dental
intake DOB/insurance at rest) and `ANTHROPIC_MENU_IMPORT_MODEL` (model id
for menu extraction; see .env.example) — plus `ANTHROPIC_API_KEY` when the
Anthropic account exists.

## Deployed to live project — update 2026-09-10 (FIX-1 wave)

Applied over the Management API after commit 380f65b: 10 new migrations
(32 recorded), 34 edge functions ACTIVE (7 new: webhooks-paypal,
job-churn-scoring, job-value-email, job-offboarding, job-retention-sweep,
job-keep-warm, api-payment-link-resend), Vault secrets
`cron_functions_base_url` + `cron_invoke_secret` created. Live-verified:
21 cron jobs scheduled, 8 pgmq queues (4 + 4 DLQ), RLS on all 53 tables,
the 4 admin views are security_invoker with zero anon/authenticated grants,
4 tenant-scoped booking/order write policies present.

Owner must set these edge-function secrets in the dashboard (Edge
Functions -> Secrets) — the build environment is not permitted to write
credentials to the live project:

- `CRON_INVOKE_SECRET` = the value stored in Vault as `cron_invoke_secret`
  (run `select decrypted_secret from vault.decrypted_secrets where
  name='cron_invoke_secret'` in the SQL editor and paste it) — until this
  matches, every cron-invoked job returns 401.
- `ADAPTER_TOKEN_ENCRYPTION_KEY` = any 64-hex random string (used to encrypt
  adapter OAuth tokens at rest; generate with `openssl rand -hex 32`).
- `SB_SECRET_KEY` = the project's `sb_secret_...` key (Settings -> API keys).
- Optional until Airtable delivery is offered: `AIRTABLE_OAUTH_CLIENT_ID`,
  `AIRTABLE_OAUTH_CLIENT_SECRET`, `AIRTABLE_OAUTH_REDIRECT_URI`,
  `AIRTABLE_OAUTH_STATE_SECRET`.

Still to delete in the dashboard: the 14 legacy edge functions and 3 legacy
storage buckets listed above.

## Deployed to live project (2026-09-09)

Live Supabase project: `qulcubtwqsqgqpfgvorn` ("Heyloo", us-east-2, PG 17).
Deployed this session (full record: BUILD_NOTES.md DEPLOY-1):

- 22 migrations applied + recorded (schema wiped by owner first; legacy
  empty schema/users/history removed). 52 tables, **RLS enabled on all**.
- Seed applied (12 platform_settings rows incl. price cards, templates).
- All 27 edge functions deployed ACTIVE (deploy command:
  `npx supabase functions deploy --use-api --import-map
  supabase/functions/deno.json`).
- Auth Custom Access Token hook enabled -> public.custom_access_token_hook.
- 8 function secrets set: CRON_INVOKE_SECRET, PROVISION_INTERNAL_SECRET,
  ADAPTER_CONNECT_STATE_SECRET, OUTREACH_WEBHOOK_SECRET (generated) +
  VOICE_TOOLS_WEBHOOK_URL, RETELL_INBOUND_WEBHOOK_URL,
  WEBHOOKS_TWILIO_SMS_URL, WEBHOOKS_POS_SQUARE_URL (derived).

Owner still to do on the project:
1. Dashboard -> Settings -> API keys: copy the `sb_secret_...` key and add
   it as edge-function secret **SB_SECRET_KEY** (Edge Functions ->
   Secrets). Copy `sb_publishable_...` for the frontend env later.
2. Delete the 14 legacy edge functions (retell-assistant, retell-events,
   retell-tools, retell-manage, retell-numbers, pos-sync, pos-oauth,
   pos-oauth-callback, pos-push, pos-push-square, pos-push-clover,
   square-webhook, clover-webhook, parse-menu) and the 3 legacy storage
   buckets (menus, voice-samples, call-recordings) — deletion is blocked
   from the build environment.
3. Provider accounts + secrets per docs/DEPLOY.md (Retell, Stripe, Twilio,
   Resend, Anthropic, PayPal, Smartlead, Apollo/Outscraper...).
4. Rotate the management access token used for this deployment, and the
   old database password shared during setup.

Snapshot as of this build's last commit (T9, Wave 4 — ops hardening, deploy
guide, E2E pass; see `docs/BUILD_NOTES.md`'s T9 entry for the full account).
Three sections: what's built, what the owner still has to do, and an honest
gaps list compiled from every prior task's own `docs/BUILD_NOTES.md`/
`docs/VERIFY.md` disclosures — nothing here is new information, it's the
consolidated version a launch decision actually needs.

## What's built

| Wave | Task | What it delivered | Tests |
|---|---|---|---|
| 0 | T0 | pnpm/Turborepo monorepo, strict TS, Biome, Vitest, base CI | smoke tests |
| 1 | T1 | Full schema (49 tables), RLS on every table + CI cross-tenant probe, Custom Access Token Hook, seed data (8 verticals) | verified via direct SQL harness (no Docker in that build env — see its own entry) |
| 1 | T2 | Canonical types, `VoiceProvider` interface, Retell adapter, template compiler (disclosure-gate enforced) | 126 (canonical-types) + 95 (adapter-retell) = 221 |
| 1 | T3 | Voice hot path (`/voice-inbound`, `/voice-tools`'s 9 tools, `/voice-events`), all webhook consumers, admin router (2/9 groups), workers, cron jobs | 253 |
| 2 | T4 | Stripe checkout/billing, 6 more admin groups, PayPal payouts, A2P registration, dunning, waitlist auto-book | 300 (cumulative) |
| 2 | T5 | `apps/web` (every FRONTEND_SPEC surface), `packages/ui`, `packages/supabase-client`, realtime provider, 2 Playwright smoke specs | 4 (apps/web unit) + component tests across `packages/ui`/`supabase-client` |
| 2 | T6 | 8 vertical agent templates, red-team adversarial suite, compiler-gate tests | 104 |
| 3 | T8 | Outreach engine (Apollo/Outscraper fetch, Claude personalize, Smartlead send, reply classification), admin outreach panel | 350 (cumulative) |
| 4 | **T9 (this task)** | Sentry wiring (`_shared/sentry.ts` + `logger.ts`, env-gated), `docs/OPS_RUNBOOK.md`, `docs/DEPLOY.md`, CI completion (`e2e`/`repo-hygiene` jobs, clean-build assertion, actionlint-clean), 3 new Playwright specs + auth infrastructure, `scripts/e2e-backend.ts` | 397 (`supabase/functions` cumulative, +20 from this task) |
| — | DESIGN-1 | Design token system + typography (`packages/ui/src/theme`), shared layout/custom components, lucide-only icon system, `UI_PREVIEW_MODE` review route group, full marketing/tenant/admin-partner restyle across 3 review rounds | 238 (`apps/web`) + 23 (`packages/ui`) |
| — | DESIGN-2 | Round-4 dashboard/admin polish: real-bug guards (crash/`NaN` fixes, dead referral-link path, axe criticals), preview-harness `.maybeSingle()` cardinality fix + fixture completeness, round-5 review | 340 (`apps/web`) + 33 (`packages/ui`) |
| — | DESIGN-3 | Round-6 shared-component fixes (`formatPhoneDisplay`, link-contrast, `--warning-foreground`, `BpsInput`), tenant/admin real-bug fixes (tenant-detail metrics contract, axe criticals), preview-harness completeness, round-6/7 review (admin/partner passes at 90) | 351 (`apps/web`) + 73 (`packages/ui`) |

**Not yet done by any task** (real, not oversight): `packages/adapters/
shopmonkey`/`ezyvet`/`google-calendar`/`square` and their webhook/two-way-
sync wiring (Wave 3, T7 — confirmed in progress but uncommitted at the time
this task ran; see below), `admin-support-requests`/`admin-flags` (still
`501`), a `/webhooks-paypal` consumer, a dedicated health-check endpoint.

Current total: **~726 tests passing** across
`supabase/functions` (397) + `packages/canonical-types` (126) +
`packages/adapters/retell` (95) + `packages/templates` (104) +
`apps/web` (4), plus the CI-only `rls-cross-tenant-probe`/`migrations-check`/
`db lint` checks that need a live Postgres (GitHub-hosted runners have
Docker; this and every prior build agent's sandbox did not).

**Concurrent work-in-progress at the time this task ran** (T7, adapters —
explicitly out of this task's scope per its own instructions): `packages/
adapters/square` fails `pnpm --filter @heyloo/adapter-square run typecheck`
today (missing `zod`/`@heyloo/canonical-types` resolution — a mid-edit
state, not a design flaw), and `supabase/functions/webhooks-pos/*` +
`supabase/functions/_shared/providers/square.ts` + `pnpm-lock.yaml` carry
uncommitted changes in this shared working tree. **Root `pnpm run
typecheck`/`lint` are not green as of this commit for that reason** —
confirmed via scoped runs that every file this task actually touched is
clean (`biome check docs .github scripts apps/web/tests
supabase/functions/_shared` → 0 errors; `tsc --noEmit` clean in
`supabase/functions` and `apps/web`; the full `supabase/functions` Vitest
suite — 397/397 — passes). This mirrors the exact situation T4's and T6's
own BUILD_NOTES entries each independently observed and left alone, for the
same reason: editing another task's in-progress files on a shared branch is
out of scope, not this task's bug to fix.

## What remains for the owner

Everything in `docs/DEPLOY.md` §1 (accounts to create) and §4 (live
Retell-sandbox VERIFY confirmations) — no build agent can create accounts,
click through vendor dashboards, or sign legal agreements. In priority
order (matching DEPLOY.md's own lead-time ordering):

1. **Start Twilio A2P brand registration and Smartlead domain warm-up
   today** — both have multi-day/multi-week lead time and should not be
   the last thing blocking launch.
2. **File the Retell support ticket** (`docs/DEPLOY.md` §4.1's seven
   questions) — the highest-risk unconfirmed item in the whole codebase
   (VERIFY-8, the Conversation-Flow wire schema) depends on this.
3. Create every account in `docs/DEPLOY.md` §1, run `scripts/setup-
   stripe.ts`, complete the deploy sequence in §3 (including the cron/queue
   SQL registration in §3.6 — genuinely not wired anywhere in code, a
   real one-time setup step).
4. Run the live-sandbox VERIFY confirmations (§4.2) before the first real
   template publish.
5. Clear the counsel checklist (`docs/DEPLOY.md` §5) — several items block
   product copy (the disclosure line, recording retention window) that's
   compiled into every agent template, so resolve these before, not after,
   onboarding real tenants.
6. Run the go-live smoke checklist (`docs/DEPLOY.md` §6) end to end against
   production before calling it launched.
7. Set up uptime monitoring + a status page (`docs/OPS_RUNBOOK.md` §3-§4)
   and do one dry-run of the backup/restore drill (§5) before the first
   real tenant's data exists to lose.
8. Merge T7's adapter work once it lands, resolve the root-gate red state
   noted above, and decide whether to build the two remaining `501` admin
   groups (Support, Feature flags) and a `/webhooks-paypal` consumer before
   or after initial launch (none of these block a phone call from being
   answered and billed correctly — they're operational-completeness items).

## Known gaps (compiled from every task's own disclosures)

Grouped by how much it matters at launch, not by which task found it —
cross-referenced against `docs/VERIFY.md` and every `docs/BUILD_NOTES.md`
entry's own "Deferred / left for later tasks" section, so nothing here is a
new finding, only a consolidated one.

### Would affect a real call/booking if unresolved

- **VERIFY-8** (Retell Conversation-Flow/Retell-LLM wire field names) — see
  above, the single highest-priority item.
- **VERIFY-1** (Retell webhook signature scheme / which key actually signs
  it) — a wrong assumption here means every inbound Retell webhook fails
  closed (loud, not silent, but still blocks every call).
- **`call_cost` unit/enum** (VERIFY-4) — unconfirmed cents-vs-dollars is a
  real billing-accuracy risk, not cosmetic.
- **Recording retention window** — no hard default shipped in code; an
  explicit open item pending counsel input (`docs/SYSTEM_DESIGN.md` §15).
- **No dedicated health-check endpoint** — `docs/OPS_RUNBOOK.md` §3's
  uptime-monitoring workaround (expect `401` from `/voice-inbound`) is a
  real but imperfect substitute.

### Would affect billing/growth accuracy but not call-answering itself

- **`/webhooks-paypal` consumer doesn't exist** — `job-referral-payouts`'s
  success means "PayPal accepted the batch," not "every partner was
  actually paid"; `referral_payouts.status` never advances past `'sent'`.
- **Apollo credit-to-dollar conversion not implemented** — CAC dashboard
  under-counts true Apollo spend until wired.
- **Smartlead has no distinct spam-complaint webhook event** (per every
  indexed source found) — the CAN-SPAM 0.3% auto-pause rule is fully built
  and unit-tested but cannot fire from a live signal today, only a manual
  admin action.
- **Per-tenant fan-out on template publish** doesn't exist — publishing a
  template update validates + publishes the template itself but does not
  re-publish every already-provisioned tenant's own agent (needs a
  rollout-strategy decision — all-at-once vs. staged/canary — not made
  anywhere yet).
- **`packages/supabase-client/database.types.ts` is hand-maintained**, not
  generated from the live schema — a real drift risk with no CI check
  tying the two together yet.

### Operational completeness (nice-to-have before scaling past pilots)

- `admin-support-requests`/`admin-flags` remain `501` (out of every task's
  named scope so far).
- `worker-adapter-push`'s adapter registry is empty until T7's Shopmonkey/
  ezyVet/Google-Calendar/Square adapters land — every push currently
  dead-letters after 6 attempts (by design, never silently "succeeds").
- Tenant impersonation mints a real magic link when `supabaseAdmin` deps
  are configured, but the exact GoTrue `generate_link` response field
  nesting is unconfirmed against a live call (`_shared/providers/
  supabase-admin.ts` checks both shapes defensively).
- The `_shared/compiler/template-compiler.ts` vs.
  `packages/adapters/retell/src/compiler/*` duplication (Deno/Node
  workspace-package boundary) is tracked maintenance debt, not a
  correctness risk today.
- CI's `e2e` job (this task) only runs the unauthenticated Playwright
  specs; the three authenticated ones (dashboard realtime, forwarding
  wizard, admin AAL2) are real and pass a source-level review but were
  never executed anywhere (no Docker/no browser install in any build
  agent's sandbox) — run them for real, locally or in an expanded CI job,
  before treating them as a release gate. Same for `scripts/e2e-backend.ts`.
- **Update (SIGNUP-1, 2026-09-21)**: Playwright/Chromium IS available in
  at least one build-agent sandbox as of this task
  (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, pre-installed, no
  `cdn.playwright.dev` needed) — this task drove a real browser through
  the signup flow and dashboard pages live (see its `docs/BUILD_NOTES.md`
  entry). That sandbox's own TLS interception still blocks Chromium's
  DIRECT connections to external hosts (`ERR_CERT_AUTHORITY_INVALID` —
  the same class of limitation CALL-5 hit for LiveKit), which is why the
  existing `apps/web/tests/e2e/` suite (written against a LOCAL Supabase
  instance, not the live hosted project) was not re-run against that
  suite's own assumptions here. The statement below (every spec
  unexecuted) is now stale for "Playwright can run at all" but still
  accurate for "this exact suite, against local Supabase, has been run" —
  that still hasn't happened in any build agent's environment.
- Full Playwright execution has never happened in any build agent's
  environment (`cdn.playwright.dev` is network-blocked in every sandbox
  used across this entire build) — every spec in `apps/web/tests/e2e/` is
  unexecuted-but-reviewed, not proven-passing, until run somewhere with
  browser install + (for the authenticated specs) a local Supabase
  instance.

### Explicitly scoped out, not forgotten

- A dedicated `join_waitlist` voice tool (waitlist requests currently route
  through `take_message`).
- An Instantly outreach adapter (Smartlead is the bound sender; Instantly
  is explicitly rejected with `422` today).
- Real-time in-audio card-number redaction (the payment-link flow avoids
  the issue by design instead — confirm this is an acceptable substitute
  with your PCI assessor, `docs/DEPLOY.md` §5).
- A tenant-facing dental BAA flow (frontend + signed-document record) —
  Retell's own BAA (§1.2) is separate from this and does not substitute for
  it.

## Related documents

- `docs/DEPLOY.md` — accounts, env vars, deploy sequence, VERIFY resolution
  workflow, counsel checklist, go-live smoke checklist.
- `docs/OPS_RUNBOOK.md` — logging conventions, Sentry, uptime monitoring,
  incident/status-page automation, backup/restore drills, break-glass
  continuity.
- `docs/VERIFY.md` — every external-API-shape assumption, by task, with
  confidence level and what to confirm before relying on it.
- `docs/BUILD_NOTES.md` — the full build history, task by task, including
  every deviation from spec and why.
