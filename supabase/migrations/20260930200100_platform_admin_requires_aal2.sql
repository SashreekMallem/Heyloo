-- SEC-01 (QA-1-auth): platform-admin MFA (AAL2) was enforced only by the
-- cockpit PAGE guard. A password-only (aal1) session already carried
-- app_metadata.platform_admin = true, so every admin API route, edge
-- function and every `fn_jwt_is_platform_admin()` RLS policy accepted it:
-- anyone holding just the admin password could read every tenant's rows via
-- PostgREST. SYSTEM_DESIGN line 72: "/admin/* (AAL2 + audit log)".
--
-- Fix at the source, fail closed, two layers:
--
--  1. `custom_access_token_hook` stamps `platform_admin` ONLY when the
--     session being minted is aal2 (`event->'claims'->>'aal'`; the event
--     shape, including `claims.aal` and `claims.amr`, is documented at
--     supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
--     For a platform admin below aal2 it stamps a separate, inert marker
--     claim `admin_mfa_required = true` instead. No RLS policy, edge
--     function or API guard reads that marker as authority; it exists only
--     so the web guards can tell "admin who must complete MFA" (route to
--     /mfa/enroll or /mfa/challenge) from "not an admin" (route to
--     /no-access). Completing `mfa.verify` mints a fresh aal2 token through
--     this same hook, which then carries `platform_admin`.
--
--  2. `fn_jwt_is_platform_admin()` (the single helper every admin RLS
--     policy calls) additionally requires the JWT's own `aal` = 'aal2', so
--     even a token minted before this migration (still `platform_admin` =
--     true at aal1, valid until it expires) loses admin data access
--     immediately, without waiting for a refresh.
--
-- `platform_admins.aal2_required` is intentionally NOT honoured: launch
-- posture is AAL2 for every platform admin, no per-row opt-out.
--
-- Per CLAUDE.md Rule 2 no applied migration is edited: the hook body below
-- is 20260921164500's full function (memberships + partner + impersonation
-- claims unchanged) with only the platform_admin block changed.

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
  v_is_aal2 boolean := coalesce(event->'claims'->>'aal', '') = 'aal2';
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
  limit 1;

  select exists(select 1 from public.platform_admins where user_id = v_user_id) into v_is_admin;
  select id into v_partner_id from public.referral_partners where user_id = v_user_id;

  if v_membership.tenant_id is not null then
    claims := jsonb_set(claims, '{app_metadata,tenant_id}', to_jsonb(v_membership.tenant_id::text));
    claims := jsonb_set(claims, '{app_metadata,role}', to_jsonb(v_membership.role));
  end if;

  -- SEC-01: the admin claim exists only on an aal2 (MFA-completed) token.
  if v_is_admin and v_is_aal2 then
    claims := jsonb_set(claims, '{app_metadata,platform_admin}', 'true');
  elsif v_is_admin then
    claims := jsonb_set(claims, '{app_metadata,admin_mfa_required}', 'true');
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

create or replace function public.fn_jwt_is_platform_admin() returns boolean
language sql stable as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'platform_admin')::boolean, false)
    and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'aal', '') = 'aal2';
$$;

comment on function public.custom_access_token_hook is
  'Registered via [auth.hook.custom_access_token] in supabase/config.toml (local) / Auth Hooks dashboard config (hosted) — uri = pg-functions://postgres/public/custom_access_token_hook. platform_admin is stamped only on aal2 tokens (SEC-01, 20260930200100); an aal1 admin gets the inert admin_mfa_required marker instead. See docs/BUILD_NOTES.md QA-1-auth.';
