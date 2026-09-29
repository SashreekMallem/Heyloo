-- QA-1 portal-core regression test (supabase/migrations/20260930200200_qa1_portal_core.sql).
--
-- Run as the database owner against a migrated database (CI: after
-- `supabase start`, `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f
-- supabase/tests/qa1_portal_core.sql`). One transaction, rolled back.
--
--   1. F-02 / F-21: fn_cron_usage_rollup() writes a row for the tenant-LOCAL
--      today and yesterday (it used to roll up only the day before yesterday
--      for US tenants), buckets calls by the tenant-local day, excludes test
--      calls / test bookings and does not double count a call that has more
--      than one usage event.
--   2. F-04: a plain member may write their OWN
--      memberships.last_seen_notifications_at, nobody else's row, and no other
--      column.
--   3. F-05: fn_append_customer_note appends atomically, keeps the rest of
--      customers.metadata, and cannot touch another tenant's customer.

begin;

insert into auth.users (id, email) values
  ('a1c00000-0000-4000-8000-000000000101', 'qa1-owner@heyloo-ci.local'),
  ('a1c00000-0000-4000-8000-000000000102', 'qa1-member@heyloo-ci.local');

insert into public.tenants (id, name, slug, vertical, timezone) values
  ('a1c00000-0000-4000-8000-0000000001a1', 'QA-1 tenant', 'qa1-tenant', 'generic', 'America/New_York');

insert into public.memberships (tenant_id, user_id, role) values
  ('a1c00000-0000-4000-8000-0000000001a1', 'a1c00000-0000-4000-8000-000000000101', 'owner'),
  ('a1c00000-0000-4000-8000-0000000001a1', 'a1c00000-0000-4000-8000-000000000102', 'member');

insert into public.resources (id, tenant_id, type, name)
  values ('a1c00000-0000-4000-8000-0000000001b1', 'a1c00000-0000-4000-8000-0000000001a1', 'staff', 'r');

-- ---------------------------------------------------------------------
-- 1. usage rollup
-- ---------------------------------------------------------------------
do $$
declare
  v_tenant constant uuid := 'a1c00000-0000-4000-8000-0000000001a1';
  v_today date := (now() at time zone 'America/New_York')::date;
  v_call_a uuid := 'a1c00000-0000-4000-8000-0000000001c1';
  r record;
begin
  -- a real call at local noon today (120 s)
  insert into public.call_logs (id, tenant_id, retell_call_id, caller_number, started_at, duration_seconds)
    values (v_call_a, v_tenant, 'qa1-call-a', '+15555550111',
            (v_today + time '12:00') at time zone 'America/New_York', 120);
  -- two billable usage events for the SAME call: must not double count the call
  insert into public.usage_events (tenant_id, call_id, minutes, occurred_at, is_billable) values
    (v_tenant, v_call_a, 1, (v_today + time '12:02') at time zone 'America/New_York', true),
    (v_tenant, v_call_a, 2, (v_today + time '12:03') at time zone 'America/New_York', true);
  -- a test call today: excluded
  insert into public.call_logs (tenant_id, retell_call_id, caller_number, started_at, duration_seconds, is_test_call)
    values (v_tenant, 'qa1-call-test', '+15555550112',
            (v_today + time '13:00') at time zone 'America/New_York', 60, true);
  -- a call at 23:30 local YESTERDAY (already the next UTC day): belongs to yesterday
  insert into public.call_logs (tenant_id, retell_call_id, caller_number, started_at, duration_seconds)
    values (v_tenant, 'qa1-call-yesterday', '+15555550113',
            ((v_today - 1) + time '23:30') at time zone 'America/New_York', 30);

  -- one real and one test booking created today
  insert into public.bookings (tenant_id, resource_id, start_at, end_at, status, is_test) values
    (v_tenant, 'a1c00000-0000-4000-8000-0000000001b1', now() + interval '2 days', now() + interval '2 days 1 hour', 'scheduled', false),
    (v_tenant, 'a1c00000-0000-4000-8000-0000000001b1', now() + interval '3 days', now() + interval '3 days 1 hour', 'scheduled', true);

  perform public.fn_cron_usage_rollup();

  select * into r from public.usage_daily where tenant_id = v_tenant and date = v_today;
  if not found then
    raise exception 'QA-1 FAIL: no usage_daily row for the tenant-local today (%)', v_today;
  end if;
  if r.total_calls <> 1 then
    raise exception 'QA-1 FAIL: today total_calls = % (expected 1: test call excluded, no usage_events fan-out)', r.total_calls;
  end if;
  if r.total_minutes <> 2 then
    raise exception 'QA-1 FAIL: today total_minutes = % (expected 2)', r.total_minutes;
  end if;
  if r.billable_minutes <> 3 then
    raise exception 'QA-1 FAIL: today billable_minutes = % (expected 3)', r.billable_minutes;
  end if;
  if r.total_bookings <> 1 then
    raise exception 'QA-1 FAIL: today total_bookings = % (expected 1: test booking excluded)', r.total_bookings;
  end if;

  select * into r from public.usage_daily where tenant_id = v_tenant and date = v_today - 1;
  if not found then
    raise exception 'QA-1 FAIL: no usage_daily row for the tenant-local yesterday';
  end if;
  if r.total_calls <> 1 then
    raise exception 'QA-1 FAIL: yesterday total_calls = % (expected 1: the 23:30 local call)', r.total_calls;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. members write only their own notification watermark
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a1c00000-0000-4000-8000-000000000102","role":"authenticated","app_metadata":{"tenant_id":"a1c00000-0000-4000-8000-0000000001a1","role":"member"}}',
  true);

do $$
declare
  v_rows bigint;
begin
  set local role authenticated;

  update public.memberships set last_seen_notifications_at = now()
    where tenant_id = 'a1c00000-0000-4000-8000-0000000001a1'
      and user_id = 'a1c00000-0000-4000-8000-000000000102';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'QA-1 FAIL: a member could not update their own last_seen_notifications_at (% rows)', v_rows;
  end if;

  -- another member's (the owner's) row is untouchable for a plain member
  update public.memberships set last_seen_notifications_at = now()
    where tenant_id = 'a1c00000-0000-4000-8000-0000000001a1'
      and user_id = 'a1c00000-0000-4000-8000-000000000101';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'QA-1 FAIL: a member updated another member''s membership row (% rows)', v_rows;
  end if;

  -- and the column grant still forbids any other column (no self-promotion)
  begin
    update public.memberships set role = 'owner'
      where user_id = 'a1c00000-0000-4000-8000-000000000102';
    raise exception 'QA-1 FAIL: a member could update memberships.role';
  exception when insufficient_privilege then
    null; -- expected
  end;

  reset role;
end $$;

-- ---------------------------------------------------------------------
-- 3. fn_append_customer_note appends atomically, only within the JWT tenant
-- ---------------------------------------------------------------------
insert into public.tenants (id, name, slug, vertical) values
  ('a1c00000-0000-4000-8000-0000000001a2', 'QA-1 bystander', 'qa1-bystander', 'generic');
insert into public.customers (id, tenant_id, phone_e164, metadata) values
  ('a1c00000-0000-4000-8000-0000000001d1', 'a1c00000-0000-4000-8000-0000000001a1', '+15555550121', '{"pets": [{"name": "Rex"}]}'),
  ('a1c00000-0000-4000-8000-0000000001d2', 'a1c00000-0000-4000-8000-0000000001a2', '+15555550122', '{}');

select set_config('request.jwt.claims',
  '{"sub":"a1c00000-0000-4000-8000-000000000101","role":"authenticated","app_metadata":{"tenant_id":"a1c00000-0000-4000-8000-0000000001a1","role":"owner"}}',
  true);

do $$
declare
  v_ok boolean;
  v_meta jsonb;
begin
  set local role authenticated;

  v_ok := public.fn_append_customer_note('a1c00000-0000-4000-8000-0000000001d1', 'first note');
  if v_ok is distinct from true then
    raise exception 'QA-1 FAIL: fn_append_customer_note returned % for an own-tenant customer', v_ok;
  end if;
  perform public.fn_append_customer_note('a1c00000-0000-4000-8000-0000000001d1', 'second note');

  -- another tenant's customer is untouchable
  v_ok := public.fn_append_customer_note('a1c00000-0000-4000-8000-0000000001d2', 'sneaky');
  if v_ok is distinct from false then
    raise exception 'QA-1 FAIL: fn_append_customer_note touched another tenant''s customer (%)', v_ok;
  end if;

  -- blank notes are rejected
  if public.fn_append_customer_note('a1c00000-0000-4000-8000-0000000001d1', '   ') then
    raise exception 'QA-1 FAIL: a blank note was appended';
  end if;

  reset role;

  select metadata into v_meta from public.customers where id = 'a1c00000-0000-4000-8000-0000000001d1';
  if jsonb_array_length(v_meta -> 'notes') <> 2
     or v_meta -> 'notes' -> 0 ->> 'body' <> 'first note'
     or v_meta -> 'notes' -> 1 ->> 'body' <> 'second note'
     or v_meta -> 'notes' -> 0 ->> 'author_id' <> 'a1c00000-0000-4000-8000-000000000101'
     or v_meta -> 'pets' -> 0 ->> 'name' <> 'Rex' then
    raise exception 'QA-1 FAIL: unexpected customers.metadata after two appends: %', v_meta;
  end if;
  if (select metadata from public.customers where id = 'a1c00000-0000-4000-8000-0000000001d2') <> '{}'::jsonb then
    raise exception 'QA-1 FAIL: the bystander customer''s metadata changed';
  end if;
end $$;

rollback;
