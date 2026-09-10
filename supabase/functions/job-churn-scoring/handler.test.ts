import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.ts";
import type { ChurnInputRow } from "./handler.ts";
import {
  computeChurnScore,
  fetchChurnInputs,
  runChurnScoring,
  upsertChurnScore,
} from "./handler.ts";

function row(overrides: Partial<ChurnInputRow> = {}): ChurnInputRow {
  return {
    tenant_id: "t1",
    status: "active",
    calls_last_7: 10,
    calls_prev_7: 10,
    open_support_tickets: 0,
    past_due_invoices: 0,
    ...overrides,
  };
}

describe("computeChurnScore", () => {
  it("scores a healthy, flat-usage tenant near zero", () => {
    const result = computeChurnScore(row());
    expect(result.score).toBe(0);
    expect(result.factors.already_churned).toBe(false);
  });

  it("scores maximum usage-trend risk when calls dropped to zero from a real baseline", () => {
    const result = computeChurnScore(row({ calls_last_7: 0, calls_prev_7: 20 }));
    expect(result.factors.usage_trend_factor).toBe(1);
    expect(result.score).toBe(40); // weight_usage_trend (0.4) * 1, no other signals
  });

  it("treats no-baseline-no-current volume as mild neutral risk, not a decline", () => {
    const result = computeChurnScore(row({ calls_last_7: 0, calls_prev_7: 0 }));
    expect(result.factors.usage_trend_factor).toBe(0.3);
    expect(result.score).toBe(12); // 0.4 * 0.3 = 0.12 -> 12
  });

  it("weights support tickets and payment failures at their configured ceilings", () => {
    const result = computeChurnScore(
      row({ open_support_tickets: 5, past_due_invoices: 2, calls_last_7: 10, calls_prev_7: 10 }),
    );
    expect(result.factors.support_ticket_factor).toBe(1);
    expect(result.factors.payment_failure_factor).toBe(1);
    expect(result.score).toBe(60); // 0.25 + 0.35 = 0.6 -> 60
  });

  it("caps ceilings at 1 even when volume exceeds them", () => {
    const result = computeChurnScore(row({ open_support_tickets: 50, past_due_invoices: 10 }));
    expect(result.factors.support_ticket_factor).toBe(1);
    expect(result.factors.payment_failure_factor).toBe(1);
  });

  it("scores an already-paused or canceled tenant at 100 regardless of factors", () => {
    const paused = computeChurnScore(
      row({ status: "paused", calls_last_7: 100, calls_prev_7: 100 }),
    );
    const canceled = computeChurnScore(row({ status: "canceled" }));
    expect(paused.score).toBe(100);
    expect(canceled.score).toBe(100);
    expect(paused.factors.already_churned).toBe(true);
  });
});

function makeSql(fixtures: unknown[] = []): { sql: SqlClient; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);
    return Promise.resolve(fixtures);
  }) as SqlClient;
  return { sql, calls };
}

describe("fetchChurnInputs / upsertChurnScore", () => {
  it("fetchChurnInputs returns whatever the query yields", async () => {
    const { sql } = makeSql([row()]);
    const rows = await fetchChurnInputs(sql);
    expect(rows).toHaveLength(1);
  });

  it("upsertChurnScore passes tenant_id/score/factors as query params", async () => {
    const { sql, calls } = makeSql();
    await upsertChurnScore(sql, "t1", computeChurnScore(row()));
    expect(calls[0]).toContain("t1");
    expect(calls[0]).toContain(0);
  });
});

describe("runChurnScoring", () => {
  it("scores and upserts every tenant returned by the fetch, once each", async () => {
    let call = 0;
    const upserts: unknown[][] = [];
    const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      call += 1;
      if (call === 1) {
        return Promise.resolve([
          row({ tenant_id: "t1" }),
          row({ tenant_id: "t2", status: "canceled" }),
        ]);
      }
      upserts.push(values);
      return Promise.resolve([]);
    }) as SqlClient;

    const result = await runChurnScoring(sql);
    expect(result).toEqual({ scored: 2 });
    expect(upserts).toHaveLength(2);
    expect(upserts[0]).toContain("t1");
    expect(upserts[1]).toContain("t2");
  });
});
