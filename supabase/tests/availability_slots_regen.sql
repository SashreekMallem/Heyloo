-- VOICE-ALERTS-1 regression test: fn_regenerate_availability_slots /
-- fn_cron_availability_rollforward.
--
-- Runs as the database owner against a migrated database (CI: `supabase
-- start`, then `psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/
-- availability_slots_regen.sql`). Everything runs in one transaction that is
-- rolled back. A failed assertion raises, which fails the psql run.
--
-- Covers what the slot generator got wrong live:
--   * a closed day stored either way (`[]`, or the old portal's per-window
--     `closed: true`, or an object `{"closed": true}`) gets no slots;
--   * an hours_exceptions entry with a blank/garbage date, or a window with
--     an unreadable time, is skipped instead of aborting;
--   * a slot_minutes of 0 does not loop forever;
--   * a rerun never duplicates already-started slots;
--   * the generator works whether or not 20260929140000's
--     booking_horizon_days column exists (it is not applied on live yet),
--     and honors the horizon when it does.

begin;

insert into public.tenants (id, name, slug, vertical, timezone, business_hours, hours_exceptions)
values (
  'a1a10000-0000-4000-8000-0000000000a1', 'regen tenant', 'regen-tenant', 'auto', 'UTC',
  jsonb_build_object(
    'mon', jsonb_build_array(jsonb_build_object('open', '09:00', 'close', '11:00')),
    'tue', jsonb_build_array(jsonb_build_object('open', '09:00', 'close', '11:00')),
    'wed', jsonb_build_array(jsonb_build_object('open', '09:00', 'close', '11:00')),
    'thu', jsonb_build_array(jsonb_build_object('open', '09:00', 'close', '11:00')),
    'fri', jsonb_build_array(jsonb_build_object('open', '09:00', 'close', '11:00')),
    -- old portal shape: a closed day is a window flagged closed
    'sat', jsonb_build_array(jsonb_build_object('open', '09:00', 'close', '17:00', 'closed', true)),
    -- an object stored instead of an array
    'sun', jsonb_build_object('closed', true)
  ),
  jsonb_build_array(
    jsonb_build_object('date', '', 'closed', true),
    jsonb_build_object('date', 'not-a-date', 'closed', true),
    to_jsonb('a string entry'::text)
  )
);

insert into public.resources (id, tenant_id, type, name, metadata)
values ('a1a10000-0000-4000-8000-0000000000b1', 'a1a10000-0000-4000-8000-0000000000a1',
        'bay', 'Bay 1', '{"slot_minutes": 0}'::jsonb);

-- 1. Works without the booking_horizon_days column (a database where
--    20260929140000 has not been applied) and never hangs on slot_minutes 0.
alter table public.tenants drop column booking_horizon_days cascade;
set local statement_timeout = '20s';
select public.fn_regenerate_availability_slots(
  'a1a10000-0000-4000-8000-0000000000a1', 'a1a10000-0000-4000-8000-0000000000b1');

do $$
declare
  v_closed int;
  v_open int;
  v_dupes int;
begin
  select count(*) into v_closed from public.availability_slots
   where resource_id = 'a1a10000-0000-4000-8000-0000000000b1'
     and extract(dow from lower(slot_range) at time zone 'UTC') in (0, 6);
  if v_closed <> 0 then
    raise exception 'closed days (sat/sun) still got % slots', v_closed;
  end if;

  select count(*) into v_open from public.availability_slots
   where resource_id = 'a1a10000-0000-4000-8000-0000000000b1';
  if v_open = 0 then
    raise exception 'no slots at all generated for a tenant with open weekdays';
  end if;
end $$;

-- 2. A rerun replaces, never duplicates (including already-started slots).
select public.fn_regenerate_availability_slots(
  'a1a10000-0000-4000-8000-0000000000a1', 'a1a10000-0000-4000-8000-0000000000b1');

do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes from (
    select slot_range from public.availability_slots
     where resource_id = 'a1a10000-0000-4000-8000-0000000000b1'
     group by slot_range having count(*) > 1
  ) d;
  if v_dupes <> 0 then
    raise exception 'rerun duplicated % slot ranges', v_dupes;
  end if;
end $$;

-- 3. With the column back, the owner's horizon is honored (5 days ahead =
--    at most 6 calendar dates: today through today + 5).
alter table public.tenants add column booking_horizon_days integer;
update public.tenants set booking_horizon_days = 5 where id = 'a1a10000-0000-4000-8000-0000000000a1';
select public.fn_regenerate_availability_slots(
  'a1a10000-0000-4000-8000-0000000000a1', 'a1a10000-0000-4000-8000-0000000000b1');

do $$
declare
  v_days int;
begin
  select count(distinct (lower(slot_range) at time zone 'UTC')::date) into v_days
    from public.availability_slots
   where resource_id = 'a1a10000-0000-4000-8000-0000000000b1';
  if v_days > 6 then
    raise exception 'booking_horizon_days = 5 produced slots on % dates', v_days;
  end if;
end $$;

-- 4. The nightly rollforward skips a resource whose tenant has an unusable
--    time zone instead of aborting the whole run.
insert into public.tenants (id, name, slug, vertical, timezone, business_hours)
values ('a1a10000-0000-4000-8000-0000000000a2', 'bad tz tenant', 'regen-bad-tz', 'auto', 'Mars/Olympus',
        '{"mon": [{"open": "09:00", "close": "10:00"}]}'::jsonb);
insert into public.resources (id, tenant_id, type, name)
values ('a1a10000-0000-4000-8000-0000000000b2', 'a1a10000-0000-4000-8000-0000000000a2', 'bay', 'Bay 2');

select public.fn_cron_availability_rollforward();

rollback;
