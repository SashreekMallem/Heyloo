-- TRIAL-1: 7-day free trial, card required, ends early after 100 call minutes
-- (docs/BUILD_NOTES.md TRIAL-1; owner decision 2026-10-11, which replaces the
-- "card-required checkout + money-back guarantee" line in SYSTEM_DESIGN.md).
-- Additive and idempotent: new columns, two indexes, one settings row, one
-- cron job and two `create or replace` function bodies; nothing already
-- applied is edited.
--
-- A tenant on a free trial stays `tenants.status = 'active'`. `'trialing'`
-- keeps its existing meaning ("signed up, never paid"): the tenant layout
-- redirects it to the plan step and api-checkout reuses it.
--
-- 1. tenants trial columns. All of them are written only by edge functions with
--    the secret key (webhooks-stripe, api-checkout's eligibility read,
--    voice-events / job-billing-cycle for the minutes cap). `authenticated`
--    keeps table-level SELECT through the tenants_select RLS policy (the
--    dashboard banner and billing page read them) and gets NO update grant:
--    20260929160000 locked tenants UPDATE to an explicit column allow-list, so
--    a new column is not owner-writable unless a migration grants it, and
--    scripts/ci/owner-privilege-escalation-probe.ts asserts that for every
--    column it does not allow-list.
alter table public.tenants
  add column if not exists trial_ends_at timestamptz,
  add column if not exists trial_minutes_cap int,
  add column if not exists trial_ended_reason text,
  add column if not exists trial_cap_claimed_at timestamptz,
  add column if not exists trial_cancel_scheduled boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_trial_minutes_cap_positive_chk'
  ) then
    alter table public.tenants
      add constraint tenants_trial_minutes_cap_positive_chk
      check (trial_minutes_cap is null or trial_minutes_cap > 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_trial_ended_reason_chk'
  ) then
    alter table public.tenants
      add constraint tenants_trial_ended_reason_chk
      check (trial_ended_reason is null or trial_ended_reason in ('time', 'minutes', 'canceled'));
  end if;
end;
$$;

comment on column public.tenants.trial_ends_at is
  'Free trial end (webhooks-stripe, from the Stripe subscription''s trial_end). While the trial runs it is the scheduled end; once it has ended it is the actual end (earlier when the minutes cap or a cancellation ended it). Not null = this business has had its one free trial. Usage before it is trial usage: never billed as overage by job-billing-cycle.';
comment on column public.tenants.trial_minutes_cap is
  'Billable call minutes the free trial includes (subscription metadata trial_minutes, default platform_settings.free_trial.minutes). Reaching it ends the trial early through Stripe; calls are never blocked.';
comment on column public.tenants.trial_ended_reason is
  'Why the free trial ended: time (ran its days), minutes (the minutes cap ended it early; set only once Stripe confirmed), canceled (subscription canceled during the trial). Null while the trial runs.';
comment on column public.tenants.trial_cap_claimed_at is
  'When a minutes-cap run (voice-events after a call, job-billing-cycle?task=trial_caps hourly) last claimed this trial. A lease: another run may claim it only 15 minutes later, so two runs never call Stripe together, and a failed or deferred attempt is retried after it lapses. Set = the cap was reached at least once.';
comment on column public.tenants.trial_cancel_scheduled is
  'The owner canceled during the free trial (Stripe cancel_at_period_end, or cancel_at no later than the trial end): the subscription ends with the trial and is never charged. From webhooks-stripe subscription events and the cap''s own Stripe read; drives the dashboard banner and billing copy. The minutes cap reads the live subscription and never ends such a trial.';

-- Active-trial scan for the hourly trial-cap job (a handful of rows at most).
create index if not exists idx_tenants_trial_open
  on public.tenants (trial_ends_at)
  where trial_ends_at is not null and trial_ended_reason is null;

-- Each free-trial owner email goes out at most once per tenant
-- (_shared/trial/owner-email.ts inserts with ON CONFLICT DO NOTHING): Stripe,
-- the minutes cap and the webhook can trigger the same email at the same
-- moment. Fan-out copies (parent_message_id set) are not covered; these
-- templates have none. No such rows exist before this migration.
create unique index if not exists messages_outbound_trial_email_once
  on public.messages_outbound (tenant_id, template_key)
  where template_key in ('trial_will_end', 'trial_minutes_used') and parent_message_id is null;

-- 2. Trial config. Read by api-checkout (absent row = these defaults). The
--    marketing and signup copy states 7 days / 100 minutes
--    (apps/web/src/lib/marketing/signup-steps.ts FREE_TRIAL_*): change both
--    together. `enabled: false` turns the trial off for new signups.
insert into public.platform_settings (key, value)
values ('free_trial', '{"enabled": true, "days": 7, "minutes": 100}'::jsonb)
on conflict (key) do nothing;

-- 3. Referral qualification counts only invoices that collected money: the
--    $0 invoice Stripe issues when a trial starts is `paid` but must not count
--    toward `referral_qualification_rule` (paid_invoices_gte). Same body as
--    20260930251400 except the `total_cents > 0` filter.
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
      where bi.tenant_id = r.referred_tenant_id and bi.status = 'paid' and bi.total_cents > 0
    ) >= v_required;

  insert into public.commission_events (referral_partner_id, referral_id, tenant_id, amount_cents, status)
  select r.referral_partner_id, r.id, r.referred_tenant_id, r.amount_cents_snapshot, 'accrued'
  from public.referrals r
  where r.status = 'qualified'
    and r.amount_cents_snapshot is not null
    and not exists (select 1 from public.commission_events ce where ce.referral_id = r.id);
end;
$$;

-- 4. Margin cockpit: a tenant on a free trial is `active` with no paid revenue
--    yet, which diagnoseMargin (supabase/functions/admin/cockpit.ts) would call
--    "negative". The cockpit already has the right reading for that case
--    ("Trialing: cost so far is acquisition spend"), keyed on status
--    'trialing', so this reports 'trialing' for a tenant whose free trial
--    reaches into the window and that has no paid revenue in it. tenants.status
--    itself is unchanged. Same body as 20260929180000 except `base` carries
--    trial_ends_at and the final select's status expression.
create or replace function public.fn_margin_by_tenant(
  p_start timestamptz,
  p_end timestamptz,
  p_include_test boolean default false
)
returns table (
  tenant_id uuid,
  name text,
  vertical text,
  status text,
  is_test boolean,
  revenue_cents bigint,
  pending_revenue_cents bigint,
  voice_cost_cents bigint,
  llm_cost_cents bigint,
  telephony_cost_cents bigint,
  other_call_cost_cents bigint,
  number_cost_cents bigint,
  messaging_cost_cents bigint,
  processing_fee_cents bigint,
  commission_cents bigint,
  cost_cents bigint,
  margin_cents bigint,
  billable_minutes numeric,
  call_count bigint
)
language sql stable as $$
  with base as (
    select t.id, t.name, t.vertical, t.status, t.is_test, t.trial_ends_at
    from public.tenants t
    where t.deleted_at is null and (p_include_test or not t.is_test)
  ),
  rev as (
    select bi.tenant_id,
           coalesce(sum(bi.total_cents) filter (where bi.status = 'paid'), 0) as paid,
           coalesce(sum(bi.total_cents) filter (where bi.status in ('draft', 'finalized', 'past_due')), 0) as pending
    from public.billing_invoices bi
    where bi.period_start >= (p_start at time zone 'UTC')::date
      and bi.period_start < (p_end at time zone 'UTC')::date
    group by bi.tenant_id
  ),
  cost as (
    select ce.tenant_id,
           coalesce(sum(ce.total_cost_cents) filter (where public.fn_cost_category(ce.provider, ce.product) = 'voice'), 0) as voice,
           coalesce(sum(ce.total_cost_cents) filter (where public.fn_cost_category(ce.provider, ce.product) = 'llm'), 0) as llm,
           coalesce(sum(ce.total_cost_cents) filter (where public.fn_cost_category(ce.provider, ce.product) = 'telephony'), 0) as telephony,
           coalesce(sum(ce.total_cost_cents) filter (where public.fn_cost_category(ce.provider, ce.product) = 'other'), 0) as other_call,
           coalesce(sum(ce.total_cost_cents) filter (where public.fn_cost_category(ce.provider, ce.product) = 'messaging'), 0) as messaging
    from public.cost_events ce
    left join public.call_logs cl on cl.id = ce.call_id
    where ce.occurred_at >= p_start and ce.occurred_at < p_end
      and (p_include_test or cl.id is null or not cl.is_test_call)
    group by ce.tenant_id
  ),
  fees as (
    select ppe.tenant_id, sum(ppe.fee_cents) as fee
    from public.payment_processing_events ppe
    where ppe.occurred_at >= p_start and ppe.occurred_at < p_end
    group by ppe.tenant_id
  ),
  comm as (
    select ce.tenant_id, sum(ce.amount_cents) as amt
    from public.commission_events ce
    where ce.status <> 'clawed_back'
      and coalesce(ce.period, ce.created_at::date) >= (p_start at time zone 'UTC')::date
      and coalesce(ce.period, ce.created_at::date) < (p_end at time zone 'UTC')::date
    group by ce.tenant_id
  ),
  usage as (
    select ud.tenant_id, sum(ud.billable_minutes) as mins
    from public.usage_daily ud
    where ud.date >= (p_start at time zone 'UTC')::date and ud.date < (p_end at time zone 'UTC')::date
    group by ud.tenant_id
  ),
  calls as (
    select cl.tenant_id, count(*) as n
    from public.call_logs cl
    where cl.started_at >= p_start and cl.started_at < p_end
      and cl.channel in ('phone', 'web_voice')
      and (p_include_test or not cl.is_test_call)
    group by cl.tenant_id
  ),
  parts as (
    select b.id, b.name, b.vertical, b.status, b.is_test, b.trial_ends_at,
           coalesce(r.paid, 0)::bigint as revenue_cents,
           coalesce(r.pending, 0)::bigint as pending_revenue_cents,
           round(coalesce(c.voice, 0))::bigint as voice_cost_cents,
           round(coalesce(c.llm, 0))::bigint as llm_cost_cents,
           round(coalesce(c.telephony, 0))::bigint as telephony_cost_cents,
           round(coalesce(c.other_call, 0))::bigint as other_call_cost_cents,
           round(public.fn_number_rental_cents(b.id, p_start, p_end))::bigint as number_cost_cents,
           round(coalesce(c.messaging, 0))::bigint as messaging_cost_cents,
           coalesce(f.fee, 0)::bigint as processing_fee_cents,
           coalesce(m.amt, 0)::bigint as commission_cents,
           coalesce(u.mins, 0) as billable_minutes,
           coalesce(k.n, 0)::bigint as call_count
    from base b
    left join rev r on r.tenant_id = b.id
    left join cost c on c.tenant_id = b.id
    left join fees f on f.tenant_id = b.id
    left join comm m on m.tenant_id = b.id
    left join usage u on u.tenant_id = b.id
    left join calls k on k.tenant_id = b.id
  )
  select p.id, p.name, p.vertical,
         case
           when p.status = 'active' and p.trial_ends_at is not null
             and p.trial_ends_at > p_start and p.revenue_cents = 0
           then 'trialing'
           else p.status
         end,
         p.is_test,
         p.revenue_cents, p.pending_revenue_cents,
         p.voice_cost_cents, p.llm_cost_cents, p.telephony_cost_cents, p.other_call_cost_cents,
         p.number_cost_cents, p.messaging_cost_cents, p.processing_fee_cents, p.commission_cents,
         (p.voice_cost_cents + p.llm_cost_cents + p.telephony_cost_cents + p.other_call_cost_cents
          + p.number_cost_cents + p.messaging_cost_cents + p.processing_fee_cents + p.commission_cents)::bigint,
         (p.revenue_cents
          - (p.voice_cost_cents + p.llm_cost_cents + p.telephony_cost_cents + p.other_call_cost_cents
             + p.number_cost_cents + p.messaging_cost_cents + p.processing_fee_cents + p.commission_cents))::bigint,
         p.billable_minutes, p.call_count
  from parts p
$$;
revoke all on function public.fn_margin_by_tenant(timestamptz, timestamptz, boolean) from public, anon, authenticated;
comment on function public.fn_margin_by_tenant(timestamptz, timestamptz, boolean) is
  'COCKPIT-1: the single margin definition. Admin-cockpit-only (raw postgres connection); executable by neither anon nor authenticated. TRIAL-1: status reads ''trialing'' for an active tenant whose free trial reaches into the window and has no paid revenue in it.';

-- 5. Hourly safety net for the trial minutes cap. voice-events checks the cap
--    after every billable call; this catches a missed check (Stripe down,
--    worker restart) and stamps trial_ended_reason = 'time' on trials that ran
--    their days. Same DO-block shape as 20261001120000; idempotent by job name.
do $$
declare
  v_base_url text;
  v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skipping job-billing-cycle-trial-caps cron job (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net extension not installed — skipping job-billing-cycle-trial-caps cron job (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise notice 'supabase_vault extension not installed — skipping job-billing-cycle-trial-caps cron job until the deploy step inserts cron_functions_base_url/cron_invoke_secret (docs/DEPLOY.md §3.6)';
    return;
  end if;

  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'cron_functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';

  if v_base_url is null or v_secret is null then
    raise notice 'cron_functions_base_url/cron_invoke_secret not yet present in Vault — skipping job-billing-cycle-trial-caps cron job until docs/DEPLOY.md §3.6''s vault.create_secret step runs (re-run this migration''s statements afterward, or push again — idempotent by job name)';
    return;
  end if;

  perform public.fn_cron_upsert('job-billing-cycle-trial-caps', '23 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 60000);$fmt$,
    v_base_url || '/job-billing-cycle?task=trial_caps', v_secret));
end;
$$;
