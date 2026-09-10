import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { accrualPeriod, runCommissionAccrual } from "./handler.ts";

const logger = createLogger();

function makeSql(fixtures: Record<string, unknown[]> = {}): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
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

describe("accrualPeriod", () => {
  it("resolves to the calendar month BEFORE `now`, in UTC", () => {
    const { period, periodStart, periodEnd } = accrualPeriod(new Date("2026-10-05T12:00:00Z"));
    expect(period).toBe("2026-09-01");
    expect(periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rolls the year back correctly when `now` is in January", () => {
    const { period } = accrualPeriod(new Date("2027-01-01T00:00:00Z"));
    expect(period).toBe("2026-12-01");
  });
});

const NOW = new Date("2026-10-01T08:00:00Z"); // accrues period 2026-09-01

describe("runCommissionAccrual", () => {
  it("does nothing when there are no rate-eligible referrals", async () => {
    const { sql } = makeSql({ "from public.referrals r": [] });
    const result = await runCommissionAccrual(sql, NOW, { logger });
    expect(result).toEqual({
      period: "2026-09-01",
      candidatesConsidered: 0,
      accrued: 0,
      skippedExpired: 0,
    });
  });

  it("accrues gross_profit commission from paid invoices minus costs and Stripe fees", async () => {
    const { sql, calls } = makeSql({
      "from public.referrals r": [
        {
          referral_id: "ref1",
          referral_partner_id: "partner1",
          tenant_id: "tenant1",
          qualified_at: "2026-01-01T00:00:00Z",
          partner_rate_bps: 1000, // 10%
          partner_commission_base: "gross_profit",
          partner_duration_months: null,
          override_rate_bps: null,
          override_commission_base: null,
          override_duration_months: null,
        },
      ],
      "from public.billing_invoices": [{ revenue_cents: 100000 }],
      "from public.cost_events": [{ cost_cents: 20000 }],
      "from public.payment_processing_events": [{ fee_cents: 5000 }],
    });

    const result = await runCommissionAccrual(sql, NOW, { logger });
    expect(result).toEqual({
      period: "2026-09-01",
      candidatesConsidered: 1,
      accrued: 1,
      skippedExpired: 0,
    });

    const insertCall = calls.find((c) => c.text.includes("insert into public.commission_events"));
    expect(insertCall).toBeDefined();
    // base_cents = 100000 - 20000 - 5000 = 75000; amount = 75000 * 1000 / 10000 = 7500
    const values = insertCall?.values as unknown[];
    expect(values).toEqual([
      "partner1",
      "ref1",
      "tenant1",
      7500,
      "2026-09-01",
      100000,
      25000,
      75000,
      1000,
    ]);
  });

  it("uses revenue (not gross_profit) as the base when commission_base is 'revenue'", async () => {
    const { sql, calls } = makeSql({
      "from public.referrals r": [
        {
          referral_id: "ref1",
          referral_partner_id: "partner1",
          tenant_id: "tenant1",
          qualified_at: "2026-01-01T00:00:00Z",
          partner_rate_bps: 500, // 5%
          partner_commission_base: "revenue",
          partner_duration_months: null,
          override_rate_bps: null,
          override_commission_base: null,
          override_duration_months: null,
        },
      ],
      "from public.billing_invoices": [{ revenue_cents: 50000 }],
      "from public.cost_events": [{ cost_cents: 999999 }], // ignored — base is revenue, not profit
      "from public.payment_processing_events": [{ fee_cents: 0 }],
    });

    await runCommissionAccrual(sql, NOW, { logger });
    const insertCall = calls.find((c) => c.text.includes("insert into public.commission_events"));
    const values = insertCall?.values as unknown[];
    // amount = 50000 * 500 / 10000 = 2500
    expect(values?.[3]).toBe(2500);
    expect(values?.[7]).toBe(50000); // base_cents = revenue_cents alone
  });

  it("applies a per-vertical override's rate/base/duration over the partner-level values", async () => {
    const { sql, calls } = makeSql({
      "from public.referrals r": [
        {
          referral_id: "ref1",
          referral_partner_id: "partner1",
          tenant_id: "tenant1",
          qualified_at: "2026-01-01T00:00:00Z",
          partner_rate_bps: 1000,
          partner_commission_base: "gross_profit",
          partner_duration_months: null,
          override_rate_bps: 2000, // vertical override: 20%
          override_commission_base: "revenue",
          override_duration_months: null,
        },
      ],
      "from public.billing_invoices": [{ revenue_cents: 10000 }],
      "from public.cost_events": [{ cost_cents: 0 }],
      "from public.payment_processing_events": [{ fee_cents: 0 }],
    });

    await runCommissionAccrual(sql, NOW, { logger });
    const insertCall = calls.find((c) => c.text.includes("insert into public.commission_events"));
    const values = insertCall?.values as unknown[];
    // override rate 20% of revenue 10000 = 2000
    expect(values?.[3]).toBe(2000);
    expect(values?.[8]).toBe(2000); // rate_bps stored
  });

  it("never accrues a negative commission when costs exceed revenue", async () => {
    const { sql, calls } = makeSql({
      "from public.referrals r": [
        {
          referral_id: "ref1",
          referral_partner_id: "partner1",
          tenant_id: "tenant1",
          qualified_at: "2026-01-01T00:00:00Z",
          partner_rate_bps: 1000,
          partner_commission_base: "gross_profit",
          partner_duration_months: null,
          override_rate_bps: null,
          override_commission_base: null,
          override_duration_months: null,
        },
      ],
      "from public.billing_invoices": [{ revenue_cents: 1000 }],
      "from public.cost_events": [{ cost_cents: 5000 }],
      "from public.payment_processing_events": [{ fee_cents: 0 }],
    });

    await runCommissionAccrual(sql, NOW, { logger });
    const insertCall = calls.find((c) => c.text.includes("insert into public.commission_events"));
    const values = insertCall?.values as unknown[];
    expect(values?.[3]).toBe(0); // floored at 0, never negative
  });

  it("skips a referral once its partner's duration_months window has elapsed", async () => {
    const { sql, calls } = makeSql({
      "from public.referrals r": [
        {
          referral_id: "ref1",
          referral_partner_id: "partner1",
          tenant_id: "tenant1",
          qualified_at: "2026-01-15T00:00:00Z", // window: Jan..Jun (6 months) -> expires before Sep period
          partner_rate_bps: 1000,
          partner_commission_base: "gross_profit",
          partner_duration_months: 6,
          override_rate_bps: null,
          override_commission_base: null,
          override_duration_months: null,
        },
      ],
    });

    const result = await runCommissionAccrual(sql, NOW, { logger });
    expect(result).toEqual({
      period: "2026-09-01",
      candidatesConsidered: 1,
      accrued: 0,
      skippedExpired: 1,
    });
    expect(calls.some((c) => c.text.includes("insert into public.commission_events"))).toBe(false);
  });

  it("still accrues when duration_months window has NOT yet elapsed", async () => {
    const { sql, calls } = makeSql({
      "from public.referrals r": [
        {
          referral_id: "ref1",
          referral_partner_id: "partner1",
          tenant_id: "tenant1",
          qualified_at: "2026-08-15T00:00:00Z", // window: Aug..Oct (3 months) -> still covers Sep period
          partner_rate_bps: 1000,
          partner_commission_base: "revenue",
          partner_duration_months: 3,
          override_rate_bps: null,
          override_commission_base: null,
          override_duration_months: null,
        },
      ],
      "from public.billing_invoices": [{ revenue_cents: 1000 }],
      "from public.cost_events": [{ cost_cents: 0 }],
      "from public.payment_processing_events": [{ fee_cents: 0 }],
    });

    const result = await runCommissionAccrual(sql, NOW, { logger });
    expect(result.accrued).toBe(1);
    expect(result.skippedExpired).toBe(0);
    expect(calls.some((c) => c.text.includes("insert into public.commission_events"))).toBe(true);
  });

  it("scopes the upsert's DO UPDATE to only ever touch a still-'accrued' row (never re-touches a paid/batched period)", async () => {
    const { sql, calls } = makeSql({
      "from public.referrals r": [
        {
          referral_id: "ref1",
          referral_partner_id: "partner1",
          tenant_id: "tenant1",
          qualified_at: "2026-01-01T00:00:00Z",
          partner_rate_bps: 1000,
          partner_commission_base: "revenue",
          partner_duration_months: null,
          override_rate_bps: null,
          override_commission_base: null,
          override_duration_months: null,
        },
      ],
      "from public.billing_invoices": [{ revenue_cents: 1000 }],
      "from public.cost_events": [{ cost_cents: 0 }],
      "from public.payment_processing_events": [{ fee_cents: 0 }],
    });

    await runCommissionAccrual(sql, NOW, { logger });
    const insertCall = calls.find((c) => c.text.includes("insert into public.commission_events"));
    expect(insertCall?.text).toContain(
      "on conflict (referral_id, period) where period is not null",
    );
    expect(insertCall?.text).toContain("where public.commission_events.status = 'accrued'");
  });
});
