import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * Monthly recurring referral-partner commission accrual (GAP_REGISTER
 * Cluster G item 1, owner decision — binding). For every referral whose
 * status is `'qualified'`/`'paid'` and whose partner (or that partner's
 * per-vertical override) has a non-null `rate_bps`, computes one
 * `commission_events` row for the PREVIOUS calendar month from that
 * tenant's paid invoices (`billing_invoices`, populated by
 * `webhooks-stripe`'s `invoice.paid` handler), real provider costs
 * (`cost_events`), and Stripe processing fees
 * (`payment_processing_events`) — `base_cents` is `revenue_cents` alone
 * (`commission_base = 'revenue'`) or `revenue_cents - cost_cents`
 * (`'gross_profit'`, which nets out Stripe fees too), and
 * `amount_cents = round(base_cents * rate_bps / 10000)`, floored at 0 (a
 * loss-making month never produces a negative commission).
 *
 * Additive to the pre-existing one-time flat qualification bonus
 * (`fn_check_referral_qualification`) — that mechanism's rows carry
 * `period IS NULL`; every row this job writes carries a real `period`, and
 * the two accrual mechanisms share the same `commission_events.status =
 * 'accrued'` pool `job-referral-payouts` already batches from partner-wide,
 * with no change needed there.
 *
 * Idempotent by design (CLAUDE.md Rule 2 — never check-then-insert): the
 * `commission_events_referral_period_unique` partial unique index
 * (`(referral_id, period) where period is not null`) backs an
 * `ON CONFLICT ... DO UPDATE` that recomputes the row in place on a re-run
 * for the same period — EXCEPT once that row has left `'accrued'` (batched
 * for payout, paid, or clawed back), at which point the `WHERE` clause on
 * the conflict action makes the upsert a no-op, so a late re-run never
 * silently changes an amount that has already been sent to the partner.
 */

export interface CommissionAccrualDeps {
  logger: Logger;
}

interface CandidateReferralRow {
  referral_id: string;
  referral_partner_id: string;
  tenant_id: string;
  qualified_at: string;
  partner_rate_bps: number | null;
  partner_commission_base: "gross_profit" | "revenue";
  partner_duration_months: number | null;
  override_rate_bps: number | null;
  override_commission_base: "gross_profit" | "revenue" | null;
  override_duration_months: number | null;
}

interface EffectiveTerms {
  rateBps: number;
  base: "gross_profit" | "revenue";
  durationMonths: number | null;
}

function effectiveTerms(row: CandidateReferralRow): EffectiveTerms | null {
  const rateBps = row.override_rate_bps ?? row.partner_rate_bps;
  if (rateBps === null || rateBps === undefined) return null;
  return {
    rateBps,
    base: row.override_commission_base ?? row.partner_commission_base,
    durationMonths:
      row.override_duration_months !== null && row.override_duration_months !== undefined
        ? row.override_duration_months
        : row.partner_duration_months,
  };
}

/** True when `periodStart` is on/after the first calendar month the
 * partner's `durationMonths` window (from `qualifiedAt`) no longer covers.
 * `durationMonths === null` means lifetime — never expires. */
function isExpired(qualifiedAt: string, durationMonths: number | null, periodStart: Date): boolean {
  if (durationMonths === null) return false;
  const qualified = new Date(qualifiedAt);
  const windowEnd = Date.UTC(
    qualified.getUTCFullYear(),
    qualified.getUTCMonth() + durationMonths,
    1,
  );
  return periodStart.getTime() >= windowEnd;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Accrues the calendar month BEFORE `now` (job runs on the 1st, per
 * BACKEND_SPEC §8-style cadences elsewhere in this codebase — by then the
 * previous month's invoices/costs are settled). */
export function accrualPeriod(now: Date): { period: string; periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { period: toDateOnly(periodStart), periodStart, periodEnd };
}

async function findCandidateReferrals(sql: SqlClient): Promise<CandidateReferralRow[]> {
  return sql<CandidateReferralRow>`
    select
      r.id as referral_id,
      r.referral_partner_id,
      r.referred_tenant_id as tenant_id,
      r.qualified_at,
      rp.rate_bps as partner_rate_bps,
      rp.commission_base as partner_commission_base,
      rp.duration_months as partner_duration_months,
      o.rate_bps as override_rate_bps,
      o.commission_base as override_commission_base,
      o.duration_months as override_duration_months
    from public.referrals r
    join public.referral_partners rp on rp.id = r.referral_partner_id
    join public.tenants t on t.id = r.referred_tenant_id
    left join public.referral_partner_vertical_overrides o
      on o.referral_partner_id = rp.id and o.vertical = t.vertical
    where r.status in ('qualified', 'paid')
      and r.qualified_at is not null
      and coalesce(o.rate_bps, rp.rate_bps) is not null
  `;
}

async function periodFinancials(
  sql: SqlClient,
  tenantId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ revenueCents: number; costCents: number }> {
  const revenueRows = await sql<{ revenue_cents: number }>`
    select coalesce(sum(total_cents), 0)::int as revenue_cents
    from public.billing_invoices
    where tenant_id = ${tenantId} and status = 'paid'
      and period_start >= ${periodStart}::date and period_start < ${periodEnd}::date
  `;
  const costRows = await sql<{ cost_cents: number }>`
    select coalesce(sum(total_cost_cents), 0)::int as cost_cents
    from public.cost_events
    where tenant_id = ${tenantId}
      and occurred_at >= ${periodStart}::date and occurred_at < ${periodEnd}::date
  `;
  const feeRows = await sql<{ fee_cents: number }>`
    select coalesce(sum(fee_cents), 0)::int as fee_cents
    from public.payment_processing_events
    where tenant_id = ${tenantId}
      and occurred_at >= ${periodStart}::date and occurred_at < ${periodEnd}::date
  `;
  const revenueCents = revenueRows[0]?.revenue_cents ?? 0;
  const costCents = (costRows[0]?.cost_cents ?? 0) + (feeRows[0]?.fee_cents ?? 0);
  return { revenueCents, costCents };
}

export interface CommissionAccrualResult {
  period: string;
  /** Referrals with a resolvable non-null rate_bps (findCandidateReferrals
   * already excludes the rest at the SQL level — a partner/vertical with
   * no rate set simply never becomes a candidate). */
  candidatesConsidered: number;
  accrued: number;
  skippedExpired: number;
}

export async function runCommissionAccrual(
  sql: SqlClient,
  now: Date,
  deps: CommissionAccrualDeps,
): Promise<CommissionAccrualResult> {
  const { period, periodStart, periodEnd } = accrualPeriod(now);
  const periodStartStr = toDateOnly(periodStart);
  const periodEndStr = toDateOnly(periodEnd);

  const candidates = await findCandidateReferrals(sql);
  let accrued = 0;
  let skippedExpired = 0;

  for (const row of candidates) {
    const terms = effectiveTerms(row);
    if (!terms) continue; // findCandidateReferrals already filters this, defensive only.

    if (isExpired(row.qualified_at, terms.durationMonths, periodStart)) {
      skippedExpired++;
      continue;
    }

    const { revenueCents, costCents } = await periodFinancials(
      sql,
      row.tenant_id,
      periodStartStr,
      periodEndStr,
    );
    const baseCents = terms.base === "revenue" ? revenueCents : revenueCents - costCents;
    const amountCents = Math.max(0, Math.round((baseCents * terms.rateBps) / 10000));

    await sql`
      insert into public.commission_events (
        referral_partner_id, referral_id, tenant_id, amount_cents, period,
        revenue_cents, cost_cents, base_cents, rate_bps, status
      ) values (
        ${row.referral_partner_id}, ${row.referral_id}, ${row.tenant_id}, ${amountCents}, ${periodStartStr}::date,
        ${revenueCents}, ${costCents}, ${baseCents}, ${terms.rateBps}, 'accrued'
      )
      on conflict (referral_id, period) where period is not null do update set
        amount_cents = excluded.amount_cents,
        revenue_cents = excluded.revenue_cents,
        cost_cents = excluded.cost_cents,
        base_cents = excluded.base_cents,
        rate_bps = excluded.rate_bps
      where public.commission_events.status = 'accrued'
    `;
    accrued++;
  }

  deps.logger.info("job_commission_accrual_ran", {
    period,
    candidates_considered: candidates.length,
    accrued,
    skipped_expired: skippedExpired,
  });

  return {
    period,
    candidatesConsidered: candidates.length,
    accrued,
    skippedExpired,
  };
}
