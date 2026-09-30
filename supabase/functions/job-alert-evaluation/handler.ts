import type { SqlClient } from "../_shared/types.ts";

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

/**
 * COCKPIT-1: evaluated on the LAST CLOSED month, for real tenants that were
 * actually paid (revenue > 0). The previous rule read the current-month
 * `v_tenant_margin` (revenue from an always-empty `revenue_events`, cost from
 * test calls too), so every tenant with any cost looked negative and one
 * tenant's test calls raised 193 hourly "negative margin" alerts. Invoices are
 * billed in arrears, so the current month has no paid revenue to compare
 * against until it closes.
 */
export async function evaluateNegativeMargin(sql: SqlClient): Promise<Alert[]> {
  const rows = await sql<{ tenant_id: string; name: string; margin_cents: unknown }>`
    select tenant_id, name, margin_cents
    from public.fn_margin_by_tenant(
      (date_trunc('month', now() at time zone 'UTC') - interval '1 month') at time zone 'UTC',
      date_trunc('month', now() at time zone 'UTC') at time zone 'UTC',
      false
    )
    where revenue_cents > 0 and margin_cents < 0
  `;
  return rows.map((r) => ({
    rule: "negative_margin",
    severity: "warning",
    tenant_id: r.tenant_id,
    payload: { tenant_name: r.name, margin_cents: Number(r.margin_cents), period: "last_month" },
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
    ), prior_week as (
      -- NOT 'trailing': reserved word in PostgreSQL (TRIM ... TRAILING), a
      -- syntax error as a CTE name; caught on the live project 2026-09-20.
      select tenant_id, avg(billable_minutes) as trailing_avg_minutes
      from public.usage_daily
      where date >= current_date - interval '7 days' and date < current_date
      group by tenant_id
    )
    select t.tenant_id, t.today_minutes, coalesce(tr.trailing_avg_minutes, 0) as trailing_avg_minutes
    from today t
    left join prior_week tr on tr.tenant_id = t.tenant_id
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

/**
 * QA-1 BE-05: cron health. `pg_cron` only records that `pg_net` QUEUED the
 * request, so `cron.job_run_details` says "succeeded" while the function
 * answered 500 or timed out (live: 22 x 500, 2 null and 1 x 546 next to 797 x
 * 200 in six hours, 3,538 "succeeded" runs). `net._http_response` (columns id,
 * status_code, content_type, headers, content, timed_out, error_msg, created;
 * retained 6 hours by default - supabase.com/docs/guides/database/extensions/pg_net)
 * holds the real outcome. It does NOT keep the request URL, so the rule is a
 * platform-wide count of failed responses with the status breakdown, not a
 * per-job one (per-job attribution needs heartbeats; see BUILD_NOTES). Read
 * defensively: if the `net` schema is not readable the rule yields nothing
 * rather than aborting the other rules.
 */
export const JOB_HEALTH_WINDOW_MINUTES = 30;
export const JOB_HEALTH_MIN_FAILURES = 3;

export async function evaluateJobHealth(sql: SqlClient): Promise<Alert[]> {
  let rows: { status: string; n: number }[];
  try {
    rows = await sql<{ status: string; n: number }>`
      select coalesce(status_code::text, case when timed_out then 'timeout' else 'no_status' end) as status,
        count(*)::int as n
      from net._http_response
      where created > now() - make_interval(mins => ${JOB_HEALTH_WINDOW_MINUTES}::int)
        and (status_code is null or status_code < 200 or status_code >= 300)
      group by 1
      order by 2 desc
    `;
  } catch {
    return [];
  }
  const failed = rows.reduce((sum, r) => sum + Number(r.n), 0);
  if (failed < JOB_HEALTH_MIN_FAILURES) return [];
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = Number(r.n);
  return [
    {
      rule: "job_failures",
      severity: "warning",
      tenant_id: null,
      payload: {
        source: "pg_net",
        window_minutes: JOB_HEALTH_WINDOW_MINUTES,
        failed,
        by_status: byStatus,
      },
    },
  ];
}

/**
 * QA-1 BE-15: what makes two alerts "the same condition" besides rule and
 * tenant. Stored in the row's payload as `dedupe_key`.
 */
export function alertKey(alert: Alert): string {
  const k = alert.payload["tool_name"] ?? alert.payload["period"] ?? alert.payload["source"];
  return typeof k === "string" ? k : "";
}

/**
 * QA-1 BE-15: one OPEN alert per (rule, tenant, key), however long the
 * condition persists. It used to insert again once the open alert was an hour
 * old, so a lasting condition re-raised every hour until someone acked it (193
 * open negative_margin rows for one tenant). An already-open alert now has its
 * payload refreshed and `last_seen_at` stamped instead of a new row.
 * `uq_alerts_open_rule_tenant` (migration 20260930251400, COCKPIT-F07) backs
 * this up against a concurrent run, hence `on conflict do nothing`.
 */
export async function upsertAlert(sql: SqlClient, alert: Alert): Promise<void> {
  const key = alertKey(alert);
  const payload = { ...alert.payload, dedupe_key: key, last_seen_at: new Date().toISOString() };
  await sql`
    with refreshed as (
      update public.alerts a
      set payload = a.payload || ${payload}::jsonb, severity = ${alert.severity}
      where a.rule = ${alert.rule}
        and a.status = 'open'
        and coalesce(a.tenant_id::text, '') = coalesce(${alert.tenant_id}, '')
        and coalesce(a.payload->>'dedupe_key', '') = ${key}
      returning a.id
    )
    insert into public.alerts (rule, severity, tenant_id, payload, status)
    select ${alert.rule}, ${alert.severity}, ${alert.tenant_id}, ${payload}::jsonb, 'open'
    where not exists (select 1 from refreshed)
    on conflict do nothing
  `;
}

/** The rules this job owns; only these are ever auto-resolved. */
export const MANAGED_RULES = [
  "negative_margin",
  "usage_spike",
  "tool_failure_spike",
  "job_failures",
] as const;

/**
 * QA-1 BE-15: auto-resolve. An open alert of a managed rule whose condition
 * did not fire in this evaluation has cleared, so it is marked `resolved`
 * (acked alerts are left alone). This also retires the historical hourly
 * duplicates the old dedupe left open.
 */
export async function resolveClearedAlerts(sql: SqlClient, current: Alert[]): Promise<void> {
  const active = current.map((a) => `${a.tenant_id ?? ""}|${a.rule}|${alertKey(a)}`);
  await sql`
    update public.alerts a
    set status = 'resolved'
    where a.status = 'open'
      and a.rule in (select jsonb_array_elements_text(${[...MANAGED_RULES]}::jsonb))
      and not exists (
        select 1 from jsonb_array_elements_text(${active}::jsonb) k
        where k = coalesce(a.tenant_id::text, '') || '|' || a.rule || '|' || coalesce(a.payload->>'dedupe_key', '')
      )
  `;
}

export async function runAlertEvaluation(sql: SqlClient): Promise<Alert[]> {
  const alerts = [
    ...(await evaluateNegativeMargin(sql)),
    ...(await evaluateUsageSpike(sql)),
    ...(await evaluateToolFailureSpike(sql)),
    ...(await evaluateJobHealth(sql)),
  ];
  for (const alert of alerts) {
    await upsertAlert(sql, alert);
  }
  await resolveClearedAlerts(sql, alerts);
  return alerts;
}
