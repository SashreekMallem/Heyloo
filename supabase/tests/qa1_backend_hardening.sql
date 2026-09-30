-- QA-1 backend hardening regression test (migration
-- 20260930200600_qa1_backend_hardening.sql: BE-03, SEC-13, SEC-14).
--
-- Runs as the database owner against a migrated database:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/qa1_backend_hardening.sql
-- Everything is one transaction that is rolled back. Each check raises on
-- failure, so ON_ERROR_STOP makes the run fail.

begin;

-- ---------------------------------------------------------------------
-- BE-03: the realtime partition window function exists, is not callable by
-- the browser roles, and (where the migration role owns realtime.messages)
-- creates today's partition.
-- ---------------------------------------------------------------------
do $$
declare
  v_owner boolean;
begin
  if to_regprocedure('public.fn_ensure_realtime_partitions(integer,integer)') is null then
    raise exception 'BE-03: fn_ensure_realtime_partitions is missing';
  end if;
  if has_function_privilege('anon', 'public.fn_ensure_realtime_partitions(integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_ensure_realtime_partitions(integer,integer)', 'execute') then
    raise exception 'BE-03: fn_ensure_realtime_partitions must not be executable by browser roles';
  end if;

  if to_regclass('realtime.messages') is not null then
    perform public.fn_ensure_realtime_partitions();
    select pg_get_userbyid(relowner) = current_user into v_owner
      from pg_class where oid = 'realtime.messages'::regclass;
    if v_owner and not exists (
      select 1 from pg_inherits i join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'realtime.messages'::regclass
        and c.relname = 'messages_' || to_char(current_date, 'YYYY_MM_DD')
    ) then
      raise exception 'BE-03: no realtime.messages partition for today after fn_ensure_realtime_partitions()';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- SEC-13: adapter_connections ciphertext columns are not readable by
-- browser roles; the status columns still are; no browser writes.
-- ---------------------------------------------------------------------
do $$
declare
  v_col text;
begin
  foreach v_col in array array['access_token', 'refresh_token'] loop
    if has_column_privilege('authenticated', 'public.adapter_connections', v_col, 'select')
       or has_column_privilege('anon', 'public.adapter_connections', v_col, 'select') then
      raise exception 'SEC-13: % is selectable by a browser role', v_col;
    end if;
  end loop;
  foreach v_col in array array['status', 'metadata', 'last_refreshed_at', 'tenant_id'] loop
    if not has_column_privilege('authenticated', 'public.adapter_connections', v_col, 'select') then
      raise exception 'SEC-13: authenticated lost select on adapter_connections.%', v_col;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.adapter_connections', 'insert')
     or has_table_privilege('authenticated', 'public.adapter_connections', 'update')
     or has_table_privilege('authenticated', 'public.adapter_connections', 'delete') then
    raise exception 'SEC-13: authenticated can write adapter_connections';
  end if;
end;
$$;

-- bookings audit columns: a tenant session can update its own booking but
-- never is_test / identity_verified_by / quoted_rate_cents.
insert into auth.users (id, email)
  values ('9a1b0000-0000-4000-8000-000000000001', 'qa1-owner@heyloo-ci.local');
insert into public.tenants (id, name, slug, vertical)
  values ('9a1b0000-0000-4000-8000-0000000000a1', 'QA-1 tenant', 'qa1-tenant', 'generic');
insert into public.resources (id, tenant_id, name, type)
  values ('9a1b0000-0000-4000-8000-0000000000b1', '9a1b0000-0000-4000-8000-0000000000a1', 'Bay', 'bay');
insert into public.bookings (id, tenant_id, resource_id, start_at, end_at, status)
  values ('9a1b0000-0000-4000-8000-0000000000c1', '9a1b0000-0000-4000-8000-0000000000a1',
          '9a1b0000-0000-4000-8000-0000000000b1', now() + interval '2 days',
          now() + interval '2 days 30 minutes', 'confirmed');

create function pg_temp.qa1_expect_denied(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'SEC-13: % was allowed', p_label;
exception
  when insufficient_privilege then
    null; -- 42501: what the guard raises
end;
$$;

set local request.jwt.claims =
  '{"role":"authenticated","sub":"9a1b0000-0000-4000-8000-000000000001","app_metadata":{"tenant_id":"9a1b0000-0000-4000-8000-0000000000a1","role":"owner"}}';
set local role authenticated;

select pg_temp.qa1_expect_denied(
  $q$update public.bookings set is_test = true where id = '9a1b0000-0000-4000-8000-0000000000c1'$q$,
  'bookings.is_test update');
select pg_temp.qa1_expect_denied(
  $q$update public.bookings set identity_verified_by = 'knowledge' where id = '9a1b0000-0000-4000-8000-0000000000c1'$q$,
  'bookings.identity_verified_by update');
select pg_temp.qa1_expect_denied(
  $q$update public.bookings set quoted_rate_cents = 1 where id = '9a1b0000-0000-4000-8000-0000000000c1'$q$,
  'bookings.quoted_rate_cents update');

reset role;

-- ---------------------------------------------------------------------
-- SEC-14: anon has no table privileges in public; the GraphQL entry point is
-- closed to browser roles; SECURITY DEFINER functions are not anon-callable
-- but the dashboard's own RPC stays callable by authenticated.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  loop
    if has_table_privilege('anon', r.rel, 'select') then
      raise exception 'SEC-14: anon can select %', r.rel;
    end if;
  end loop;

  if to_regnamespace('graphql') is not null then
    for r in
      select p.oid::regprocedure as fn
      from pg_proc p where p.pronamespace = 'graphql'::regnamespace and p.proname = 'resolve'
        -- Only where the migration role can actually revoke it: on the hosted
        -- stack it is owned by supabase_admin (see the migration's note).
        and (p.proowner = (select oid from pg_roles where rolname = current_user)
             or (select rolsuper from pg_roles where rolname = current_user))
    loop
      if has_function_privilege('anon', r.fn, 'execute')
         or has_function_privilege('authenticated', r.fn, 'execute') then
        raise exception 'SEC-14: % is executable by a browser role', r.fn;
      end if;
    end loop;
  end if;

  for r in
    select p.oid, p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    if has_function_privilege('anon', r.oid, 'execute') then
      raise exception 'SEC-14: SECURITY DEFINER % is executable by anon', r.fn;
    end if;
  end loop;

  if to_regprocedure('public.fn_enqueue_adapter_push(uuid,text,text,uuid)') is not null
     and not has_function_privilege('authenticated', 'public.fn_enqueue_adapter_push(uuid,text,text,uuid)', 'execute') then
    raise exception 'SEC-14: authenticated lost execute on fn_enqueue_adapter_push (dashboard sync-now RPC)';
  end if;
end;
$$;

rollback;
