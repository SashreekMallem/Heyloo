-- Recurring per-partner profit-share commissions (GAP_REGISTER Cluster G
-- item 1; owner decision, binding): each referral partner earns an
-- admin-set recurring commission (rate_bps of either 'gross_profit' or
-- 'revenue') for either a fixed number of months after qualification or
-- for the lifetime of the referred tenant, overridable per vertical — NO
-- platform-wide hardcoded rate. `job-commission-accrual`
-- (supabase/functions/job-commission-accrual/) computes one
-- commission_events row per (referral, month) from that month's paid
-- invoices/cost_events/Stripe fees.
--
-- Additive to, NOT a replacement for, the pre-existing one-time flat
-- qualification bonus (`fn_check_referral_qualification`,
-- 20260907131400_functions_triggers.sql, driven by
-- `platform_settings.referral_flat_amount_cents`) — that mechanism still
-- inserts a single `period IS NULL` commission_events row the moment a
-- referral qualifies; this migration's recurring engine inserts additional
-- `period`-scoped rows monthly thereafter. Both flow into the SAME
-- `commission_events.status = 'accrued'` pool `job-referral-payouts`
-- already batches by partner with no changes needed there. Logged per
-- CLAUDE.md Rule 4 in docs/BUILD_NOTES.md's Cluster G entry.

alter table public.referral_partners
  add column rate_bps int check (rate_bps is null or (rate_bps >= 0 and rate_bps <= 10000)),
  add column commission_base text not null default 'gross_profit'
    check (commission_base in ('gross_profit', 'revenue')),
  add column duration_months int check (duration_months is null or duration_months > 0);

comment on column public.referral_partners.rate_bps is
  'Admin-set recurring commission rate in basis points (10000 = 100%). NULL = no recurring commission accrues for this partner (job-commission-accrual skips it) — deliberately no platform-wide default (owner decision).';
comment on column public.referral_partners.commission_base is
  'gross_profit = revenue_cents - (that referred tenant''s real provider costs from cost_events + its Stripe processing fees from payment_processing_events) for the period; revenue = revenue_cents alone.';
comment on column public.referral_partners.duration_months is
  'How many months after referrals.qualified_at this partner keeps earning the recurring commission on a given referred tenant. NULL = lifetime (no expiry).';

create table public.referral_partner_vertical_overrides (
  id uuid primary key default gen_random_uuid(),
  referral_partner_id uuid not null references public.referral_partners(id),
  vertical text not null
    check (vertical in ('auto', 'vet', 'legal', 'dental', 'real_estate', 'motel', 'restaurant', 'generic')),
  rate_bps int check (rate_bps is null or (rate_bps >= 0 and rate_bps <= 10000)),
  commission_base text check (commission_base is null or commission_base in ('gross_profit', 'revenue')),
  duration_months int check (duration_months is null or duration_months > 0),
  created_at timestamptz not null default now(),
  constraint referral_partner_vertical_overrides_unique unique (referral_partner_id, vertical)
);

comment on table public.referral_partner_vertical_overrides is
  'Per-vertical override of a referral_partners row''s rate_bps/commission_base/duration_months. Any NULL column here falls back to the partner-level value (referral_partners), never to a platform default — matches the "no platform-wide hardcoded rate" owner decision at every fallback level.';

create index idx_referral_partner_vertical_overrides_partner
  on public.referral_partner_vertical_overrides (referral_partner_id);

-- `period date` already exists on `commission_events` from its original
-- definition (20260907131000_money.sql) — anticipated but never populated
-- by any writer until this migration's job-commission-accrual. Only the
-- four money/rate breakdown columns are genuinely new here.
alter table public.commission_events
  add column revenue_cents int,
  add column cost_cents int,
  add column base_cents int,
  add column rate_bps int;

comment on column public.commission_events.period is
  'First-of-month date this recurring accrual covers (job-commission-accrual). NULL for the pre-existing one-time flat qualification bonus, which is not period-scoped.';
comment on column public.commission_events.base_cents is
  'revenue_cents, or revenue_cents minus cost_cents (that period''s cost_events + Stripe fees), per the effective commission_base at accrual time. amount_cents = round(base_cents * rate_bps / 10000).';

-- job-commission-accrual's idempotency guarantee for the recurring engine
-- (CLAUDE.md Rule 2: never check-then-insert) — a re-run or overlapping
-- invocation for the same (referral, period) upserts rather than
-- duplicating. Partial (period IS NOT NULL) so it never constrains the
-- pre-existing period-less flat-bonus rows.
create unique index commission_events_referral_period_unique
  on public.commission_events (referral_id, period) where period is not null;

alter table public.referral_partner_vertical_overrides enable row level security;

create policy referral_partner_vertical_overrides_select
  on public.referral_partner_vertical_overrides for select
  using (
    referral_partner_id = public.fn_jwt_referral_partner_id()
    or public.fn_jwt_is_platform_admin()
  );
-- No client INSERT/UPDATE/DELETE policy: admin-set only, written by
-- supabase/functions/admin (service_role) — same posture as
-- referral_partners' own admin-authored columns below.

-- ---------------------------------------------------------------------
-- referral_partners_update (20260907131500_rls.sql) already lets a partner
-- self-update THEIR OWN row (payout_method/paypal_email) — Postgres RLS
-- has no column-level granularity within one UPDATE policy, so this
-- BEFORE UPDATE trigger additionally pins the three new commission-terms
-- columns to their prior value on any write made through a real
-- PostgREST/RLS session (request.jwt.claims present) that is not a
-- platform admin. Guarded on request.jwt.claims being present at all so a
-- service-role raw-Postgres connection (supabase/functions/admin, this
-- migration's own seed/backfill statements) — which never sets that
-- session GUC and so would otherwise always read fn_jwt_is_platform_admin()
-- as false — is left untouched; only a genuine non-admin self-service
-- write is reverted.
-- ---------------------------------------------------------------------

create or replace function public.fn_protect_referral_partner_commission_fields()
returns trigger language plpgsql as $$
begin
  if current_setting('request.jwt.claims', true) is not null
     and not public.fn_jwt_is_platform_admin() then
    new.rate_bps := old.rate_bps;
    new.commission_base := old.commission_base;
    new.duration_months := old.duration_months;
  end if;
  return new;
end;
$$;

comment on function public.fn_protect_referral_partner_commission_fields() is
  'Only an admin (platform_admin, checked via the JWT claims a real PostgREST request carries) may change rate_bps/commission_base/duration_months on referral_partners — a referral partner''s own self-service update (allowed for payout_method/paypal_email) silently leaves these three unchanged instead.';

create trigger trg_referral_partners_protect_commission_fields
  before update on public.referral_partners
  for each row execute function public.fn_protect_referral_partner_commission_fields();
