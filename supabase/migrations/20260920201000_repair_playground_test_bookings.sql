-- CALL-6 (docs/BUILD_NOTES.md) — honest data repair for the cross-tenant
-- collision context.ts's fix closes (see 20260920200000_bookings_is_test.sql
-- and voice-tools/context.ts's CALL-6 doc comment for the root cause).
--
-- Before this fix, EVERY Retell batch-test/simulator call — from every
-- tenant, every scenario — shared the single literal call_logs row keyed
-- by `retell_call_id = 'playground'`. Every booking any batch test ever
-- created therefore has `source_call_id` pointing at that one row,
-- regardless of which tenant's own test suite actually created it (live
-- query, pre-repair: `select source_call_id, count(*) from bookings
-- group by 1` -> one source_call_id, count 18, all under the tenant that
-- happened to win that row first).
--
-- This migration marks exactly those rows `is_test = true` — a true,
-- checkable fact (they all trace back to the one call_logs row that only
-- ever gets created by a placeholder/batch-test resolution, never a real
-- call) — and does NOT attempt to guess which of the 18 "really" belongs
-- to which tenant's test suite; that information was never recorded and
-- can't be honestly reconstructed. They stay attributed to whichever
-- tenant_id they already have (an artifact of the pre-fix bug, left as-is
-- rather than silently reassigned) but are flagged test so they no longer
-- show up in that tenant's real bookings list or KPI counts. Documented in
-- docs/BUILD_NOTES.md's CALL-6 entry.
--
-- Also flips the pre-existing 'playground' call_logs row itself to
-- `is_test_call = true` (CALL-5's own entry already noted this specific
-- row predated the is_test_call-on-placeholder-rows fix and was never
-- retroactively updated — no authorized write path in that session; this
-- migration is that authorized, reviewed write). Both updates are no-ops
-- (0 rows) on a from-zero database with no pre-existing playground row —
-- additive and reproducible either way.

update public.bookings
set is_test = true
where source_call_id in (
  select id from public.call_logs where retell_call_id = 'playground'
);

update public.call_logs
set is_test_call = true
where retell_call_id = 'playground';
