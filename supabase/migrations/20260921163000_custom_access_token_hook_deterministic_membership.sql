-- DASH-2 (docs/BUILD_NOTES.md): `public.custom_access_token_hook`
-- (20260907131400_functions_triggers.sql) picks a user's membership with
-- `select tenant_id, role from public.memberships where user_id = ...
-- limit 1` and NO `order by`. For a user with exactly one membership row
-- this is harmless, but LOGIN-1 found live that for a user with two rows
-- Postgres returns an arbitrary-but-plan-dependent row — not guaranteed
-- stable across query-plan changes, index use, or a VACUUM/ANALYZE — so
-- which tenant a multi-membership user lands in on any given token
-- refresh is undefined behavior, not a documented "picks the first one"
-- policy. `public.memberships` has no primary/default-tenant flag column
-- (`20260907130100_tenancy.sql`), so this migration makes the existing
-- BACKEND_SPEC §11.2 "pick primary membership" DECIDE concrete and
-- deterministic without a schema change: earliest `created_at` (the
-- tenant the user was first added to), tie-broken by `id` for two rows
-- inserted in the same transaction/instant. Never edits the original
-- migration (CLAUDE.md Rule 2 — migrations are additive and reproducible
-- from zero); this `create or replace function` redefines the same
-- function body the original migration created.
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
  order by created_at asc, id asc -- DASH-2: deterministic "primary membership"
                                   -- (no primary/default flag on this table —
                                   -- earliest-created, then id, as the
                                   -- tie-break for same-instant inserts).
  limit 1;

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
  'Registered via [auth.hook.custom_access_token] in supabase/config.toml (local) / Auth Hooks dashboard config (hosted) — uri = pg-functions://postgres/public/custom_access_token_hook. Verify current registration mechanism against supabase.com/docs before relying on this in a fresh project (CLAUDE.md Rule 1). DASH-2 (docs/BUILD_NOTES.md): membership selection is now deterministic (earliest created_at, then id) — see 20260921163000_custom_access_token_hook_deterministic_membership.sql.';
