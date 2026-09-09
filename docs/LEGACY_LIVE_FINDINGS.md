# Legacy Live-DB Findings

Findings mined from the **live** legacy Supabase project
(`qulcubtwqsqgqpfgvorn`, read-only SQL over the Management API) and
compared against `legacy/` repo source and the new system's
`supabase/migrations/` + `docs/spec/BACKEND_SPEC.md`. Each finding: what
the live DB actually does, whether it matches the legacy repo, and a
verdict for the new system.

## Database

### Method

- Live `public` schema has 198 `pg_proc` entries, but 188 of them are
  `btree_gist` operator-class internals (`gbt_*`, `*_dist`) pulled in by
  the extension — not application logic. The actual custom application
  functions are exactly **10**: `create_appointment_reminder`,
  `get_admin_analytics`, `get_available_slots`,
  `get_business_overview_stats`, `get_business_stats`,
  `get_next_available_slot`, `log_phi_access`, `set_updated_at`,
  `update_customer_stats`, `update_customer_stats_on_delete`.
- 16 triggers, 0 views, 23 tables. Dumped full `pg_get_functiondef` /
  `pg_get_triggerdef` / `pg_get_constraintdef` / `pg_indexes` for all of
  the above plus every CHECK/EXCLUDE constraint and index on the 23
  tables.
- Cross-checked every one of the 10 function names and both
  `phi_audit_log`/`scheduled_notifications`/`scheduled_callbacks` table
  names against `legacy/` (migrations *and* app/edge-function code, `grep
  -rn`, case-sensitive and case-insensitive).

### Finding 1 — 8 of the 10 live functions exist ONLY in the live DB, never in the legacy repo (ADOPT the practice, not the code)

`legacy/supabase/migrations/20250214_initial_schema.sql` (the only
migration file that defines any function) defines exactly **one** of the
ten: `set_updated_at`. The other nine —
`create_appointment_reminder`, `get_admin_analytics`,
`get_available_slots`, `get_business_overview_stats`,
`get_business_stats`, `get_next_available_slot`, `log_phi_access`,
`update_customer_stats`, `update_customer_stats_on_delete` — do not
appear anywhere in `legacy/` (no migration, no edge function, no
dashboard code calling `.rpc(...)` on any of them). They were written
directly against the live database (SQL editor or an out-of-band
migration that was never committed) and are pure production drift.

**Verdict: this corroborates `docs/AUDIT_2026-09.md`'s account of why the
legacy repo was discarded** — the live schema and the committed schema
diverged, silently, on exactly the logic that mattered most (booking
availability, per-tenant stats, PHI audit). No code or SQL from these was
copied (per CLAUDE.md Rule 0/legacy policy); this is a process lesson,
already addressed by the new repo's structure: every function lives in
`supabase/migrations/20260907131400_functions_triggers.sql`, migrations
are the only path to prod (`docs/DEPLOY.md`), and there is no live project
yet to drift from. **No action needed beyond staying disciplined about
never hand-patching the live DB once it exists.**

### Finding 2 — `get_available_slots` hardcodes `America/Chicago` regardless of tenant location (ALREADY COVERED correctly in the new design)

```sql
v_tz TEXT := 'America/Chicago';
...
v_window_start := (p_date::TEXT || ' ' || v_rule.start_time::TEXT)::TIMESTAMP AT TIME ZONE v_tz;
```

Every business on the legacy platform — regardless of where it actually
operates — has its availability windows computed in Central time. This
is a real production bug class (a Pacific-time salon's 9am slot would
materialize as 9am Central = 7am Pacific, silently shifting all offered
times by up to 3 hours across the US). Nothing in the legacy schema
stores a per-business timezone at all — this hardcoding was the only
option available to whoever wrote the hotfix (see Finding 1).

**Verdict: ALREADY COVERED.** The new schema stores
`tenants.timezone` (IANA name, e.g. `America/New_York`,
`supabase/migrations/20260907130100_tenancy.sql`) and
`BACKEND_SPEC.md` §5/¶359 is explicit that slot-generation math is baked
in at materialization time from `tenants.timezone`, never computed at
request time. `fn_regenerate_availability_slots` (functions_triggers.sql)
takes the resource's tenant timezone, not a hardcoded literal. No change
needed — cite this as validation that the per-tenant-timezone design
decision was correct, and as a concrete example of the exact failure mode
it prevents.

### Finding 3 — the booking exclusion constraint blocks a *broader* set of statuses than the new schema's (verify the design decision is still right, once holds are used)

Live: `appointments_staff_member_id_time_range_excl` —
```sql
EXCLUDE USING gist (staff_member_id WITH =, time_range WITH &&)
  WHERE (status <> 'cancelled')
```
i.e. it blocks overlap for **every** status except `cancelled`
(`pending`, `confirmed`, `completed`, `no_show` all mutually exclude).

New: `bookings` (`supabase/migrations/20260907130600_booking_core.sql`,
mirrored in `BACKEND_SPEC.md` §3.4 line ~388) —
```sql
exclude using gist (resource_id with =, during with &&)
  where (status = 'confirmed')
```
i.e. it blocks overlap only when both rows are `confirmed`; a `scheduled`
booking never blocks anything (not even another `scheduled` booking).

**Verdict: ALREADY COVERED, but flag the assumption it rests on.**
`BACKEND_SPEC.md` §7.2.2 confirms `create_booking` inserts directly with
`status='confirmed'` — the `scheduled` status is currently a vestigial
enum value never written by any documented code path, so the narrower
predicate is safe today. But this is exactly the shape of gap the legacy
system's hotfix (Finding 1) suggests happens under real load: the day
`scheduled` (or a future `pending`/`hold`/`awaiting_deposit` status) is
actually used as an interim state — e.g. a payment-required flow that
holds a slot before confirming — two concurrent holds on the same
resource/time will NOT be caught by the exclusion constraint, silently
reproducing the double-booking bug this whole mechanism exists to
prevent. Recommend a one-line follow-up whenever any non-`confirmed`
status becomes a real, code-written interim booking state: widen the
predicate to `where (status not in ('cancelled', 'rescheduled'))` (or
equivalent), matching the legacy DB's broader, battle-tested predicate.
No migration change needed *now* — logged to `docs/BUILD_NOTES.md` as a
tripwire for whichever task first makes a tool call write
`status != 'confirmed'`.

### Finding 4 — legacy's `get_available_slots` enforces a turnaround/buffer gap between bookings; the new schema has no equivalent (ADOPT)

```sql
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_staff_member_id uuid, p_date date,
  p_duration_minutes integer DEFAULT 30,
  p_buffer_minutes integer DEFAULT 15,
  p_slot_increment integer DEFAULT 15)
...
  IF NOT EXISTS (
    SELECT 1 FROM appointments
    WHERE staff_member_id = p_staff_member_id
      AND status NOT IN ('cancelled')
      AND time_range && tstzrange(
        v_slot - (p_buffer_minutes * INTERVAL '1 minute'),
        v_slot_end + (p_buffer_minutes * INTERVAL '1 minute')
      )
  ) THEN ...
```

Every offered slot is checked against existing appointments **padded by a
15-minute buffer on each side** — a chair/room/bay/table cleanup or
turnaround gap, independent of the appointment's own duration. This is a
real vertical need (dental chair turnover, tattoo/salon cleanup, auto bay
turnaround) that a bare duration-only overlap check misses entirely: two
back-to-back bookings with zero gap would be "available" under a pure
overlap check but leave staff no time to reset.

**Verdict: ADOPT.** `resources.metadata` already carries a documented
override channel (`{"slot_minutes": <int>}` per
`booking_core.sql` comment on `resources.metadata`) but nothing carries a
buffer/turnaround minutes value, and `fn_regenerate_availability_slots`
(functions_triggers.sql) generates back-to-back slots with no gap
concept. Recommend: add an optional `buffer_minutes` key to the same
`resources.metadata` (or `offerings.metadata`) JSON, consumed by
`fn_regenerate_availability_slots` when materializing `availability_slots`
(pad the generated slot's occupied range, or skip slots within
`buffer_minutes` of an adjacent occupied slot) so the buffer is baked in
at precompute time — consistent with the "zero runtime arithmetic on the
hot path" design already documented for that function. Logged to
`docs/BUILD_NOTES.md`.

### Finding 5 — neither legacy nor the new schema enforces E.164 format at the database boundary (ADOPT a defense-in-depth CHECK)

Live: `businesses.phone_number` and `customers.phone_number` are bare
`text NOT NULL` with a `UNIQUE` index each but **no CHECK constraint** on
shape — normalization was entirely an application-layer concern, and nothing
in the 18 CHECK constraints on the live DB touches phone format.

New: same gap. `phone_numbers.e164`, `customers.phone_e164`,
`messages_inbound.from_e164/to_e164` are all bare `text not null` with
uniqueness constraints but no format CHECK anywhere in
`supabase/migrations/*.sql` (confirmed via grep across all migration
files).

**Verdict: ADOPT, as defense-in-depth.** CLAUDE.md Rule 2 already commits
to "Phones normalized to E.164 at every boundary" as an architecture
invariant; today that invariant is enforced only by application code
(Zod validators at the edge-function boundary, presumably). Legacy's
production history shows exactly what happens when an invariant like this
lives only in app code and the app code drifts (Finding 1). Recommend a
DB-level `CHECK (phone_e164 ~ '^\+[1-9]\d{1,14}$')` (and equivalent on
`phone_numbers.e164`, `messages_inbound.from_e164/to_e164`) as a second,
independent layer that fails loudly on any code path that forgets to
normalize before insert — cheap to add, catches a whole bug class for
free. Logged to `docs/BUILD_NOTES.md`.

### Finding 6 — legacy's per-customer stats are a brute-force `COUNT`/`SUM` recompute on every write; the new design already does incremental increments (ALREADY COVERED, new design is strictly better)

Live `update_customer_stats()` / `update_customer_stats_on_delete()`
(fired `AFTER INSERT OR UPDATE` / `AFTER DELETE` on every single
`transactions` row):
```sql
UPDATE customers SET
  total_transactions = (SELECT COUNT(*) FROM transactions WHERE customer_id = NEW.customer_id),
  total_spent = (SELECT COALESCE(SUM(total), 0) FROM transactions WHERE customer_id = NEW.customer_id)
WHERE id = NEW.customer_id;
```
This re-scans the customer's entire transaction history on every single
order write — O(n) per write, O(n²) over a customer's lifetime, and a
trigger every business.

**Verdict: ALREADY COVERED, and better.** The new schema's equivalent
trigger (`functions_triggers.sql` ~line 462) does true incremental
increments — `lifetime_calls = lifetime_calls + 1`,
`lifetime_bookings = lifetime_bookings + 1`,
`lifetime_value_cents = lifetime_value_cents + new total_cents` — O(1)
per write, no re-scan. No change needed; flagging only as confirmation
the new design already avoids a real legacy perf footgun (worth keeping
in mind if a future migration is ever tempted to "simplify" back to a
recompute-from-source pattern for correctness's sake — don't, without an
async reconciliation job as a backstop instead).

### Finding 7 — legacy schedules appointment reminders via an `AFTER INSERT` trigger creating a queue row; the new design uses an hourly cron scan instead (ALREADY COVERED, different mechanism, note the tradeoff)

Live `create_appointment_reminder()` fires `AFTER INSERT ON appointments`
and, only if `NEW.status = 'confirmed'`, inserts one
`scheduled_notifications` row with `scheduled_for = lower(time_range) -
INTERVAL '24 hours'`. A separate (not found in this DB — likely an edge
function/cron not covered by `pg_proc`) worker must poll
`scheduled_notifications WHERE status='pending' AND scheduled_for <=
now()`. Weakness of this pattern: if the appointment is later
rescheduled, the precomputed `scheduled_for` on the existing
notification row goes stale unless something explicitly updates or
regenerates it — no trigger here handles `UPDATE OF time_range`.

New: no `scheduled_notifications`-equivalent table; instead
`docs/spec/MASTER_SPEC.md` §"reminder-scheduler" describes an **hourly
job that scans `bookings` directly** for rows at T-24h (config per
vertical) and enqueues into `messages_outbound` / a Retell outbound-call
batch at query time.

**Verdict: ALREADY COVERED, and the new mechanism is structurally
immune to the staleness bug above** — since the scheduler reads
`bookings.start_at` live every run rather than a value precomputed at
INSERT time, a reschedule is automatically picked up with no extra
trigger needed. No change needed; noting this only so a future
implementer of the reminder-scheduler doesn't accidentally introduce
the precompute pattern (e.g. "for efficiency, let's snapshot the next
24h of reminders into a table once a day") without also handling booking
updates/cancellations against that snapshot.

### Finding 8 — legacy's admin/business dashboards are single aggregating RPCs (`SECURITY DEFINER` JSONB blobs); note for the new cockpit's read path (informational, no migration change)

`get_admin_analytics(range_start)`, `get_business_overview_stats
(p_business_id)`, and `get_business_stats()` are each one
`SECURITY DEFINER` function returning a single JSONB object (or table)
combining calls, revenue, customer counts, and a small "recent activity"
slice — one round trip for an entire dashboard load, with the
`retell_per_min` billing rate read once from `platform_settings` and
applied uniformly. The new system's `cost_events`/`usage_events`/
`usage_daily`/`revenue_events`/`billing_invoices` split
(`money.sql`) is far more granular and auditable (event-sourced, correct
per-tenant billing history, no periodic full-table aggregation) — a
strict improvement for billing correctness. **This is not a
"live DB does it better" case**; noting it only so whichever task builds
the platform-admin cockpit's read queries considers precomputing (a
`usage_daily`-driven materialized view, or a single aggregating RPC over
already-granular tables) rather than having the dashboard fire N separate
queries per page load — the *shape* worth salvaging from legacy is "one
round trip per dashboard load," not the underlying billing math.

### Finding 9 — `log_phi_access` / `phi_audit_log` / `medical_alerts` / `insurance_profiles` / `accepted_carriers`: a working PHI-audit pattern for the (not-yet-built) dental/HIPAA vertical (ADOPT, deferred)

Live has a full HIPAA-flavored audit trail: `log_phi_access(action,
resource_type, resource_id, customer_id, business_id, details)` is a
`SECURITY DEFINER` function that inserts one row into `phi_audit_log`
per PHI touch, capturing `auth.uid()` (the acting user) automatically;
supporting tables `medical_alerts` (allergy/medication/condition/
premedication, with a `severity` CHECK), `insurance_profiles` (one
`is_primary` per customer via a `UNIQUE (customer_id, is_primary)`
index — note: this quirk actually caps a customer at exactly 2 insurance
rows total, since `is_primary` is boolean; a real multi-secondary-
insurance case would need a partial unique index
`WHERE is_primary` instead), and `accepted_carriers` (which insurance
carriers a business accepts) round out a dental/medical vertical data
model that isn't in the legacy repo's migrations either (same
live-only-drift pattern as Finding 1) but clearly ran in production.

**Verdict: ADOPT, but deferred** — per `docs/MASTER_PLAN.md`
(dental is Phase 4 / Wave 3, gated on signing a Retell BAA) and
`docs/VERTICAL_RESEARCH.md` ("HIPAA posture needed only when
dental/medical launches"), this vertical is not in scope for the current
build waves. No migration change now. When the dental/HIPAA wave starts:
reuse the *pattern* (a `SECURITY DEFINER` `log_phi_access`-style helper
called from every tool/handler that reads or writes a PHI-bearing table,
writing to a dedicated append-only audit table with RLS locked to
platform admins) but fix the `insurance_profiles` uniqueness quirk
(`UNIQUE (customer_id, is_primary)` → partial unique index
`ON insurance_profiles (customer_id) WHERE is_primary`) rather than
copying it as-is.

### Finding 10 — `voice_clones` table exists live, unreferenced in either the legacy repo or the current new-system spec (informational)

`voice_clones` (indexed by `business_id`) exists on the live DB with no
matching code anywhere in `legacy/` and no equivalent in the new spec's
docs. Likely an experimental/abandoned feature (custom voice cloning per
tenant) that shipped a table but no finished feature. No action —
flagging only in case a future task encounters a stray reference to
"voice clone" in old support tickets/docs and needs context that this
was a live-only, code-orphaned table in the legacy system.

### Summary table

| # | Legacy live-DB behavior | Legacy repo match? | Verdict |
|---|---|---|---|
| 1 | 9/10 custom functions never committed to `legacy/` | No (live-only drift) | Process lesson only — corroborates AUDIT_2026-09; no code adopted |
| 2 | `get_available_slots` hardcodes `America/Chicago` | N/A (live-only) | ALREADY COVERED — new schema uses per-tenant `tenants.timezone` |
| 3 | Exclusion constraint blocks all non-`cancelled` statuses | N/A (live-only) | ALREADY COVERED today; tripwire logged for when non-`confirmed` interim statuses start being written |
| 4 | 15-min buffer/turnaround padding in slot search | N/A (live-only) | ADOPT — add `buffer_minutes` to resource/offering metadata, consumed by `fn_regenerate_availability_slots` |
| 5 | No DB-level E.164 format CHECK (either system) | Same gap in both | ADOPT — add CHECK constraints as defense-in-depth |
| 6 | Per-write full recompute of customer stats | N/A (live-only) | ALREADY COVERED — new incremental-increment trigger is strictly better |
| 7 | Trigger-precomputed reminder rows (staleness risk on reschedule) | N/A (live-only) | ALREADY COVERED — new hourly-scan design avoids the staleness bug structurally |
| 8 | Single aggregating RPC per dashboard load | N/A (live-only) | Informational — keep the "one round trip" shape when building the admin cockpit's read queries |
| 9 | Working PHI-audit-log pattern + insurance/medical tables | No (live-only) | ADOPT, deferred to the dental/HIPAA wave; fix the `is_primary` uniqueness quirk when adopted |
| 10 | Orphaned `voice_clones` table | No (live-only) | Informational only, no action |

## Edge Functions

Findings mined from the **live deployed source** of the legacy Supabase
project's 14 edge functions (Management API `/functions/<slug>/body`,
read-only), fetched as `ESZIP2.3` bundles and recovered to source text via
`strings` extraction (no `deno`/`eszip` CLI available in this
environment; verified reliable because eszip v2 stores each module's raw
UTF-8 source as one contiguous byte run — `strings` reconstructs it
line-by-line faithfully, only dropping blank/very-short lines). Bundles
fetched: `retell-events`, `retell-tools`, `retell-assistant`,
`retell-manage`, `square-webhook`, `pos-push-square`, `retell-numbers`,
`clover-webhook`, `pos-sync` (9 of 14 — the remaining 5 `pos-oauth*`/
`pos-push`/`pos-push-clover`/`parse-menu` were not pulled, lower priority
per task order and not needed for the findings below). Local copies:
`/tmp/claude-0/-home-user-Heyloo/e911cd24-2831-5e08-8f6e-43e25e74e180/scratchpad/live-functions/*.strings.txt`
(session scratchpad — not part of the repo).

**Zero overlap with the committed `legacy/` repo.** `legacy/supabase/functions/`
has no `retell-*` functions at all — only `vapi-assistant`, `vapi-tools`,
`vapi-events`, `vapi-backfill` (a prior voice provider). The live project's
`retell-*` functions (assistant v76, manage v60, tools v50, events v36)
are a complete, never-committed rewrite/migration done directly against
production. Every finding below is therefore live-vs-new-system only;
there is no legacy-repo diff to show because the repo predates the
Retell migration entirely. This is itself the single clearest
confirmation of AUDIT_2026-09's reason for discarding `legacy/` outright.

### VERIFY-2 (inbound call webhook) — evidence found, recommend marking CONTRADICTED / needs fix

`retell-assistant/index.ts` (the live function handling Retell's inbound-call
webhook across 76 production redeploys) branches on:

```js
if (payload.event === "call_inbound" && payload.call_inbound) {
  const { from_number, to_number } = payload.call_inbound;
  ...
```

and its success/fallback responses are both shaped `{ call_inbound: { override_agent_id?, dynamic_variables: {...} } }`.
This means the REQUEST envelope Retell actually sends is
`{event: "call_inbound", call_inbound: {from_number, to_number, ...}}` —
nested under an `event`/`call_inbound` wrapper, NOT the flat
`{call_id, from_number, to_number, agent_id?}` body VERIFY-2 assumed. The
RESPONSE envelope (`{call_inbound: {override_agent_id?, dynamic_variables}}`)
already matches the new system exactly — that half needs no change.

**CONTRADICTS-NEW-CODE:**
- `supabase/functions/_shared/schemas/voice-inbound.ts:11-17`
  (`VoiceInboundRequestSchema` — requires flat top-level `call_id`,
  `from_number`, `to_number`; `.passthrough()` does not help because
  those fields are *required*, not just strictly-typed-if-present). If
  Retell really sends the wrapped shape, every real inbound call to
  `/voice-inbound` would fail Zod validation and return 400
  `invalid_request` — this is a hot-path-breaking bug, not a cosmetic one.
- `packages/adapters/retell/src/raw-types.ts:31-36`
  (`zRetellInboundCallWebhook` — same flat assumption; only consumed by
  `packages/adapters/retell/src/inbound.ts`, not by the actual deployed
  `voice-inbound` function, but should still be fixed for consistency and
  because it's presumably what admin/testing tooling exercises).

**Caveat on confidence:** this is inferred from production code that
*processed real traffic successfully* for months, not from a captured raw
webhook body — slightly weaker than a direct capture, but far stronger
than a docs snippet: code this specific (`payload.event === "call_inbound"
&& payload.call_inbound`, destructuring `from_number`/`to_number` from
the nested object, never from a top-level field) would not survive
production for 76 versions if the shape were wrong. Recommend treating
VERIFY-2 as **resolved-pending-one-live-confirmation-call** rather than
fully closed — a single staging test call remains the cheapest way to
remove all doubt, per VERIFY.md's own standing recommendation.

### VERIFY-3 (tool-call webhook envelope) — RESOLVED, matches new code exactly

`retell-tools/index.ts` (live, v50) does:

```js
const payload = await req.json();
const { args: parameters, name: function_name } = payload;
...
const call_id = payload.call?.call_id;
const from_number = payload.call?.from_number;
```

This is a byte-for-byte confirmation of the new adapter's assumption:
flat top-level `name` + `args`, `call` as a nested object carrying
`call_id` and `from_number`. It directly confirms both open sub-questions
VERIFY-3 flagged:
1. The envelope is `{name, args, call: {call_id, from_number, to_number, ...}}`
   — matches `packages/adapters/retell/src/raw-types.ts`'s
   `zRetellToolCallWebhook` and `tool-call.ts:47-63`
   (`toCanonicalToolCallRequest`) exactly.
2. The caller's live number IS exposed under `call.from_number` — matches
   `tool-call.ts:72-75`'s `extractCallerNumber` exactly (the function's own
   comment already guessed this correctly; now confirmed by production
   code, not just the SDK's partial corroboration VERIFY-3 already had).

**Verdict: ALREADY COVERED.** No code change needed. Recommend updating
`docs/VERIFY.md`'s VERIFY-3 entry to cite this live evidence (done below).

### Retell webhook signature verification — production evidence, IGNORE the legacy scheme, confirms new approach

Both `retell-events` and `retell-assistant` (live) implement signature
verification as: re-stringify the parsed body
(`JSON.stringify(JSON.parse(rawBody))`, NOT the raw body bytes as
received), HMAC-SHA256 with the plain API key as secret, hex digest, no
timestamp/replay component at all (no `v=...,d=...` scheme). **And then
neither one enforces it** — both have the exact same commented-out
`return 401` with a `// TODO: Re-enable strict verification once webhook
badge API key is confirmed` and a "ALLOWING TRAFFIC FOR DEBUGGING"
console warning left in place across dozens of production versions. This
means the legacy production system accepted **unauthenticated** Retell
webhooks for basically its entire life.

**Verdict: IGNORE the legacy scheme; it's a lesson, not a pattern.**
Two real, incident-shaped takeaways for the new system (both already
correctly handled — cite as confirmation, not a gap):
1. Signing must be checked against the **raw** body bytes exactly as
   received, never a reparsed-and-restringified copy (whitespace/key-order
   changes from `JSON.parse` + `JSON.stringify` would break any correct
   signature scheme) — CLAUDE.md Rule 2 ("verify signature against the RAW
   body first") already gets this right;
   `packages/adapters/retell/src/signature.ts` /
   `supabase/functions/_shared/retell-signature.ts` operate on `rawBody`
   directly per VERIFY-1. **ADOPT (already covered)** — no action, just
   confirms the rule mattered in practice.
2. "Fail closed" (Rule 2: "missing secret = reject, never skip") is the
   direct fix for the exact failure mode observed live — an unconfigured
   or misconfigured signing secret silently degrading to "accept
   everything." Confirm `voice-inbound/index.ts` and `voice-tools`'s Deno
   entrypoint genuinely 401 (not warn-and-continue) when
   `RETELL_WEBHOOK_SIGNING_SECRET` verification fails — spot-checked
   `voice-inbound/index.ts` here: it does (`return jsonResponse({error:
   "unauthorized"}, {status: 401})` unconditionally on `!verification.valid`,
   no bypass). **ALREADY COVERED.**

### Square webhook signature — RESOLVED via live evidence, confirms new implementation

Live `square-webhook` (v15) computes:
`HMAC-SHA256(notificationUrl + rawBody, signatureKey)` → base64, compared
against the `x-square-hmacsha256-signature` header (byte/char loop
comparison, length-checked first). This matches
`supabase/functions/_shared/providers/square.ts:193-240`
(`verifySquareSignature`/`hmacSha256Base64`) **exactly** in algorithm,
message construction (`notificationUrl + rawBody`, concatenation order
matters and matches), and header name — that file's own comment already
flagged this as an unconfirmed "starting hypothesis" pending Square's live
docs (egress-blocked during that build). **This live evidence resolves
it.** The new implementation additionally does `timingSafeEqual` (legacy
used a non-early-exit char loop, functionally similar but not using a
vetted constant-time helper) and fails closed on a missing secret — the
legacy version's *signature verification itself* had no live "allow
through" bypass, but critically its caller did:
`if (!isValid && SQUARE_WEBHOOK_SIGNATURE_KEY)` — meaning when the env var
was simply unset, verification silently short-circuited to "pass."

**Verdict: ADOPT/CONFIRMED.** No code change — recommend only updating the
comment at `supabase/functions/_shared/providers/square.ts:193-204` to
note this is now confirmed by live production evidence, not just a
hypothesis (see BUILD_NOTES.md entry).

### Webhook idempotency — legacy had none anywhere; new system's rule is a real, validated fix

Across all of `retell-events`, `retell-assistant`, and `square-webhook`
(live), no function ever writes to a `webhook_events`-style dedup table
or checks a `(source, event_id)` uniqueness constraint before processing
— `square-webhook` extracts `event.event_id` and logs it but never
persists or checks it. The only accidental protection against duplicate
processing was incidental: `call_started`'s plain `.insert()` (not
upsert) into `interactions`, which happens to rely on a DB unique
constraint and swallows Postgres error `23505` — everything else
(`call_ended`/`call_analyzed` upserts, all of `square-webhook`'s
`.update()` calls) would silently reprocess on any redelivered webhook
(both Retell's and Square's webhook systems retry on non-2xx/timeout).

**Verdict: ADOPT/CONFIRMED — validates the new design, no gap found.**
`supabase/functions/_shared/webhook-dedup.ts`
(`insertWebhookEventIfNew`/`markWebhookEventProcessed`) is already wired
into `voice-events/index.ts`, `webhooks-pos/index.ts`,
`webhooks-stripe/handler.ts`, and `webhooks-twilio-sms/handler.ts` —
exactly the fix this live gap needed. No further action.

### `lookup_customer` / caller-number scoping — legacy had the exact gap G6 exists to close

Legacy `retell-tools/index.ts` resolves the "customer phone" used for
every tool (including saving/creating customer records) as:
`customerPhone = parameters?.phone_number || from_number` — i.e. a
model-supplied `phone_number` **argument** silently takes priority over
the call's real caller ID (`from_number`) for every handler
(`saveCustomerDetails`, `bookAppointment`, etc. all receive this
pre-resolved value via `ctx.customerPhone`). Nothing in the live code
cross-checks the two. This is a real prompt-injection-shaped gap: a
malicious/confused caller (or a model that hallucinates a phone number
from conversation) could look up or attach records to any phone number,
not just their own.

**Verdict: CONTRADICTS-LEGACY-PATTERN (do not adopt); new code already
fixes this.** `supabase/functions/voice-tools/tools/lookup_customer.ts:42-55`
does exactly the cross-check the legacy code lacked
(`samePhone(args.phone, ctx.callerNumber)`, rejecting a mismatch as
`unauthorized_lookup` and logging it), with `ctx.callerNumber` sourced
from `call_logs` (`supabase/functions/voice-tools/context.ts:19-37`) —
never from tool `args`. **ALREADY COVERED** — cite this finding as
evidence the G6 authorization check is addressing a real, previously-live
gap, not a theoretical one; no further action needed on `lookup_customer`
itself, but worth double-checking `create_booking`/`create_order`/
`send_sms_confirmation` (BUILD_NOTES.md follow-up below) don't have the
same "arg overrides caller identity" shape the legacy `save_customer_details`/
`book_appointment` handlers did.

### Recording fetch — legacy did it synchronously inline; new system's async worker is already the fix

Legacy `retell-events` downloads the Retell recording URL and re-uploads
it to Supabase Storage **synchronously, inside the webhook handler**,
before responding to Retell — a slow (network fetch + blob + storage
upload), failure-prone step directly on Retell's webhook response-time
budget, with a bare `webhook_timeout_ms: 10000` set on affected agents in
`retell-manage`'s `create_agent`/`create_test_agent` flows (a very likely
production hotfix reaction to exactly this timeout risk).

**Verdict: ALREADY COVERED — new architecture is strictly better.**
`supabase/functions/voice-events/handler.ts:119-127` enqueues a
`recordingFetch` job (`QUEUE_NAMES.recordingFetch`) instead of fetching
inline, explicitly citing "a fetch to Retell/Storage has no place adding
latency/failure surface to this background task." No action — cite as
confirmation the design choice was right, and as the answer to why
`webhook_timeout_ms` never needs to be a tuning knob for this codebase.

### Retell agent `webhook_url` / `webhook_timeout_ms` fields — minor gap, non-blocking

Live `retell-manage`'s `create_agent` calls set both `webhook_url` (the
call-lifecycle events target — already matched: `agents.ts:93` sets
`webhook_url: input.eventsWebhookUrl`) **and** `webhook_timeout_ms: 10000`
on the Agent resource. The new adapter's `agents.ts` sets `webhook_url`
but has no `webhook_timeout_ms` field at all in
`CreateOrUpdateAgentInput`/the outgoing request body.

**Verdict: ADOPT (minor).** Given `voice-events` now processes
recordings asynchronously (previous finding), the default Retell
timeout is very likely fine — but since this field costs nothing to
carry and the legacy system evidently needed to raise it once already,
recommend adding an explicit `webhook_timeout_ms` (e.g. 10000ms, matching
the one concrete production data point available) to
`CreateOrUpdateAgentInput` rather than leaving it to Retell's undocumented
default. Logged in `docs/BUILD_NOTES.md` (LIVE-MINE-EDGE) rather than
changed here per task scope.

### Conversation-flow node/edge shapes — corroborates VERIFY-8, no new information

Live `retell-manage`'s `create_test_agent` action builds an actual
`/create-conversation-flow` request body with
`model_choice: {type: "cascading", model, high_priority}`,
`start_speaker: "agent"` (set both at the flow level and per-node),
`transition_condition: {type: "prompt", prompt}` on every edge, and a
`type: "function"` node shape (`tool_id`, `tool_type: "local"`,
`speak_during_execution`, `speak_after_execution`, `wait_for_result`) not
currently enumerated in `docs/VERIFY.md`'s VERIFY-8 write-up. All of this
matches VERIFY-8's already-RESOLVED (via the official SDK) findings for
the fields VERIFY-8 covers; the function-node fields are new information
worth having on file if `packages/adapters/retell/src/compiler/
conversation-flow.ts` ever needs to emit a `type: "function"` node itself
(function nodes are Retell's built-in mechanism for a hard tool-call step
in the graph — potentially relevant to VERIFY-8's flagged "no hard
per-node tool-restriction" architecture gap, since a `function` node,
unlike a `conversation` node, only exposes the one tool it names).
**Verdict: Informational — logged for whoever next revisits the
conversation-flow compiler; not actionable within this task's scope.**

### Retell phone-number provisioning — legacy used a different endpoint than the new system targets

Live `retell-numbers` calls `POST /create-phone-number` (buy a
Retell-hosted number, `{area_code, inbound_agent_id}` — singular
`inbound_agent_id` string, not the `inbound_agents` weighted array) and
`GET /list-phone-numbers`, never `/import-phone-number` (SIP-trunk BYON,
which is what `packages/adapters/retell/src/numbers.ts` and VERIFY-7
target). Response handling reads `numberData.phone_number` directly with
no `phone_number_id` field used — an independent, second confirmation
(different endpoint, same `PhoneNumberResponse` resource) of VERIFY-7's
already-RESOLVED finding that Retell phone numbers have no separate id,
just the E.164 string itself.
**Verdict: Informational only** — MASTER_PLAN's BYON/SIP-trunk-import
approach is a deliberate architecture decision (Rule 4: not
re-litigating it here); noting the alternate endpoint only in case a
future "instant number" self-serve flow is ever considered.

### Clover — no webhook signature verification exists in the legacy live code at all

Live `clover-webhook` has no HMAC/signature check of any kind — it
handles Clover's verification-challenge handshake (`verificationCode` in
the URL query or POST body, echoed back) and otherwise trusts the webhook
body's `merchantId`/`objectId` to decide what to re-fetch, but never
authenticates the delivery itself. Its one saving grace: it treats the
webhook purely as a "something changed, go re-fetch" trigger and always
re-pulls the authoritative order via Clover's REST API using the
tenant's own stored OAuth `access_token` (`fetchCloverOrder`) rather than
trusting any field from the webhook body as data — so a forged webhook
could at most cause a wasted re-fetch of a real order, not data
injection. This is real information for whoever builds the Clover
adapter (none exists yet in `packages/adapters/`/`supabase/functions/` as
of this task).
**Verdict: Informational, logged for the future Clover build** (not
CONTRADICTS, since no new Clover code exists yet to contradict) — (a)
confirm from Clover's current docs whether a real signature/HMAC
mechanism exists before building (CLAUDE.md Rule 1) rather than assuming
none does just because legacy never implemented one; (b) if none exists,
adopt legacy's "webhook is only a re-fetch trigger, never a data source"
pattern as the mitigation, consistent with Rule 2's fail-closed spirit.

### Clover OAuth env var naming — minor, logged for the future Clover build

Live `pos-sync`'s `refreshCloverToken` reads
`CLOVER_CLIENT_ID ?? CLOVER_APP_ID` and
`CLOVER_CLIENT_SECRET ?? CLOVER_APP_SECRET` — a fallback chain implying
Clover's own docs/dashboard terminology for these credentials shifted
between "Client ID/Secret" and "App ID/Secret" at some point during the
legacy system's life. **Verdict: Informational** — when a Clover adapter
is eventually built, expect this naming ambiguity in Clover's current
docs/dashboard and pick one canonical `.env.example` name with a comment
noting the alternate term Clover's UI may use.

### Square/Clover order-state mapping — informational reference

Both `square-webhook` and legacy's `pos-sync`/`pos-push-square` map
provider order states to a 4-value internal set
(`DRAFT/OPEN/COMPLETED/CANCELED` -> `pending/confirmed/delivered/cancelled`
for Square). Square idempotency keys are already used correctly on
writes (`idempotency_key: terminal-${transaction.id}`, customer ID as key
elsewhere) — this matches the new Square adapter's `idempotencyKey`
handling in `packages/adapters/square/src/booking.ts:49,128` exactly.
**Verdict: ALREADY COVERED.** No action.

### Summary table

| Item | Live legacy behavior | New system status | Verdict |
|---|---|---|---|
| VERIFY-2 (call_inbound envelope) | `{event:"call_inbound", call_inbound:{from_number,to_number}}`, nested | New request schema assumes flat `{call_id,from_number,to_number}` | **CONTRADICTS-NEW-CODE** — `supabase/functions/_shared/schemas/voice-inbound.ts:11-17`, `packages/adapters/retell/src/raw-types.ts:31-36` |
| VERIFY-3 (tool-call envelope) | `{name,args,call:{call_id,from_number,...}}` | Matches exactly | **ALREADY COVERED** |
| Retell signature scheme (live) | Re-stringified body, no timestamp, verification present but never enforced (commented-out 401) | Raw-body HMAC+timestamp, fails closed | **ADOPT/CONFIRMED** (new code already correct; legacy is the cautionary tale) |
| Square signature scheme | `HMAC-SHA256(url+body)`, base64, char-loop compare | Same algorithm, `timingSafeEqual`, fails closed on missing secret | **ADOPT/CONFIRMED** — resolves `square.ts`'s own "unconfirmed hypothesis" comment |
| Webhook idempotency | None anywhere (only incidental via unique-constraint catch) | `webhook_events` dedup wired into all 4 webhook entrypoints | **ADOPT/CONFIRMED** |
| `lookup_customer` caller-number scoping | `args.phone_number` silently overrides real caller ID | G6 check cross-validates `args.phone` against `call_logs.caller_number` | **ALREADY COVERED** (contradicts the *legacy pattern*, not new code) |
| Recording fetch timing | Synchronous inline download+reupload in the webhook handler | Async queue job (`recordingFetch`) | **ALREADY COVERED**, new design strictly better |
| Agent `webhook_timeout_ms` | Set to 10000ms (likely a timeout-incident hotfix) | Field not sent at all | **ADOPT (minor)** — see BUILD_NOTES.md |
| Conversation-flow function-node shape | `type:"function"`, `tool_id`, `tool_type:"local"`, `speak_during/after_execution`, `wait_for_result` | Not in VERIFY-8's inventory | Informational, logged for the compiler |
| Retell number provisioning | `/create-phone-number` + `inbound_agent_id` (buy-a-number flow) | Targets `/import-phone-number` (BYON/SIP) per VERIFY-7 | Informational — different endpoint, not a gap |
| Clover webhook auth | None; webhook only triggers an authenticated re-fetch | No Clover adapter built yet | Informational, logged for the future build |
| Clover OAuth env var naming | `CLIENT_ID`/`APP_ID` and `CLIENT_SECRET`/`APP_SECRET` both accepted | N/A, no Clover adapter yet | Informational, logged for the future build |
| Square/Clover order-state mapping + idempotency keys | 4-value state map; idempotency keys already used on writes | Matches (`booking.ts` idempotencyKey usage) | **ALREADY COVERED** |
