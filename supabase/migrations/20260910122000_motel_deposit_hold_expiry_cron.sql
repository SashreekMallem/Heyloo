-- GAP_REGISTER.md §2 Motel item 4 — MASTER_SPEC §3.2's "held scheduled
-- until paid" had no expiry mechanism: create_booking.ts now inserts a
-- deposit-required motel booking as status='scheduled' with a
-- hold_expires_at (20260910120500_bookings_quoted_rate_and_hold_expiry.sql)
-- but nothing ever swept an unpaid hold past its TTL back to a cancelled/
-- released state. Pure-SQL job, same "DB-internal jobs run as plain
-- SQL/PLpgSQL, no pg_net/vault/edge-function round trip" pattern as
-- fn_cron_availability_rollforward/fn_cron_usage_rollup
-- (20260910093000_queues_and_scheduled_jobs.sql, which also defines the
-- fn_cron_upsert helper this migration reuses). Additive only, reproducible
-- from zero (CLAUDE.md Rule 2) — guarded the same way that migration
-- guards every block against pg_cron being absent (a plain local Postgres
-- harness).
--
-- This job only handles the TTL-expiry half of the deposit-hold feature.
-- The exclusivity half — blocking a second caller from being offered or
-- confirming the same slot while a hold is active — is
-- `bookings_hold_exclusion` plus the extended availability-invalidation
-- trigger, both in 20260910170000_motel_hold_exclusion.sql (previously a
-- logged KNOWN LIMITATION, now closed; see docs/BUILD_NOTES.md).

create or replace function public.fn_expire_unpaid_deposit_holds()
returns void language plpgsql as $$
begin
  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = 'deposit_hold_expired'
  where status = 'scheduled'
    and hold_expires_at is not null
    and hold_expires_at < now();
end;
$$;

comment on function public.fn_expire_unpaid_deposit_holds() is
  'Scheduled every 15 minutes (job-motel-deposit-hold-expiry) — cancels any booking still status=''scheduled'' past its hold_expires_at (an unpaid deposit hold). webhooks-stripe/handler.ts flips a booking to ''confirmed'' on a paid Stripe checkout session BEFORE this would fire, so a booking reaching this UPDATE genuinely never got paid.';

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skipping job-motel-deposit-hold-expiry schedule (expected outside a Supabase-hosted Postgres)';
    return;
  end if;

  perform public.fn_cron_upsert('job-motel-deposit-hold-expiry', '*/15 * * * *',
    $sql$select public.fn_expire_unpaid_deposit_holds();$sql$);
end;
$$;
