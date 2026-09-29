-- SEC-2 review (docs/BUILD_NOTES.md, "SEC-2 review"): two holes the column-grant
-- migration (20260929160000) left open, both reachable by an ordinary tenant
-- owner / member through PostgREST.
--
-- 1. tenants.timezone is owner-writable (correctly: the portal edits it) but
--    nothing in the database validates it. The portal's own route checks the
--    zone (SETTINGS-1 review), yet a PATCH straight at
--    /rest/v1/tenants?id=eq.<own id> with {"timezone":"Mars/Phobos"} skips
--    that route. fn_cron_usage_rollup() then evaluates
--    `now() at time zone t.timezone` for EVERY tenant in one loop with no
--    exception handler, so one tenant's bad zone raises 22023 ("time zone ...
--    not recognized") and aborts the nightly usage rollup for the whole
--    platform (usage/billing/alerts stop). Reproduced on a scratch Postgres:
--    owner UPDATE succeeded, then `select fn_cron_usage_rollup()` failed.
--    The same free-text zone reaches `insert into tenants` from api-checkout
--    (schemas/checkout.ts: `timezone: z.string().min(1).optional()`).
--    Fix: a BEFORE INSERT OR UPDATE OF timezone guard (unknown zone on UPDATE
--    -> 22023; on INSERT -> the column default, so a signup from a browser
--    whose ICU knows a newer zone than Postgres still completes), plus a
--    per-tenant exception block in fn_cron_usage_rollup() so any other
--    per-tenant failure skips that tenant with a WARNING instead of stopping
--    the run (the same treatment fn_cron_availability_rollforward got).
--
-- 2. customers still carried Supabase's table-wide UPDATE for `authenticated`
--    under the customers_write RLS policy (any owner/admin/member). The
--    SEC-2 notes deferred it because the segment/lifetime triggers are
--    SECURITY INVOKER. Left open it lets a tenant member
--      - clear customers.sms_opt_out (a STOP the platform must honour:
--        worker-messages-outbound and job-review-request rely on it), and
--      - write customers.consent with a non-boolean value:
--        job-reminder-scheduler evaluates `(c.consent->>'sms')::boolean` for
--        every tenant's candidate bookings in ONE query, so `{"sms":"x"}`
--        raises 22P02 and stops reminders platform-wide.
--    The portal writes exactly one customers column with the user-scoped
--    client (`metadata`, the notes route). Fix: make the two trigger
--    functions SECURITY DEFINER (search_path '' -- they only touch
--    public.customers by id from a row RLS already tenant-pinned), then
--    grant `authenticated` UPDATE(metadata) only and no INSERT/DELETE/
--    TRUNCATE. voice/edge functions use the secret key and are unaffected.
--
-- Additive: create-or-replace + alter function + grants + one new trigger.

-- ---------------------------------------------------------------------
-- 1. time zone guard
-- ---------------------------------------------------------------------
create or replace function public.fn_guard_tenant_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- IANA names Postgres can resolve. Case-insensitive because `at time zone`
  -- resolves names case-insensitively; posix/ and right/ aliases and
  -- 'Factory' resolve in Postgres but not in the JS Intl the scheduler jobs
  -- also use, so they are not accepted.
  if exists (
    select 1
    from pg_catalog.pg_timezone_names z
    where lower(z.name) = lower(new.timezone)
      and z.name !~ '^(posix|right)/'
      and z.name <> 'Factory'
  ) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.timezone := 'America/New_York'; -- the column default (20260907130100_tenancy.sql)
    return new;
  end if;

  raise exception 'unknown time zone: %', new.timezone
    using errcode = '22023', hint = 'Use an IANA name such as America/Chicago.';
end;
$$;

comment on function public.fn_guard_tenant_timezone() is
  'SEC-2 review: rejects (UPDATE) or defaults (INSERT) a tenants.timezone Postgres cannot resolve, so one tenant cannot abort fn_cron_usage_rollup / availability regeneration for everyone.';

drop trigger if exists trg_tenants_guard_timezone on public.tenants;
create trigger trg_tenants_guard_timezone
  before insert or update of timezone on public.tenants
  for each row execute function public.fn_guard_tenant_timezone();

create or replace function public.fn_cron_usage_rollup()
returns void language plpgsql as $$
declare
  t record;
begin
  for t in select id, timezone from public.tenants where deleted_at is null loop
    begin
      perform public.fn_upsert_usage_daily(t.id, ((now() at time zone t.timezone)::date - 1));
    exception when others then
      raise warning 'fn_cron_usage_rollup: skipped tenant % (%)', t.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. customers: compliance columns are system-written
-- ---------------------------------------------------------------------
alter function public.fn_touch_customer() security definer set search_path = '';
alter function public.fn_recompute_customer_segment() security definer set search_path = '';

revoke insert, update, delete, truncate on public.customers from authenticated, anon;
grant update (metadata) on public.customers to authenticated;
