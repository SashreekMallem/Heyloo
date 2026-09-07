import type { SqlClient } from "../_shared/types.js";

/**
 * Alert-evaluation job (BACKEND_SPEC §8, every 5 minutes): evaluates the
 * cockpit's alert rules and upserts into `alerts` (`DECIDE:` table per
 * BACKEND_SPEC §8 — `id, rule, severity, tenant_id nullable, payload jsonb,
 * status, created_at, acked_at, acked_by`).
 *
 * This build implements the three rules with the most direct, already-
 * available data sources: `negative_margin` (from the `v_tenant_margin`
 * view, §2), `usage_spike` (trailing-7-day average vs. today from
 * `usage_daily`), and `tool_failure_spike` (from the `tool_health` table
 * `/voice-tools` emits stats into, tool-stats.ts). The remaining rules
 * named in BACKEND_SPEC §8 — price drift >8% (needs a cost-baseline
 * comparison in `platform_settings` not yet defined), concurrency >=80% of
 * purchased Retell concurrency (needs a live Retell concurrency-usage API
 * read), commission > margin, and payment failures (needs
 * `payment_processing_events`/dunning-state correlation) — are flagged here
 * as follow-ups rather than guessed at with placeholder thresholds.
 */
export interface Alert {
  rule: string;
  severity: "info" | "warning" | "critical";
  tenant_id: string | null;
  payload: Record<string, unknown>;
}

export async function evaluateNegativeMargin(sql: SqlClient): Promise<Alert[]> {
  const rows = await sql<{ tenant_id: string; name: string; margin_cents: number }>`
    select tenant_id, name, margin_cents from public.v_tenant_margin where margin_cents < 0
  `;
  return rows.map((r) => ({
    rule: "negative_margin",
    severity: "warning",
    tenant_id: r.tenant_id,
    payload: { tenant_name: r.name, margin_cents: r.margin_cents },
  }));
}

const USAGE_SPIKE_MULTIPLIER = 2.5;

export async function evaluateUsageSpike(sql: SqlClient): Promise<Alert[]> {
  const rows = await sql<{
    tenant_id: string;
    today_minutes: number;
    trailing_avg_minutes: number;
  }>`
    with today as (
      select tenant_id, sum(billable_minutes) as today_minutes
      from public.usage_daily where date = current_date
      group by tenant_id
    ), trailing as (
      select tenant_id, avg(billable_minutes) as trailing_avg_minutes
      from public.usage_daily
      where date >= current_date - interval '7 days' and date < current_date
      group by tenant_id
    )
    select t.tenant_id, t.today_minutes, coalesce(tr.trailing_avg_minutes, 0) as trailing_avg_minutes
    from today t
    left join trailing tr on tr.tenant_id = t.tenant_id
    where tr.trailing_avg_minutes > 0 and t.today_minutes >= tr.trailing_avg_minutes * ${USAGE_SPIKE_MULTIPLIER}
  `;
  return rows.map((r) => ({
    rule: "usage_spike",
    severity: "warning",
    tenant_id: r.tenant_id,
    payload: { today_minutes: r.today_minutes, trailing_avg_minutes: r.trailing_avg_minutes },
  }));
}

const TOOL_FAILURE_RATE_THRESHOLD = 0.2;

export async function evaluateToolFailureSpike(sql: SqlClient): Promise<Alert[]> {
  const rows = await sql<{ tool_name: string; total: number; errors: number }>`
    select tool_name, count(*) as total, count(*) filter (where not success) as errors
    from public.tool_health
    where occurred_at > now() - interval '5 minutes'
    group by tool_name
    having count(*) filter (where not success)::numeric / nullif(count(*), 0) > ${TOOL_FAILURE_RATE_THRESHOLD}
  `;
  return rows.map((r) => ({
    rule: "tool_failure_spike",
    severity: "critical",
    tenant_id: null,
    payload: { tool_name: r.tool_name, total: r.total, errors: r.errors },
  }));
}

export async function upsertAlert(sql: SqlClient, alert: Alert): Promise<void> {
  await sql`
    insert into public.alerts (rule, severity, tenant_id, payload, status)
    select ${alert.rule}, ${alert.severity}, ${alert.tenant_id}, ${JSON.stringify(alert.payload)}::jsonb, 'open'
    where not exists (
      select 1 from public.alerts a
      where a.rule = ${alert.rule}
        and a.status = 'open'
        and coalesce(a.tenant_id::text, '') = coalesce(${alert.tenant_id}, '')
        and a.created_at > now() - interval '1 hour'
    )
  `;
}

export async function runAlertEvaluation(sql: SqlClient): Promise<Alert[]> {
  const alerts = [
    ...(await evaluateNegativeMargin(sql)),
    ...(await evaluateUsageSpike(sql)),
    ...(await evaluateToolFailureSpike(sql)),
  ];
  for (const alert of alerts) {
    await upsertAlert(sql, alert);
  }
  return alerts;
}
