-- Server-enforced impersonation boundary (docs/audit/FIX_REQUESTS.md's
-- "genuine schema+auth-model decision" gap; repair task: "Impersonation
-- end-to-end ... read-only/edit toggle enforced"). Additive only (CLAUDE.md
-- Rule 2) — no earlier migration file is edited.
--
-- Design (option (a) from the task, not (b)): `generate_link` mints a real
-- GoTrue session for the tenant owner's own user_id with no support for
-- injecting arbitrary extra app_metadata at mint time (there is no
-- documented `generate_link` parameter for that — Rule 1 docs-first check:
-- supabase.com was unreachable from this environment for the Auth Admin API
-- reference, and the npm `@supabase/supabase-js`/GoTrue admin client types
-- checked in `node_modules` show `generateLink` accepting only
-- email/password/redirect/type fields, no `app_metadata` override — logged
-- to docs/VERIFY.md rather than guessed further). So a claim cannot be baked
-- into the mint call itself; it must be added by `custom_access_token_hook`,
-- which already runs on every mint AND refresh.
--
-- `impersonation_sessions` is the source of truth the hook joins against by
-- `target_user_id` (the tenant owner being impersonated). Known scope limit
-- (documented, not silently ignored): the hook has no session-id to bind to
-- (event->>'user_id' and event->'claims' are the only fields this codebase's
-- existing hook reads or that could be confirmed offline per the VERIFY.md
-- entry above) — so if the real tenant owner independently logs in while an
-- admin's impersonation session for them is still active (not yet ended or
-- expired), that owner's own token would also carry the impersonation claim
-- until the session ends/expires. This is a narrow, time-boxed (<=30 min),
-- fully audited window (every impersonation start/end already writes
-- admin_actions) rather than a silent gap; tightening it further would need
-- a session-id-bound hook input this environment could not verify exists.

create table public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  admin_user_id uuid not null references auth.users(id),
  target_user_id uuid not null references auth.users(id),
  edit_enabled boolean not null default false,
  reason text not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_impersonation_sessions_active_target
  on public.impersonation_sessions (target_user_id, expires_at)
  where ended_at is null;

comment on table public.impersonation_sessions is
  'Backs the impersonated_by/impersonation_edit_enabled JWT claims (custom_access_token_hook). Written only by the admin edge function via its service_role/raw-Postgres connection — no client insert/update policy below (RLS-enabled + zero matching policy = default deny, same convention as every other service-role-only table in 20260907131500_rls.sql).';

alter table public.impersonation_sessions enable row level security;

create policy impersonation_sessions_select on public.impersonation_sessions for select
  using (public.fn_jwt_is_platform_admin());
-- No client INSERT/UPDATE/DELETE policy: written only by supabase/functions/admin (service_role).

-- ---------------------------------------------------------------------
-- JWT helper functions (alongside fn_jwt_tenant_id() etc. in
-- 20260907131500_rls.sql — same current_setting('request.jwt.claims', ...)
-- pattern, added here rather than editing that applied migration).
-- ---------------------------------------------------------------------

create or replace function public.fn_jwt_is_impersonating() returns boolean
language sql stable as $$
  select (current_setting('request.jwt.claims', true)::jsonb
    -> 'app_metadata' ->> 'impersonated_by') is not null;
$$;

create or replace function public.fn_jwt_impersonation_edit_enabled() returns boolean
language sql stable as $$
  select coalesce((current_setting('request.jwt.claims', true)::jsonb
    -> 'app_metadata' ->> 'impersonation_edit_enabled')::boolean, false);
$$;

comment on function public.fn_jwt_is_impersonating() is
  'True only while an active (not ended, not expired) impersonation_sessions row exists for the current session''s user, per custom_access_token_hook.';
comment on function public.fn_jwt_impersonation_edit_enabled() is
  'Meaningful only when fn_jwt_is_impersonating() is true; always false for a normal (non-impersonated) session. Every tenant-write RLS policy requires (not is_impersonating() or edit_enabled()).';

-- ---------------------------------------------------------------------
-- custom_access_token_hook: stamp the two claims above from an active
-- impersonation_sessions row, if any, for event->>'user_id'. Re-declared in
-- full (CREATE OR REPLACE, not an edit of the applied 20260907131400
-- migration) with exactly the prior body plus this addition.
-- ---------------------------------------------------------------------
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
  limit 1; -- DECIDE (BACKEND_SPEC §11.2): multi-tenant users pick primary
           -- membership; UI switches tenant via a re-auth/refresh that
           -- re-derives claims for the selected tenant.

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

-- ---------------------------------------------------------------------
-- Tighten every tenant-self-service WRITE policy: a read-only impersonated
-- session (fn_jwt_is_impersonating() and not fn_jwt_impersonation_edit_enabled())
-- must never be able to write, regardless of what the client sends, even
-- though it carries the same tenant_id/role claims as the owner's normal
-- login. Platform-admin-only / service-role-only tables are unaffected
-- (a platform admin's own session never carries impersonated_by).
-- ---------------------------------------------------------------------

drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants for update
  using ((id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
         or public.fn_jwt_is_platform_admin())
  with check (((id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
              or public.fn_jwt_is_platform_admin())
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships for all
  using ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() = 'owner')
         or public.fn_jwt_is_platform_admin())
  with check (((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() = 'owner')
              or public.fn_jwt_is_platform_admin())
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

drop policy if exists agent_configs_update on public.agent_configs;
create policy agent_configs_update on public.agent_configs for update
  using ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
         or public.fn_jwt_is_platform_admin())
  with check (((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
              or public.fn_jwt_is_platform_admin())
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

drop policy if exists offerings_write on public.offerings;
create policy offerings_write on public.offerings for all
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin')
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

drop policy if exists resources_write on public.resources;
create policy resources_write on public.resources for all
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin')
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

-- bookings/orders: current definitions are the DB-H1-hardened versions from
-- 20260910090000_view_security_and_write_rls_hardening.sql (ownership-of-
-- referenced-row EXISTS checks) — reissued verbatim plus the impersonation
-- guard, not the original pre-hardening shape.

drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings for insert
  with check (
    tenant_id = public.fn_jwt_tenant_id()
    and exists (
      select 1 from public.resources r
      where r.id = resource_id and r.tenant_id = public.fn_jwt_tenant_id()
    )
    and (
      offering_id is null
      or exists (
        select 1 from public.offerings o
        where o.id = offering_id and o.tenant_id = public.fn_jwt_tenant_id()
      )
    )
    and (
      customer_id is null
      or exists (
        select 1 from public.customers c
        where c.id = customer_id and c.tenant_id = public.fn_jwt_tenant_id()
      )
    )
    and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled())
  );

drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings for update
  using (tenant_id = public.fn_jwt_tenant_id())
  with check (
    tenant_id = public.fn_jwt_tenant_id()
    and exists (
      select 1 from public.resources r
      where r.id = resource_id and r.tenant_id = public.fn_jwt_tenant_id()
    )
    and (
      offering_id is null
      or exists (
        select 1 from public.offerings o
        where o.id = offering_id and o.tenant_id = public.fn_jwt_tenant_id()
      )
    )
    and (
      customer_id is null
      or exists (
        select 1 from public.customers c
        where c.id = customer_id and c.tenant_id = public.fn_jwt_tenant_id()
      )
    )
    and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled())
  );

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders for insert
  with check (
    tenant_id = public.fn_jwt_tenant_id()
    and (
      customer_id is null
      or exists (
        select 1 from public.customers c
        where c.id = customer_id and c.tenant_id = public.fn_jwt_tenant_id()
      )
    )
    and not exists (
      select 1 from jsonb_array_elements(items) as item
      where item ? 'offering_id'
        and (item->>'offering_id') is not null
        and not exists (
          select 1 from public.offerings o
          where o.id = (item->>'offering_id')::uuid
            and o.tenant_id = public.fn_jwt_tenant_id()
        )
    )
    and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled())
  );

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders for update
  using (tenant_id = public.fn_jwt_tenant_id())
  with check (
    tenant_id = public.fn_jwt_tenant_id()
    and (
      customer_id is null
      or exists (
        select 1 from public.customers c
        where c.id = customer_id and c.tenant_id = public.fn_jwt_tenant_id()
      )
    )
    and not exists (
      select 1 from jsonb_array_elements(items) as item
      where item ? 'offering_id'
        and (item->>'offering_id') is not null
        and not exists (
          select 1 from public.offerings o
          where o.id = (item->>'offering_id')::uuid
            and o.tenant_id = public.fn_jwt_tenant_id()
        )
    )
    and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled())
  );

drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers for all
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin','member'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin','member')
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

drop policy if exists customer_addresses_write on public.customer_addresses;
create policy customer_addresses_write on public.customer_addresses for all
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin','member'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin','member')
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

drop policy if exists waitlist_entries_write on public.waitlist_entries;
create policy waitlist_entries_write on public.waitlist_entries for all
  using (tenant_id = public.fn_jwt_tenant_id())
  with check (tenant_id = public.fn_jwt_tenant_id()
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

drop policy if exists api_tokens_all on public.api_tokens;
create policy api_tokens_all on public.api_tokens for all
  using ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
         or public.fn_jwt_is_platform_admin())
  with check (((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
              or public.fn_jwt_is_platform_admin())
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

drop policy if exists support_requests_write on public.support_requests;
create policy support_requests_write on public.support_requests for all
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin())
  with check ((tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin())
              and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled()));

drop policy if exists support_request_notes_insert on public.support_request_notes;
create policy support_request_notes_insert on public.support_request_notes for insert
  with check (
    (
      public.fn_jwt_is_platform_admin()
      or (visible_to_tenant and exists (
        select 1 from public.support_requests sr
        where sr.id = support_request_notes.support_request_id
          and sr.tenant_id = public.fn_jwt_tenant_id()
      ))
    )
    and (not public.fn_jwt_is_impersonating() or public.fn_jwt_impersonation_edit_enabled())
  );

comment on policy tenants_update on public.tenants is
  'Repair task (impersonation read-only enforcement): a read-only impersonated session (fn_jwt_is_impersonating() true, fn_jwt_impersonation_edit_enabled() false) can never satisfy WITH CHECK regardless of client-sent role/edit-mode fields.';
