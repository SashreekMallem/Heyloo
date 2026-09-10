-- Database hardening pass — docs/audit/DB_AUDIT.md DB-B1, DB-H1, DB-H3, DB-M2.
-- Additive only (CLAUDE.md Rule 2): every change below is an ALTER/REVOKE/
-- DROP POLICY+CREATE POLICY/CREATE INDEX against objects created in earlier
-- migrations — no existing migration file is edited.

-- ===========================================================================
-- DB-B1 — admin-only cockpit views were readable by anon/authenticated,
-- bypassing the underlying tables' RLS entirely.
-- ===========================================================================
-- Root cause (confirmed live per DB_AUDIT.md): a `create or replace view`
-- with no `security_invoker` option runs with the *view owner's* privileges
-- (here, `postgres`, which carries `rolbypassrls = true`), not the querying
-- role's — so every one of these four views silently bypassed RLS on
-- `revenue_events`/`cost_events`/`usage_daily`/`referral_partners`/
-- `referrals`/`commission_events` for any role that could `SELECT` the view,
-- and the default Postgres/Supabase relation grant handed exactly that
-- SELECT to both `anon` and `authenticated`.
--
-- Fix, both required together (per DB_AUDIT.md's own reasoning — with
-- security_invoker alone, a signed-in tenant member would get their own
-- margin/cost data back, which BACKEND_SPEC §5's margin-secrecy rule says
-- they should never see at all, not just other tenants'):
--   1. `security_invoker = true` — the view now evaluates the underlying
--      tables' RLS as the querying role, exactly like a plain SELECT would.
--   2. `revoke all ... from anon, authenticated` — these are admin-cockpit-
--      only views; even correctly RLS-scoped, no non-admin role should be
--      able to query them at all (a clean 403 beats a silently-empty 200).
--
-- Admin-cockpit-read-path verification (per this task's own instruction):
-- both the `admin` edge function (supabase/functions/admin/handler.ts,
-- margin/cost-vs-billed/referral-P&L routes) and `job-alert-evaluation`
-- (which also reads v_tenant_margin) construct their SQL client via
-- `getSql()` (supabase/functions/_shared/deno/db.ts) — a raw postgres.js
-- connection against `SUPABASE_DB_URL`, i.e. authenticated straight to
-- Postgres (the pooler's `postgres`/`postgres.<ref>` role), NOT through
-- PostgREST as `service_role`/`authenticated`. That role carries
-- `rolbypassrls = true` (the same fact DB-B1 flagged as the bug for the view
-- owner also makes it true for every raw-Postgres-connection caller), so it
-- is completely unaffected by security_invoker or by revoking anon/
-- authenticated grants — neither change touches its access at all. No
-- platform-admin RLS policy needs to be added to the underlying base tables
-- for the cockpit to keep working. (If a future read path instead queries
-- these views over PostgREST using a platform-admin JWT, it would need an
-- explicit `fn_jwt_is_platform_admin()` SELECT grant/policy path added at
-- that time — not needed today, since no such path exists.)
--
-- These are the only four views defined anywhere under supabase/migrations/
-- (confirmed by grep across every migration file) — no other view exists to
-- enumerate.

alter view public.v_tenant_margin set (security_invoker = true);
alter view public.v_call_cost_vs_billed set (security_invoker = true);
alter view public.v_usage_alerts set (security_invoker = true);
alter view public.v_referral_pnl set (security_invoker = true);

revoke all on public.v_tenant_margin from anon, authenticated;
revoke all on public.v_call_cost_vs_billed from anon, authenticated;
revoke all on public.v_usage_alerts from anon, authenticated;
revoke all on public.v_referral_pnl from anon, authenticated;

comment on view public.v_tenant_margin is
  'Admin-cockpit-only (BACKEND_SPEC §5 margin secrecy). security_invoker=true + anon/authenticated revoked (DB_AUDIT.md DB-B1) — readable only via a raw Postgres connection (service/secret-key edge functions use getSql(), which bypasses RLS as the connection role) or a future explicit platform-admin grant, never via PostgREST with the publishable key or a tenant JWT.';
comment on view public.v_call_cost_vs_billed is
  'Admin-cockpit-only (BACKEND_SPEC §5 margin secrecy). security_invoker=true + anon/authenticated revoked (DB_AUDIT.md DB-B1) — see comment on public.v_tenant_margin for the read-path verification this relies on.';
comment on view public.v_usage_alerts is
  'Admin-cockpit-only (BACKEND_SPEC §5 margin secrecy). security_invoker=true + anon/authenticated revoked (DB_AUDIT.md DB-B1) — see comment on public.v_tenant_margin for the read-path verification this relies on.';
comment on view public.v_referral_pnl is
  'Admin-cockpit-only (BACKEND_SPEC §5 margin secrecy). security_invoker=true + anon/authenticated revoked (DB_AUDIT.md DB-B1) — see comment on public.v_tenant_margin for the read-path verification this relies on.';

-- ===========================================================================
-- DB-H1 — bookings/orders write RLS never validated that the referenced
-- resource/offering/customer actually belongs to the caller's own tenant.
-- ===========================================================================
-- `tenant_id = fn_jwt_tenant_id()` alone only constrains the row's OWN
-- tenant_id column; resource_id/offering_id/customer_id reference globally-
-- unique ids with no tenant-scoped FK, so an authenticated member of tenant
-- A could previously POST a bookings/orders row with `tenant_id: A` but a
-- resource/offering/customer id belonging to tenant B, and RLS would accept
-- it (this is the RLS-policy-level twin of docs/audit/EDGE_AUDIT.md's B1,
-- which covers the same gap in the service_role voice-tools write path;
-- this fix only closes the direct-PostgREST/dashboard write path, which
-- EDGE_AUDIT B1 does not touch). Fixed here via the faster, no-schema-
-- change option DB_AUDIT.md names explicitly (option b) — an EXISTS-based
-- WITH CHECK — rather than a composite-FK schema change, which is out of
-- this task's scope.
--
-- USING clauses (which govern which existing rows are visible/targetable
-- for UPDATE) are left as the plain tenant_id match; only WITH CHECK (which
-- governs the row values being written) gains the additional ownership
-- checks, so this cannot make any previously-valid update newly invisible —
-- it only blocks writing a row that points outside the caller's own tenant.

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
  );

-- orders has no resource_id/offering_id column (line items live in the
-- `items` jsonb array, validated against `offerings` by the create_order
-- tool at the application layer per the column's own comment in
-- 20260907130600_booking_core.sql) — but the exact same class of gap
-- exists for `customer_id`, and for any `offering_id` an authenticated
-- writer embeds directly in `items` bypassing that tool, so both are
-- checked here.
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
  );

comment on policy bookings_insert on public.bookings is
  'DB_AUDIT.md DB-H1: resource_id/offering_id/customer_id must resolve to a row owned by the same tenant as the booking itself, not merely share the bookings row''s own tenant_id.';
comment on policy orders_insert on public.orders is
  'DB_AUDIT.md DB-H1: customer_id, and any offering_id embedded in items[], must resolve to a row owned by the same tenant as the order itself.';

-- ===========================================================================
-- DB-H3 — messages_outbound's documented dedup check (BACKEND_SPEC §7.2.7:
-- soft-unique on (related_booking_id, template_key) / (related_order_id,
-- template_key) before insert, to avoid double-confirming on a Retell tool
-- retry) had no supporting index, forcing a sequential scan on the hot path
-- (/voice/tools, p95 < 500ms budget, CLAUDE.md Rule 2).
-- ===========================================================================

create index if not exists idx_messages_outbound_dedup_booking
  on public.messages_outbound (related_booking_id, template_key)
  where related_booking_id is not null;

create index if not exists idx_messages_outbound_dedup_order
  on public.messages_outbound (related_order_id, template_key)
  where related_order_id is not null;

-- ===========================================================================
-- DB-M2 — FK columns backing dashboard/detail-page read paths ("show this
-- call's resulting booking", "show this booking's payment-link status")
-- with no supporting index. Plain single-column btrees, per the audit's own
-- recommendation (no composite shape to guess before the query pattern is
-- known); partial (`where ... is not null`) since every one of these
-- columns is nullable and only non-null values are ever looked up by.
-- ===========================================================================

create index if not exists idx_bookings_offering
  on public.bookings (offering_id) where offering_id is not null;
create index if not exists idx_bookings_source_call
  on public.bookings (source_call_id) where source_call_id is not null;
create index if not exists idx_orders_source_call
  on public.orders (source_call_id) where source_call_id is not null;
create index if not exists idx_payment_links_order
  on public.payment_links (order_id) where order_id is not null;
create index if not exists idx_payment_links_booking
  on public.payment_links (booking_id) where booking_id is not null;
