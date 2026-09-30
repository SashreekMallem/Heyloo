import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { AdminRequestContext } from "./handler.ts";
import { routeAdminRequest } from "./handler.ts";

const logger = createLogger();
const TENANT = "00000000-0000-4000-8000-000000000001";

function ctx(overrides: Partial<AdminRequestContext>): AdminRequestContext {
  return {
    method: "GET",
    path: `/admin-cockpit/per-customer-margin/${TENANT}`,
    claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
    body: undefined,
    adminUserId: "admin_1",
    ...overrides,
  };
}

/** `fn_margin_by_tenant(start, end, include_test)`: real numbers only without test data. */
function makeSql(isTestTenant: boolean) {
  const marginCalls: { includeTest: unknown }[] = [];
  const callLoads: { includeTest: unknown }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (text.includes("from public.fn_margin_by_tenant")) {
      const includeTest = values[2];
      marginCalls.push({ includeTest });
      return Promise.resolve([
        {
          tenant_id: TENANT,
          name: "Riverside Auto Repair",
          vertical: "auto",
          is_test: isTestTenant,
          revenue_cents: "0",
          // the F13 numbers: 16c on real calls only, 380c with test calls
          cost_cents: includeTest ? "380" : "16",
          margin_cents: includeTest ? "-380" : "-16",
          call_count: includeTest ? "21" : "4",
          billable_minutes: "0",
        },
      ]);
    }
    if (text.includes("from public.call_logs cl")) {
      callLoads.push({ includeTest: values[0] });
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, marginCalls, callLoads };
}

// COCKPIT-F13
describe("per-customer margin drill-down honors include_test", () => {
  it("shows the same real-only cost as the list by default", async () => {
    const { sql, callLoads } = makeSql(false);
    const result = await routeAdminRequest(sql, ctx({}), logger);
    const body = result.body as {
      include_test: boolean;
      summary: { cost_cents: number };
    };
    expect(body.include_test).toBe(false);
    expect(body.summary.cost_cents).toBe(16);
    expect(callLoads).toEqual([{ includeTest: false }]);
  });

  it("includes test calls when the list was opened with include_test=1", async () => {
    const { sql, callLoads } = makeSql(false);
    const result = await routeAdminRequest(sql, ctx({ query: { include_test: "1" } }), logger);
    const body = result.body as { include_test: boolean; summary: { cost_cents: number } };
    expect(body.include_test).toBe(true);
    expect(body.summary.cost_cents).toBe(380);
    expect(callLoads).toEqual([{ includeTest: true }]);
  });

  it("a test tenant always shows its own data (it does not exist in the real-only view)", async () => {
    const { sql } = makeSql(true);
    const result = await routeAdminRequest(sql, ctx({}), logger);
    const body = result.body as { include_test: boolean; summary: { cost_cents: number } };
    expect(body.include_test).toBe(true);
    expect(body.summary.cost_cents).toBe(380);
  });

  it("still 404s an unknown tenant", async () => {
    const sql = (() => Promise.resolve([])) as unknown as SqlClient;
    const result = await routeAdminRequest(sql, ctx({}), logger);
    expect(result).toEqual({ status: 404, body: { error: "tenant_not_found" } });
  });
});
