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
