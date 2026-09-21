-- DASH-2 follow-up (docs/BUILD_NOTES.md): fixes a real regression the
-- previous migration in this same task introduced, caught live by CI's
-- "RLS cross-tenant probe" job before merge to `main` completed.
--
-- `20260921163000_custom_access_token_hook_deterministic_membership.sql`
-- redeclared `public.custom_access_token_hook` in full (CREATE OR
-- REPLACE) to add a deterministic `order by` to the membership lookup —
-- but it copied that change onto the function body from the ORIGINAL
-- `20260907131400_functions_triggers.sql` migration, not the CURRENT one.
-- `20260910110000_impersonation_claim.sql` had already re-declared this
-- same function in full to add the `impersonated_by`/
-- `impersonation_edit_enabled` claims (the ones every tenant-write RLS
-- policy's `(not fn_jwt_is_impersonating() or
-- fn_jwt_impersonation_edit_enabled())` guard depends on) — since
-- `20260921163000` runs AFTER `20260910110000` (migrations apply in
-- filename/timestamp order) and used the pre-impersonation body, it
-- silently deleted that claim logic. Net effect, confirmed by CI: a
-- read-only impersonated admin session could write (a booking INSERT
-- that should have been rejected came back 201), because the hook no
-- longer stamped `impersonated_by`/`impersonation_edit_enabled` onto
-- ANY session's JWT, so `fn_jwt_is_impersonating()` was always false and
-- the guard's `(not fn_jwt_is_impersonating() or ...)` was vacuously true
-- for every write. Live production was fixed the same way (applied via
-- the management API SQL proxy) within minutes of the CI failure and
-- before this fix was merged to `main`; confirmed via
-- `pg_get_functiondef`.
--
-- Per CLAUDE.md Rule 2 ("never edit an applied migration"),
-- `20260921163000` itself is left exactly as committed/pushed — this is
-- a forward-fixing migration, not a rewrite of that one's history. The
-- body below is `20260910110000`'s full function (memberships +
-- platform_admin + referral_partner_id + impersonation claims) with only
-- the deterministic `order by` from `20260921163000` re-applied to the
-- membership lookup, so nothing else changes.
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
  v_impersonation record;
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

  select admin_user_id, edit_enabled into v_impersonation
  from public.impersonation_sessions
  where target_user_id = v_user_id
    and ended_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if v_impersonation.admin_user_id is not null then
    claims := jsonb_set(claims, '{app_metadata,impersonated_by}', to_jsonb(v_impersonation.admin_user_id::text));
    claims := jsonb_set(claims, '{app_metadata,impersonation_edit_enabled}', to_jsonb(coalesce(v_impersonation.edit_enabled, false)));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

comment on function public.custom_access_token_hook is
  'Registered via [auth.hook.custom_access_token] in supabase/config.toml (local) / Auth Hooks dashboard config (hosted) — uri = pg-functions://postgres/public/custom_access_token_hook. Verify current registration mechanism against supabase.com/docs before relying on this in a fresh project (CLAUDE.md Rule 1). Deterministic membership order (DASH-2, 20260921163000) plus the impersonation claims (20260910110000) that a follow-up migration (20260921164500) restored after 20260921163000 briefly regressed them — see docs/BUILD_NOTES.md.';
