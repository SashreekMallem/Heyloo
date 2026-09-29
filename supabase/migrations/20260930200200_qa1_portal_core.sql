-- QA-1 portal-core database fixes (one migration, additive):
--   Part 1 (F-02 / F-21)  usage_daily rollup: tenant-local buckets, hourly.
--   Part 2 (F-04)         members may write their own notification watermark.
--
-- ===========================================================================
-- Part 1 — F-02 / F-21: the Overview "Calls today / Bookings today /
-- Minutes used" cards were stale by ~2 days for every tenant.
--
-- Root causes (both in the usage_daily writers, not the portal):
--   1. fn_cron_usage_rollup() ran once a day at 00:10 UTC and rolled up
--      (tenant-local date - 1). At 00:10 UTC an America/New_York tenant is
--      still on the previous evening, so it rolled up the day BEFORE
--      yesterday: yesterday and today never got a row.
--   2. fn_upsert_usage_daily() bucketed by the UTC date (started_at::date)
--      instead of the tenant's local day, counted call_logs rows through a
--      LEFT JOIN onto usage_events (a call with two usage events counted
--      twice), and counted is_test_call / is_test rows.
--
-- Fix (additive: CREATE OR REPLACE + a reschedule; no applied migration is
-- edited):
--   * fn_upsert_usage_daily buckets every source by the tenant-local day
--     window [p_date 00:00, p_date+1 00:00) in tenants.timezone, counts calls
--     from call_logs directly (no join fan-out), sums usage_events in its own
--     subquery, and excludes test calls / test bookings / test orders.
--   * fn_cron_usage_rollup covers today AND yesterday in each tenant's own
--     timezone (yesterday finalises the late-evening tail after midnight)
--     and is scheduled hourly at :05, so usage_daily is at most an hour old.
--     The portal additionally computes the "today" headline cards live (see
--     apps/web/src/components/tenant/overview-client.tsx); the hourly job
--     feeds the trend chart and billing.
--
-- text_messages_out stays untouched (owned by the text-agent engine, see
-- 20260911110000_channels_pricing_and_usage.sql).

create or replace function public.fn_upsert_usage_daily(p_tenant_id uuid, p_date date)
returns void language plpgsql as $$
declare
  v_price_version text;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  select price_version, coalesce(nullif(timezone, ''), 'UTC')
    into v_price_version, v_tz
    from public.tenants where id = p_tenant_id;

  -- Tenant-local day window. `timestamp at time zone tz` interprets the
  -- wall-clock timestamp in tz and yields the matching timestamptz, so DST
  -- days are 23/25 hours long rather than mis-bucketed.
  v_start := p_date::timestamp at time zone v_tz;
  v_end := (p_date + 1)::timestamp at time zone v_tz;

  insert into public.usage_daily (
    tenant_id, date, total_calls, total_minutes, billable_minutes,
    total_bookings, total_orders, total_order_value_cents,
    price_version
  )
  values (
    p_tenant_id, p_date,
    (select count(*)
       from public.call_logs cl
      where cl.tenant_id = p_tenant_id
        and not cl.is_test_call
        and cl.channel in ('phone', 'web_voice')
        and cl.started_at >= v_start and cl.started_at < v_end),
    coalesce((select sum(cl.duration_seconds)
                from public.call_logs cl
               where cl.tenant_id = p_tenant_id
                 and not cl.is_test_call
                 and cl.channel in ('phone', 'web_voice')
                 and cl.started_at >= v_start and cl.started_at < v_end), 0) / 60.0,
    coalesce((select sum(ue.minutes)
                from public.usage_events ue
               where ue.tenant_id = p_tenant_id
                 and ue.is_billable
                 and ue.occurred_at >= v_start and ue.occurred_at < v_end
                 and exists (select 1 from public.call_logs cl
                              where cl.id = ue.call_id
                                and cl.tenant_id = p_tenant_id
                                and not cl.is_test_call
                                and cl.channel in ('phone', 'web_voice'))), 0),
    (select count(*) from public.bookings b
      where b.tenant_id = p_tenant_id and not b.is_test
        and b.created_at >= v_start and b.created_at < v_end),
    (select count(*) from public.orders o
      where o.tenant_id = p_tenant_id and not o.is_test
        and o.created_at >= v_start and o.created_at < v_end),
    (select coalesce(sum(o.total_cents), 0) from public.orders o
      where o.tenant_id = p_tenant_id and not o.is_test
        and o.created_at >= v_start and o.created_at < v_end),
    v_price_version
  )
  on conflict (tenant_id, date) do update set
    total_calls = excluded.total_calls,
    total_minutes = excluded.total_minutes,
    billable_minutes = excluded.billable_minutes,
    total_bookings = excluded.total_bookings,
    total_orders = excluded.total_orders,
    total_order_value_cents = excluded.total_order_value_cents,
    updated_at = now();
end;
$$;

create or replace function public.fn_cron_usage_rollup()
returns void language plpgsql as $$
declare
  t record;
  v_today date;
begin
  for t in select id, timezone from public.tenants where deleted_at is null loop
    begin
      v_today := (now() at time zone t.timezone)::date;
      -- Today (partial, refreshed hourly) and yesterday (finalised).
      perform public.fn_upsert_usage_daily(t.id, v_today);
      perform public.fn_upsert_usage_daily(t.id, v_today - 1);
    exception when others then
      raise warning 'fn_cron_usage_rollup: skipped tenant % (%)', t.id, sqlerrm;
    end;
  end loop;
end;
$$;

comment on function public.fn_cron_usage_rollup() is
  'Scheduled hourly at :05 (was daily 00:10 UTC, QA-1 F-02/F-21) — refreshes usage_daily for each tenant''s own local today and yesterday, so the current day is at most an hour stale and the previous day is finalised after local midnight.';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform public.fn_cron_upsert('job-internal-usage-rollup', '5 * * * *',
      $sql$select public.fn_cron_usage_rollup();$sql$);
  end if;
end;
$$;

-- ===========================================================================
-- Part 2 — F-04: the notification bell never cleared its unread badge.
-- 20260929160000 left `last_seen_notifications_at` as the only column
-- `authenticated` may UPDATE on memberships, but the only UPDATE policy
-- (memberships_write) is owner-only, so a non-owner member's write would
-- silently touch 0 rows, and an owner could write ANY member's row. Add a
-- self-scoped UPDATE policy: a member may update only their own membership row
-- of the tenant in their JWT (the column grant still limits WHAT they can set).
-- ===========================================================================

create policy memberships_update_own_seen on public.memberships
  for update
  using (user_id = auth.uid() and tenant_id = public.fn_jwt_tenant_id())
  with check (user_id = auth.uid() and tenant_id = public.fn_jwt_tenant_id());
