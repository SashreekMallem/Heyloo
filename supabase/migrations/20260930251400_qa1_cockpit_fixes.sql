-- QA-1 cockpit fixes (COCKPIT-F06, F07, F08, F14, F25). Additive and idempotent.
--
-- 1. F06: `fn_check_referral_qualification` read the flat amount from
--    `value->>'flat_amount_cents'` but the admin settings route wrote
--    `{amount_cents}` (and dropped the qualification `value`), so one Save from
--    the cockpit left `amount_cents_snapshot` NULL. The route now writes the
--    seeded shape; this makes the SQL function the other half of the contract:
--    it honors the `referral_qualification_rule` setting (`paid_invoices_gte`
--    + `value`, seeded `2`) instead of a hard-coded `>= 2`, tolerates the legacy
--    `amount_cents` key on rows written by the old route, and never accrues a
--    commission with a NULL amount.
-- 2. F07: `job-alert-evaluation` deduped only against alerts younger than one
--    hour, so a persistent condition inserted a new open row every hour (193
--    `negative_margin` rows for one tenant). One OPEN alert per rule + tenant
--    (+ tool for `tool_failure_spike`) is now enforced by a partial unique
--    index, after collapsing the existing duplicates (older rows -> 'resolved',
--    the newest stays open). Other writers (Stripe/PayPal payment failures,
--    per-run regression alerts) are deliberately outside the index: each of
--    their rows is a distinct event.
-- 3. F07/F14: the eight `test-*` QA tenants were created with is_test=false, so
--    they showed up in real margin views and fired alerts. Marked as test data
--    unless they carry a real Stripe subscription.
-- 4. F08: `campaigns` had nowhere to keep the daily send cap or template the
--    new-campaign form collects.
-- 5. F25: tickets a tenant creates through PostgREST never recorded who created
--    them; `created_by` now defaults to the caller.

-- 1 -------------------------------------------------------------------------
create or replace function public.fn_check_referral_qualification()
returns void language plpgsql as $$
declare
  v_required int;
begin
  select coalesce(nullif(value->>'value', '')::int, 2) into v_required
  from public.platform_settings
  where key = 'referral_qualification_rule'
    and coalesce(value->>'rule', 'paid_invoices_gte') = 'paid_invoices_gte';
  v_required := greatest(coalesce(v_required, 2), 1);

  update public.referrals r
  set status = 'qualified',
      qualified_at = now(),
      amount_cents_snapshot = (
        select coalesce((value->>'flat_amount_cents')::int, (value->>'amount_cents')::int)
        from public.platform_settings where key = 'referral_flat_amount_cents'
      )
  where r.status = 'pending'
    and r.fraud_flag = false
    and (
      select count(*) from public.billing_invoices bi
      where bi.tenant_id = r.referred_tenant_id and bi.status = 'paid'
    ) >= v_required;

  insert into public.commission_events (referral_partner_id, referral_id, tenant_id, amount_cents, status)
  select r.referral_partner_id, r.id, r.referred_tenant_id, r.amount_cents_snapshot, 'accrued'
  from public.referrals r
  where r.status = 'qualified'
    and r.amount_cents_snapshot is not null
    and not exists (select 1 from public.commission_events ce where ce.referral_id = r.id);
end;
$$;

-- 2 -------------------------------------------------------------------------
update public.alerts a
set status = 'resolved'
where a.status = 'open'
  -- Only the three rules the index below covers: the per-run agent_regression_*
  -- alerts are distinct events (44 open rows across 6 distinct scenarios on the
  -- live project) and must not be auto-resolved here.
  and a.rule in ('negative_margin', 'usage_spike', 'tool_failure_spike')
  and exists (
    select 1 from public.alerts b
    where b.status = 'open'
      and b.rule = a.rule
      and coalesce(b.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(a.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and coalesce(b.payload->>'tool_name', '') = coalesce(a.payload->>'tool_name', '')
      and (b.created_at, b.id) > (a.created_at, a.id)
  );

create unique index if not exists uq_alerts_open_rule_tenant
  on public.alerts (
    rule,
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(payload->>'tool_name', '')
  )
  where status = 'open' and rule in ('negative_margin', 'usage_spike', 'tool_failure_spike');

comment on index public.uq_alerts_open_rule_tenant is
  'One open alert per rule + tenant (+ tool for tool_failure_spike) for the three job-alert-evaluation rules; the job refreshes the payload instead of inserting again.';

-- 3 -------------------------------------------------------------------------
update public.tenants
set is_test = true
where slug like 'test-%'
  and stripe_subscription_id is null
  and is_test is distinct from true;

-- 4 -------------------------------------------------------------------------
alter table public.campaigns
  add column if not exists daily_send_cap int check (daily_send_cap is null or daily_send_cap between 1 and 2000),
  add column if not exists template_id uuid;

comment on column public.campaigns.daily_send_cap is
  'Per-day send ceiling the admin set on the new-campaign form (1-2000); null = provider default.';
comment on column public.campaigns.template_id is
  'Optional outreach email template reference chosen on the new-campaign form (no FK: templates live in the provider).';

-- 5 -------------------------------------------------------------------------
alter table public.support_requests
  alter column created_by set default auth.uid();
