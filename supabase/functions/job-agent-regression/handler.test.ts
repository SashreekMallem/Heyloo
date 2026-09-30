import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { AgentRegressionDeps } from "./handler.ts";
import { runAgentRegression } from "./handler.ts";

const logger = createLogger();

interface SqlCall {
  text: string;
  values: unknown[];
}

function makeSql(fixtures: Record<string, unknown[]> = {}): { sql: SqlClient; calls: SqlCall[] } {
  const calls: SqlCall[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return rows;
    }
    return [];
  }) as unknown as SqlClient;
  return { sql, calls };
}

const TENANT = { id: "tenant-1", slug: "test-vet-lakeside", vertical: "vet" };

function tenantFixtures(rows: unknown[] = [TENANT]): Record<string, unknown[]> {
  return {
    "from public.tenants": rows,
    "into public.agent_regression_runs": [{ id: "run-1" }],
  };
}

function scenarioResult(overrides: Record<string, unknown> = {}) {
  return {
    case_id: "book_new_caller",
    label: "book_new_caller",
    status: "pass",
    result_explanation: null,
    field_capture: null,
    ...overrides,
  };
}

function fakeFetch(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i, responses.length - 1)] ?? { status: 500, body: {} };
    i++;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
}

function deps(overrides: Partial<AgentRegressionDeps> = {}): AgentRegressionDeps {
  return {
    fetchImpl: fakeFetch([
      {
        status: 200,
        body: {
          batch_job_id: "b1",
          settled: true,
          started_at: "2026-09-21T09:00:00Z",
          results: [scenarioResult()],
        },
      },
    ]),
    functionsBaseUrl: "https://example.supabase.co/functions/v1",
    internalSecret: "secret",
    logger,
    sleep: async () => {},
    ...overrides,
  };
}

describe("runAgentRegression", () => {
  it("records a complete, passing run with no alert when every scenario passes", async () => {
    const { sql, calls } = makeSql(tenantFixtures());
    const result = await runAgentRegression(sql, deps());

    expect(result).toEqual({ tenant_count: 1, tenants: ["test-vet-lakeside"] });
    const update = calls.find((c) => c.text.includes("update public.agent_regression_runs"));
    expect(update).toBeTruthy();
    expect(update?.values).toContain("complete");
    const alertInsert = calls.find((c) => c.text.includes("into public.alerts"));
    expect(alertInsert).toBeUndefined();
  });

  it("QA-1 BE-15: resolves the tenant's open regression alerts once the suite passes again", async () => {
    const { sql, calls } = makeSql(tenantFixtures());
    await runAgentRegression(sql, deps());
    const resolve = calls.find((c) => c.text.includes("update public.alerts"));
    expect(resolve?.text).toContain("set status = 'resolved'");
    expect(resolve?.values).toContain(TENANT.id);
  });

  it("QA-1 BE-15: keeps ONE open alert per tenant and rule however long the failure lasts (no time window)", async () => {
    const results = [scenarioResult({ case_id: "b", status: "fail" })];
    const { sql, calls } = makeSql(tenantFixtures());
    await runAgentRegression(
      sql,
      deps({
        fetchImpl: fakeFetch([
          { status: 200, body: { batch_job_id: "b1", settled: true, started_at: "t", results } },
        ]),
      }),
    );
    const alertInsert = calls.find((c) => c.text.includes("into public.alerts"));
    expect(alertInsert?.text).toContain("a.status = 'open'");
    expect(alertInsert?.text).not.toContain("created_at");
    expect(alertInsert?.text).not.toContain("interval");
    expect(calls.some((c) => c.text.includes("update public.alerts"))).toBe(false);
  });

  it("writes an agent_regression_failure alert when the pass ratio drops below 5/6", async () => {
    const results = [
      scenarioResult({ case_id: "a", status: "pass" }),
      scenarioResult({ case_id: "b", status: "fail", result_explanation: "wrong hours" }),
    ];
    const { sql, calls } = makeSql(tenantFixtures());
    await runAgentRegression(
      sql,
      deps({
        fetchImpl: fakeFetch([
          { status: 200, body: { batch_job_id: "b1", settled: true, started_at: "t", results } },
        ]),
      }),
    );

    const alertInsert = calls.find((c) => c.text.includes("into public.alerts"));
    expect(alertInsert).toBeTruthy();
    expect(alertInsert?.values).toContain("agent_regression_failure");
    expect(alertInsert?.values).toContain(TENANT.id);

    // JSONB-2: `failures` (runs table) and the alert payload are raw
    // array/object params, never JSON.stringify'd strings.
    const update = calls.find((c) => c.text.includes("update public.agent_regression_runs"));
    const failures = update?.values.find((v) => Array.isArray(v));
    expect(failures).toEqual([
      expect.objectContaining({ case_id: "b", result_explanation: "wrong hours" }),
    ]);
    expect(update?.values.some((v) => typeof v === "string" && v.startsWith("["))).toBe(false);
    const payload = alertInsert?.values.find((v) => typeof v === "object" && v !== null);
    expect(payload).toEqual(
      expect.objectContaining({ run_id: "run-1", tenant_slug: TENANT.slug, failures }),
    );
    expect(alertInsert?.values.some((v) => typeof v === "string" && v.startsWith("{"))).toBe(false);
  });

  it("writes an alert when every scenario passes but field capture is missing required fields", async () => {
    const results = [
      scenarioResult({
        field_capture: {
          write_intent: "create_booking",
          row_found: true,
          fields_required: ["customer.phone"],
          fields_captured: [],
          fields_missing: ["customer.phone"],
        },
      }),
    ];
    const { sql, calls } = makeSql(tenantFixtures());
    await runAgentRegression(
      sql,
      deps({
        fetchImpl: fakeFetch([
          { status: 200, body: { batch_job_id: "b1", settled: true, started_at: "t", results } },
        ]),
      }),
    );

    const update = calls.find((c) => c.text.includes("update public.agent_regression_runs"));
    expect(update?.values).toContain(false); // field_capture_ok
    const alertInsert = calls.find((c) => c.text.includes("into public.alerts"));
    expect(alertInsert?.values).toContain("agent_regression_failure");
  });

  it("follows a resume chain across multiple calls until settled", async () => {
    const { sql } = makeSql(tenantFixtures());
    const resume = { batch_job_id: "b1", case_definitions: [], started_at: "t" };
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            batch_job_id: "b1",
            settled: false,
            started_at: "t",
            results: [],
            resume,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          batch_job_id: "b1",
          settled: true,
          started_at: "t",
          results: [scenarioResult()],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await runAgentRegression(sql, deps({ fetchImpl }));
    expect(calls).toBe(2);
    expect(result.tenant_count).toBe(1);
  });

  it("marks the run 'timeout' and preserves resume_state when the per-tenant budget elapses", async () => {
    const { sql, calls } = makeSql(tenantFixtures());
    const resume = {
      batch_job_id: "b1",
      case_definitions: [{ case_id: "a", definition_id: "d1" }],
      started_at: "t",
    };
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          batch_job_id: "b1",
          settled: false,
          started_at: "t",
          results: [],
          resume,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    // Deadline already in the past — the loop's very first settled:false
    // response should exit immediately as a timeout rather than looping.
    await runAgentRegression(
      sql,
      deps({ fetchImpl, now: () => new Date(0), perTenantBudgetMs: -1 }),
    );

    const update = calls.find((c) => c.text.includes("update public.agent_regression_runs"));
    expect(update?.values).toContain("timeout");
    // JSONB-2: jsonb params are bound as raw objects/arrays (postgres.js
    // serializes them exactly once via the learned jsonb type) — never a
    // pre-stringified JSON string, which would be stored double-encoded.
    expect(update?.values).toContainEqual(resume);
    expect(update?.values.filter((v) => typeof v === "string" && v.startsWith("{"))).toEqual([]);
    const alertInsert = calls.find((c) => c.text.includes("into public.alerts"));
    expect(alertInsert?.values).toContain("agent_regression_timeout");
  });

  it("marks the run 'error' and alerts when the internal call fails outright", async () => {
    const { sql, calls } = makeSql(tenantFixtures());
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "tenant_has_no_compiled_agent" }), {
        status: 422,
      })) as unknown as typeof fetch;

    await runAgentRegression(sql, deps({ fetchImpl }));

    const update = calls.find((c) => c.text.includes("update public.agent_regression_runs"));
    expect(update?.values).toContain("error");
    const alertInsert = calls.find((c) => c.text.includes("into public.alerts"));
    expect(alertInsert?.values).toContain("agent_regression_error");
  });

  it("runs multiple tenants and reports every slug", async () => {
    const tenants = [TENANT, { id: "tenant-2", slug: "test-riverside-auto", vertical: "auto" }];
    const { sql } = makeSql(tenantFixtures(tenants));
    const result = await runAgentRegression(sql, deps());
    expect(result.tenant_count).toBe(2);
    expect(result.tenants).toEqual(["test-vet-lakeside", "test-riverside-auto"]);
  });
});
