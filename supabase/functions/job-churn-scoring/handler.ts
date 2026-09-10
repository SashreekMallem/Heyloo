import type { SqlClient } from "../_shared/types.ts";

/**
 * Churn-scoring job (BACKEND_SPEC §8 "Churn scoring", `0 6 * * *`,
 * E2E_FLOWS_AUDIT H3): recomputes a per-tenant churn-risk score from usage
 * trend, support-ticket volume, and payment-failure history, upserting the
 * single latest row per tenant into `churn_scores` (BACKEND_SPEC §8's own
 * `DECIDE:` — "a small churn_scores(tenant_id, score, factors jsonb,
 * computed_at) table rather than overloading tenants", approved in
 * MASTER_SPEC §2).
 *
 * Three signals, each normalized to [0, 1] before weighting:
 *  - `usageTrendFactor` — trailing-7-day call volume vs. the 7 days before
 *    that (from `usage_daily`, already rolled up by the usage-rollup job).
 *    A tenant whose calls dropped off is more likely to churn; a tenant
 *    with no prior-week baseline and no current-week volume either is
 *    scored neutral (not enough signal to call it a decline), while a
 *    tenant that HAD volume and now has none scores maximum risk on this
 *    factor.
 *  - `supportTicketFactor` — open/pending `support_requests` in the
 *    trailing 30 days, normalized against a ceiling of 5 (more than 5 open
 *    tickets is already a clear risk signal, not a linear scale worth
 *    distinguishing further).
 *  - `paymentFailureFactor` — `billing_invoices` rows that went `past_due`
 *    in the trailing 180 days, normalized against a ceiling of 2 (a repeat
 *    payment failure is the strongest financial-risk signal available
 *    without a live Stripe dunning-state read).
 *
 * Weights (usage 0.40 / support 0.25 / payment 0.35) favor usage trend as
 * the earliest-available signal and payment failures as the most
 * financially consequential one, per BACKEND_SPEC §8's own ordering of the
 * three named signals. A tenant already `paused`/`canceled` is scored 100
 * outright (churn already happened) rather than through the weighted
 * formula — the factors are still recorded for audit trail.
 *
 * `DECIDE:` (docs/BUILD_NOTES.md, task CLUSTER-F): the exact weights/
 * ceilings above are this build's reasoned defaults, not a spec-mandated
 * formula (BACKEND_SPEC §8 names the three signal categories but not a
 * scoring function) — tune once real churn outcomes are observed.
 */
export interface ChurnInputRow {
  tenant_id: string;
  status: string;
  calls_last_7: number;
  calls_prev_7: number;
  open_support_tickets: number;
  past_due_invoices: number;
}

export async function fetchChurnInputs(sql: SqlClient): Promise<ChurnInputRow[]> {
  return sql<ChurnInputRow>`
    select
      t.id as tenant_id,
      t.status,
      coalesce(last7.calls, 0)::int as calls_last_7,
      coalesce(prev7.calls, 0)::int as calls_prev_7,
      coalesce(support.cnt, 0)::int as open_support_tickets,
      coalesce(pastdue.cnt, 0)::int as past_due_invoices
    from public.tenants t
    left join (
      select tenant_id, sum(total_calls) as calls
      from public.usage_daily
      where date >= current_date - 7 and date < current_date
      group by tenant_id
    ) last7 on last7.tenant_id = t.id
    left join (
      select tenant_id, sum(total_calls) as calls
      from public.usage_daily
      where date >= current_date - 14 and date < current_date - 7
      group by tenant_id
    ) prev7 on prev7.tenant_id = t.id
    left join (
      select tenant_id, count(*) as cnt
      from public.support_requests
      where status in ('open', 'pending') and created_at >= now() - interval '30 days'
      group by tenant_id
    ) support on support.tenant_id = t.id
    left join (
      select tenant_id, count(*) as cnt
      from public.billing_invoices
      where status = 'past_due' and created_at >= now() - interval '180 days'
      group by tenant_id
    ) pastdue on pastdue.tenant_id = t.id
    where t.deleted_at is null
  `;
}

export interface ChurnScoreResult {
  score: number;
  factors: {
    usage_trend_factor: number;
    support_ticket_factor: number;
    payment_failure_factor: number;
    calls_last_7: number;
    calls_prev_7: number;
    open_support_tickets: number;
    past_due_invoices: number;
    already_churned: boolean;
  };
}

const SUPPORT_TICKET_CEILING = 5;
const PAYMENT_FAILURE_CEILING = 2;
const WEIGHT_USAGE_TREND = 0.4;
const WEIGHT_SUPPORT = 0.25;
const WEIGHT_PAYMENT = 0.35;

function usageTrendFactor(callsLast7: number, callsPrev7: number): number {
  if (callsPrev7 <= 0) return callsLast7 > 0 ? 0 : 0.3; // no baseline: mild neutral risk, never zero
  const decline = (callsPrev7 - callsLast7) / callsPrev7;
  return Math.min(1, Math.max(0, decline));
}

export function computeChurnScore(row: ChurnInputRow): ChurnScoreResult {
  const alreadyChurned = row.status === "paused" || row.status === "canceled";
  const usage = usageTrendFactor(row.calls_last_7, row.calls_prev_7);
  const support = Math.min(1, row.open_support_tickets / SUPPORT_TICKET_CEILING);
  const payment = Math.min(1, row.past_due_invoices / PAYMENT_FAILURE_CEILING);

  const weighted = WEIGHT_USAGE_TREND * usage + WEIGHT_SUPPORT * support + WEIGHT_PAYMENT * payment;
  const score = alreadyChurned ? 100 : Math.round(Math.min(1, weighted) * 100);

  return {
    score,
    factors: {
      usage_trend_factor: usage,
      support_ticket_factor: support,
      payment_failure_factor: payment,
      calls_last_7: row.calls_last_7,
      calls_prev_7: row.calls_prev_7,
      open_support_tickets: row.open_support_tickets,
      past_due_invoices: row.past_due_invoices,
      already_churned: alreadyChurned,
    },
  };
}

export async function upsertChurnScore(
  sql: SqlClient,
  tenantId: string,
  result: ChurnScoreResult,
): Promise<void> {
  await sql`
    insert into public.churn_scores (tenant_id, score, factors, computed_at)
    values (${tenantId}, ${result.score}, ${JSON.stringify(result.factors)}::jsonb, now())
    on conflict (tenant_id) do update set
      score = excluded.score, factors = excluded.factors, computed_at = excluded.computed_at
  `;
}

export async function runChurnScoring(sql: SqlClient): Promise<{ scored: number }> {
  const rows = await fetchChurnInputs(sql);
  for (const row of rows) {
    const result = computeChurnScore(row);
    await upsertChurnScore(sql, row.tenant_id, result);
  }
  return { scored: rows.length };
}
