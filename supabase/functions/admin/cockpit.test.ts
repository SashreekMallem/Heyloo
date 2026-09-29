import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import {
  buildDrift,
  buildWaterfallSegments,
  CONFIG_LAB_RATES,
  diagnoseMargin,
  impliedBilledCents,
  type MarginRow,
  n,
  parsePeriod,
  periodWindow,
  simulateScenario,
  sumMargin,
} from "./cockpit.ts";
import { routeAdminRequest } from "./handler.ts";

const logger = createLogger();

function makeSql(fixtures: Record<string, unknown[]> = {}) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const adminCtx = (path: string, over: Record<string, unknown> = {}) => ({
  method: "GET",
  path,
  claims: { app_metadata: { platform_admin: true }, aal: "aal2" as const },
  body: undefined,
  adminUserId: "a1",
  ...over,
});

function row(over: Partial<MarginRow> = {}): MarginRow {
  return {
    tenant_id: "t1",
    name: "Acme",
    vertical: "auto",
    status: "active",
    is_test: false,
    revenue_cents: 29900,
    pending_revenue_cents: 0,
    voice_cost_cents: 100,
    llm_cost_cents: 50,
    telephony_cost_cents: 50,
    other_call_cost_cents: 0,
    number_cost_cents: 200,
    messaging_cost_cents: 0,
    processing_fee_cents: 897,
    commission_cents: 0,
    cost_cents: 1297,
    margin_cents: 28603,
    billable_minutes: 100,
    call_count: 30,
    ...over,
  };
}

describe("n()", () => {
  it("coerces postgres bigint/numeric strings and treats null/garbage as 0", () => {
    expect(n("123")).toBe(123);
    expect(n("4.5")).toBe(4.5);
    expect(n(null)).toBe(0);
    expect(n(undefined)).toBe(0);
    expect(n("abc")).toBe(0);
  });
});

describe("periodWindow (UTC)", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  it("mtd = the current calendar month [start, next month)", () => {
    const w = periodWindow("mtd", now);
    expect(w.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
  it("last_month = previous calendar month, including across a year boundary", () => {
    const w = periodWindow("last_month", new Date("2026-01-15T00:00:00Z"));
    expect(w.start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
  it("quarter = the calendar quarter containing now", () => {
    const w = periodWindow("quarter", now);
    expect(w.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
  it("parsePeriod falls back to mtd", () => {
    expect(parsePeriod("bogus")).toBe("mtd");
    expect(parsePeriod(undefined)).toBe("mtd");
    expect(parsePeriod("quarter")).toBe("quarter");
  });
});

describe("waterfall math", () => {
  it("sums tenant rows + fixed costs; segments add up exactly to total cost and net margin", () => {
    const rows = [
      row(),
      row({
        tenant_id: "t2",
        revenue_cents: 0,
        voice_cost_cents: 10,
        llm_cost_cents: 5,
        telephony_cost_cents: 5,
        number_cost_cents: 200,
        processing_fee_cents: 0,
        cost_cents: 220,
        margin_cents: -220,
      }),
    ];
    const totals = sumMargin(rows, 300);
    expect(totals.revenue_cents).toBe(29900);
    expect(totals.cost_cents).toBe(1297 + 220 + 300);
    expect(totals.margin_cents).toBe(29900 - (1297 + 220 + 300));
    const segments = buildWaterfallSegments(totals);
    expect(segments[0]).toMatchObject({ label: "Revenue", kind: "add" });
    expect(segments.at(-1)).toMatchObject({ label: "Net margin", kind: "total" });
    const subtracted = segments
      .filter((s) => s.kind === "subtract")
      .reduce((a, s) => a + s.amount, 0);
    expect(subtracted).toBe(totals.cost_cents);
    expect(segments.at(-1)?.amount).toBe(totals.revenue_cents - subtracted);
  });

  it("is empty when there is neither revenue nor cost", () => {
    expect(buildWaterfallSegments(sumMargin([], 0))).toEqual([]);
  });
});

describe("diagnoseMargin", () => {
  it("healthy above the watch threshold", () => {
    const d = diagnoseMargin(row(), 300);
    expect(d.health).toBe("healthy");
    expect(d.margin_pct).toBeCloseTo(95.66, 1);
    expect(d.diagnosis_reason).toBeNull();
  });
  it("negative margin with usage far above the allowance is diagnosed as a usage problem", () => {
    const d = diagnoseMargin(
      row({ cost_cents: 40000, margin_cents: -10100, billable_minutes: 900 }),
      300,
    );
    expect(d.health).toBe("negative");
    expect(d.diagnosis_reason).toBe("Usage 3.0x the plan allowance");
    expect(d.suggested_action).toMatch(/Upsell/);
  });
  it("watch band (positive but below 60%) names the largest cost component", () => {
    const d = diagnoseMargin(
      row({ cost_cents: 15000, margin_cents: 14900, llm_cost_cents: 12000, billable_minutes: 100 }),
      300,
    );
    expect(d.health).toBe("watch");
    expect(d.diagnosis_reason).toMatch(/Largest cost: LLM \(80% of cost\)/);
    expect(d.suggested_action).toMatch(/cheaper LLM tier/);
  });
  it("a trialing tenant with cost but no invoice is healthy (acquisition spend), not negative", () => {
    const d = diagnoseMargin(
      row({ status: "trialing", revenue_cents: 0, cost_cents: 40, margin_cents: -40 }),
      300,
    );
    expect(d.health).toBe("healthy");
    expect(d.margin_pct).toBeNull();
    expect(d.diagnosis_reason).toMatch(/Trialing/);
  });
  it("an active tenant with cost but no paid revenue is negative", () => {
    const d = diagnoseMargin(row({ revenue_cents: 0, cost_cents: 40, margin_cents: -40 }), 300);
    expect(d.health).toBe("negative");
    expect(d.diagnosis_reason).toMatch(/no paid invoice/);
  });
  it("uncollected invoices are called out instead of a margin verdict", () => {
    const d = diagnoseMargin(
      row({ revenue_cents: 0, pending_revenue_cents: 29900, cost_cents: 40, margin_cents: -40 }),
      300,
    );
    expect(d.diagnosis_reason).toBe("Invoice not collected yet");
  });
});

describe("impliedBilledCents", () => {
  it("bills minutes at the plan's effective in-allowance rate", () => {
    expect(impliedBilledCents(180, 29900, 300)).toBe(299);
    expect(impliedBilledCents(0, 29900, 300)).toBe(0);
    expect(impliedBilledCents(60, 0, 300)).toBeNull();
    expect(impliedBilledCents(60, 29900, 0)).toBeNull();
  });
});

describe("buildDrift", () => {
  const baseline = { voice: 7.0, llm: 1.28, telephony: 1.5 };
  it("does not mark rates within the 8% threshold", () => {
    const { points, markers } = buildDrift(
      [
        { day: "2026-09-21", cat: "voice", rate_cents_per_min: 7.3, calls: 1 },
        { day: "2026-09-21", cat: "llm", rate_cents_per_min: 1.28, calls: 1 },
        { day: "2026-09-21", cat: "telephony", rate_cents_per_min: 1.5, calls: 1 },
      ],
      baseline,
    );
    expect(points).toHaveLength(1);
    expect(markers).toEqual([]);
  });
  it("marks a category beyond the threshold, in $/min", () => {
    const { markers } = buildDrift(
      [
        { day: "2026-09-21", cat: "voice", rate_cents_per_min: 7.0, calls: 1 },
        { day: "2026-09-21", cat: "llm", rate_cents_per_min: 1.28, calls: 1 },
        { day: "2026-09-21", cat: "telephony", rate_cents_per_min: 3.0, calls: 1 },
      ],
      baseline,
    );
    expect(markers).toEqual([{ label: "09-21", provider: "telephony", value: 0.03 }]);
  });
});

describe("simulateScenario", () => {
  const input = {
    llm_tier: "standard",
    voice_tier: "standard",
    assumed_volume: 100,
    base_cents: 29900,
    included_minutes: 300,
    overage_cents: 35,
    minutes_per_call: 3,
  };
  it("costs scale with minutes at Retell's published per-minute prices and net margin adds up", () => {
    const seg = simulateScenario(input);
    const revenue = seg.find((s) => s.kind === "add")?.amount ?? 0;
    const cost = seg.filter((s) => s.kind === "subtract").reduce((a, s) => a + s.amount, 0);
    expect(revenue).toBe(29900); // 300 min == allowance, no overage
    expect(seg.find((s) => s.label === "Voice infra")?.amount).toBe(
      Math.round(300 * CONFIG_LAB_RATES.voice_infra_cents_per_min),
    );
    expect(seg.at(-1)?.amount).toBe(revenue - cost);
  });
  it("a premium LLM tier lowers margin versus standard for the same volume", () => {
    const std = simulateScenario(input).at(-1)?.amount ?? 0;
    const premium = simulateScenario({ ...input, llm_tier: "premium" }).at(-1)?.amount ?? 0;
    expect(premium).toBeLessThan(std);
  });
  it("charges overage above the allowance", () => {
    const seg = simulateScenario({ ...input, assumed_volume: 200 }); // 600 min
    expect(seg.find((s) => s.kind === "add")?.amount).toBe(29900 + 300 * 35);
  });
});

describe("admin routes — COCKPIT-1 shapes", () => {
  it("referral P&L returns page-shaped rows with numeric coercion", async () => {
    const { sql } = makeSql({
      "from public.v_referral_pnl": [
        {
          referral_partner_id: "p1",
          name: "Alice",
          qualified_count: "3",
          signup_count: "5",
          paid_count: "2",
          paid_cents: "40000",
          accrued_cents: "20000",
          attributed_revenue_cents: "119600",
        },
      ],
    });
    const result = await routeAdminRequest(sql, adminCtx("/admin-referrals"), logger);
    const body = result.body as { rows: Record<string, unknown>[]; referral_partners: unknown[] };
    expect(body.rows[0]).toEqual({
      partner_id: "p1",
      partner_name: "Alice",
      clicks: null,
      signups: 5,
      qualified: 3,
      paid: 2,
      payouts_cents: 40000,
      accrued_cents: 20000,
      revenue_cents: 119600,
    });
    expect(body.referral_partners).toHaveLength(1);
  });

  it("CAC returns per-channel totals (test tenants excluded upstream) and a cohort CAC trend keyed by channel", async () => {
    const { sql } = makeSql({
      "count(distinct ce.lead_id)": [
        {
          channel: "cold_email",
          total_cost_cents: "30000",
          lead_count: "40",
          converted_tenant_count: "3",
        },
      ],
      "'YYYY-MM'": [
        { channel: "cold_email", label: "2026-08", cost_cents: "20000", converted: "2" },
        { channel: "cold_email", label: "2026-09", cost_cents: "10000", converted: "0" },
      ],
    });
    const result = await routeAdminRequest(sql, adminCtx("/admin-cac"), logger);
    const body = result.body as {
      byChannel: Record<string, { label: string; value: number }[]>;
      channels: { cac_cents: number | null; lead_count: number }[];
    };
    // 2026-09 has spend but no conversions -> no defined CAC -> omitted from the trend
    expect(body.byChannel["cold_email"]).toEqual([{ label: "2026-08", value: 10000 }]);
    expect(body.channels[0]).toMatchObject({ cac_cents: 10000, lead_count: 40 });
  });

  it("Config Lab scenario mode returns before/after waterfalls and never writes", async () => {
    const { sql, calls } = makeSql({
      "from public.platform_settings where key": [
        { value: { base_cents: 29900, included_minutes: 300, overage_cents: 35 } },
      ],
      "avg(cl.duration_seconds)": [{ avg_seconds: "180" }],
    });
    const result = await routeAdminRequest(
      sql,
      adminCtx("/admin-config-lab/simulate", {
        method: "POST",
        body: {
          name: "x",
          vertical: "auto",
          llm_tier: "premium",
          voice_tier: "standard",
          assumed_volume: 100,
        },
      }),
      logger,
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      before: { label: string; amount: number }[];
      after: { label: string; amount: number }[];
      minutes_per_call: number;
    };
    expect(body.minutes_per_call).toBe(3);
    const llm = (segs: { label: string; amount: number }[]) =>
      segs.find((s) => s.label === "LLM")?.amount ?? 0;
    expect(llm(body.after)).toBeGreaterThan(llm(body.before));
    expect(calls.some((c) => /\b(insert|update|delete)\b/i.test(c.text))).toBe(false);
  });
});
