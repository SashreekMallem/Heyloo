import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.ts";
import {
  evaluateNegativeMargin,
  evaluateToolFailureSpike,
  evaluateUsageSpike,
  upsertAlert,
} from "./handler.ts";

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

describe("evaluateNegativeMargin", () => {
  it("maps v_tenant_margin rows with negative margin into alerts", async () => {
    const { sql } = makeSql({
      "from public.v_tenant_margin": [{ tenant_id: "t1", name: "Acme", margin_cents: -500 }],
    });
    const alerts = await evaluateNegativeMargin(sql);
    expect(alerts).toEqual([
      {
        rule: "negative_margin",
        severity: "warning",
        tenant_id: "t1",
        payload: { tenant_name: "Acme", margin_cents: -500 },
      },
    ]);
  });
});

describe("evaluateUsageSpike", () => {
  it("maps rows crossing the 2.5x trailing-average threshold into alerts", async () => {
    const { sql } = makeSql({
      "left join prior_week": [{ tenant_id: "t1", today_minutes: 300, trailing_avg_minutes: 100 }],
    });
    const alerts = await evaluateUsageSpike(sql);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.rule).toBe("usage_spike");
  });
});

describe("evaluateToolFailureSpike", () => {
  it("maps tool_health rows over the failure-rate threshold into critical alerts", async () => {
    const { sql } = makeSql({
      "from public.tool_health": [{ tool_name: "create_booking", total: 10, errors: 4 }],
    });
    const alerts = await evaluateToolFailureSpike(sql);
    expect(alerts).toEqual([
      {
        rule: "tool_failure_spike",
        severity: "critical",
        tenant_id: null,
        payload: { tool_name: "create_booking", total: 10, errors: 4 },
      },
    ]);
  });
});

describe("upsertAlert", () => {
  it("issues an insert-if-not-exists-in-the-last-hour query", async () => {
    const { sql, calls } = makeSql();
    await upsertAlert(sql, {
      rule: "negative_margin",
      severity: "warning",
      tenant_id: "t1",
      payload: {},
    });
    expect(calls[0]?.text).toContain("insert into public.alerts");
    expect(calls[0]?.values).toContain("negative_margin");
  });
});
