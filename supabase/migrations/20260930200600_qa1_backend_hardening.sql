-- QA-1 backend hardening (BE-03, SEC-13, SEC-14). Additive and idempotent;
-- every block that touches a Supabase-platform schema (realtime, storage,
-- graphql) is guarded so the migration also applies to a bare local Postgres
-- and never aborts on a privilege the migration role may not hold.

-- ---------------------------------------------------------------------
-- BE-03: keep realtime.messages daily partitions alive.
--
-- Broadcast-from-database (fn_broadcast_tenant_update ->
-- realtime.broadcast_changes) inserts into realtime.messages, which is
-- partitioned by day. Per supabase.com/docs (Realtime, "Missing partition
-- warning") the partitions (yesterday, today, next three days) are created
-- only when a Realtime client connects and by a janitor that only covers
-- projects with recent connections, so a quiet project's window lapses: live,
-- the last partition was messages_2026_09_26 and ~1,800 "no partition of
-- relation messages found for row" warnings followed, every calls / bookings /
-- messages broadcast being dropped. This is a database-side stopgap: a
-- function that creates the same rolling window with the same names, run every
-- six hours. It needs the migration role to be allowed to create partitions of
-- realtime.messages; if it is not, each failure is a WARNING (never an error)
-- and the app-side polling fallback plus a Supabase support ticket remain the
-- fix (docs/BUILD_NOTES.md, QA-1-backend).
-- ---------------------------------------------------------------------

create or replace function public.fn_ensure_realtime_partitions(
  p_days_back int default 1,
  p_days_ahead int default 3
) returns int
language plpgsql
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_offset int;
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

comment on function public.fn_ensure_realtime_partitions(int, int) is
  'QA-1 BE-03: creates the realtime.messages daily partitions (yesterday .. +3 days, names messages_YYYY_MM_DD like Realtime''s own) that Realtime only creates when a client connects. No-op without the realtime schema; a partition it cannot create is a WARNING, not an error. Scheduled every six hours (job-realtime-partitions).';

revoke all on function public.fn_ensure_realtime_partitions(int, int) from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skipping job-realtime-partitions schedule (expected outside a Supabase-hosted Postgres)';
    return;
  end if;

  perform public.fn_cron_upsert('job-realtime-partitions', '17 */6 * * *',
    $sql$select public.fn_ensure_realtime_partitions();$sql$);
end;
$$;

-- Create today's window immediately (a no-op / warnings where not permitted).
select public.fn_ensure_realtime_partitions();

-- ---------------------------------------------------------------------
-- SEC-13: defence in depth.
-- ---------------------------------------------------------------------

-- 1. adapter_connections: the AES-GCM ciphertext columns (access_token,
--    refresh_token) were selectable through PostgREST by any tenant member
--    (Supabase default grants + a tenant-wide select policy). Only edge
--    functions and service-role routes read them; the dashboard status card
--    selects status / metadata / last_refreshed_at only. Table-level SELECT is
--    revoked and re-granted per non-secret column (column privileges cannot be
--    revoked from under a table-level grant). Browser roles never write it.
revoke all on public.adapter_connections from anon;
revoke insert, update, delete, truncate on public.adapter_connections from authenticated;
revoke select on public.adapter_connections from authenticated;
grant select (
  id, tenant_id, provider, status, auth_mode, expires_at, provider_account_id,
  metadata, last_refreshed_at, last_error, disconnected_at, connected_by,
  created_at, updated_at
) on public.adapter_connections to authenticated;

-- 2. bookings: RLS decides which rows a member may update, not which columns.
--    is_test (hides a booking from the dashboard and from billing),
--    identity_verified_by (the caller-identity audit trail) and
--    quoted_rate_cents (the motel rate-dispute record) are written by the
--    voice tools / service role only. A browser-role write to them is refused
--    (same pattern as fn_guard_tenant_messaging_columns). service_role and the
--    edge functions' direct connection are a different current_user.
create or replace function public.fn_guard_booking_audit_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.is_test is distinct from false
         or new.identity_verified_by is not null
         or new.quoted_rate_cents is not null then
        raise exception 'booking audit columns are system-managed'
          using errcode = '42501';
      end if;
    elsif new.is_test is distinct from old.is_test
       or new.identity_verified_by is distinct from old.identity_verified_by
       or new.quoted_rate_cents is distinct from old.quoted_rate_cents then
      raise exception 'booking audit columns are system-managed'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.fn_guard_booking_audit_columns() is
  'QA-1 SEC-13: a tenant session may write its own bookings rows (RLS) but never the audit columns is_test / identity_verified_by / quoted_rate_cents.';

drop trigger if exists trg_bookings_guard_audit_columns on public.bookings;
create trigger trg_bookings_guard_audit_columns
  before insert or update on public.bookings
  for each row execute function public.fn_guard_booking_audit_columns();

-- 3. storage.objects: two "Authenticated users can read/upload menus" policies
--    exist on the live project (created outside the repo) for a `menus` bucket
--    that does not exist and that nothing in the repo uses. Dropped by
--    definition (any policy naming the bucket), best effort: skipped where the
--    role does not own storage.objects.
do $$
declare
  r record;
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  for r in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%''menus''%'
  loop
    begin
      execute format('drop policy %I on storage.objects', r.policyname);
    exception when others then
      raise warning 'could not drop storage policy % (% %)', r.policyname, sqlstate, sqlerrm;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- SEC-14: anonymous schema exposure and anon-executable SECURITY DEFINER
-- functions. Nothing in the app reads a public table or calls GraphQL as
-- `anon` (every RLS policy is `to authenticated`; the marketing funnel goes
-- through Next routes and edge functions), so the anon role loses its table
-- privileges and the GraphQL entry point (pg_graphql introspection lists every
-- anon-readable relation regardless of RLS - Supabase lint 0026/0027, docs
-- verified 2026-09-30).
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
-- Future tables created by this role must not start with any anon privilege
-- either (Supabase's default privileges grant ALL, not only SELECT).
alter default privileges in schema public revoke all on tables from anon;

-- Block /graphql/v1 for the browser roles (the app never uses it). Guarded:
-- the schema exists only where pg_graphql is installed. NOTE: on the hosted
-- project graphql.resolve is owned by supabase_admin and the migration role
-- holds no grant option on it, so this REVOKE is then a no-op (a WARNING, not
-- an error); the table revoke above is what actually empties the anonymous
-- introspection result (pg_graphql lists only relations the role can select).
do $$
declare
  r record;
begin
  if to_regnamespace('graphql') is null then
    return;
  end if;
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    where p.pronamespace = 'graphql'::regnamespace and p.proname = 'resolve'
  loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    exception when others then
      raise warning 'could not revoke % (% %)', r.fn, sqlstate, sqlerrm;
    end;
  end loop;
end;
$$;

-- SECURITY DEFINER functions in `public` were executable by anon through the
-- default PUBLIC grant (fn_enqueue_message_outbound, fn_enqueue_adapter_push,
-- fn_touch_customer, ...). PUBLIC and anon lose EXECUTE; every other role that
-- can execute a function today keeps it exactly (authenticated for the RPCs
-- the dashboard calls, service_role, supabase_auth_admin for the access-token
-- hook), so this only removes the anonymous path.
do $$
declare
  r record;
  v_role text;
  v_keep text[];
begin
  for r in
    select p.oid, p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    v_keep := '{}';
    foreach v_role in array array['authenticated', 'service_role', 'supabase_auth_admin'] loop
      if exists (select 1 from pg_roles where rolname = v_role)
         and has_function_privilege(v_role, r.oid, 'execute') then
        v_keep := v_keep || v_role;
      end if;
    end loop;
    begin
      execute format('revoke execute on function %s from public, anon', r.fn);
      foreach v_role in array v_keep loop
        execute format('grant execute on function %s to %I', r.fn, v_role);
      end loop;
    exception when others then
      raise warning 'could not tighten execute on % (% %)', r.fn, sqlstate, sqlerrm;
    end;
  end loop;
end;
$$;
