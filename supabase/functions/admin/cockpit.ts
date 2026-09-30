import type { SqlClient } from "../_shared/types.ts";

/**
 * Margin cockpit read routes (BACKEND_SPEC §7.7, FRONTEND_SPEC §7.1) — COCKPIT-1.
 *
 * Every response is shaped for the cockpit page that consumes it (the pages
 * were built against FRONTEND_SPEC's shapes while this file returned raw
 * view rows, so five of the nine margin pages rendered empty against live
 * data). Margin math lives in ONE place — the `fn_margin_by_tenant` SQL
 * function (migration 20260929180000) — and this file only shapes/derives:
 *   revenue  = paid Stripe invoices for the billing period (billing_invoices)
 *   cost     = Retell per-call cost_events + number rental + per-message
 *              SMS/email + Stripe processing fees + accrued commissions
 *   test tenants and test calls are EXCLUDED unless `?include_test=1`.
 * Postgres `bigint`/`numeric` arrive as strings from postgres.js, so every
 * numeric column is passed through `n()` before it reaches JSON.
 */

export interface CockpitResponse {
  status: number;
  body: unknown;
}

export interface CockpitContext {
  method: string;
  path: string;
  query?: Record<string, string> | undefined;
}

export function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** Postgres bigint/numeric -> JS number (all money here is integer cents well below 2^53). */
export function n(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

// ---------------------------------------------------------------------------
// Period windows (UTC)
// ---------------------------------------------------------------------------
export type MarginPeriod = "mtd" | "last_month" | "quarter";
export const MARGIN_PERIODS: readonly MarginPeriod[] = ["mtd", "last_month", "quarter"];

export interface PeriodWindow {
  period: MarginPeriod;
  start: Date;
  end: Date;
}

export function parsePeriod(raw: string | undefined): MarginPeriod {
  return (MARGIN_PERIODS as readonly string[]).includes(raw ?? "") ? (raw as MarginPeriod) : "mtd";
}

/** [start, end) — calendar month containing `now` (mtd), the previous calendar month, or the calendar quarter. */
export function periodWindow(period: MarginPeriod, now: Date = new Date()): PeriodWindow {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "last_month") {
    return { period, start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
  }
  if (period === "quarter") {
    const qStart = m - (m % 3);
    return {
      period,
      start: new Date(Date.UTC(y, qStart, 1)),
      end: new Date(Date.UTC(y, qStart + 3, 1)),
    };
  }
  return { period, start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function includeTestFlag(query: Record<string, string> | undefined): boolean {
  const v = query?.["include_test"];
  return v === "1" || v === "true";
}

// ---------------------------------------------------------------------------
// Margin rows
// ---------------------------------------------------------------------------
interface RawMarginRow {
  tenant_id: string;
  name: string;
  vertical: string;
  status: string;
  is_test: boolean;
  revenue_cents: unknown;
  pending_revenue_cents: unknown;
  voice_cost_cents: unknown;
  llm_cost_cents: unknown;
  telephony_cost_cents: unknown;
  other_call_cost_cents: unknown;
  number_cost_cents: unknown;
  messaging_cost_cents: unknown;
  processing_fee_cents: unknown;
  commission_cents: unknown;
  cost_cents: unknown;
  margin_cents: unknown;
  billable_minutes: unknown;
  call_count: unknown;
}

export interface MarginRow {
  tenant_id: string;
  name: string;
  vertical: string;
  status: string;
  is_test: boolean;
  revenue_cents: number;
  pending_revenue_cents: number;
  voice_cost_cents: number;
  llm_cost_cents: number;
  telephony_cost_cents: number;
  other_call_cost_cents: number;
  number_cost_cents: number;
  messaging_cost_cents: number;
  processing_fee_cents: number;
  commission_cents: number;
  cost_cents: number;
  margin_cents: number;
  billable_minutes: number;
  call_count: number;
}

export function toMarginRow(r: RawMarginRow): MarginRow {
  return {
    tenant_id: r.tenant_id,
    name: r.name,
    vertical: r.vertical,
    status: r.status,
    is_test: r.is_test === true,
    revenue_cents: n(r.revenue_cents),
    pending_revenue_cents: n(r.pending_revenue_cents),
    voice_cost_cents: n(r.voice_cost_cents),
    llm_cost_cents: n(r.llm_cost_cents),
    telephony_cost_cents: n(r.telephony_cost_cents),
    other_call_cost_cents: n(r.other_call_cost_cents),
    number_cost_cents: n(r.number_cost_cents),
    messaging_cost_cents: n(r.messaging_cost_cents),
    processing_fee_cents: n(r.processing_fee_cents),
    commission_cents: n(r.commission_cents),
    cost_cents: n(r.cost_cents),
    margin_cents: n(r.margin_cents),
    billable_minutes: n(r.billable_minutes),
    call_count: n(r.call_count),
  };
}

export async function loadMarginRows(
  sql: SqlClient,
  win: PeriodWindow,
  includeTest: boolean,
): Promise<MarginRow[]> {
  const rows = await sql<RawMarginRow>`
    select * from public.fn_margin_by_tenant(${win.start.toISOString()}::timestamptz, ${win.end.toISOString()}::timestamptz, ${includeTest})
  `;
  return rows.map(toMarginRow);
}

async function loadFixedCostCents(sql: SqlClient, win: PeriodWindow): Promise<number> {
  const rows = await sql<{ amount_cents: unknown }>`
    select coalesce(sum(amount_cents), 0) as amount_cents
    from public.fixed_cost_allocations
    where period >= ${isoDate(win.start)}::date and period < ${isoDate(win.end)}::date
  `;
  return n(rows[0]?.amount_cents);
}

export interface WaterfallSegment {
  label: string;
  amount: number;
  kind: "add" | "subtract" | "total";
}

export interface MarginTotals {
  revenue_cents: number;
  pending_revenue_cents: number;
  voice_cost_cents: number;
  llm_cost_cents: number;
  telephony_cost_cents: number;
  other_call_cost_cents: number;
  number_cost_cents: number;
  messaging_cost_cents: number;
  processing_fee_cents: number;
  commission_cents: number;
  fixed_cost_cents: number;
  /** All cost components including fixed costs. */
  cost_cents: number;
  margin_cents: number;
}

export function sumMargin(rows: MarginRow[], fixedCostCents: number): MarginTotals {
  const t: MarginTotals = {
    revenue_cents: 0,
    pending_revenue_cents: 0,
    voice_cost_cents: 0,
    llm_cost_cents: 0,
    telephony_cost_cents: 0,
    other_call_cost_cents: 0,
    number_cost_cents: 0,
    messaging_cost_cents: 0,
    processing_fee_cents: 0,
    commission_cents: 0,
    fixed_cost_cents: fixedCostCents,
    cost_cents: 0,
    margin_cents: 0,
  };
  for (const r of rows) {
    t.revenue_cents += r.revenue_cents;
    t.pending_revenue_cents += r.pending_revenue_cents;
    t.voice_cost_cents += r.voice_cost_cents;
    t.llm_cost_cents += r.llm_cost_cents;
    t.telephony_cost_cents += r.telephony_cost_cents;
    t.other_call_cost_cents += r.other_call_cost_cents;
    t.number_cost_cents += r.number_cost_cents;
    t.messaging_cost_cents += r.messaging_cost_cents;
    t.processing_fee_cents += r.processing_fee_cents;
    t.commission_cents += r.commission_cents;
  }
  t.cost_cents =
    t.voice_cost_cents +
    t.llm_cost_cents +
    t.telephony_cost_cents +
    t.other_call_cost_cents +
    t.number_cost_cents +
    t.messaging_cost_cents +
    t.processing_fee_cents +
    t.commission_cents +
    t.fixed_cost_cents;
  t.margin_cents = t.revenue_cents - t.cost_cents;
  return t;
}

/** Revenue down to net margin. Every cost segment is a real cost component; nothing is counted twice. Empty when the period has neither revenue nor cost. */
export function buildWaterfallSegments(t: MarginTotals): WaterfallSegment[] {
  if (t.revenue_cents === 0 && t.cost_cents === 0) return [];
  const out: WaterfallSegment[] = [{ label: "Revenue", amount: t.revenue_cents, kind: "add" }];
  const costs: [string, number][] = [
    ["Voice (engine + TTS)", t.voice_cost_cents],
    ["LLM", t.llm_cost_cents],
    ["Telephony", t.telephony_cost_cents],
    ["Other call costs", t.other_call_cost_cents],
    ["Phone numbers", t.number_cost_cents],
    ["SMS / email", t.messaging_cost_cents],
    ["Payment processing", t.processing_fee_cents],
    ["Referral commissions", t.commission_cents],
    ["Fixed costs", t.fixed_cost_cents],
  ];
  for (const [label, amount] of costs) {
    if (amount > 0) out.push({ label, amount, kind: "subtract" });
  }
  out.push({ label: "Net margin", amount: t.margin_cents, kind: "total" });
  return out;
}

// ---------------------------------------------------------------------------
// Per-customer margin + backend diagnosis
// ---------------------------------------------------------------------------
export type MarginHealth = "healthy" | "watch" | "negative";
/** Below this margin % a tenant is "watch". MASTER_PLAN.md targets ~80% gross margin at scale; 60% leaves headroom before flagging. */
export const MARGIN_WATCH_PCT = 60;

const HEALTH_RANK: Record<MarginHealth, number> = { negative: 0, watch: 1, healthy: 2 };

const COST_COMPONENTS: [keyof MarginRow, string][] = [
  ["voice_cost_cents", "voice"],
  ["llm_cost_cents", "LLM"],
  ["telephony_cost_cents", "telephony"],
  ["other_call_cost_cents", "other call costs"],
  ["number_cost_cents", "phone-number rental"],
  ["messaging_cost_cents", "SMS/email"],
  ["processing_fee_cents", "payment processing"],
  ["commission_cents", "referral commission"],
];

export interface Diagnosis {
  health: MarginHealth;
  margin_pct: number | null;
  diagnosis_reason: string | null;
  suggested_action: string | null;
}

/**
 * Backend-computed health + diagnosis (FRONTEND_SPEC §7.1.2: "read directly,
 * never recomputed client-side"). `includedMinutes` is the tenant's plan
 * allowance (price_card_<vertical>.included_minutes), when known.
 */
export function diagnoseMargin(row: MarginRow, includedMinutes: number | null): Diagnosis {
  const marginPct = row.revenue_cents > 0 ? (row.margin_cents / row.revenue_cents) * 100 : null;
  const usageRatio =
    includedMinutes && includedMinutes > 0 ? row.billable_minutes / includedMinutes : null;

  let health: MarginHealth;
  if (row.revenue_cents === 0) {
    health = row.cost_cents > 0 && row.status !== "trialing" ? "negative" : "healthy";
  } else if (row.margin_cents < 0) {
    health = "negative";
  } else if ((marginPct ?? 100) < MARGIN_WATCH_PCT) {
    health = "watch";
  } else {
    health = "healthy";
  }

  let reason: string | null = null;
  let action: string | null = null;
  if (row.revenue_cents === 0 && row.cost_cents > 0) {
    if (row.status === "trialing") {
      reason = "Trialing: no paid invoice yet";
      action = "Confirm the trial converts; cost so far is acquisition spend.";
    } else if (row.pending_revenue_cents > 0) {
      reason = "Invoice not collected yet";
      action = "Check the invoice/dunning state in Stripe before judging margin.";
    } else {
      reason = "Cost incurred with no paid invoice in this period";
      action = "Check the subscription/billing state for this tenant.";
    }
  } else if (health !== "healthy") {
    if (usageRatio !== null && usageRatio >= 1.5) {
      reason = `Usage ${usageRatio.toFixed(1)}x the plan allowance`;
      action = "Upsell the next tier or review the overage rate.";
    } else if (row.revenue_cents > 0 && row.commission_cents / row.revenue_cents >= 0.5) {
      reason = "Referral commission is at least half of revenue";
      action = "Review the partner's commission terms.";
    } else {
      let top: [string, number] = ["", 0];
      for (const [key, label] of COST_COMPONENTS) {
        const v = row[key] as number;
        if (v > top[1]) top = [label, v];
      }
      if (top[1] > 0 && row.cost_cents > 0) {
        reason = `Largest cost: ${top[0]} (${Math.round((top[1] / row.cost_cents) * 100)}% of cost)`;
        action =
          top[0] === "LLM"
            ? "Consider a cheaper LLM tier for this vertical."
            : top[0] === "voice"
              ? "Consider a cheaper voice tier."
              : "Review this cost line for the tenant.";
      }
    }
  }
  return { health, margin_pct: marginPct, diagnosis_reason: reason, suggested_action: action };
}

interface PriceCardRow {
  key: string;
  value: { included_minutes?: number; base_cents?: number };
}

async function loadIncludedMinutes(sql: SqlClient): Promise<Map<string, number>> {
  const rows = await sql<PriceCardRow>`
    select key, value from public.platform_settings where key like 'price_card_%'
  `;
  const map = new Map<string, number>();
  for (const r of rows) {
    const inc = n(r.value?.included_minutes);
    if (inc > 0) map.set(r.key.replace("price_card_", ""), inc);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Calls (cost vs billed)
// ---------------------------------------------------------------------------
interface RawCallRow {
  call_id: string;
  tenant_id: string;
  tenant_name: string;
  started_at: string;
  duration_seconds: number | null;
  cost_cents: unknown;
  cost_source: string | null;
  is_test: boolean;
  base_cents: unknown;
  included_minutes: unknown;
}

export interface CallCostRow {
  call_id: string;
  tenant_id: string;
  tenant_name: string;
  started_at: string;
  duration_seconds: number;
  /** null = unknown (the provider never reported a cost for this call). */
  cost_cents: number | null;
  cost_source: string | null;
  billed_cents: number | null;
  delta_cents: number | null;
  is_test: boolean;
}

/** Effective per-minute price inside the plan allowance x minutes. Overage minutes are billed at tenant level, not per call. */
export function impliedBilledCents(
  durationSeconds: number,
  baseCents: number,
  includedMinutes: number,
): number | null {
  if (!(baseCents > 0) || !(includedMinutes > 0)) return null;
  return Math.round(((durationSeconds / 60) * baseCents) / includedMinutes);
}

export function toCallCostRow(r: RawCallRow): CallCostRow {
  const duration = n(r.duration_seconds);
  const cost = r.cost_cents === null || r.cost_cents === undefined ? null : n(r.cost_cents);
  const billed = impliedBilledCents(duration, n(r.base_cents), n(r.included_minutes));
  return {
    call_id: r.call_id,
    tenant_id: r.tenant_id,
    tenant_name: r.tenant_name,
    started_at: r.started_at,
    duration_seconds: duration,
    cost_cents: cost,
    cost_source: r.cost_source,
    billed_cents: billed,
    delta_cents: cost !== null && billed !== null ? billed - cost : null,
    is_test: r.is_test === true,
  };
}

async function loadCalls(
  sql: SqlClient,
  opts: { includeTest: boolean; tenantId: string | null; start: Date | null; end: Date | null },
): Promise<CallCostRow[]> {
  const rows = await sql<RawCallRow>`
    select cl.id as call_id, cl.tenant_id, t.name as tenant_name, cl.started_at, cl.duration_seconds,
           cl.cost_source, (cl.is_test_call or t.is_test) as is_test,
           round(coalesce((select sum(ce.total_cost_cents) from public.cost_events ce where ce.call_id = cl.id), cl.cost_cents)) as cost_cents,
           pc.base_cents, pc.included_minutes
    from public.call_logs cl
    join public.tenants t on t.id = cl.tenant_id
    left join lateral (
      select (value->>'base_cents')::numeric as base_cents, (value->>'included_minutes')::numeric as included_minutes
      from public.platform_settings where key = 'price_card_' || t.vertical
    ) pc on true
    where cl.channel in ('phone', 'web_voice')
      and (${opts.includeTest} or (not cl.is_test_call and not t.is_test))
      and (${opts.tenantId}::uuid is null or cl.tenant_id = ${opts.tenantId}::uuid)
      and (${opts.start ? opts.start.toISOString() : null}::timestamptz is null or cl.started_at >= ${opts.start ? opts.start.toISOString() : null}::timestamptz)
      and (${opts.end ? opts.end.toISOString() : null}::timestamptz is null or cl.started_at < ${opts.end ? opts.end.toISOString() : null}::timestamptz)
    order by cl.started_at desc
    limit 200
  `;
  return rows.map(toCallCostRow);
}

// ---------------------------------------------------------------------------
// Repricing drift
// ---------------------------------------------------------------------------
export const DRIFT_THRESHOLD_PCT = 8;

/**
 * Fallback baseline when `platform_settings.provider_rate_baseline` is
 * absent: Retell's published per-minute prices (retellai.com/pricing,
 * verified 2026-09-29): voice infrastructure $0.055 + platform voice
 * $0.015, GPT-4.1 mini $0.0128, telephony $0.015.
 */
export const DEFAULT_RATE_BASELINE_CENTS_PER_MIN = { voice: 7.0, llm: 1.28, telephony: 1.5 };
type DriftCategory = keyof typeof DEFAULT_RATE_BASELINE_CENTS_PER_MIN;
const DRIFT_CATEGORIES: DriftCategory[] = ["voice", "llm", "telephony"];

interface RawDriftRow {
  day: string;
  cat: DriftCategory;
  rate_cents_per_min: unknown;
  calls: unknown;
}

export interface DriftPoint {
  label: string;
  voice: number;
  llm: number;
  telephony: number;
}
export interface DriftMarker {
  label: string;
  provider: DriftCategory;
  /** $/min */
  value: number;
}

/** Days that have all three categories become chart points ($/min); a marker is emitted for each category whose rate deviates from baseline by more than the threshold. */
export function buildDrift(
  rows: RawDriftRow[],
  baseline: Record<DriftCategory, number>,
  thresholdPct: number = DRIFT_THRESHOLD_PCT,
): { points: DriftPoint[]; markers: DriftMarker[] } {
  const byDay = new Map<string, Partial<Record<DriftCategory, number>>>();
  for (const r of rows) {
    const day = byDay.get(r.day) ?? {};
    day[r.cat] = n(r.rate_cents_per_min);
    byDay.set(r.day, day);
  }
  const points: DriftPoint[] = [];
  const markers: DriftMarker[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const rates = byDay.get(day) as Partial<Record<DriftCategory, number>>;
    if (DRIFT_CATEGORIES.some((c) => rates[c] === undefined)) continue;
    const label = day.slice(5); // MM-DD
    points.push({
      label,
      voice: (rates.voice as number) / 100,
      llm: (rates.llm as number) / 100,
      telephony: (rates.telephony as number) / 100,
    });
    for (const cat of DRIFT_CATEGORIES) {
      const base = baseline[cat];
      const rate = rates[cat] as number;
      if (base > 0 && (Math.abs(rate - base) / base) * 100 > thresholdPct) {
        markers.push({ label, provider: cat, value: rate / 100 });
      }
    }
  }
  return { points, markers };
}

async function loadBaseline(sql: SqlClient): Promise<{
  baseline: Record<DriftCategory, number>;
  configured: boolean;
}> {
  const rows = await sql<{ value: { cents_per_minute?: Partial<Record<DriftCategory, number>> } }>`
    select value from public.platform_settings where key = 'provider_rate_baseline'
  `;
  const cfg = rows[0]?.value?.cents_per_minute;
  return {
    configured: cfg !== undefined,
    baseline: {
      voice: cfg?.voice ?? DEFAULT_RATE_BASELINE_CENTS_PER_MIN.voice,
      llm: cfg?.llm ?? DEFAULT_RATE_BASELINE_CENTS_PER_MIN.llm,
      telephony: cfg?.telephony ?? DEFAULT_RATE_BASELINE_CENTS_PER_MIN.telephony,
    },
  };
}

// ---------------------------------------------------------------------------
// Bottlenecks
// ---------------------------------------------------------------------------
export interface LatencyPoint {
  label: string;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export async function handleCockpit(sql: SqlClient, ctx: CockpitContext): Promise<CockpitResponse> {
  const parts = segments(ctx.path); // ["admin-cockpit", "<page>", ":id"?]
  const page = parts[1];
  if (ctx.method !== "GET") return { status: 404, body: { error: "not_found" } };
  const includeTest = includeTestFlag(ctx.query);
  const win = periodWindow(parsePeriod(ctx.query?.["period"]));
  const windowBody = {
    period: win.period,
    window: { start: win.start.toISOString(), end: win.end.toISOString() },
    include_test: includeTest,
  };

  if (page === "waterfall") {
    const rows = await loadMarginRows(sql, win, includeTest);
    const totals = sumMargin(rows, await loadFixedCostCents(sql, win));
    return {
      status: 200,
      body: {
        ...windowBody,
        segments: buildWaterfallSegments(totals),
        totals,
        // Back-compat with the pre-COCKPIT-1 response shape.
        waterfall: {
          revenue_cents: totals.revenue_cents,
          cost_cents: totals.cost_cents,
          margin_cents: totals.margin_cents,
        },
      },
    };
  }

  if (page === "per-customer-margin" && !parts[2]) {
    const [rows, included] = await Promise.all([
      loadMarginRows(sql, win, includeTest),
      loadIncludedMinutes(sql),
    ]);
    const out = rows
      .map((r) => ({ ...r, ...diagnoseMargin(r, included.get(r.vertical) ?? null) }))
      // Worst first (FRONTEND_SPEC §7.1.2): health rank, then margin % ascending
      // (tenants with no revenue after those with a margin), then highest cost.
      .sort(
        (a, b) =>
          HEALTH_RANK[a.health] - HEALTH_RANK[b.health] ||
          (a.margin_pct ?? Number.POSITIVE_INFINITY) - (b.margin_pct ?? Number.POSITIVE_INFINITY) ||
          b.cost_cents - a.cost_cents,
      );
    return { status: 200, body: { ...windowBody, rows: out, tenants: out } };
  }

  if (page === "per-customer-margin" && parts[2]) {
    const tenantId = parts[2];
    // COCKPIT-F13: the list applies `include_test`; this drill-down always used
    // `true`, so the same tenant/period showed cost 16c on the list and 380c
    // here. It now honors the flag the list was opened with. A TEST tenant only
    // exists in the include-test view, so its own page always shows its data.
    const allRows = await loadMarginRows(sql, win, true);
    const anyRow = allRows.find((r) => r.tenant_id === tenantId);
    if (!anyRow) return { status: 404, body: { error: "tenant_not_found" } };
    const effectiveIncludeTest = includeTest || anyRow.is_test;
    const [rows, included, calls] = await Promise.all([
      effectiveIncludeTest ? Promise.resolve(allRows) : loadMarginRows(sql, win, false),
      loadIncludedMinutes(sql),
      loadCalls(sql, {
        includeTest: effectiveIncludeTest,
        tenantId,
        start: win.start,
        end: win.end,
      }),
    ]);
    const row = rows.find((r) => r.tenant_id === tenantId) ?? anyRow;
    const diagnosis = diagnoseMargin(row, included.get(row.vertical) ?? null);
    return {
      status: 200,
      body: {
        ...windowBody,
        include_test: effectiveIncludeTest,
        tenant: { id: row.tenant_id, name: row.name, vertical: row.vertical, is_test: row.is_test },
        summary: { ...row, ...diagnosis },
        calls,
        suggestedAction: diagnosis.suggested_action,
      },
    };
  }

  if (page === "per-call-cost") {
    const calls = await loadCalls(sql, {
      includeTest,
      tenantId: null,
      start: null,
      end: null,
    });
    return { status: 200, body: { include_test: includeTest, rows: calls, calls } };
  }

  if (page === "repricing-drift") {
    const [{ baseline, configured }, driftRows, productRows] = await Promise.all([
      loadBaseline(sql),
      sql<RawDriftRow>`
        with lines as (
          select date_trunc('day', ce.occurred_at) as d, ce.call_id,
                 public.fn_cost_category(ce.provider, ce.product) as cat,
                 sum(ce.unit_cost_cents) as rate
          from public.cost_events ce
          left join public.call_logs cl on cl.id = ce.call_id
          left join public.tenants t on t.id = ce.tenant_id
          where ce.provider = 'retell' and ce.unit = 'minute' and ce.unit_cost_cents is not null
            and ce.occurred_at >= now() - interval '90 days'
            and (${includeTest} or (cl.id is not null and not cl.is_test_call and not t.is_test))
          group by 1, 2, 3
        )
        select to_char(d, 'YYYY-MM-DD') as day, cat,
               avg(rate)::float8 as rate_cents_per_min, count(*)::int as calls
        from lines
        where cat in ('voice', 'llm', 'telephony')
        group by d, cat
        order by d
      `,
      sql<{
        provider: string;
        product: string;
        avg_unit_cost_cents: unknown;
        sample_count: unknown;
      }>`
        select provider, product, avg(unit_cost_cents)::numeric(12,4) as avg_unit_cost_cents, count(*)::int as sample_count
        from public.cost_events
        where occurred_at >= now() - interval '30 days' and unit = 'minute' and unit_cost_cents is not null
        group by provider, product
        order by provider, product
      `,
    ]);
    const { points, markers } = buildDrift(driftRows, baseline);
    return {
      status: 200,
      body: {
        include_test: includeTest,
        threshold_pct: DRIFT_THRESHOLD_PCT,
        baseline_cents_per_minute: baseline,
        baseline_configured: configured,
        points,
        markers,
        drift: productRows.map((r) => ({
          provider: r.provider,
          product: r.product,
          avg_unit_cost_cents: n(r.avg_unit_cost_cents),
          sample_count: n(r.sample_count),
        })),
      },
    };
  }

  if (page === "bottleneck") {
    const [hourly, recent] = await Promise.all([
      sql<{
        tool_name: string;
        label: string;
        calls: unknown;
        errors: unknown;
        p50: unknown;
        p95: unknown;
        p99: unknown;
      }>`
        select tool_name, to_char(date_trunc('hour', occurred_at), 'HH24:00') as label,
               count(*)::int as calls, (count(*) filter (where not success))::int as errors,
               percentile_cont(0.5) within group (order by latency_ms)::float8 as p50,
               percentile_cont(0.95) within group (order by latency_ms)::float8 as p95,
               percentile_cont(0.99) within group (order by latency_ms)::float8 as p99
        from public.tool_health
        where occurred_at >= now() - interval '24 hours'
        group by tool_name, date_trunc('hour', occurred_at)
        order by date_trunc('hour', occurred_at)
      `,
      sql<{
        tool_name: string;
        calls: unknown;
        error_rate: unknown;
        p95_ms: unknown;
        top_error_type: string | null;
      }>`
        select th.tool_name, count(*)::int as calls,
               (count(*) filter (where not th.success))::numeric / nullif(count(*), 0) as error_rate,
               percentile_cont(0.95) within group (order by th.latency_ms) as p95_ms,
               -- COCKPIT-F11: the failure reason to show next to the error rate.
               (select f.error_type from public.tool_health f
                where f.tool_name = th.tool_name and not f.success and f.error_type is not null
                  and f.occurred_at >= now() - interval '1 hour'
                group by f.error_type order by count(*) desc, f.error_type limit 1) as top_error_type
        from public.tool_health th
        where th.occurred_at >= now() - interval '1 hour'
        group by th.tool_name
        order by p95_ms desc nulls last
      `,
    ]);
    const byTool: Record<string, LatencyPoint[]> = {};
    for (const r of hourly) {
      const calls = n(r.calls);
      const series = byTool[r.tool_name] ?? [];
      series.push({
        label: r.label,
        p50: n(r.p50),
        p95: n(r.p95),
        p99: n(r.p99),
        errorRate: calls > 0 ? n(r.errors) / calls : 0,
      });
      byTool[r.tool_name] = series;
    }
    return {
      status: 200,
      body: {
        byTool,
        tools: recent.map((r) => ({
          tool_name: r.tool_name,
          calls: n(r.calls),
          error_rate: n(r.error_rate),
          p95_ms: n(r.p95_ms),
          top_error_type: r.top_error_type ?? null,
        })),
      },
    };
  }

  if (page === "alerts") {
    const rows = await sql<Record<string, unknown>>`
      select * from public.alerts where status = 'open' order by created_at desc limit 100
    `;
    return { status: 200, body: { alerts: rows } };
  }

  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------------
// Config Lab
// ---------------------------------------------------------------------------
/** Retell public per-minute prices (retellai.com/pricing, verified 2026-09-29), US cents per minute. */
export const CONFIG_LAB_RATES = {
  voice_infra_cents_per_min: 5.5,
  telephony_cents_per_min: 1.5,
  /** GPT-5 mini $0.008, GPT-4.1 mini $0.0128, GPT-4.1 $0.045 per minute. */
  llm_cents_per_min: { economy: 0.8, standard: 1.28, premium: 4.5 } as Record<string, number>,
  /** Retell platform voices / Cartesia $0.015, ElevenLabs $0.040 per minute. */
  tts_cents_per_min: { economy: 1.5, standard: 1.5, premium: 4.0 } as Record<string, number>,
  number_monthly_cents: 200,
  /** Stripe standard card pricing: 2.9% + 30c (stripe.com/pricing, verified 2026-09-29). */
  card_fee_bps: 290,
  card_fee_fixed_cents: 30,
  default_minutes_per_call: 3.5,
};

export interface ScenarioInput {
  llm_tier: string;
  voice_tier: string;
  assumed_volume: number;
  base_cents: number;
  included_minutes: number;
  overage_cents: number;
  minutes_per_call: number;
}

export function simulateScenario(input: ScenarioInput): WaterfallSegment[] {
  const R = CONFIG_LAB_RATES;
  const minutes = input.assumed_volume * input.minutes_per_call;
  const overage = Math.max(0, minutes - input.included_minutes);
  const revenue = Math.round(input.base_cents + overage * input.overage_cents);
  const voice = Math.round(minutes * R.voice_infra_cents_per_min);
  const tts = Math.round(
    minutes * (R.tts_cents_per_min[input.voice_tier] ?? R.tts_cents_per_min["standard"] ?? 0),
  );
  const llm = Math.round(
    minutes * (R.llm_cents_per_min[input.llm_tier] ?? R.llm_cents_per_min["standard"] ?? 0),
  );
  const telephony = Math.round(minutes * R.telephony_cents_per_min);
  const numbers = R.number_monthly_cents;
  const fee = Math.round((revenue * R.card_fee_bps) / 10000 + R.card_fee_fixed_cents);
  const costs = voice + tts + llm + telephony + numbers + fee;
  return [
    { label: "Revenue", amount: revenue, kind: "add" },
    { label: "Voice infra", amount: voice, kind: "subtract" },
    { label: "TTS voice", amount: tts, kind: "subtract" },
    { label: "LLM", amount: llm, kind: "subtract" },
    { label: "Telephony", amount: telephony, kind: "subtract" },
    { label: "Phone number", amount: numbers, kind: "subtract" },
    { label: "Card processing", amount: fee, kind: "subtract" },
    { label: "Net margin", amount: revenue - costs, kind: "total" },
  ];
}

interface PriceCardValue {
  base_cents: number;
  included_minutes: number;
  overage_cents: number;
}

export async function handleConfigLab(
  sql: SqlClient,
  ctx: { method: string; path: string; body: unknown },
): Promise<CockpitResponse> {
  const parts = segments(ctx.path); // ["admin-config-lab", "simulate"]
  if (parts[1] !== "simulate" || (ctx.method !== "GET" && ctx.method !== "POST")) {
    return { status: 404, body: { error: "not_found" } };
  }

  const body = (ctx.body ?? {}) as Partial<PriceCardValue> & {
    vertical?: string;
    llm_tier?: string;
    voice_tier?: string;
    assumed_volume?: number;
  };
  if (!body.vertical) return { status: 422, body: { error: "missing_vertical" } };

  const currentRows = await sql<{ value: PriceCardValue }>`
    select value from public.platform_settings where key = ${`price_card_${body.vertical}`}
  `;
  const current = currentRows[0]?.value;
  if (!current) return { status: 404, body: { error: "unknown_vertical" } };

  // Scenario mode (the Config Lab page): tiers + assumed monthly call volume
  // per tenant -> before/after waterfalls at Retell's published per-minute
  // prices. Nothing is written.
  if (
    body.llm_tier !== undefined ||
    body.voice_tier !== undefined ||
    body.assumed_volume !== undefined
  ) {
    const avgRows = await sql<{ avg_seconds: unknown }>`
      select avg(cl.duration_seconds) as avg_seconds
      from public.call_logs cl join public.tenants t on t.id = cl.tenant_id
      where t.vertical = ${body.vertical} and cl.duration_seconds > 0
        and cl.channel in ('phone', 'web_voice')
    `;
    const avgSeconds = n(avgRows[0]?.avg_seconds);
    const minutesPerCall =
      avgSeconds > 0 ? avgSeconds / 60 : CONFIG_LAB_RATES.default_minutes_per_call;
    const common = {
      assumed_volume: Math.max(0, Math.round(n(body.assumed_volume))),
      base_cents: n(current.base_cents),
      included_minutes: n(current.included_minutes),
      overage_cents: n(current.overage_cents),
      minutes_per_call: minutesPerCall,
    };
    return {
      status: 200,
      body: {
        vertical: body.vertical,
        minutes_per_call: minutesPerCall,
        before: simulateScenario({ ...common, llm_tier: "standard", voice_tier: "standard" }),
        after: simulateScenario({
          ...common,
          llm_tier: body.llm_tier ?? "standard",
          voice_tier: body.voice_tier ?? "standard",
        }),
        assumptions: {
          rates: CONFIG_LAB_RATES,
          basis: "before = standard LLM/voice tiers at Retell's published per-minute prices",
        },
      },
    };
  }

  // Price-card mode: proposed base/included/overage against this month's usage.
  const proposed: PriceCardValue = {
    base_cents: body.base_cents ?? current.base_cents,
    included_minutes: body.included_minutes ?? current.included_minutes,
    overage_cents: body.overage_cents ?? current.overage_cents,
  };

  const usageRows = await sql<{ tenant_id: string; billable_minutes: unknown }>`
    select t.id as tenant_id, coalesce(sum(ud.billable_minutes), 0) as billable_minutes
    from public.tenants t
    left join public.usage_daily ud on ud.tenant_id = t.id and ud.date >= date_trunc('month', now())::date
    where t.vertical = ${body.vertical} and t.deleted_at is null and t.status = 'active' and not t.is_test
    group by t.id
  `;

  // Real cost only: test tenants and test calls never enter a margin projection.
  const costRows = await sql<{ cost_cents: unknown }>`
    select coalesce(sum(ce.total_cost_cents), 0) as cost_cents
    from public.cost_events ce
    join public.tenants t on t.id = ce.tenant_id
    left join public.call_logs cl on cl.id = ce.call_id
    where t.vertical = ${body.vertical} and not t.is_test
      and ce.occurred_at >= date_trunc('month', now())
      and (cl.id is null or not cl.is_test_call)
  `;
  const costCents = Math.round(n(costRows[0]?.cost_cents));

  const project = (card: PriceCardValue) => {
    let revenue = 0;
    for (const row of usageRows) {
      const overage = Math.max(0, n(row.billable_minutes) - card.included_minutes);
      revenue += card.base_cents + Math.round(overage * card.overage_cents);
    }
    return { revenue_cents: revenue, cost_cents: costCents, margin_cents: revenue - costCents };
  };

  return {
    status: 200,
    body: {
      vertical: body.vertical,
      tenant_count: usageRows.length,
      current: project(current),
      simulated: project(proposed),
    },
  };
}
