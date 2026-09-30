-- Merge fix: 20260930260000_billing_behavior_fixes (BILL-7) re-created
-- fn_upsert_usage_daily from the pre-QA-1 body, so it ran after
-- 20260930200200_qa1_portal_core and silently undid QA-1's F-02/F-21 fixes:
-- test calls were counted again, the call_logs x usage_events join fanned
-- total_calls out per usage row, test bookings/orders were counted, and
-- non-voice channels were included. CI caught it (qa1_portal_core.sql:
-- "today total_calls = 3 (expected 1)").
--
-- This keeps QA-1's body (tenant-local window, is_test exclusions, no join
-- fan-out) and folds in what BILL-7/BILL-12 actually needed from theirs:
-- minutes rounded to 6 decimals, and the hourly rollup covering the last
-- three local days. Same signatures, so every caller is unchanged.
--
-- Also re-creates fn_ensure_realtime_partitions (20260930200600) without its
-- declared-but-shadowed `v_offset` (and the rollup without BILL-7's `d`): an
-- integer FOR loop declares its own variable, and `supabase db lint`
-- (fail-on warning) rejects the unused shadowed declaration.

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
    round(coalesce((select sum(cl.duration_seconds)
                from public.call_logs cl
               where cl.tenant_id = p_tenant_id
                 and not cl.is_test_call
                 and cl.channel in ('phone', 'web_voice')
                 and cl.started_at >= v_start and cl.started_at < v_end), 0) / 60.0, 6),
    round(coalesce((select sum(ue.minutes)
                from public.usage_events ue
               where ue.tenant_id = p_tenant_id
                 and ue.is_billable
                 and ue.occurred_at >= v_start and ue.occurred_at < v_end
                 and exists (select 1 from public.call_logs cl
                              where cl.id = ue.call_id
                                and cl.tenant_id = p_tenant_id
                                and not cl.is_test_call
                                and cl.channel in ('phone', 'web_voice'))), 0), 6),
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
      v_today := (now() at time zone coalesce(nullif(t.timezone, ''), 'UTC'))::date;
      -- Today (partial) plus the two days before, re-rolled hourly so the
      -- newest day is never more than an hour stale and a month's last local
      -- day is final before the 1st's billing run (BILL-7).
      for d in 0..2 loop
        perform public.fn_upsert_usage_daily(t.id, v_today - d);
      end loop;
    exception when others then
      raise warning 'fn_cron_usage_rollup: skipped tenant % (%)', t.id, sqlerrm;
    end;
  end loop;
end;
$$;

comment on function public.fn_cron_usage_rollup() is
  'Scheduled hourly (BILL-7) — re-rolls each tenant''s last three local days via fn_upsert_usage_daily (tenant-local day, test calls/bookings/orders excluded, voice channels only).';

create or replace function public.fn_ensure_realtime_partitions(
  p_days_back int default 1,
  p_days_ahead int default 3
) returns int
language plpgsql
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_day date;
  v_name text;
  v_created int := 0;
begin
  if to_regclass('realtime.messages') is null then
    return 0;
  end if;
  for v_offset in -greatest(p_days_back, 0) .. greatest(p_days_ahead, 0) loop
    v_day := (current_date + v_offset);
    v_name := 'messages_' || to_char(v_day, 'YYYY_MM_DD');
    if to_regclass(format('realtime.%I', v_name)) is null then
      begin
        execute format(
          'create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
          v_name, v_day::timestamp, (v_day + 1)::timestamp
        );
        v_created := v_created + 1;
      exception when others then
        raise warning 'fn_ensure_realtime_partitions: cannot create realtime.% (% %)',
          v_name, sqlstate, sqlerrm;
      end;
    end if;
  end loop;
  return v_created;
end;
$$;

-- Re-bucket the open month and the previous one with the corrected function
-- (the billing migration's backfill wrote the fanned-out counts).
do $$
declare
  t record;
begin
  for t in select id, timezone from public.tenants where deleted_at is null loop
    begin
      for d in 0..62 loop
        perform public.fn_upsert_usage_daily(
          t.id, ((now() at time zone coalesce(nullif(t.timezone, ''), 'UTC'))::date - d));
      end loop;
    exception when others then
      raise warning 'usage re-bucket skipped tenant % (%)', t.id, sqlerrm;
    end;
  end loop;
end;
$$;
