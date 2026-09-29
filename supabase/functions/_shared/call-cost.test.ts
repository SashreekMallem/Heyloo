import { describe, expect, it } from "vitest";
import { combinedCostCents, recordCallCost, toCostLines } from "./call-cost.ts";
import type { SqlClient } from "./types.ts";

function recordingSql(fixtures: Record<string, unknown[]> = {}) {
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

// A real Retell call_cost captured live on 2026-09-21 (214s phone call).
const LIVE_CALL_COST = {
  combined_cost: 42.312,
  product_costs: [
    { product: "gpt_4_1_mini", cost: 4.5653262, unit_price: 0.0213333 },
    { product: "gpt_5_6_terra_text_testing", cost: 2.08, unit_price: 2.08 },
    { product: "platform_tts", cost: 5.35, unit_price: 0.025 },
    { product: "retell_voice_engine", cost: 19.6166738, unit_price: 0.0916667 },
    { product: "us_telnyx_telephony", cost: 10.7, unit_price: 0.05 },
  ],
};

describe("toCostLines", () => {
  it("keeps fractional cents and derives per-minute unit cost from cents/second unit_price", () => {
    const lines = toCostLines(LIVE_CALL_COST);
    const voice = lines.find((l) => l.product === "retell_voice_engine");
    expect(voice?.totalCostCents).toBeCloseTo(19.6166738, 7);
    expect(voice?.unit).toBe("minute");
    // 0.0916667 c/s * 60 = 5.5 c/min = Retell's published $0.055/min voice infrastructure
    expect(voice?.unitCostCents).toBeCloseTo(5.5, 4);
    expect(voice?.quantity).toBeCloseTo(214 / 60, 2);
    const tts = lines.find((l) => l.product === "platform_tts");
    expect(tts?.unitCostCents).toBeCloseTo(1.5, 6); // $0.015/min
  });

  it("treats cost == unit_price as a flat per-call charge", () => {
    const flat = toCostLines(LIVE_CALL_COST).find(
      (l) => l.product === "gpt_5_6_terra_text_testing",
    );
    expect(flat).toMatchObject({ unit: "unit", quantity: 1, unitCostCents: 2.08 });
  });

  it("flags transfer legs and skips malformed lines", () => {
    const lines = toCostLines({
      product_costs: [
        { product: "retell_voice_engine", cost: 3, unit_price: 0.1, is_transfer_leg_cost: true },
        { product: "bad", cost: Number.NaN },
        { product: "neg", cost: -1 },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.isTransferLeg).toBe(true);
  });
});

describe("combinedCostCents", () => {
  it("rounds combined_cost to integer cents", () => {
    expect(combinedCostCents(LIVE_CALL_COST)).toBe(42);
  });
  it("is 0 (not null) for a provider-reported zero-cost call", () => {
    expect(combinedCostCents({ combined_cost: 0, product_costs: [] })).toBe(0);
  });
  it("falls back to the itemized sum when combined_cost is absent", () => {
    expect(
      combinedCostCents({
        product_costs: [
          { product: "a", cost: 1.4 },
          { product: "b", cost: 1.4 },
        ],
      }),
    ).toBe(3);
  });
  it("is null (unknown) when there is no call_cost at all", () => {
    expect(combinedCostCents(undefined)).toBeNull();
  });
});

describe("recordCallCost", () => {
  it("upserts each line idempotently and stamps call_logs.cost_cents + cost_source", async () => {
    const { sql, calls } = recordingSql({ "update public.call_logs": [{ cost_cents: 42 }] });
    const result = await recordCallCost(sql, {
      tenantId: "t1",
      callId: "c1",
      occurredAt: "2026-09-21T08:18:41.662Z",
      callCost: LIVE_CALL_COST,
      source: "retell_call_ended",
    });
    expect(result).toEqual({ recorded: true, costCents: 42, lineCount: 5 });
    const inserts = calls.filter((c) => c.text.includes("insert into public.cost_events"));
    expect(inserts).toHaveLength(5);
    for (const i of inserts) {
      expect(i.text).toContain("on conflict (call_id, provider, product, is_transfer_leg_cost)");
      expect(i.text).toContain("do update set");
    }
    const upd = calls.find((c) => c.text.includes("update public.call_logs"));
    expect(upd?.values).toContain("retell_call_ended");
  });

  it("records an explicit 0 with a source for a zero-cost provider-reported call", async () => {
    const { sql, calls } = recordingSql({ "update public.call_logs": [{ cost_cents: 0 }] });
    const result = await recordCallCost(sql, {
      tenantId: "t1",
      callId: "c1",
      occurredAt: "2026-09-20T20:05:35.000Z",
      callCost: { combined_cost: 0, product_costs: [] },
      source: "retell_call_ended",
    });
    expect(result).toEqual({ recorded: true, costCents: 0, lineCount: 0 });
    expect(calls.filter((c) => c.text.includes("insert into public.cost_events"))).toHaveLength(0);
    expect(calls.some((c) => c.text.includes("update public.call_logs"))).toBe(true);
  });

  it("leaves cost unknown (no writes) when the provider sent no call_cost", async () => {
    const { sql, calls } = recordingSql();
    const result = await recordCallCost(sql, {
      tenantId: "t1",
      callId: "c1",
      occurredAt: "2026-09-20T20:05:35.000Z",
      callCost: undefined,
      source: "retell_call_ended",
    });
    expect(result).toEqual({ recorded: false, costCents: null, lineCount: 0 });
    expect(calls).toHaveLength(0);
  });
});
