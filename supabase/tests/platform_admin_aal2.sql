-- SEC-01 regression test: platform-admin authority requires an aal2 session.
--
-- Runs as the database owner against a migrated database (CI: `psql
-- "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/
-- platform_admin_aal2.sql`). Asserts, all inside one rolled-back transaction:
--   * custom_access_token_hook stamps app_metadata.platform_admin only when
--     the event's claims.aal is 'aal2'; an aal1 (or aal-less) admin token gets
--     the inert admin_mfa_required marker and NO platform_admin claim.
--   * a non-admin never gets either claim.
--   * fn_jwt_is_platform_admin() is false for a platform_admin=true JWT at
--     aal1 (a token minted before the hook change) and true only at aal2.
--   * through the real `authenticated` role, an aal1 admin token reads 0
--     tenants rows while an aal2 admin token reads them all.

begin;

insert into auth.users (id, email) values
  ('5ec10000-0000-4000-8000-000000000001', 'sec1-admin@heyloo-ci.local'),
  ('5ec10000-0000-4000-8000-000000000002', 'sec1-plain@heyloo-ci.local');

insert into public.platform_admins (user_id, role)
  values ('5ec10000-0000-4000-8000-000000000001', 'superadmin');

insert into public.tenants (id, name, slug, vertical, avg_transaction_value_cents)
  values ('5ec10000-0000-4000-8000-0000000000a1', 'SEC-1 tenant', 'sec1-tenant', 'generic', 10000);

create or replace function pg_temp.sec1_assert(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'SEC-01 FAIL: %', label;
  end if;
end $$;

create or replace function pg_temp.sec1_hook(uid text, aal text) returns jsonb
language sql as $$
  select (public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', uid,
      'claims', jsonb_build_object(
        'aud', 'authenticated', 'sub', uid, 'role', 'authenticated', 'aal', aal,
        'app_metadata', '{}'::jsonb),
      'authentication_method', 'password')
  ) -> 'claims' -> 'app_metadata');
$$;

-- hook ---------------------------------------------------------------------
select pg_temp.sec1_assert(
  pg_temp.sec1_hook('5ec10000-0000-4000-8000-000000000001', 'aal1') ->> 'platform_admin' is null,
  'aal1 admin token must NOT carry platform_admin');
select pg_temp.sec1_assert(
  pg_temp.sec1_hook('5ec10000-0000-4000-8000-000000000001', 'aal1') ->> 'admin_mfa_required' = 'true',
  'aal1 admin token carries the admin_mfa_required marker');
select pg_temp.sec1_assert(
  pg_temp.sec1_hook('5ec10000-0000-4000-8000-000000000001', 'aal2') ->> 'platform_admin' = 'true',
  'aal2 admin token carries platform_admin');
select pg_temp.sec1_assert(
  pg_temp.sec1_hook('5ec10000-0000-4000-8000-000000000001', 'aal2') ->> 'admin_mfa_required' is null,
  'aal2 admin token has no MFA marker');
select pg_temp.sec1_assert(
  (public.custom_access_token_hook(jsonb_build_object(
    'user_id', '5ec10000-0000-4000-8000-000000000001',
    'claims', jsonb_build_object('sub', '5ec10000-0000-4000-8000-000000000001'),
    'authentication_method', 'password')) -> 'claims' -> 'app_metadata' ->> 'platform_admin') is null,
  'an event with no aal fails closed');
select pg_temp.sec1_assert(
  pg_temp.sec1_hook('5ec10000-0000-4000-8000-000000000002', 'aal2') ->> 'platform_admin' is null
  and pg_temp.sec1_hook('5ec10000-0000-4000-8000-000000000002', 'aal2') ->> 'admin_mfa_required' is null,
  'a non-admin never gets admin claims, even at aal2');

-- fn_jwt_is_platform_admin ---------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"5ec10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","app_metadata":{"platform_admin":true}}', true);
select pg_temp.sec1_assert(public.fn_jwt_is_platform_admin() is false,
  'legacy platform_admin=true token at aal1 is not an admin');
select set_config('request.jwt.claims',
  '{"sub":"5ec10000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"platform_admin":true}}', true);
select pg_temp.sec1_assert(public.fn_jwt_is_platform_admin() is false,
  'platform_admin=true with no aal claim is not an admin');
select set_config('request.jwt.claims',
  '{"sub":"5ec10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","app_metadata":{"platform_admin":true}}', true);
select pg_temp.sec1_assert(public.fn_jwt_is_platform_admin() is true,
  'platform_admin=true at aal2 is an admin');

-- real RLS through the authenticated role -----------------------------------
do $$
declare
  n_aal1 int;
  n_aal2 int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5ec10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","app_metadata":{"platform_admin":true}}', true);
  set local role authenticated;
  select count(*) into n_aal1 from public.tenants;
  reset role;

  perform set_config('request.jwt.claims',
    '{"sub":"5ec10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","app_metadata":{"platform_admin":true}}', true);
  set local role authenticated;
  select count(*) into n_aal2 from public.tenants;
  reset role;

  if n_aal1 <> 0 then
    raise exception 'SEC-01 FAIL: aal1 admin token read % tenants rows via RLS', n_aal1;
  end if;
  if n_aal2 < 1 then
    raise exception 'SEC-01 FAIL: aal2 admin token could not read tenants';
  end if;
end $$;

rollback;
