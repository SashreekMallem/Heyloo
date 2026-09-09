# Database Layer Production-Readiness Audit

Date: 2026-09-09
Scope: `supabase/migrations/` (22 files), `supabase/seed/seed.sql`, and the
**live** deployed project `qulcubtwqsqgqpfgvorn`, queried read-only via the
Management API (`EXPLAIN`/`SELECT` only, plus session-scoped `SET ROLE` +
`SET request.jwt.claims` inside `BEGIN…ROLLBACK` to reproduce exactly what
PostgREST does per-request — no data was written or altered). Edge functions
(`supabase/functions/**`) and `apps/web` are out of scope — see
`docs/audit/EDGE_AUDIT.md` and `docs/audit/E2E_FLOWS_AUDIT.md` for those
layers; findings below reference them only to mark the boundary, not to
duplicate them.

Method: read all 22 migrations end-to-end against `docs/spec/BACKEND_SPEC.md`
§0-§10 and `docs/spec/MASTER_SPEC.md` §3, then verified the **live** database
state directly — extensions, migration history, table/RLS/policy inventory,
view ownership and grants, `cron.job`, `pgmq.list_queues()`, FK/index
coverage, and `EXPLAIN` on the representative hot-path queries — rather than
trusting the migration files' comments alone. Every finding below that makes
a live-state claim was independently re-derived from a live query, not copied
from `docs/BUILD_NOTES.md`'s own self-reported testing.

---

## BLOCKER

### DB-B1. Four admin-only views leak every tenant's financial data to `anon` — confirmed live, unauthenticated, right now

`supabase/migrations/20260907131300_views.sql` creates `v_tenant_margin`,
`v_call_cost_vs_billed`, `v_usage_alerts`, and `v_referral_pnl` with plain
`create or replace view` — no `security_invoker = true` (the Postgres 15+
option that makes a view honor the *querying* role's RLS, not the *owner's*).
BACKEND_SPEC §5's own RLS matrix says the underlying tables
(`revenue_events`, `cost_events`, `usage_daily`, `referral_partners`,
`referrals`, `commission_events`) are `fn_jwt_is_platform_admin()`-gated or
tenant-scoped — i.e. never meant to be readable across tenants by a
non-admin, and never at all by an unauthenticated caller.

Live confirmation (all four queries run against the live project inside a
rolled-back transaction):

- View ownership: all four views are owned by `postgres`, which carries
  `rolbypassrls = true` live (confirmed: `select rolname, rolbypassrls from
  pg_roles` → `postgres | true`). Per Postgres's documented view-permission
  model, a view without `security_invoker` checks the underlying tables'
  RLS **as the view owner**, not as the querying role — so every one of
  these views silently bypasses RLS for *any* role that can select from the
  view, regardless of that role's own JWT claims.
- Grants: `information_schema.role_table_grants` shows `SELECT` (and, oddly,
  `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`) granted to **both `anon` and
  `authenticated`** on all four views — this is the standard Supabase
  default-privilege grant that every new relation in `public` picks up, and
  nothing in this migration revokes it (contrast with every RLS-sensitive
  base table, which relies on RLS to filter rows even though the same
  blanket grant exists there too).
- Live exploit reproduction, unauthenticated (`SET LOCAL ROLE anon`, no JWT
  claims at all — exactly what a request using only the public
  anon/publishable key looks like):
  ```
  SET LOCAL ROLE anon;
  SELECT count(*) FROM public.tenants;        --  0   (RLS correctly blocks the base table)
  SELECT count(*) FROM public.v_tenant_margin; --  8   (all 8 seeded tenants' revenue/cost/margin)
  ```
- Live exploit reproduction, authenticated as one specific tenant (`SET
  LOCAL ROLE authenticated` + `request.jwt.claims` shaped exactly like the
  Custom Access Token Hook's output for the "Demo Veterinary Clinic" tenant):
  ```
  SELECT count(*) FROM public.tenants;         -- 1  (correctly scoped to the caller's own tenant)
  SELECT tenant_id, name FROM public.v_tenant_margin; -- returns all 8 tenants, not just the caller's
  ```

Net effect: any signed-up tenant owner — or, via `anon`, literally anyone
with the project's public publishable key (which ships in every browser page
load) — can call `GET /rest/v1/v_tenant_margin` and read every tenant's
monthly revenue, cost, and margin; `v_call_cost_vs_billed` similarly exposes
per-call provider cost vs. implied billed amount for every tenant;
`v_referral_pnl` exposes every referral partner's accrued/paid commissions.
(`v_usage_alerts`/`v_referral_pnl` currently return 0 rows for `anon` only
because `usage_daily`/`referral_partners` are empty in this seed-only
project — the identical bypass mechanism applies to all four views
identically, confirmed by the shared owner/grant pattern, so this is latent,
not absent, for those two.) This is a direct, live violation of CLAUDE.md
Rule 2 ("RLS on every table") and SYSTEM_DESIGN §7 — the margin-secrecy
requirement BACKEND_SPEC §5 states explicitly ("cost is admin/cockpit-only,
never tenant-exposed") is currently false in production.

**Fix:** `alter view public.v_tenant_margin set (security_invoker = true);`
(and the same for the other three) so they honor the querying role's own RLS
on the underlying tables, **and** `revoke all on public.v_tenant_margin,
public.v_call_cost_vs_billed, public.v_usage_alerts, public.v_referral_pnl
from anon, authenticated;` (these are admin-cockpit-only views — even with
`security_invoker` fixed, a tenant member calling them would get an empty
result rather than an error, which is worse UX than a clean 401/403; grant
`select` back only to a role the admin cockpit actually authenticates as, or
keep them `service_role`-only and proxy through an edge function). Add a
migration-time regression test (`SET ROLE anon; SELECT * FROM
<every view>`) to CI's RLS cross-tenant probe so a future view addition
can't reintroduce this silently — the existing probe (BACKEND_SPEC §5)
only exercises base tables today, which is exactly why this one shipped.

### DB-B2. Zero `pg_cron` jobs exist on the live project — the entire scheduled-jobs layer is inert

Live query: `select * from cron.job;` → **`[]`** (empty). `pg_cron` the
extension is installed (`extversion 1.6.4`, confirmed via `pg_extension`),
but nothing has ever called `cron.schedule(...)`. `supabase/migrations/
20260907130000_extensions_and_helpers.sql:9` and
`supabase/migrations/README.md:43-47` are explicit that this is
intentional — schedule registration is out of T1's (this layer's) scope —
and `docs/DEPLOY.md` §3.6 (lines 433-525) documents the exact
copy-pasteable `cron.schedule(...)` calls for every job in BACKEND_SPEC §8.
But that script is a manual, undocumented-as-run operational step, and this
audit confirms directly against the live project that **it was never
executed**.

Concretely, right now, on the live database: no availability
roll-forward (the 21/30-day `availability_slots` window will simply run out
and `check_availability` will start returning `none_available` for every
tenant once the precomputed window from seed/provisioning is exhausted); no
nightly usage rollup (`usage_daily` never populates, so billing and the
usage-alert UI have no data); no billing-cycle job (no Stripe meter
reporting, no `billing_invoices` ever generated); no retention sweep (BIPA-
relevant recordings are never purged past `tenants.retention_days` — G3 is
currently unenforced for every tenant, indefinitely); no churn scoring; no
reminder scheduler (MASTER_SPEC §3.6 booking reminders never fire); no
review-request job; no Retell health-check/failover probe (G5's "detect an
outage in under 2 minutes" guarantee never runs); no alert evaluation (the
cockpit's entire alerting system, BACKEND_SPEC §8's `alert evaluation` row,
never executes); no keep-warm ping; no referral-qualification/payout batch.

**Fix:** run `docs/DEPLOY.md` §3.6's `cron.schedule` block (or fold it into
a new, idempotent migration using `cron.schedule` — additive, safe to
re-run since `cron.schedule` upserts by job name) against the live project,
then re-verify with `select jobname, schedule, active from cron.job;` before
this project is called production-ready. Track this as a release blocker,
not a follow-up — nothing downstream of §8 can work without it.

### DB-B3. Zero `pgmq` queues exist on the live project — every async worker has nowhere to enqueue

Live query: `select * from pgmq.list_queues();` → **`[]`** (empty), for all
four documented queues (`messages_outbound_queue`, `recording_fetch_queue`,
`adapter_push_queue`, `outreach_send_queue`) and their four dead-letter
companions. `pgmq` the extension is installed (`extversion 1.5.1`), but
`pgmq.create(...)` has never been called for any queue name. Same root
cause and same `docs/DEPLOY.md` §3.6 remediation script as DB-B2, confirmed
independently since a missing cron schedule and a missing queue are
independently fatal to different subsystems.

Concretely: any edge-function code path that calls `pgmq.send('
messages_outbound_queue', ...)` (or the equivalent for the other three)
will error against a queue that doesn't exist — booking/order SMS
confirmations, the <10-minute Retell recording fetch, adapter push
(Shopmonkey/ezyVet/Google Calendar/Square), and outreach sends all have no
transport today, independent of whether their respective edge functions are
otherwise correctly written. This is the DB-layer half of why
`docs/audit/EDGE_AUDIT.md`'s H1 (no real retry/DLQ for outbound messages)
can't even be observed yet — there's no queue for the worker to poll in the
first place.

**Fix:** same as DB-B2 — run the `pgmq.create(...)` calls from
`docs/DEPLOY.md` §3.6 against the live project (primary + `_dlq` for all
four), then confirm with `select * from pgmq.list_queues();`.

---

## HIGH

### DB-H1. RLS write policies on `bookings`/`orders` never validate that `resource_id`/`offering_id` belong to the caller's own tenant

`supabase/migrations/20260907131500_rls.sql:165-166` (`bookings_insert`) and
`:183-184` (`orders_insert`), plus their `_update` counterparts, are:
```sql
create policy bookings_insert on public.bookings for insert
  with check (tenant_id = public.fn_jwt_tenant_id());
```
This checks only that the *row's own* `tenant_id` matches the caller's JWT
— it never checks that `resource_id` (or `offering_id`) actually references
a `resources`/`offerings` row owned by that same tenant. `bookings.resource_id`
references `resources(id)` globally (`supabase/migrations/
20260907130600_booking_core.sql:67-69`), not a tenant-scoped composite key,
so there is no FK-level backstop either.

This is the DB-layer counterpart to `docs/audit/EDGE_AUDIT.md`'s **B1**
(`create_booking` doesn't verify `resource_id`/`offering_id` ownership) —
but it is a distinct, independently-exploitable surface: EDGE_AUDIT's B1 is
about the `voice-tools` edge function, which writes via `service_role` and
was never going to be caught by RLS regardless. This finding is about the
**RLS policy itself**, which is what the dashboard's own "member-initiated
manual booking" write path (BACKEND_SPEC §5's stated reason this policy
exists at all) goes through directly via PostgREST as an `authenticated`
role — so even after EDGE_AUDIT B1 is fixed, an authenticated member of
Tenant A can still `POST /rest/v1/bookings` with `tenant_id: A,
resource_id: <Tenant B's resource>` and the database will accept it with no
error, corrupting Tenant B's availability via the existing invalidation
trigger.

**Fix:** either (a) add `unique (tenant_id, id)` to `resources` and
`offerings` and change `bookings.resource_id`/`offering_id` (and
`orders`' equivalent) to a composite FK `(tenant_id, resource_id) references
resources(tenant_id, id)` — real referential integrity, enforced for every
writer including `service_role` — or (b), as a faster interim fix, extend
the `with check` clauses to `tenant_id = fn_jwt_tenant_id() and exists
(select 1 from resources r where r.id = resource_id and r.tenant_id =
fn_jwt_tenant_id())` (and similarly for `offering_id`/orders' items). Option
(a) is preferable since it also protects the `service_role` path EDGE_AUDIT
B1 flagged.

### DB-H2. `adapter_connections.access_token`/`refresh_token` stored as plaintext for every tenant's live third-party credentials

`supabase/migrations/20260907160000_t7_adapter_connections.sql:17-25,35-36`:
these columns hold live OAuth access/refresh tokens (Google Calendar,
Square) and API keys (Shopmonkey, ezyVet) in plain `text`, self-documented
in the migration as "a KNOWN GAP, not an oversight... flagged in
docs/VERIFY.md rather than half-built." That candor is good, but this audit
must still flag it as a production blocker-adjacent risk: any DB-level read
access (a logical backup, a read replica, a support engineer's ad-hoc query,
a future SQL-injection bug in an unrelated function) exposes every
connected tenant's live external-system credentials in cleartext — for
systems (practice-management/POS software) that themselves hold real
customer PII and payment data. RLS on this table only gates the
dashboard-facing `select` path (BACKEND_SPEC/this migration's own comment:
"read-only defense-in-depth... not the write path"); it does nothing to
protect the column's cleartext value from any role/query that *does* have
row access (`service_role`, `postgres`, any future admin tooling).

**Fix:** encrypt `access_token`/`refresh_token` at rest before any real
tenant connects a live adapter — `pgsodium`/Supabase Vault (already
installed: `supabase_vault` extension is present live,
`extversion 0.3.1`) is the natural fit given CLAUDE.md Rule 1's guidance to
follow current `supabase.com/docs` Vault guidance; confirm the exact
current API before implementing. Track the key-rotation story alongside it,
not as a later follow-up.

### DB-H3. `messages_outbound`'s own documented idempotency check has no supporting index

BACKEND_SPEC §7.2.7 (`send_sms_confirmation`) states the tool
"soft-checks unique on `(related_booking_id, template_key)`... before
insert to avoid double-confirming on a Retell retry." Live index listing
(`pg_indexes` for `messages_outbound`) confirms only three indexes exist:
`messages_outbound_pkey`, `idx_messages_outbound_tenant_created (tenant_id,
created_at desc)`, and `idx_messages_outbound_pending (status) where status
in (...)` — **no index covers `related_booking_id` or `related_order_id` at
all** (confirmed independently by a live FK-column/index-coverage query
across every table in `public`, which flags `messages_outbound
.related_booking_id`, `.related_order_id`, and `.related_call_id` among its
results). Every `send_sms_confirmation`/order-confirmation tool call —
which happens inline during a live voice call, inside the same p95<500ms
`/voice/tools` budget CLAUDE.md Rule 2 calls out — will sequential-scan this
table to run its own documented dedup check, against a table that (per
DB-M1 below) has no retention/pruning strategy and therefore only grows.

**Fix:** `create index idx_messages_outbound_dedup on public.messages_outbound
(related_booking_id, template_key) where related_booking_id is not null;`
(and the analogous index for `related_order_id`).

---

## MEDIUM

### DB-M1. No retention/pruning strategy exists — in the spec or live — for `webhook_events` or `tool_health`

BACKEND_SPEC §8's job table lists a "Retention sweep" job, but it is scoped
only to Storage recording objects and `call_logs`'s recording-URL columns
(§6) — there is no job anywhere in the spec, the migrations, or (per DB-B2)
the live `cron.job` table that ever prunes `webhook_events` (one row per
webhook delivery, every provider, forever) or `tool_health` (one row per
`/voice/tools` call, emitted async on every single tool invocation, per
BACKEND_SPEC §7.2 — this is the highest-write-volume table in the schema by
design). Both currently sit at 0 rows live (pre-launch), so this is a
design gap rather than an active incident, but it will not stay that way:
`tool_health` alone accrues at roughly one row per tool call across every
tenant's every live call, with zero downstream consumer that deletes old
rows (`job-alert-evaluation`'s `tool_failure_spike` rule only reads a
trailing window; nothing archives or drops old rows).

**Fix:** add a documented retention job (time-based `DELETE`, or convert to
a monthly-partitioned table with `DROP PARTITION`, for `tool_health`
specifically given its volume) for both tables, and register it alongside
the DB-B2 fix rather than deferring it again.

### DB-M2. Several FK columns used by dashboard/detail-page read paths have no supporting index

Live FK/index-coverage query (every `FOREIGN KEY` column in `public` cross-
checked against `pg_index`'s leading column) surfaces, beyond the DB-H3
case already called out separately for its hot-path severity:
`bookings.offering_id`, `bookings.source_call_id`, `orders.source_call_id`,
`payment_links.order_id`, `payment_links.booking_id`. These back reasonable
queries ("show this call's resulting booking," "show this booking's
payment-link status" — the exact UI MASTER_SPEC §3.10/E2E_FLOWS_AUDIT H4
says still needs to be built) that are not on the `/voice/tools` hot path,
so this is lower urgency than DB-H3, but worth closing in the same pass
before those dashboard pages ship and start issuing these lookups at real
volume. (Several other FK misses from the same query —
`agent_templates.created_by`, `platform_settings.updated_by`,
`alerts.acked_by`, `referral_partners.user_id`, etc. — are low-cardinality
admin/audit columns queried rarely if ever directly; not worth indexing
speculatively.)

**Fix:** `create index` on each of the five columns above once the
corresponding dashboard read paths exist (no need to guess the exact
composite shape before the query pattern is known — a plain single-column
btree on each is a safe default).

### DB-M3. Exclusion-constraint predicate is a self-flagged tripwire, not yet a bug — re-confirming it's still live and unresolved

`supabase/migrations/20260909120000_live_mining_hardening.sql:196-212`
already documents this precisely: `bookings`'s GIST exclusion constraint
(`bookings_resource_id_during_excl`, confirmed live via `pg_indexes`) only
blocks double-booking where `status = 'confirmed'`. Today that's correct —
`create_booking` only ever writes `'confirmed'` directly. This audit
re-confirms the constraint's live definition matches that comment exactly
and that no code path currently writes an interim `'scheduled'`/hold status,
so there is no active bug — but this is worth carrying forward as a named,
must-not-miss item (not just a comment) since the day a payment-required
hold status is added (MASTER_SPEC §3.2 motel-deposit flow implies exactly
such a status may eventually be needed) and the predicate isn't widened in
the *same* migration, the double-booking bug this constraint exists to
prevent returns silently.

**Fix:** no code change needed now; add this specific tripwire to whatever
pre-merge checklist covers new booking-status values, referencing this
constraint by name.

### DB-M4. `cost_events` money columns are `numeric`, not integer cents — matches the spec, but is in tension with CLAUDE.md's blanket rule

`cost_events.quantity`, `.unit_cost_cents`, `.total_cost_cents`
(`supabase/migrations/20260907131000_money.sql:9-12`) are `numeric`, exactly
as BACKEND_SPEC §1.6 literally specifies (fractional per-second/per-unit
provider costs need sub-cent precision before they roll up to
`call_logs.cost_cents`, which *is* an integer). CLAUDE.md Rule 2 states
"Money in integer cents / numeric" — so `numeric` is explicitly permitted
by the rule's own text, but every other money column in the schema (the
ones that are actually invoiced/billed — `revenue_events.amount_cents`,
`billing_invoices.*_cents`, `bookings`/`orders` price/total columns) is a
plain `int`. This isn't a bug, but it's worth a one-line
`docs/BUILD_NOTES.md` note explaining the intentional exception so a future
reviewer doesn't flag it as a Rule 2 violation without context.

---

## LOW

- **DB-L1.** Only the two `SECURITY DEFINER` functions
  (`custom_access_token_hook`, `fn_broadcast_tenant_update`) set
  `search_path = ''` — confirmed live via `pg_proc.proconfig` (every other
  function in `public`, all `SECURITY INVOKER`, has `proconfig: null`). Not
  a real risk today since none of the rest run with elevated privilege, but
  setting `search_path` on every `SECURITY DEFINER` function is the only
  case that actually matters, and both of those already do it correctly —
  no action required, noted for completeness against the audit checklist.
- **DB-L2.** `realtime.messages`'s tenant-channel broadcast policy
  (`supabase/migrations/20260907131500_rls.sql:454-459`) is internally
  consistent with the broadcast trigger's topic string (`'tenant:' ||
  tenant_id`, both in `fn_broadcast_tenant_update`) and RLS is confirmed
  live-enabled on `realtime.messages`. The topic-string mismatch with the
  frontend subscriber is a frontend-layer bug already captured as
  `docs/audit/E2E_FLOWS_AUDIT.md`'s **B3** — flagged here only to confirm
  the DB layer's half of this contract is correct and isn't the cause.
- **DB-L3.** `20260909120000_live_mining_hardening.sql`'s
  `buffer_minutes`/turnaround-time backfill is a well-executed, additive,
  self-tested fix (it correctly re-derives `is_available` against existing
  confirmed bookings at regeneration time, closing a real gap the original
  `fn_regenerate_availability_slots` had) — noted as a positive example, no
  action needed.
- **DB-L4.** `tool_health` (added in `20260907140000`) originally shipped
  without RLS enabled at all — a direct CLAUDE.md Rule 2 violation — but
  this was caught during the team's own first live-deployment verification
  and fixed same-day by `20260909130000_tool_health_rls.sql`. Confirmed live
  that RLS is now enabled with the intended zero-policy default-deny
  posture. No outstanding action; noted as evidence the team's own
  verification process does catch this class of bug when it's exercised —
  which makes DB-B1 (the views) more notable, since that same verification
  pass (per `docs/BUILD_NOTES.md`'s own account) tested base tables and
  `realtime.messages` this way but never the four views.

---

## What's solid (no action needed)

- **RLS coverage is complete and, for base tables, live-verified correct.**
  All 52 live tables have `relrowsecurity = true` (confirmed via
  `pg_class`, zero exceptions) with policy counts matching each table's
  documented access shape (service-role-only tables carry exactly the one
  `_select` policy for admins; owner/admin-writable tables carry the
  expected 2-3). Independently re-ran the base-table cross-tenant test this
  audit's checklist calls for (not just trusted `docs/BUILD_NOTES.md`'s
  account of it): `SET ROLE authenticated` + a tenant-A JWT claim sees
  exactly 1 row from `tenants` and 0 from another tenant's data; `SET ROLE
  anon` sees 0 rows from every tenant-scoped/admin-only base table tested.
  The failure is specifically and only the four views (DB-B1) — the
  underlying table-level RLS matrix itself is genuinely solid.
- **Hot-path indexing is correct and `EXPLAIN`-confirmed on the live DB.**
  `check_availability`'s `slot_range && tstzrange(...)` lookup uses
  `idx_availability_slots_range` (GIST) via an Index Scan; the
  tenant+phone customer lookup uses the unique `(tenant_id, phone_e164)`
  index; the `call_logs` feed query uses `idx_call_logs_tenant_started`;
  the `webhook_events` dedup check uses the unique `(source, event_id)`
  index; and the booking-overlap check (mirroring both the exclusion
  constraint and the new buffer-minutes logic) uses an **Index Only Scan**
  on `bookings_resource_id_during_excl` — all confirmed via live `EXPLAIN`,
  not just by reading the migration's index list.
- **Idempotency and race-proofing are correctly built at the constraint
  level, not app logic.** `bookings`'s GIST exclusion constraint (`resource_id
  =, during &&, where status='confirmed'`) plus `unique (tenant_id,
  idempotency_key)`, and the identical shape on `orders`, are exactly the
  "never check-then-insert" pattern CLAUDE.md Rule 2 requires — confirmed
  present and indexed live, matching `docs/audit/EDGE_AUDIT.md`'s
  independent confirmation that the calling code relies on catching
  `23P01`/`23505` rather than pre-checking.
- **Live state otherwise matches the migrations exactly.** All 22
  migrations are recorded in `supabase_migrations.schema_migrations`; the
  live table count is exactly 52; `pgcrypto`, `btree_gist`, `pg_cron`,
  `pgmq`, `pg_net` are all installed at the versions the extensions
  migration expects. The gap is entirely that two of those extensions
  (`pg_cron`, `pgmq`) were installed but never actually *used* (DB-B2/DB-B3)
  — a deployment-completeness gap, not a schema-correctness one.
- **E.164/timestamptz/money conventions are followed almost everywhere.**
  Every phone column live carries a `timestamptz`-everywhere schema (no
  naive `timestamp` columns found anywhere in `information_schema.columns`
  for date/time fields) and, per `20260909120000`, real regex `CHECK`
  constraints now enforce E.164 shape at the DB boundary for
  `phone_numbers.e164`, `customers.phone_e164`, and both
  `messages_inbound` phone columns — a genuine defense-in-depth win over
  "app-layer-only" normalization, confirmed live via `pg_constraint`.
- **The one self-inflicted RLS gap the team had (`tool_health` shipping
  without RLS) was caught and fixed same-cycle** (DB-L4) — evidence the
  overall discipline here is real, even though DB-B1 shows its coverage
  wasn't complete.

---

## Verdict

**Not production-grade as deployed, despite a genuinely well-designed
schema.** The table/column/constraint/index design in
`supabase/migrations/` is careful, internally consistent with
BACKEND_SPEC/MASTER_SPEC, and — where it was actually tested — correctly
enforces tenant isolation; the hot-path indexing for availability lookups,
customer lookup, the call feed, webhook dedup, and the booking exclusion
constraint is exactly right and `EXPLAIN`-confirmed on the live database,
not just asserted in a migration comment. That is the hard part of this
layer, and it's done well.

But three independent, live-confirmed facts mean this database cannot run
the product it was built for today: **(1)** four admin-only views leak
every tenant's revenue, cost, margin, and referral-commission data to any
`anon`-key holder — the single most severe possible finding for a
multi-tenant SaaS's data layer, reproduced live in this audit with zero
ambiguity; **(2)** zero scheduled jobs exist, so availability never rolls
forward, recordings are never purged (an open BIPA/retention exposure),
billing never runs, and the platform's own stated resilience guarantees
(Retell failover, alerting) never execute; **(3)** zero queues exist, so
the entire async-worker architecture (confirmations, recording fetch,
adapter push, outreach) has no transport. None of these three are schema
*design* flaws — they're a security regression (the views) and a
deployment step that was written down (`docs/DEPLOY.md` §3.6) but never
run against the live project. All three are fixable in well under a day of
focused work with no schema redesign required, but none of them should be
treated as optional before this project accepts real tenant traffic. Once
DB-B1/B2/B3 are closed, this layer is lean, well-indexed, and — on the
evidence gathered here — genuinely fast and secure.
