-- PUBLISH-1 (docs/BUILD_NOTES.md, deliverable 4 — ONBOARD-1's own flagged
-- consistency nit): `orders` gets the SAME `is_test` flag `bookings` has
-- had since CALL-6 (20260920200000_bookings_is_test.sql) — a Retell
-- batch-test/simulator order writing through `create_order` (`ctx.
-- isTestCall`, ultimately `call_logs.is_test_call`) was never flagged
-- before, so the tenant's real orders list and the header notification
-- bell had no way to exclude it (unlike bookings, which both already do).
--
-- No index added, same rationale as CALL-6's own migration: every real
-- query filtering on this column already filters by `tenant_id` first.

alter table public.orders
  add column is_test boolean not null default false;

comment on column public.orders.is_test is
  'true when this order was created from a test/placeholder call (call_logs.is_test_call — a Retell batch-test/simulator/chat-completion session, keyed off the shared "playground" call id). Excluded from the tenant dashboard orders list and the header notification bell, mirroring bookings.is_test (CALL-6).';
