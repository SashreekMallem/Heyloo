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
  it("COCKPIT-1: alerts on the last closed month's PAID negative margin (real tenants only), coercing bigint strings", async () => {
    const { sql, calls } = makeSql({
      "from public.fn_margin_by_tenant": [{ tenant_id: "t1", name: "Acme", margin_cents: "-500" }],
    });
    const alerts = await evaluateNegativeMargin(sql);
    expect(alerts).toEqual([
      {
        rule: "negative_margin",
        severity: "warning",
        tenant_id: "t1",
        payload: { tenant_name: "Acme", margin_cents: -500, period: "last_month" },
      },
    ]);
    const q = calls[0]?.text ?? "";
    expect(q).toContain("revenue_cents > 0 and margin_cents < 0");
    // include_test = false: test tenants/calls never raise a margin alert
    expect(q).toContain("false");
    expect(q).not.toContain("v_tenant_margin");
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
  // COCKPIT-F07: a persistent condition inserted a new open row every hour.
  it("refreshes an existing open alert, then inserts only when none is open (no time window)", async () => {
    const { sql, calls } = makeSql();
    await upsertAlert(sql, {
      rule: "negative_margin",
      severity: "warning",
      tenant_id: "t1",
      payload: { margin_cents: -500 },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("update public.alerts");
    expect(calls[0]?.text).toContain("set payload =");
    expect(calls[1]?.text).toContain("insert into public.alerts");
    expect(calls[1]?.text).toContain("where not exists");
    expect(calls[1]?.text).toContain("on conflict do nothing");
    for (const call of calls) {
      expect(call.text).not.toContain("interval");
      expect(call.values).toContain("negative_margin");
    }
  });

  it("keys tool_failure_spike alerts per tool so one failing tool cannot hide another", async () => {
    const { sql, calls } = makeSql();
    await upsertAlert(sql, {
      rule: "tool_failure_spike",
      severity: "critical",
      tenant_id: null,
      payload: { tool_name: "book_appointment", total: 10, errors: 5 },
    });
    expect(calls[0]?.values).toContain("book_appointment");
    expect(calls[1]?.values).toContain("book_appointment");
  });
});
