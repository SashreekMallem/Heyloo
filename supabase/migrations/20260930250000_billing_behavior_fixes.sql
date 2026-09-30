-- BEHAVIOR-billing: schema support for the billing-cycle fixes (BILL-1, 4, 7, 10, 12).
-- Additive: new columns/functions/triggers only; nothing already applied is edited.
--
-- 1. tenants.canceled_at (BILL-10): job-billing-cycle bills a canceled tenant's
--    final usage when it was canceled inside or after the period being billed,
--    which needs to know WHEN it was canceled. webhooks-stripe sets it.
alter table public.tenants add column if not exists canceled_at timestamptz;

update public.tenants
set canceled_at = updated_at
where status = 'canceled' and canceled_at is null;

comment on column public.tenants.canceled_at is
  'When the subscription was canceled (webhooks-stripe customer.subscription.deleted); null while the tenant is not canceled. job-billing-cycle bills a canceled tenant''s last period when canceled_at >= period start.';

-- 2. billing_invoices report-state columns (BILL-1/2/4): the meter report and the
--    text-overage invoice item are recorded per invoice row so a failed report
--    is retried on the next run (stripe_report_pending) and a successful one is
--    never repeated (Stripe de-duplicates a meter identifier / idempotency key
--    only for ~24 h, which a daily retry would straddle).
alter table public.billing_invoices
  add column if not exists text_overage_cents int not null default 0,
  add column if not exists text_messages_billed int not null default 0,
  add column if not exists meter_reported_at timestamptz,
  add column if not exists text_overage_item_id text,
  add column if not exists stripe_report_pending boolean not null default false;

comment on column public.billing_invoices.overage_minutes is
  'Voice minutes beyond included_minutes, rounded to 6 decimals; this (not the total) is what is reported to the Stripe meter, whose price is the per-minute overage rate.';
comment on column public.billing_invoices.text_overage_cents is
  'AI text replies beyond included_text_conversations x text_conversation_overage_cents (BILL-4); billed to Stripe as one invoice item on the next invoice. total_cents includes it.';
comment on column public.billing_invoices.stripe_report_pending is
  'true while a Stripe meter event / invoice item for this period still has to be sent; job-billing-cycle retries it on each run.';

create index if not exists billing_invoices_report_pending_idx
  on public.billing_invoices (tenant_id, period_start)
  where stripe_report_pending;

-- 3. Round stored minutes to 6 decimals (BILL-12). usage_events.minutes was written
--    as durationSeconds / 60 (a JS float, e.g. 1.3333333333333333), so sums drift
--    (300 min summed to 300.000000000000005) and exceed Stripe's 15-digit limit.
create or replace function public.fn_usage_events_round_minutes()
returns trigger language plpgsql as $$
begin
  new.minutes := round(new.minutes, 6);
  return new;
end;
$$;

drop trigger if exists trg_usage_events_round_minutes on public.usage_events;
create trigger trg_usage_events_round_minutes
  before insert or update of minutes on public.usage_events
  for each row execute function public.fn_usage_events_round_minutes();

update public.usage_events
set minutes = round(minutes, 6)
where minutes <> round(minutes, 6);

-- 4. Tenant-local day bucketing (BILL-7). fn_upsert_usage_daily labelled the row with
--    the tenant-local date but filtered `started_at::date = p_date` in the session
--    time zone (UTC), so a 22:00 ET call landed on the next day. Same signature and
--    same columns as 20260911110000; text_messages_out is still left untouched
--    (event-sourced per message by the text agent).
create or replace function public.fn_upsert_usage_daily(p_tenant_id uuid, p_date date)
returns void language plpgsql as $$
declare
  v_price_version text;
  v_tz text;
begin
  select price_version, timezone into v_price_version, v_tz
  from public.tenants where id = p_tenant_id;
  v_tz := coalesce(v_tz, 'America/New_York');

  insert into public.usage_daily (
    tenant_id, date, total_calls, total_minutes, billable_minutes,
    total_bookings, total_orders, total_order_value_cents,
    price_version
  )
  select
    p_tenant_id, p_date,
    count(*) filter (where (cl.started_at at time zone v_tz)::date = p_date),
    round(coalesce(sum(cl.duration_seconds) filter (where (cl.started_at at time zone v_tz)::date = p_date), 0) / 60.0, 6),
    round(coalesce(sum(ue.minutes) filter (where ue.is_billable and (ue.occurred_at at time zone v_tz)::date = p_date), 0), 6),
    (select count(*) from public.bookings b where b.tenant_id = p_tenant_id and (b.created_at at time zone v_tz)::date = p_date),
    (select count(*) from public.orders o where o.tenant_id = p_tenant_id and (o.created_at at time zone v_tz)::date = p_date),
    (select coalesce(sum(o.total_cents), 0) from public.orders o where o.tenant_id = p_tenant_id and (o.created_at at time zone v_tz)::date = p_date),
    v_price_version
  from public.call_logs cl
  left join public.usage_events ue on ue.call_id = cl.id
  where cl.tenant_id = p_tenant_id
    -- only the calls that can fall on p_date (a day of slack either side for
    -- DST): the hourly rollup must not rescan a tenant's whole history.
    and cl.started_at >= ((p_date - 1)::timestamp at time zone v_tz)
    and cl.started_at < ((p_date + 2)::timestamp at time zone v_tz)
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

-- The rollup only reached local yesterday-minus-one, once at 00:10 UTC, so on
-- the 1st the last local day of the month was still missing. Roll the last three
-- LOCAL days (today, yesterday, the day before) every hour so the portal and any
-- reader of usage_daily stay fresh. job-billing-cycle no longer depends on this
-- (it sums usage_events for the exact tenant-local period), the two agree.
create or replace function public.fn_cron_usage_rollup()
returns void language plpgsql as $$
declare
  t record;
  d int;
begin
  for t in select id, timezone from public.tenants where deleted_at is null loop
    begin
      for d in 0..2 loop
        perform public.fn_upsert_usage_daily(t.id, ((now() at time zone t.timezone)::date - d));
      end loop;
    exception when others then
      raise warning 'fn_cron_usage_rollup: skipped tenant % (%)', t.id, sqlerrm;
    end;
  end loop;
end;
$$;

comment on function public.fn_cron_usage_rollup() is
  'Scheduled hourly (BILL-7) — re-rolls each tenant''s last three local days so the newest day is never more than an hour stale; usage is bucketed by the tenant''s own timezone.';

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skipping the hourly usage-rollup schedule (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  perform public.fn_cron_upsert('job-internal-usage-rollup', '5 * * * *',
    $sql$select public.fn_cron_usage_rollup();$sql$);
end;
$$;

-- Backfill the local-day bucketing for the open month plus the previous one.
do $$
declare
  t record;
  d int;
begin
  for t in select id, timezone from public.tenants where deleted_at is null loop
    begin
      for d in 0..62 loop
        perform public.fn_upsert_usage_daily(t.id, ((now() at time zone t.timezone)::date - d));
      end loop;
    exception when others then
      raise warning 'usage backfill skipped tenant % (%)', t.id, sqlerrm;
    end;
  end loop;
end;
$$;


-- 5. Vertical change on an unpaid tenant (BILL-6). api-checkout reuses an abandoned
--    trialing tenant for a new Checkout and updates its vertical to the one picked now
--    (webhooks-stripe also re-syncs it from the paid session's metadata). The default
--    average ticket is stamped from the vertical on INSERT only, so a switch would leave
--    an `auto` ticket on a `dental` tenant: re-stamp it, but only while it still holds
--    the old vertical's untouched default (never overwrite an owner-entered value).
create or replace function public.fn_vertical_default_avg_ticket(p_vertical text)
returns int language sql immutable as $$
  select case p_vertical
    when 'auto'        then 55000
    when 'vet'         then 17500
    when 'legal'       then 250000
    when 'dental'      then 65000
    when 'real_estate' then 800000
    when 'motel'       then 12500
    when 'restaurant'  then 4500
    else 10000
  end;
$$;

create or replace function public.fn_tenants_restamp_avg_ticket()
returns trigger language plpgsql as $$
begin
  if new.vertical is distinct from old.vertical
     and new.avg_transaction_value_cents is not distinct from old.avg_transaction_value_cents
     and old.avg_transaction_value_cents = public.fn_vertical_default_avg_ticket(old.vertical) then
    new.avg_transaction_value_cents := public.fn_vertical_default_avg_ticket(new.vertical);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tenants_restamp_avg_ticket on public.tenants;
create trigger trg_tenants_restamp_avg_ticket
  before update of vertical on public.tenants
  for each row execute function public.fn_tenants_restamp_avg_ticket();

-- Test tenants are kept out of billing by job-billing-cycle itself (is_test, and no
-- Stripe customer). The eight `test-*` QA tenants are deliberately NOT flagged is_test
-- here: that flag also turns off owner alerts, reminders and billable usage for them,
-- which the QA runs exercise.
