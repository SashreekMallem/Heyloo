-- SEC-2 review regression test (supabase/migrations/
-- 20260929170000_sec2_review_timezone_guard_and_customer_grants.sql).
--
-- Run as the database owner against a migrated database (CI: after
-- `supabase start`, `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f
-- supabase/tests/sec2_review_hardening.sql`). One transaction, rolled back.
--
--   1. An owner cannot store an unknown time zone in tenants.timezone (it
--      would abort fn_cron_usage_rollup for every tenant); valid zones still
--      save; an unknown zone on INSERT falls back to the column default; and
--      fn_cron_usage_rollup itself survives a bad zone that got in anyway.
--   2. A tenant member can update customers.metadata (the portal's notes
--      write) but NO other customers column (sms_opt_out, consent, phone...),
--      cannot INSERT/DELETE customers, and a user-scoped booking insert still
--      updates the customer's lifetime/segment through the (now SECURITY
--      DEFINER) triggers.

begin;

insert into auth.users (id, email) values
  ('5ec20000-0000-4000-8000-000000000101', 'sec2r-owner@heyloo-ci.local'),
  ('5ec20000-0000-4000-8000-000000000102', 'sec2r-member@heyloo-ci.local');

insert into public.tenants (id, name, slug, vertical) values
  ('5ec20000-0000-4000-8000-0000000001a1', 'SEC-2R tenant', 'sec2r-tenant', 'generic'),
  ('5ec20000-0000-4000-8000-0000000001a2', 'SEC-2R bystander', 'sec2r-bystander', 'generic');

insert into public.memberships (tenant_id, user_id, role) values
  ('5ec20000-0000-4000-8000-0000000001a1', '5ec20000-0000-4000-8000-000000000101', 'owner'),
  ('5ec20000-0000-4000-8000-0000000001a1', '5ec20000-0000-4000-8000-000000000102', 'member');

insert into public.resources (id, tenant_id, type, name)
  values ('5ec20000-0000-4000-8000-0000000001b1', '5ec20000-0000-4000-8000-0000000001a1', 'staff', 'r');

insert into public.customers (id, tenant_id, phone_e164, sms_opt_out, consent)
  values ('5ec20000-0000-4000-8000-0000000001c1', '5ec20000-0000-4000-8000-0000000001a1',
          '+15555550190', true, '{"sms": true}');

-- ---------------------------------------------------------------------
-- 1. time zone guard
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"5ec20000-0000-4000-8000-000000000101","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000001a1","role":"owner"}}',
  true);

do $$
declare
  v_rows bigint;
begin
  set local role authenticated;

  -- a real zone still saves (the portal write)
  update public.tenants set timezone = 'America/Chicago'
    where id = '5ec20000-0000-4000-8000-0000000001a1';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'SEC-2R FAIL: owner could not save a valid time zone (% rows)', v_rows;
  end if;

  -- names resolve case-insensitively in Postgres
  update public.tenants set timezone = 'america/new_york'
    where id = '5ec20000-0000-4000-8000-0000000001a1';

  -- an unknown zone must be rejected with 22023, not stored
  begin
    update public.tenants set timezone = 'Mars/Phobos'
      where id = '5ec20000-0000-4000-8000-0000000001a1';
    raise exception 'SEC-2R FAIL: owner stored the unknown time zone Mars/Phobos';
  exception when invalid_parameter_value then
    null; -- expected
  end;

  -- neither may an alias the JS Intl-based jobs cannot resolve
  begin
    update public.tenants set timezone = 'posix/America/Chicago'
      where id = '5ec20000-0000-4000-8000-0000000001a1';
    raise exception 'SEC-2R FAIL: owner stored posix/America/Chicago';
  exception when invalid_parameter_value then
    null; -- expected
  end;

  reset role;
end $$;

-- an unknown zone on INSERT (api-checkout passes a browser-supplied string)
-- falls back to the column default instead of failing the signup
insert into public.tenants (id, name, slug, vertical, timezone)
  values ('5ec20000-0000-4000-8000-0000000001a3', 'SEC-2R fallback', 'sec2r-fallback', 'generic', 'Mars/Phobos');
do $$
begin
  if (select timezone from public.tenants where id = '5ec20000-0000-4000-8000-0000000001a3')
     is distinct from 'America/New_York' then
    raise exception 'SEC-2R FAIL: unknown time zone on INSERT did not fall back to the default';
  end if;
end $$;

-- defence in depth: even if a bad zone is already stored (written before the
-- guard, or by a privileged path), the nightly rollup must not abort
do $$
begin
  -- (the guard trigger does not exist before the migration; tolerate that so the
  -- test can show the pre-fix failure of the rollup itself)
  if exists (select 1 from pg_trigger where tgname = 'trg_tenants_guard_timezone') then
    alter table public.tenants disable trigger trg_tenants_guard_timezone;
  end if;
  update public.tenants set timezone = 'Mars/Phobos'
    where id = '5ec20000-0000-4000-8000-0000000001a2';
  if exists (select 1 from pg_trigger where tgname = 'trg_tenants_guard_timezone') then
    alter table public.tenants enable trigger trg_tenants_guard_timezone;
  end if;
  perform public.fn_cron_usage_rollup(); -- raised 22023 for every tenant before the fix
end $$;

-- ---------------------------------------------------------------------
-- 2. customers: only `metadata` is writable
-- ---------------------------------------------------------------------
create function pg_temp.sec2r_customers_check(p_claims jsonb) returns void language plpgsql as $$
declare
  v_col text;
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  set local role authenticated;

  for v_col in
    select column_name::text from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name <> 'metadata'
    order by ordinal_position
  loop
    begin
      execute format('update public.customers set %1$I = %1$I where id = %2$L',
        v_col, '5ec20000-0000-4000-8000-0000000001c1');
      raise exception 'SEC-2R FAIL: authenticated could UPDATE customers.% (must be system-written)', v_col;
    exception when insufficient_privilege then
      null; -- expected
    end;
  end loop;

  -- the portal's notes write still works
  update public.customers set metadata = '{"notes": []}'
    where id = '5ec20000-0000-4000-8000-0000000001c1';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'SEC-2R FAIL: customers.metadata update changed % rows', v_rows;
  end if;

  begin
    insert into public.customers (tenant_id, phone_e164)
      values ('5ec20000-0000-4000-8000-0000000001a1', '+15555550191');
    raise exception 'SEC-2R FAIL: authenticated could INSERT into customers';
  exception when insufficient_privilege then
    null; -- expected
  end;

  begin
    delete from public.customers where id = '5ec20000-0000-4000-8000-0000000001c1';
    raise exception 'SEC-2R FAIL: authenticated could DELETE from customers';
  exception when insufficient_privilege then
    null; -- expected
  end;

  reset role;
end;
$$;

select pg_temp.sec2r_customers_check(
  '{"sub":"5ec20000-0000-4000-8000-000000000101","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000001a1","role":"owner"}}');
select pg_temp.sec2r_customers_check(
  '{"sub":"5ec20000-0000-4000-8000-000000000102","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000001a1","role":"member"}}');

-- the STOP flag and consent survived every attempt above
do $$
declare
  r record;
begin
  select sms_opt_out, consent into r from public.customers
    where id = '5ec20000-0000-4000-8000-0000000001c1';
  if r.sms_opt_out is distinct from true or r.consent is distinct from '{"sms": true}'::jsonb then
    raise exception 'SEC-2R FAIL: compliance columns changed (opt_out=%, consent=%)', r.sms_opt_out, r.consent;
  end if;
end $$;

-- a user-scoped booking insert fires fn_touch_customer / fn_recompute_customer_segment
-- as `authenticated`; with customers' UPDATE narrowed they must be SECURITY DEFINER
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5ec20000-0000-4000-8000-000000000101","role":"authenticated","app_metadata":{"tenant_id":"5ec20000-0000-4000-8000-0000000001a1","role":"owner"}}',
    true);
  set local role authenticated;
  insert into public.bookings (tenant_id, resource_id, customer_id, start_at, end_at, status)
    values ('5ec20000-0000-4000-8000-0000000001a1', '5ec20000-0000-4000-8000-0000000001b1',
            '5ec20000-0000-4000-8000-0000000001c1', now() + interval '3 days',
            now() + interval '3 days 1 hour', 'confirmed');
  reset role;
  if (select lifetime_bookings from public.customers
        where id = '5ec20000-0000-4000-8000-0000000001c1') <> 1 then
    raise exception 'SEC-2R FAIL: booking insert did not bump customers.lifetime_bookings';
  end if;
end $$;

rollback;
