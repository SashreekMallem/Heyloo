-- Row Level Security — every table. BACKEND_SPEC.md §5.
-- Global rules (CLAUDE.md Rule 2, non-negotiable): RLS enabled on every
-- table below; tenant_id for predicates comes only from
-- auth.jwt() -> app_metadata ->> tenant_id (set by the Custom Access Token
-- Hook), never a client-supplied parameter. `service_role` has BYPASSRLS
-- on a Supabase project, so tables marked "service_role only" below
-- deliberately carry NO insert/update/delete policy for authenticated/anon
-- — RLS-enabled + zero matching permissive policy = default deny for every
-- role except the ones that bypass RLS outright. Per CLAUDE.md, every
-- service_role-using edge function must still explicitly filter by a
-- verified tenant_id in its own query — RLS bypass is not a substitute for
-- that application-layer check.

-- ---------------------------------------------------------------------
-- Helper functions (read JWT app_metadata claims set by the access-token hook)
-- ---------------------------------------------------------------------

create or replace function public.fn_jwt_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb
    -> 'app_metadata' ->> 'tenant_id', '')::uuid;
$$;

create or replace function public.fn_jwt_role() returns text
language sql stable as $$
  select current_setting('request.jwt.claims', true)::jsonb
    -> 'app_metadata' ->> 'role';
$$;

create or replace function public.fn_jwt_is_platform_admin() returns boolean
language sql stable as $$
  select coalesce((current_setting('request.jwt.claims', true)::jsonb
    -> 'app_metadata' ->> 'platform_admin')::boolean, false);
$$;

create or replace function public.fn_jwt_referral_partner_id() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb
    -> 'app_metadata' ->> 'referral_partner_id', '')::uuid;
$$;

-- ---------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------
alter table public.tenants enable row level security;

create policy tenants_select on public.tenants for select
  using (id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy tenants_update on public.tenants for update
  using ((id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
         or public.fn_jwt_is_platform_admin())
  with check ((id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
              or public.fn_jwt_is_platform_admin());
-- No client INSERT/DELETE policy: created by the signup/provisioning saga
-- (service_role); no hard delete ever (soft delete via deleted_at, admin action).

-- ---------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------
alter table public.memberships enable row level security;

create policy memberships_select on public.memberships for select
  using (tenant_id = public.fn_jwt_tenant_id() or user_id = auth.uid() or public.fn_jwt_is_platform_admin());

create policy memberships_write on public.memberships for all
  using ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() = 'owner')
         or public.fn_jwt_is_platform_admin())
  with check ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() = 'owner')
              or public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- platform_admins
-- ---------------------------------------------------------------------
alter table public.platform_admins enable row level security;

create policy platform_admins_select on public.platform_admins for select
  using (public.fn_jwt_is_platform_admin());
-- No client write policy: service_role only (no self-service admin grants).

-- ---------------------------------------------------------------------
-- admin_actions (append-only audit log)
-- ---------------------------------------------------------------------
alter table public.admin_actions enable row level security;

create policy admin_actions_select on public.admin_actions for select
  using (public.fn_jwt_is_platform_admin());
-- No client INSERT/UPDATE/DELETE: written only by service_role from admin edge functions.

-- ---------------------------------------------------------------------
-- phone_numbers
-- ---------------------------------------------------------------------
alter table public.phone_numbers enable row level security;

create policy phone_numbers_select on public.phone_numbers for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());
-- No client write policy: provisioning saga (service_role) owns this table.

-- ---------------------------------------------------------------------
-- agent_templates (tenants never see raw templates)
-- ---------------------------------------------------------------------
alter table public.agent_templates enable row level security;

create policy agent_templates_all on public.agent_templates for all
  using (public.fn_jwt_is_platform_admin())
  with check (public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- agent_configs
-- ---------------------------------------------------------------------
alter table public.agent_configs enable row level security;

create policy agent_configs_select on public.agent_configs for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy agent_configs_update on public.agent_configs for update
  using ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
         or public.fn_jwt_is_platform_admin())
  with check ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
              or public.fn_jwt_is_platform_admin());
-- INSERT/publish is service_role only (provisioning saga / template compiler).
-- Column-level restriction to owner-editable fields (assistant_name,
-- special_instructions, transfer_number, greeting_overrides,
-- dynamic_variable_overrides — never retell_agent_id/compiled_config) is
-- enforced by the tenant-facing edge function's column whitelist, not RLS.

-- ---------------------------------------------------------------------
-- offerings / resources
-- ---------------------------------------------------------------------
alter table public.offerings enable row level security;

create policy offerings_select on public.offerings for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy offerings_write on public.offerings for all
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'));

alter table public.resources enable row level security;

create policy resources_select on public.resources for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy resources_write on public.resources for all
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'));

-- ---------------------------------------------------------------------
-- availability_slots
-- ---------------------------------------------------------------------
alter table public.availability_slots enable row level security;

create policy availability_slots_select on public.availability_slots for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());
-- No client write policy: generated/invalidated by functions & triggers via service_role.

-- ---------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------
alter table public.bookings enable row level security;

create policy bookings_select on public.bookings for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy bookings_insert on public.bookings for insert
  with check (tenant_id = public.fn_jwt_tenant_id());

create policy bookings_update on public.bookings for update
  using (tenant_id = public.fn_jwt_tenant_id())
  with check (tenant_id = public.fn_jwt_tenant_id());
-- INSERT primarily happens via /voice/tools using service_role; this policy
-- additionally allows member-initiated manual bookings/reschedule/cancel
-- from the dashboard. No DELETE — status-transition only, never removed.

-- ---------------------------------------------------------------------
-- orders (same shape as bookings)
-- ---------------------------------------------------------------------
alter table public.orders enable row level security;

create policy orders_select on public.orders for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy orders_insert on public.orders for insert
  with check (tenant_id = public.fn_jwt_tenant_id());

create policy orders_update on public.orders for update
  using (tenant_id = public.fn_jwt_tenant_id())
  with check (tenant_id = public.fn_jwt_tenant_id());

-- ---------------------------------------------------------------------
-- customers / customer_addresses
-- ---------------------------------------------------------------------
alter table public.customers enable row level security;

create policy customers_select on public.customers for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy customers_write on public.customers for all
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin','member'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin','member'));

comment on policy customers_select on public.customers is
  'The lookup_customer voice tool additionally scopes to the caller''s own number at the application layer (G6) — RLS alone cannot express "this call''s caller".';

alter table public.customer_addresses enable row level security;

create policy customer_addresses_select on public.customer_addresses for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy customer_addresses_write on public.customer_addresses for all
  using (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin','member'))
  with check (tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin','member'));

-- ---------------------------------------------------------------------
-- waitlist_entries
-- ---------------------------------------------------------------------
alter table public.waitlist_entries enable row level security;

create policy waitlist_entries_select on public.waitlist_entries for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy waitlist_entries_write on public.waitlist_entries for all
  using (tenant_id = public.fn_jwt_tenant_id())
  with check (tenant_id = public.fn_jwt_tenant_id());

-- ---------------------------------------------------------------------
-- call_logs (recordings/transcripts never client-writable)
-- ---------------------------------------------------------------------
alter table public.call_logs enable row level security;

create policy call_logs_select on public.call_logs for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- messages_outbound / messages_inbound
-- ---------------------------------------------------------------------
alter table public.messages_outbound enable row level security;

create policy messages_outbound_select on public.messages_outbound for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

alter table public.messages_inbound enable row level security;

create policy messages_inbound_select on public.messages_inbound for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- webhook_events (tenants never see raw webhook payloads)
-- ---------------------------------------------------------------------
alter table public.webhook_events enable row level security;

create policy webhook_events_select on public.webhook_events for select
  using (public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- payment_links
-- ---------------------------------------------------------------------
alter table public.payment_links enable row level security;

create policy payment_links_select on public.payment_links for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- Money domain — cost/revenue are admin-only (margin secrecy); usage/
-- billing are tenant-readable (needed for the usage-alert UI) but never
-- tenant-writable.
-- ---------------------------------------------------------------------
alter table public.cost_events enable row level security;
create policy cost_events_select on public.cost_events for select
  using (public.fn_jwt_is_platform_admin());

alter table public.revenue_events enable row level security;
create policy revenue_events_select on public.revenue_events for select
  using (public.fn_jwt_is_platform_admin());

alter table public.usage_events enable row level security;
create policy usage_events_select on public.usage_events for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

alter table public.usage_daily enable row level security;
create policy usage_daily_select on public.usage_daily for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

alter table public.billing_invoices enable row level security;
create policy billing_invoices_select on public.billing_invoices for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

alter table public.payment_processing_events enable row level security;
create policy payment_processing_events_select on public.payment_processing_events for select
  using (public.fn_jwt_is_platform_admin());

alter table public.commission_events enable row level security;
create policy commission_events_select on public.commission_events for select
  using (referral_partner_id = public.fn_jwt_referral_partner_id() or public.fn_jwt_is_platform_admin());

alter table public.cac_events enable row level security;
create policy cac_events_select on public.cac_events for select
  using (public.fn_jwt_is_platform_admin());

alter table public.fixed_cost_allocations enable row level security;
create policy fixed_cost_allocations_all on public.fixed_cost_allocations for all
  using (public.fn_jwt_is_platform_admin())
  with check (public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- Referral program
-- ---------------------------------------------------------------------
alter table public.referral_partners enable row level security;

create policy referral_partners_select on public.referral_partners for select
  using (id = public.fn_jwt_referral_partner_id() or public.fn_jwt_is_platform_admin());

create policy referral_partners_update on public.referral_partners for update
  using (id = public.fn_jwt_referral_partner_id() or public.fn_jwt_is_platform_admin())
  with check (id = public.fn_jwt_referral_partner_id() or public.fn_jwt_is_platform_admin());

alter table public.referral_links enable row level security;
create policy referral_links_select on public.referral_links for select
  using (referral_partner_id = public.fn_jwt_referral_partner_id() or public.fn_jwt_is_platform_admin());

alter table public.referrals enable row level security;
create policy referrals_select on public.referrals for select
  using (referral_partner_id = public.fn_jwt_referral_partner_id() or public.fn_jwt_is_platform_admin());

alter table public.referral_payouts enable row level security;
create policy referral_payouts_select on public.referral_payouts for select
  using (referral_partner_id = public.fn_jwt_referral_partner_id() or public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- Outreach — admin-only, no tenant exposure
-- ---------------------------------------------------------------------
alter table public.leads enable row level security;
create policy leads_all on public.leads for all
  using (public.fn_jwt_is_platform_admin()) with check (public.fn_jwt_is_platform_admin());

alter table public.campaigns enable row level security;
create policy campaigns_all on public.campaigns for all
  using (public.fn_jwt_is_platform_admin()) with check (public.fn_jwt_is_platform_admin());

alter table public.send_events enable row level security;
create policy send_events_all on public.send_events for all
  using (public.fn_jwt_is_platform_admin()) with check (public.fn_jwt_is_platform_admin());

alter table public.replies enable row level security;
create policy replies_all on public.replies for all
  using (public.fn_jwt_is_platform_admin()) with check (public.fn_jwt_is_platform_admin());

alter table public.suppression_list enable row level security;
create policy suppression_list_all on public.suppression_list for all
  using (public.fn_jwt_is_platform_admin()) with check (public.fn_jwt_is_platform_admin());

alter table public.pipeline_costs enable row level security;
create policy pipeline_costs_all on public.pipeline_costs for all
  using (public.fn_jwt_is_platform_admin()) with check (public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- platform_settings
-- ---------------------------------------------------------------------
alter table public.platform_settings enable row level security;
create policy platform_settings_all on public.platform_settings for all
  using (public.fn_jwt_is_platform_admin())
  with check (public.fn_jwt_is_platform_admin());
comment on policy platform_settings_all on public.platform_settings is
  'Some keys (e.g. price cards) are read by the signup flow via a service_role proxy edge function, never a direct client SELECT.';

-- ---------------------------------------------------------------------
-- support_requests / support_request_notes
-- ---------------------------------------------------------------------
alter table public.support_requests enable row level security;

create policy support_requests_select on public.support_requests for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

create policy support_requests_write on public.support_requests for all
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin())
  with check (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

alter table public.support_request_notes enable row level security;

create policy support_request_notes_select on public.support_request_notes for select
  using (
    public.fn_jwt_is_platform_admin()
    or (visible_to_tenant and exists (
      select 1 from public.support_requests sr
      where sr.id = support_request_notes.support_request_id
        and sr.tenant_id = public.fn_jwt_tenant_id()
    ))
  );

create policy support_request_notes_insert on public.support_request_notes for insert
  with check (
    public.fn_jwt_is_platform_admin()
    or (visible_to_tenant and exists (
      select 1 from public.support_requests sr
      where sr.id = support_request_notes.support_request_id
        and sr.tenant_id = public.fn_jwt_tenant_id()
    ))
  );

-- ---------------------------------------------------------------------
-- api_tokens (hash never exposed by the API layer regardless of RLS)
-- ---------------------------------------------------------------------
alter table public.api_tokens enable row level security;

create policy api_tokens_all on public.api_tokens for all
  using ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
         or public.fn_jwt_is_platform_admin())
  with check ((tenant_id = public.fn_jwt_tenant_id() and public.fn_jwt_role() in ('owner','admin'))
              or public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- Supporting tables (MASTER_SPEC §2 approved additions)
-- ---------------------------------------------------------------------
alter table public.demo_sessions enable row level security;
create policy demo_sessions_select on public.demo_sessions for select
  using (public.fn_jwt_is_platform_admin());
-- No client write policy: /api/demo-agent runs as service_role (public,
-- unauthenticated marketing-site flow — no tenant/admin JWT exists at all
-- for that request, so client RLS access is irrelevant to it either way).

alter table public.provisioning_runs enable row level security;
create policy provisioning_runs_select on public.provisioning_runs for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

alter table public.alerts enable row level security;
create policy alerts_select on public.alerts for select
  using (public.fn_jwt_is_platform_admin());
create policy alerts_update on public.alerts for update
  using (public.fn_jwt_is_platform_admin())
  with check (public.fn_jwt_is_platform_admin());

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_all on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.churn_scores enable row level security;
create policy churn_scores_select on public.churn_scores for select
  using (public.fn_jwt_is_platform_admin());

alter table public.airtable_sync_state enable row level security;
create policy airtable_sync_state_select on public.airtable_sync_state for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

-- ---------------------------------------------------------------------
-- realtime.messages — private per-tenant broadcast channel authorization.
-- Topic convention is 'tenant:<tenant_id>' (fn_broadcast_tenant_update).
-- Only a member of that tenant (or a platform admin) may subscribe/receive.
-- Verify realtime.messages' exact column set / RLS entry point against
-- current supabase.com/docs Broadcast-from-Database guidance before relying
-- on this in a fresh project (CLAUDE.md Rule 1) — this policy assumes a
-- `topic` text column, the documented shape as of this build.
-- ---------------------------------------------------------------------
create policy tenant_channel_broadcast_select on realtime.messages for select
  to authenticated
  using (
    realtime.messages.topic = 'tenant:' || public.fn_jwt_tenant_id()::text
    or public.fn_jwt_is_platform_admin()
  );
