-- CALL-6 (docs/BUILD_NOTES.md): additive test-booking flag, mirroring
-- call_logs.is_test_call (20260907130500_call_logs.sql). Retell's batch-
-- test/simulator harness collapses every tenant's tool calls onto a
-- literal "playground" call id (voice-tools/context.ts's own doc comment);
-- `create_booking` now writes `is_test = true` on this column whenever the
-- resolved call context is itself a test/placeholder call
-- (`call_logs.is_test_call`), so a batch-test booking never counts toward
-- a tenant's real dashboard list or KPI aggregates (bookings list page,
-- job-value-email's weekly "bookings captured" digest, job-reminder-
-- scheduler, job-review-request — every one of those already excludes
-- `is_test = true` as of this same task; see docs/BUILD_NOTES.md CALL-6).
--
-- No index added: every real query filtering on this column already
-- filters by `tenant_id` first (small per-tenant row counts today), so a
-- plain boolean scan is cheap; add a partial index
-- (`where is_test = false`) if a dashboard query profile later says
-- otherwise.

alter table public.bookings
  add column is_test boolean not null default false;

comment on column public.bookings.is_test is
  'true when this booking was created from a test/placeholder call (call_logs.is_test_call — a Retell batch-test/simulator/chat-completion session, keyed off the shared "playground" call id). Excluded from the tenant dashboard bookings list and every KPI aggregate that counts bookings by default.';
