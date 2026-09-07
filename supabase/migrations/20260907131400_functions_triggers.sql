-- Postgres functions + trigger inventory. BACKEND_SPEC.md §3-4.
-- Deviations from the doc's literal code sketches are called out inline
-- and in docs/BUILD_NOTES.md (task T1) — each is a correctness fix, not a
-- design change.

-- =====================================================================
-- 3.1 Custom Access Token Hook
-- =====================================================================
-- DEVIATIONS from the BACKEND_SPEC §3.1 sketch:
--  1. Marked `security definer` (function runs with the privileges/
--     ownership context of whoever creates it, i.e. the migration-applying
--     superuser on a Supabase project) with `set search_path = ''` and
--     fully-schema-qualified identifiers. Without `security definer`,
--     supabase_auth_admin (a non-superuser role with no JWT claims of its
--     own) would execute this function as itself, RLS on
--     memberships/platform_admins/referral_partners would apply, and every
--     lookup would silently return zero rows — breaking the hook. This is
--     the pattern Supabase's own custom-access-token-hook documentation
--     uses.
--  2. Real bug found by local verification (docs/BUILD_NOTES.md task T1):
--     `jsonb_set(claims, '{app_metadata,tenant_id}', ...)` is a documented
--     Postgres no-op — NOT an insert — whenever an intermediate path
--     element (here, `app_metadata` itself) does not already exist in the
--     target; only the FINAL path segment is created on demand. GoTrue's
--     real event.claims payload is expected to already carry
--     `app_metadata` (even as `{}`), so this likely would not surface
--     against a live Supabase Auth instance, but the sketch had no
--     defensive handling for the case where it's absent — a silent
--     failure to attach tenant scoping is exactly the kind of bug that
--     should never be allowed to fail silently in the multi-tenancy
--     boundary. Fixed by ensuring `app_metadata` exists as an object
--     before every jsonb_set call that writes under it.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  v_user_id uuid := (event->>'user_id')::uuid;
  v_membership record;
  v_is_admin boolean;
  v_partner_id uuid;
begin
  claims := event->'claims';
  if not (claims ? 'app_metadata') then
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;

  select tenant_id, role into v_membership
  from public.memberships
  where user_id = v_user_id
  limit 1; -- DECIDE (BACKEND_SPEC §11.2): multi-tenant users pick primary
           -- membership; UI switches tenant via a re-auth/refresh that
           -- re-derives claims for the selected tenant.

  select exists(select 1 from public.platform_admins where user_id = v_user_id) into v_is_admin;
  select id into v_partner_id from public.referral_partners where user_id = v_user_id;

  if v_membership.tenant_id is not null then
    claims := jsonb_set(claims, '{app_metadata,tenant_id}', to_jsonb(v_membership.tenant_id::text));
    claims := jsonb_set(claims, '{app_metadata,role}', to_jsonb(v_membership.role));
  end if;

  if v_is_admin then
    claims := jsonb_set(claims, '{app_metadata,platform_admin}', 'true');
  end if;

  if v_partner_id is not null then
    claims := jsonb_set(claims, '{app_metadata,referral_partner_id}', to_jsonb(v_partner_id::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

comment on function public.custom_access_token_hook is
  'Registered via [auth.hook.custom_access_token] in supabase/config.toml (local) / Auth Hooks dashboard config (hosted) — uri = pg-functions://postgres/public/custom_access_token_hook. Verify current registration mechanism against supabase.com/docs before relying on this in a fresh project (CLAUDE.md Rule 1).';

-- =====================================================================
-- Tenant default avg_transaction_value_cents (MASTER_SPEC §3.8)
-- =====================================================================
create or replace function public.fn_default_tenant_avg_ticket()
returns trigger language plpgsql as $$
begin
  if new.avg_transaction_value_cents is null then
    new.avg_transaction_value_cents := case new.vertical
      when 'auto'   then 55000
      when 'vet'    then 17500
      when 'legal'         then 250000
      when 'dental'        then 65000
      when 'real_estate'   then 800000
      when 'motel'         then 12500
      when 'restaurant'    then 4500
      else 10000 -- generic
    end;
  end if;
  return new;
end;
$$;

create trigger trg_tenants_default_avg_ticket
  before insert on public.tenants
  for each row execute function public.fn_default_tenant_avg_ticket();

-- =====================================================================
-- 3.2 Availability regeneration (pre-subdivided, per MASTER_SPEC §2)
-- =====================================================================
-- DEVIATIONS from the BACKEND_SPEC §3.2 sketch:
--  1. Fills in the per-vertical subdivision granularity the doc left as a
--     `DECIDE:` placeholder: 30-min default, dental 30 (15-min is a
--     per-resource opt-in via resources.metadata->>'slot_minutes'), motel
--     per-night (whole-calendar-day slots, ignoring business_hours since a
--     motel's front-desk hours aren't the same thing as room availability).
--  2. Fixes a real bug in the sketch's hours_exceptions handling: the
--     original `coalesce(<exception match filtered to NOT closed>, v_hours
--     ->v_dow)` falls through to normal business_hours on a day explicitly
--     marked closed (since the exception subquery's own filter excludes
--     closed rows, coalesce never sees "closed" and always uses the
--     fallback) — i.e. a holiday closure would have been silently ignored
--     and slots generated anyway. Fixed below by checking for a closed
--     exception explicitly and short-circuiting to an empty window set.
--  3. days_ahead defaults to 21 (30 for motels) per MASTER_SPEC §2 rather
--     than a bare literal default.
create or replace function public.fn_regenerate_availability_slots(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_days_ahead int default null
) returns void
language plpgsql as $$
declare
  v_tz text;
  v_vertical text;
  v_hours jsonb;
  v_exceptions jsonb;
  v_resource_meta jsonb;
  v_slot_minutes int;
  v_days_ahead int;
  v_day date;
  v_dow text;
  v_is_closed boolean;
  v_day_windows jsonb;
  v_window jsonb;
  v_window_open timestamptz;
  v_window_close timestamptz;
  v_slot_start timestamptz;
begin
  select t.timezone, t.vertical, t.business_hours, t.hours_exceptions
    into v_tz, v_vertical, v_hours, v_exceptions
  from public.tenants t where t.id = p_tenant_id;

  select r.metadata into v_resource_meta from public.resources r where r.id = p_resource_id;

  v_slot_minutes := coalesce(
    nullif(v_resource_meta->>'slot_minutes', '')::int,
    case when v_vertical = 'motel' then 1440 else 30 end
  );
  v_days_ahead := coalesce(p_days_ahead, case when v_vertical = 'motel' then 30 else 21 end);

  -- Clear only future generated (non-manual-block) slots for this resource
  -- before regenerating, so schedule-change edits are idempotent.
  delete from public.availability_slots
  where resource_id = p_resource_id
    and source = 'generated'
    and lower(slot_range) >= now();

  for v_day in select generate_series(current_date, current_date + v_days_ahead, '1 day')::date loop

    if v_vertical = 'motel' then
      -- Per-night: one slot spanning the full calendar day.
      insert into public.availability_slots (tenant_id, resource_id, slot_range, source)
      values (
        p_tenant_id, p_resource_id,
        tstzrange(v_day::timestamp at time zone v_tz, (v_day + 1)::timestamp at time zone v_tz, '[)'),
        'generated'
      );
      continue;
    end if;

    v_dow := lower(to_char(v_day, 'dy'));

    select coalesce((e.value->>'closed')::boolean, false)
      into v_is_closed
    from jsonb_array_elements(v_exceptions) e(value)
    where (e.value->>'date')::date = v_day;

    if coalesce(v_is_closed, false) then
      v_day_windows := '[]'::jsonb;
    else
      select e.value->'hours'
        into v_day_windows
      from jsonb_array_elements(v_exceptions) e(value)
      where (e.value->>'date')::date = v_day and e.value ? 'hours';

      if v_day_windows is null then
        v_day_windows := coalesce(v_hours->v_dow, '[]'::jsonb);
      end if;
    end if;

    for v_window in select jsonb_array_elements(v_day_windows) loop
      v_window_open := (v_day || ' ' || (v_window->>'open'))::timestamp at time zone v_tz;
      v_window_close := (v_day || ' ' || (v_window->>'close'))::timestamp at time zone v_tz;
      v_slot_start := v_window_open;
      while v_slot_start + make_interval(mins => v_slot_minutes) <= v_window_close loop
        insert into public.availability_slots (tenant_id, resource_id, slot_range, source)
        values (
          p_tenant_id, p_resource_id,
          tstzrange(v_slot_start, v_slot_start + make_interval(mins => v_slot_minutes), '[)'),
          'generated'
        );
        v_slot_start := v_slot_start + make_interval(mins => v_slot_minutes);
      end loop;
    end loop;
  end loop;
end;
$$;

-- =====================================================================
-- 3.3 Usage upsert
-- =====================================================================
create or replace function public.fn_upsert_usage_daily(p_tenant_id uuid, p_date date)
returns void language plpgsql as $$
declare
  v_price_version text;
begin
  select price_version into v_price_version from public.tenants where id = p_tenant_id;

  insert into public.usage_daily (
    tenant_id, date, total_calls, total_minutes, billable_minutes,
    total_bookings, total_orders, total_order_value_cents, price_version
  )
  select
    p_tenant_id, p_date,
    count(*) filter (where cl.started_at::date = p_date),
    coalesce(sum(cl.duration_seconds) filter (where cl.started_at::date = p_date), 0) / 60.0,
    coalesce(sum(ue.minutes) filter (where ue.is_billable and ue.occurred_at::date = p_date), 0),
    (select count(*) from public.bookings b where b.tenant_id = p_tenant_id and b.created_at::date = p_date),
    (select count(*) from public.orders o where o.tenant_id = p_tenant_id and o.created_at::date = p_date),
    (select coalesce(sum(o.total_cents), 0) from public.orders o where o.tenant_id = p_tenant_id and o.created_at::date = p_date),
    v_price_version
  from public.call_logs cl
  left join public.usage_events ue on ue.call_id = cl.id
  where cl.tenant_id = p_tenant_id
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

-- =====================================================================
-- 3.4 Broadcast triggers (tenant-scoped realtime)
-- =====================================================================
-- realtime.broadcast_changes(topic, event, operation, table, schema, new, old)
-- per current supabase.com/docs Broadcast-from-Database guidance (verified
-- parameter order at build time, Rule 1). plpgsql function bodies are not
-- validated against the catalog at CREATE time, so this migration applies
-- cleanly even before the `realtime` schema exists (e.g. a bare local
-- Postgres without the Supabase platform's realtime extension) — it will
-- only fail at first invocation in that environment, which is expected;
-- see docs/BUILD_NOTES.md for how this was verified.
create or replace function public.fn_broadcast_tenant_update()
returns trigger
security definer
set search_path = ''
language plpgsql as $$
declare
  v_tenant_id uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  perform realtime.broadcast_changes(
    'tenant:' || v_tenant_id,   -- topic: private per-tenant channel
    tg_op, tg_op,               -- event, operation
    tg_table_name, tg_table_schema,
    new, old
  );
  return coalesce(new, old);
end;
$$;

comment on function public.fn_broadcast_tenant_update() is
  'The frontend never reads row payload off the broadcast for anything sensitive — it refetches via TanStack Query on receipt (SYSTEM_DESIGN: "fires only on update, delivered only to that tenant, frontend refetches").';

create trigger trg_broadcast_call_logs after insert or update on public.call_logs
  for each row execute function public.fn_broadcast_tenant_update();
create trigger trg_broadcast_bookings after insert or update on public.bookings
  for each row execute function public.fn_broadcast_tenant_update();
create trigger trg_broadcast_orders after insert or update on public.orders
  for each row execute function public.fn_broadcast_tenant_update();
create trigger trg_broadcast_support_requests after insert or update on public.support_requests
  for each row execute function public.fn_broadcast_tenant_update();

-- =====================================================================
-- 3.5 Availability invalidation on booking write
-- =====================================================================
create or replace function public.fn_invalidate_availability_on_booking()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' and new.status = 'confirmed')
     or (tg_op = 'UPDATE' and new.status = 'confirmed' and old.status is distinct from 'confirmed') then
    update public.availability_slots
    set is_available = false
    where resource_id = new.resource_id
      and slot_range && new.during;
  elsif (tg_op = 'UPDATE' and old.status = 'confirmed'
         and new.status in ('cancelled','no_show')) then
    update public.availability_slots
    set is_available = true
    where resource_id = new.resource_id
      and slot_range && new.during
      and source = 'generated';
  end if;
  return new;
end;
$$;

create trigger trg_bookings_invalidate_availability
  after insert or update on public.bookings
  for each row execute function public.fn_invalidate_availability_on_booking();

-- =====================================================================
-- Waitlist notification on cancellation (MASTER_SPEC §3.4)
-- =====================================================================
-- Matches active waitlist_entries whose window overlaps the freed slot and
-- enqueues an outbound SMS per match; the actual Twilio send happens in the
-- messages_outbound queue worker (T3/T4), not here.
create or replace function public.fn_notify_waitlist_on_cancellation()
returns trigger language plpgsql as $$
declare
  v_entry record;
begin
  if tg_op = 'UPDATE' and old.status = 'confirmed' and new.status in ('cancelled','no_show') then
    for v_entry in
      select we.* from public.waitlist_entries we
      where we.tenant_id = new.tenant_id
        and we.status = 'active'
        and we."window" && new.during
    loop
      update public.waitlist_entries set status = 'notified' where id = v_entry.id;
      insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload, related_booking_id)
      select new.tenant_id, 'sms', c.phone_e164, 'waitlist_slot_opened',
             jsonb_build_object('start', lower(new.during), 'waitlist_entry_id', v_entry.id),
             new.id
      from public.customers c where c.id = v_entry.customer_id;
    end loop;
  end if;
  return new;
end;
$$;

create trigger trg_bookings_notify_waitlist
  after update on public.bookings
  for each row execute function public.fn_notify_waitlist_on_cancellation();

-- =====================================================================
-- 3.6 Customer segment recompute
-- =====================================================================
-- `DECIDE:` (BACKEND_SPEC §3.6) thresholds are placeholders pending real
-- usage data; kept as literals here (not yet exposed via platform_settings
-- — that indirection is a follow-up once thresholds actually need tuning,
-- tracked in docs/BUILD_NOTES.md rather than built speculatively now).
create or replace function public.fn_recompute_customer_segment()
returns trigger language plpgsql as $$
begin
  update public.customers set
    segment = case
      when lifetime_bookings >= 10 or lifetime_value_cents >= 100000 then 'vip'
      when lifetime_bookings >= 4 then 'loyal'
      when lifetime_bookings >= 2 then 'returning'
      else 'new'
    end,
    last_seen_at = now()
  where id = new.customer_id;
  return new;
end;
$$;

create trigger trg_bookings_recompute_segment
  after insert or update of status on public.bookings
  for each row when (new.status = 'completed')
  execute function public.fn_recompute_customer_segment();

-- =====================================================================
-- 3.7 Referral qualification
-- =====================================================================
create or replace function public.fn_check_referral_qualification()
returns void language plpgsql as $$
begin
  update public.referrals r
  set status = 'qualified',
      qualified_at = now(),
      amount_cents_snapshot = (
        select (value->>'flat_amount_cents')::int
        from public.platform_settings where key = 'referral_flat_amount_cents'
      )
  where r.status = 'pending'
    and r.fraud_flag = false
    and (
      select count(*) from public.billing_invoices bi
      where bi.tenant_id = r.referred_tenant_id and bi.status = 'paid'
    ) >= 2; -- default rule: qualifies after 2nd paid month (SYSTEM_DESIGN §6, §10)

  insert into public.commission_events (referral_partner_id, referral_id, tenant_id, amount_cents, status)
  select r.referral_partner_id, r.id, r.referred_tenant_id, r.amount_cents_snapshot, 'accrued'
  from public.referrals r
  where r.status = 'qualified'
    and not exists (select 1 from public.commission_events ce where ce.referral_id = r.id);
end;
$$;

-- =====================================================================
-- §4 Trigger inventory — remaining function-backed triggers
-- =====================================================================

create or replace function public.fn_rollup_call_cost()
returns trigger language plpgsql as $$
begin
  if new.call_id is not null then
    update public.call_logs
    set cost_cents = coalesce((
      select sum(total_cost_cents)::int from public.cost_events where call_id = new.call_id
    ), 0)
    where id = new.call_id;
  end if;
  return new;
end;
$$;
create trigger trg_call_logs_cost_rollup after insert on public.cost_events
  for each row execute function public.fn_rollup_call_cost();

-- DEVIATIONS from the BACKEND_SPEC §4 trigger-inventory sketch:
--  1. That table lists call_logs alongside bookings/orders as a source for
--     trg_customers_touch, but call_logs has no customer_id column (it
--     tracks caller_number, not a customer FK) — attaching this trigger
--     there would fail at runtime with "record has no field customer_id".
--     Only the two CREATE TRIGGER statements the doc actually gives
--     (bookings, orders) are wired.
--  2. Real bug found by local verification (docs/BUILD_NOTES.md task T1):
--     the sketch's `new.total_cents` is a *static* field reference — since
--     this one function is shared across two tables with different row
--     shapes (bookings has no total_cents column at all), PL/pgSQL raises
--     "record 'new' has no field 'total_cents'" on every booking-insert
--     invocation, not just when it's actually an orders row, because field
--     access on a `record`-typed trigger variable is resolved against the
--     row literally passed at that invocation regardless of which branch
--     of the surrounding CASE would use it. Fixed by reading the field
--     dynamically via to_jsonb(new)->>'total_cents' (returns NULL, not an
--     error, when the row type lacks that key) instead of new.total_cents.
create or replace function public.fn_touch_customer()
returns trigger language plpgsql as $$
begin
  if new.customer_id is not null then
    update public.customers set
      last_seen_at = now(),
      lifetime_calls = lifetime_calls + (case when tg_table_name = 'call_logs' then 1 else 0 end),
      lifetime_bookings = lifetime_bookings + (case when tg_table_name = 'bookings' then 1 else 0 end),
      lifetime_value_cents = lifetime_value_cents +
        (case when tg_table_name = 'orders' then coalesce((to_jsonb(new)->>'total_cents')::int, 0) else 0 end)
    where id = new.customer_id;
  end if;
  return new;
end;
$$;
create trigger trg_customers_touch_bookings after insert on public.bookings
  for each row execute function public.fn_touch_customer();
create trigger trg_customers_touch_orders after insert on public.orders
  for each row execute function public.fn_touch_customer();
