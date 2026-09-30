import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { AdminRequestContext } from "./handler.ts";
import { routeAdminRequest } from "./handler.ts";

const logger = createLogger();

function ctx(overrides: Partial<AdminRequestContext>): AdminRequestContext {
  return {
    method: "GET",
    path: "/admin-tenants",
    claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
    body: {},
    adminUserId: "admin_1",
    ...overrides,
  };
}

function makeSql(): { sql: SqlClient; calls: string[] } {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    calls.push(strings.join(" "));
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

// COCKPIT-F17: a malformed id used to reach Postgres as `where id = 'not-a-uuid'`
// (unhandled cast error -> 500 "Internal Server Error").
describe("routeAdminRequest — malformed path ids", () => {
  it.each([
    ["GET", "/admin-tenants/not-a-uuid"],
    ["PATCH", "/admin-tenants/not-a-uuid"],
    ["POST", "/admin-tenants/not-a-uuid/impersonate"],
    ["GET", "/admin-cockpit/per-customer-margin/not-a-uuid"],
    ["PATCH", "/admin-alerts/not-a-uuid/ack"],
    ["PATCH", "/admin-alerts/rules/not-a-uuid"],
    ["GET", "/admin-support-requests/not-a-uuid"],
    ["GET", "/admin-outreach/campaigns/not-a-uuid"],
    ["POST", "/admin-outreach/replies/not-a-uuid/actions"],
    ["POST", "/admin-referrals/not-a-uuid/payout-override"],
    ["PATCH", "/admin-referrals/partners/not-a-uuid"],
  ])("%s %s answers 404 invalid_id without touching the database", async (method, path) => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(sql, ctx({ method, path }), logger);
    expect(result).toEqual({ status: 404, body: { error: "invalid_id" } });
    expect(calls).toHaveLength(0);
  });

  it("still routes list endpoints and slug-keyed template lookups", async () => {
    const { sql } = makeSql();
    expect((await routeAdminRequest(sql, ctx({ path: "/admin-tenants" }), logger)).status).toBe(
      200,
    );
    expect(
      (await routeAdminRequest(sql, ctx({ path: "/admin-templates/real_estate" }), logger)).status,
    ).toBe(404);
    expect(
      (await routeAdminRequest(sql, ctx({ path: "/admin-alerts/rules" }), logger)).status,
    ).toBe(200);
  });
});
