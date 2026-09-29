-- COCKPIT-1 — trustworthy per-call cost capture + correct margin math.
-- Additive (CLAUDE.md Rule 2): ALTERs new columns/indexes onto existing
-- tables, replaces four cockpit-only views (drop + create — their old
-- definitions were wrong, see below) and adds cockpit-only SQL functions.
-- No existing migration is edited.
--
-- Root causes this fixes (docs/BUILD_NOTES.md COCKPIT-1):
--  1. `call_logs.cost_cents` was only ever written by the `fn_rollup_call_cost`
--     INSERT trigger on `cost_events`. A call whose `call_cost` is present
--     but empty/zero (Retell `error_user_not_joined` web calls report
--     `combined_cost: 0`, `product_costs: []`) inserts no cost_events row, so
--     the trigger never fired and the cost stayed NULL ("unknown") instead of
--     a real 0. Handlers now write cost_cents + cost_source explicitly.
--  2. Nothing recorded WHERE a cost came from (webhook vs get-call backfill vs
--     estimate), and cost_events had no idempotency key, so a second source
--     (call_analyzed re-delivering the same call_cost, a get-call backfill)
--     would double count. New unique indexes make every write an upsert.
--  3. `cost_events.unit_cost_cents/quantity/unit` were never populated, so the
--     repricing-drift page (which averages unit_cost_cents) was always empty.
--  4. `v_tenant_margin` read revenue from `revenue_events` (never written by
--     any code path — always 0), counted test calls/tenants, ignored payment
--     processing fees / number rentals / messaging / commissions.
--  5. `v_referral_pnl` joined referrals x commission_events per partner, so
--     every count/sum was multiplied by the other side's row count.

-- ---------------------------------------------------------------------------
-- 1. Cost provenance columns + idempotency
-- ---------------------------------------------------------------------------
alter table public.call_logs
  add column if not exists cost_source text;
alter table public.call_logs
  drop constraint if exists call_logs_cost_source_check;
alter table public.call_logs
  add constraint call_logs_cost_source_check check (
    cost_source is null or cost_source in (
      'retell_call_ended', 'retell_call_analyzed', 'retell_get_call', 'webhook_payload_backfill'
    )
  );
comment on column public.call_logs.cost_source is
  'Where cost_cents came from. NULL = cost unknown (no provider call, or the provider never reported one) — distinct from 0 (provider reported a zero-cost call, e.g. Retell error_user_not_joined). cost_cents is the ROUNDED sum of cost_events.total_cost_cents; margin math sums cost_events directly (numeric) so per-call rounding never accumulates.';

alter table public.cost_events
  add column if not exists source text not null default 'retell_call_ended',
  add column if not exists is_transfer_leg_cost boolean not null default false,
  add column if not exists external_ref text;
alter table public.cost_events
  drop constraint if exists cost_events_source_check;
alter table public.cost_events
  add constraint cost_events_source_check check (
    source in (
      'retell_call_ended', 'retell_call_analyzed', 'retell_get_call', 'estimate', 'provider_reported'
    )
  );
comment on column public.cost_events.source is
  'retell_* = provider-reported per-call cost (Retell call_cost.product_costs[].cost, US cents, fractional); estimate = computed from platform_settings.provider_cost_card (SMS/email per message) — replace with provider_reported when a provider price callback is wired.';
comment on column public.cost_events.external_ref is
  'Idempotency key for non-call cost rows (e.g. messages_outbound.id for a per-message SMS/email estimate). Call cost rows are keyed by (call_id, provider, product, is_transfer_leg_cost).';

create unique index if not exists uq_cost_events_call_product
  on public.cost_events (call_id, provider, product, is_transfer_leg_cost)
  where call_id is not null and external_ref is null;
create unique index if not exists uq_cost_events_external_ref
  on public.cost_events (provider, product, external_ref)
  where external_ref is not null;

-- ---------------------------------------------------------------------------
-- 2. Backfill from data we already hold (webhook_events payloads) — no
--    provider calls. Idempotent: only touches rows still NULL / unpopulated.
-- ---------------------------------------------------------------------------
update public.call_logs cl
set cost_cents = round(w.combined)::int,
    cost_source = 'webhook_payload_backfill'
from (
  select distinct on (rcid) rcid, combined
  from (
    select payload->'call'->>'call_id' as rcid,
           (payload->'call'->'call_cost'->>'combined_cost')::numeric as combined,
           created_at
    from public.webhook_events
    where source = 'retell'
      and event_type in ('call_ended', 'call_analyzed')
      and jsonb_typeof(payload->'call'->'call_cost') = 'object'
      and payload->'call'->'call_cost'->>'combined_cost' is not null
  ) s
  order by rcid, created_at desc
) w
where cl.retell_call_id = w.rcid
  and cl.cost_cents is null;

update public.call_logs
set cost_source = 'retell_call_ended'
where cost_cents is not null
  and cost_source is null
  and exists (select 1 from public.cost_events ce where ce.call_id = call_logs.id);

-- Populate unit_cost_cents/quantity/unit for Retell rows already stored.
-- `raw.unit_price` is US cents PER SECOND (Retell get-call docs). A product
-- whose cost equals its unit_price is a flat per-call charge (unit 'unit');
-- everything else is time-metered (unit 'minute', unit_cost_cents per minute).
update public.cost_events
set unit = case when abs(total_cost_cents / nullif((raw->>'unit_price')::numeric, 0) - 1) <= 0.01
                then 'unit' else 'minute' end,
    quantity = case when abs(total_cost_cents / nullif((raw->>'unit_price')::numeric, 0) - 1) <= 0.01
                    then 1 else total_cost_cents / (raw->>'unit_price')::numeric / 60 end,
    unit_cost_cents = case when abs(total_cost_cents / nullif((raw->>'unit_price')::numeric, 0) - 1) <= 0.01
                           then (raw->>'unit_price')::numeric else (raw->>'unit_price')::numeric * 60 end
where provider = 'retell'
  and unit_cost_cents is null
  and raw ? 'unit_price'
  and (raw->>'unit_price') ~ '^[0-9]+(\.[0-9]+)?$'
  and (raw->>'unit_price')::numeric > 0;

-- ---------------------------------------------------------------------------
-- 3. Rollup trigger: round properly, keep provenance, also fire on UPDATE
-- ---------------------------------------------------------------------------
create or replace function public.fn_rollup_call_cost()
returns trigger language plpgsql as $$
begin
  if new.call_id is not null then
    update public.call_logs
    set cost_cents = coalesce((
          select round(sum(total_cost_cents))::int from public.cost_events where call_id = new.call_id
        ), 0),
        cost_source = coalesce(cost_source, new.source)
    where id = new.call_id
      and new.source <> 'estimate';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_call_logs_cost_rollup_upd on public.cost_events;
create trigger trg_call_logs_cost_rollup_upd after update of total_cost_cents on public.cost_events
  for each row when (old.total_cost_cents is distinct from new.total_cost_cents)
  execute function public.fn_rollup_call_cost();

-- ---------------------------------------------------------------------------
-- 4. Provider price card (assumptions; see docs/VERIFY.md COCKPIT-1)
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value)
values (
  'provider_cost_card',
  jsonb_build_object(
    'as_of', '2026-09-29',
    'retell', jsonb_build_object('number_monthly_cents', 200),
    'twilio', jsonb_build_object('number_monthly_cents', 115, 'sms_segment_cents', 0.83, 'sms_carrier_fee_cents', 0.40),
    'telnyx', jsonb_build_object('number_monthly_cents', 100, 'sms_segment_cents', 0.40, 'sms_carrier_fee_cents', 0.40),
    'resend', jsonb_build_object('email_cents', 0.04)
  )
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Cost categories + number rental
-- ---------------------------------------------------------------------------
create or replace function public.fn_cost_category(p_provider text, p_product text)
returns text language sql immutable as $$
  select case
    when p_product = 'phone_number_monthly' then 'numbers'
    when p_provider in ('twilio', 'telnyx', 'resend') then 'messaging'
    when p_product ilike '%telephony%' then 'telephony'
    when p_product ilike '%voice_engine%' or p_product ilike '%tts%' or p_product ilike '%voice%' then 'voice'
    when p_product ilike 'gpt%' or p_product ilike 'claude%' or p_product ilike 'gemini%'
      or p_product ilike '%llm%' then 'llm'
    else 'other'
  end
$$;

-- Monthly number rental accrued in [p_start, p_end): fee x active days /
-- days in that calendar month, summed per month overlapped (UTC). Retell
-- native numbers (twilio_sid NULL or 'retell-native:%') bill at the Retell
-- rate; Twilio-leased numbers at the Twilio rate.
create or replace function public.fn_number_rental_cents(p_tenant uuid, p_start timestamptz, p_end timestamptz)
returns numeric language sql stable as $$
  with card as (select value from public.platform_settings where key = 'provider_cost_card'),
  months as (
    select m as m_start, m + interval '1 month' as m_end
    from generate_series(
      date_trunc('month', p_start at time zone 'UTC'),
      (p_end at time zone 'UTC') - interval '1 microsecond',
      interval '1 month'
    ) m
  )
  select coalesce(sum(
    fee.cents
    * greatest(0, extract(epoch from (
        least(coalesce(pn.released_at at time zone 'UTC', 'infinity'::timestamp), p_end at time zone 'UTC', mo.m_end)
        - greatest(pn.created_at at time zone 'UTC', p_start at time zone 'UTC', mo.m_start)
      )) / 86400.0)
    / extract(day from (mo.m_end - mo.m_start))
  ), 0)
  from public.phone_numbers pn
  cross join months mo
  cross join lateral (
    select coalesce(
      (select ((value -> (case when pn.twilio_sid is not null and pn.twilio_sid not like 'retell-native:%'
                              then 'twilio' else 'retell' end)) ->> 'number_monthly_cents')::numeric from card),
      case when pn.twilio_sid is not null and pn.twilio_sid not like 'retell-native:%' then 115 else 200 end
    ) as cents
  ) fee
  where pn.tenant_id = p_tenant
$$;

-- ---------------------------------------------------------------------------
-- 6. The margin definition (one place; cockpit views + admin function use it)
--    revenue  = billing_invoices.status='paid' (Stripe-collected), by billing
--               period (period_start in window) — same definition as
--               job-commission-accrual.periodFinancials.
--    cost     = Retell per-call cost_events (real calls only unless
--               p_include_test) + number rental (COMPUTED from phone_numbers,
--               never stored as cost_events, so it cannot double count)
--               + per-message SMS/email cost_events
--               + Stripe processing fees + accrued (non-clawed-back) commissions.
--    Each component is rounded to integer cents FIRST, cost is the sum of the
--    rounded components, so the waterfall always adds up exactly.
-- ---------------------------------------------------------------------------
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
    select t.id, t.name, t.vertical, t.status, t.is_test
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
    select b.id, b.name, b.vertical, b.status, b.is_test,
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
  select p.id, p.name, p.vertical, p.status, p.is_test,
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
revoke all on function public.fn_number_rental_cents(uuid, timestamptz, timestamptz) from public, anon, authenticated;
comment on function public.fn_margin_by_tenant(timestamptz, timestamptz, boolean) is
  'COCKPIT-1: the single margin definition. Admin-cockpit-only (raw postgres connection); executable by neither anon nor authenticated.';

-- ---------------------------------------------------------------------------
-- 7. Views (replaced — old definitions were wrong, see header)
-- ---------------------------------------------------------------------------
drop view if exists public.v_tenant_margin;
create view public.v_tenant_margin as
select tenant_id, name, vertical, revenue_cents, cost_cents, margin_cents,
       pending_revenue_cents, voice_cost_cents, llm_cost_cents, telephony_cost_cents,
       other_call_cost_cents, number_cost_cents, messaging_cost_cents,
       processing_fee_cents, commission_cents, billable_minutes, call_count
from public.fn_margin_by_tenant(
  date_trunc('month', now() at time zone 'UTC') at time zone 'UTC',
  (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC',
  false
);

drop view if exists public.v_call_cost_vs_billed;
create view public.v_call_cost_vs_billed as
select
  cl.id as call_id,
  cl.tenant_id,
  cl.duration_seconds,
  coalesce(cc.cost, cl.cost_cents::numeric) as provider_cost_numeric_cents,
  round(coalesce(cc.cost, cl.cost_cents::numeric))::int as provider_cost_cents,
  case when pc.base_cents is not null and nullif(pc.included_minutes, 0) is not null
       then round((cl.duration_seconds / 60.0) * pc.base_cents / pc.included_minutes)::int
  end as implied_billed_cents,
  cl.cost_source
from public.call_logs cl
join public.tenants t on t.id = cl.tenant_id and not t.is_test and t.deleted_at is null
left join lateral (
  select sum(ce.total_cost_cents) as cost from public.cost_events ce where ce.call_id = cl.id
) cc on true
left join lateral (
  select (value->>'base_cents')::numeric as base_cents, (value->>'included_minutes')::numeric as included_minutes
  from public.platform_settings where key = 'price_card_' || t.vertical
) pc on true
where cl.is_test_call = false and cl.channel in ('phone', 'web_voice');

drop view if exists public.v_referral_pnl;
create view public.v_referral_pnl as
select
  rp.id as referral_partner_id,
  rp.name,
  coalesce(r.qualified_count, 0)::bigint as qualified_count,
  c.paid_cents,
  c.accrued_cents,
  coalesce(r.signup_count, 0)::bigint as signup_count,
  coalesce(r.paid_count, 0)::bigint as paid_count,
  c.batched_cents,
  coalesce(rv.revenue_cents, 0)::bigint as attributed_revenue_cents
from public.referral_partners rp
left join (
  select referral_partner_id,
         count(*) filter (where status in ('qualified', 'paid')) as qualified_count,
         count(*) filter (where status = 'paid') as paid_count,
         count(*) as signup_count
  from public.referrals
  group by referral_partner_id
) r on r.referral_partner_id = rp.id
left join (
  select referral_partner_id,
         sum(amount_cents) filter (where status = 'paid')::bigint as paid_cents,
         sum(amount_cents) filter (where status = 'accrued')::bigint as accrued_cents,
         sum(amount_cents) filter (where status = 'batched')::bigint as batched_cents
  from public.commission_events
  group by referral_partner_id
) c on c.referral_partner_id = rp.id
left join (
  select rf.referral_partner_id, sum(bi.total_cents) as revenue_cents
  from public.referrals rf
  join public.tenants t on t.id = rf.referred_tenant_id and not t.is_test
  join public.billing_invoices bi on bi.tenant_id = rf.referred_tenant_id and bi.status = 'paid'
  where rf.status <> 'disqualified'
  group by rf.referral_partner_id
) rv on rv.referral_partner_id = rp.id;

alter view public.v_tenant_margin set (security_invoker = true);
alter view public.v_call_cost_vs_billed set (security_invoker = true);
alter view public.v_referral_pnl set (security_invoker = true);
revoke all on public.v_tenant_margin from anon, authenticated;
revoke all on public.v_call_cost_vs_billed from anon, authenticated;
revoke all on public.v_referral_pnl from anon, authenticated;

comment on view public.v_tenant_margin is
  'Admin-cockpit-only (margin secrecy, DB_AUDIT.md DB-B1). Current calendar month (UTC), REAL tenants/calls only, via fn_margin_by_tenant (COCKPIT-1). revenue = paid Stripe invoices for that billing period.';
comment on view public.v_call_cost_vs_billed is
  'Admin-cockpit-only. Real calls only. implied_billed_cents = duration x (plan base fee / included minutes), i.e. the effective per-minute price inside the allowance — overage minutes are billed at the tenant level, not per call (COCKPIT-1; the previous overage-rate basis understated revenue).';
comment on view public.v_referral_pnl is
  'Admin-cockpit-only. Per-partner rollup with pre-aggregated referrals and commission_events (COCKPIT-1: the old direct double join multiplied every count/sum by the other side''s row count).';
