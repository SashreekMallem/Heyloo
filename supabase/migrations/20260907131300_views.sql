-- Views. BACKEND_SPEC.md §2.

-- Per-tenant margin, current calendar month, for the cockpit waterfall.
create or replace view public.v_tenant_margin as
select
  t.id as tenant_id,
  t.name,
  t.vertical,
  coalesce(r.revenue_cents, 0) as revenue_cents,
  coalesce(c.cost_cents, 0) as cost_cents,
  coalesce(r.revenue_cents, 0) - coalesce(c.cost_cents, 0) as margin_cents
from public.tenants t
left join (
  select tenant_id, sum(amount_cents) as revenue_cents
  from public.revenue_events
  where period_start >= date_trunc('month', now())::date
  group by tenant_id
) r on r.tenant_id = t.id
left join (
  select tenant_id, sum(total_cost_cents)::int as cost_cents
  from public.cost_events
  where occurred_at >= date_trunc('month', now())
  group by tenant_id
) c on c.tenant_id = t.id
where t.deleted_at is null;

-- Per-call cost vs implied billed amount, for the "per-call cost vs billed" cockpit page.
create or replace view public.v_call_cost_vs_billed as
select
  cl.id as call_id,
  cl.tenant_id,
  cl.duration_seconds,
  cl.cost_cents as provider_cost_cents,
  round((cl.duration_seconds / 60.0) * ov.overage_rate_cents)::int as implied_billed_cents
from public.call_logs cl
join lateral (
  select (value->>'overage_cents')::int as overage_rate_cents
  from public.platform_settings
  where key = 'price_card_' || (select vertical from public.tenants where id = cl.tenant_id)
) ov on true
where cl.is_test_call = false;

-- Tenants crossing usage-alert thresholds (80%/100% of included minutes), G14.
create or replace view public.v_usage_alerts as
select
  ud.tenant_id,
  sum(ud.billable_minutes) as mtd_minutes,
  pc.included_minutes,
  sum(ud.billable_minutes) / nullif(pc.included_minutes, 0) as pct_used
from public.usage_daily ud
join lateral (
  select (value->>'included_minutes')::numeric as included_minutes
  from public.platform_settings
  where key = 'price_card_' || (select vertical from public.tenants where id = ud.tenant_id)
) pc on true
where ud.date >= date_trunc('month', now())::date
group by ud.tenant_id, pc.included_minutes
having sum(ud.billable_minutes) / nullif(pc.included_minutes, 0) >= 0.8;

-- Referral P&L per partner.
create or replace view public.v_referral_pnl as
select
  rp.id as referral_partner_id,
  rp.name,
  count(r.id) filter (where r.status = 'qualified') as qualified_count,
  sum(ce.amount_cents) filter (where ce.status = 'paid') as paid_cents,
  sum(ce.amount_cents) filter (where ce.status = 'accrued') as accrued_cents
from public.referral_partners rp
left join public.referrals r on r.referral_partner_id = rp.id
left join public.commission_events ce on ce.referral_partner_id = rp.id
group by rp.id, rp.name;
