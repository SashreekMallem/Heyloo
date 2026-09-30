import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.ts";
import {
  alertKey,
  evaluateJobHealth,
  evaluateNegativeMargin,
  evaluateToolFailureSpike,
  evaluateUsageSpike,
  resolveClearedAlerts,
  runAlertEvaluation,
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
  it("inserts an alert when no open one exists for the condition", async () => {
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

describe("upsertAlert (QA-1 BE-15)", () => {
  const alert = {
    rule: "negative_margin",
    severity: "warning" as const,
    tenant_id: "t1",
    payload: { tenant_name: "Acme", period: "last_month" },
  };

  it("has no time window: any open alert for the same rule, tenant and key is refreshed, never duplicated", async () => {
    const { sql, calls } = makeSql();
    await upsertAlert(sql, alert);
    const text = calls[0]?.text ?? "";
    expect(text).toContain("update public.alerts");
    expect(text).toContain("insert into public.alerts");
    expect(text).toContain("where not exists (select 1 from refreshed)");
    expect(text).not.toContain("interval '1 hour'");
    expect(text).not.toMatch(/created_at\s*>/);
  });

  it("stamps a dedupe key and last_seen_at into the stored payload", async () => {
    const { sql, calls } = makeSql();
    await upsertAlert(sql, alert);
    const stored = calls[0]?.values.find(
      (v) => typeof v === "object" && v !== null && "dedupe_key" in v,
    ) as Record<string, unknown> | undefined;
    expect(stored?.["dedupe_key"]).toBe("last_month");
    expect(typeof stored?.["last_seen_at"]).toBe("string");
    expect(stored?.["tenant_name"]).toBe("Acme");
  });

  it("keys tool_failure_spike per tool so two failing tools stay two alerts", () => {
    const base = { rule: "tool_failure_spike", severity: "critical" as const, tenant_id: null };
    expect(alertKey({ ...base, payload: { tool_name: "a" } })).toBe("a");
    expect(alertKey({ ...base, payload: { tool_name: "b" } })).toBe("b");
  });

  // A tiny in-memory model of the alerts table, driven by the fake sql's
  // bound values, to prove a persistent condition stays ONE open row.
  it("a condition that persists for 24 evaluations leaves exactly one open alert", async () => {
    const rows: { key: string; status: string }[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("with refreshed")) {
        const payload = values.find((v) => typeof v === "object" && v !== null) as {
          dedupe_key: string;
        };
        if (!rows.some((r) => r.status === "open" && r.key === payload.dedupe_key)) {
          rows.push({ key: payload.dedupe_key, status: "open" });
        }
      }
      return Promise.resolve([]);
    }) as SqlClient;
    for (let i = 0; i < 24; i += 1) await upsertAlert(sql, alert);
    expect(rows.filter((r) => r.status === "open")).toHaveLength(1);
  });
});

describe("resolveClearedAlerts (QA-1 BE-15)", () => {
  it("resolves open alerts of the managed rules whose condition did not fire, and passes the active keys", async () => {
    const { sql, calls } = makeSql();
    await resolveClearedAlerts(sql, [
      {
        rule: "negative_margin",
        severity: "warning",
        tenant_id: "t1",
        payload: { period: "last_month" },
      },
    ]);
    const text = calls[0]?.text ?? "";
    expect(text).toContain("set status = 'resolved'");
    expect(text).toContain("a.status = 'open'");
    // raw arrays for the ::jsonb parameters (a pre-stringified value would be stored as a JSON string scalar)
    expect(calls[0]?.values).toContainEqual(["t1|negative_margin|last_month"]);
    expect(calls[0]?.values[0]).toContain("job_failures");
    // never touches rules other jobs own (agent_regression_*)
    expect(String(calls[0]?.values[0])).not.toContain("agent_regression");
  });

  it("runAlertEvaluation upserts every alert and then resolves the cleared ones", async () => {
    const { sql, calls } = makeSql({
      "from public.tool_health": [{ tool_name: "create_booking", total: 10, errors: 4 }],
    });
    const alerts = await runAlertEvaluation(sql);
    expect(alerts.map((a) => a.rule)).toEqual(["tool_failure_spike"]);
    const last = calls[calls.length - 1]?.text ?? "";
    expect(last).toContain("set status = 'resolved'");
  });
});

describe("evaluateJobHealth (QA-1 BE-05)", () => {
  it("raises a job_failures alert with the status breakdown when pg_net responses failed", async () => {
    const { sql, calls } = makeSql({
      "from net._http_response": [
        { status: "500", n: 4 },
        { status: "timeout", n: 1 },
      ],
    });
    const alerts = await evaluateJobHealth(sql);
    expect(alerts).toEqual([
      {
        rule: "job_failures",
        severity: "warning",
        tenant_id: null,
        payload: {
          source: "pg_net",
          window_minutes: 30,
          failed: 5,
          by_status: { "500": 4, timeout: 1 },
        },
      },
    ]);
    expect(calls[0]?.text).toContain("status_code >= 300");
  });

  it("stays quiet below the failure threshold", async () => {
    const { sql } = makeSql({ "from net._http_response": [{ status: "500", n: 2 }] });
    expect(await evaluateJobHealth(sql)).toEqual([]);
  });

  it("never aborts the other rules when the net schema cannot be read", async () => {
    const sql = (() =>
      Promise.reject(new Error("permission denied for schema net"))) as unknown as SqlClient;
    expect(await evaluateJobHealth(sql)).toEqual([]);
  });
});
