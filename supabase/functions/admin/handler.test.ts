import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { SqlClient } from "../_shared/types.js";
import type { AdminRequestContext } from "./handler.js";
import { routeAdminRequest } from "./handler.js";

const logger = createLogger();

function baseCtx(overrides: Partial<AdminRequestContext> = {}): AdminRequestContext {
  return {
    method: "GET",
    path: "/admin-tenants",
    claims: { app_metadata: { platform_admin: true } },
    body: undefined,
    adminUserId: "admin_1",
    ...overrides,
  };
}

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

describe("routeAdminRequest — auth gate", () => {
  it("rejects any request without platform_admin=true, before routing", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ claims: { app_metadata: { platform_admin: false } } }),
      logger,
    );
    expect(result).toEqual({ status: 403, body: { error: "not_a_platform_admin" } });
  });

  it("rejects a request with no claims at all", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(sql, baseCtx({ claims: null }), logger);
    expect(result.status).toBe(403);
  });
});

describe("routeAdminRequest — tenants group", () => {
  it("lists tenants on GET /admin-tenants", async () => {
    const { sql } = makeSql({
      "from public.tenants where deleted_at": [
        { id: "t1", name: "Acme", vertical: "auto_repair", status: "active" },
      ],
    });
    const result = await routeAdminRequest(sql, baseCtx(), logger);
    expect(result.status).toBe(200);
    expect((result.body as { tenants: unknown[] }).tenants).toHaveLength(1);
  });

  it("patches allowed fields and writes an admin_actions audit row", async () => {
    const { sql, calls } = makeSql({
      "select * from public.tenants where id": [{ id: "t1", status: "trialing" }],
    });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "PATCH", path: "/admin-tenants/t1", body: { status: "active" } }),
      logger,
    );
    expect(result.status).toBe(200);
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(true);
  });

  it("rejects an unrecognized PATCH field (never silently no-ops, returns 422)", async () => {
    const { sql } = makeSql({ "select * from public.tenants where id": [{ id: "t1" }] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "PATCH",
        path: "/admin-tenants/t1",
        body: { stripe_customer_id: "cus_hacked" },
      }),
      logger,
    );
    expect(result.status).toBe(422);
  });

  it("requires AAL2 for impersonation and never reaches the audit-log write without it", async () => {
    const { sql, calls } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-tenants/t1/impersonate",
        claims: { app_metadata: { platform_admin: true }, aal: "aal1" },
      }),
      logger,
    );
    expect(result).toEqual({ status: 403, body: { error: "aal2_required" } });
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(false);
  });

  it("writes admin_actions impersonate_start when AAL2 is present", async () => {
    const { sql, calls } = makeSql({ "from public.tenants where id": [{ id: "t1" }] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({
        method: "POST",
        path: "/admin-tenants/t1/impersonate",
        claims: { app_metadata: { platform_admin: true }, aal: "aal2" },
      }),
      logger,
    );
    expect(calls.some((c) => c.text.includes("insert into public.admin_actions"))).toBe(true);
    // Token minting itself isn't implemented yet — see handler.ts's own note.
    expect(result.status).toBe(501);
  });
});

describe("routeAdminRequest — alerts group", () => {
  it("acks an open alert", async () => {
    const { sql } = makeSql({ "update public.alerts": [{ id: "alert_1" }] });
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "PATCH", path: "/admin-alerts/alert_1/ack" }),
      logger,
    );
    expect(result).toEqual({ status: 200, body: { acked: true } });
  });

  it("returns 404 when the alert doesn't exist or is already acked", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ method: "PATCH", path: "/admin-alerts/missing/ack" }),
      logger,
    );
    expect(result.status).toBe(404);
  });
});

describe("routeAdminRequest — not-yet-implemented groups", () => {
  it("returns 501 (never a silent 200) for an unimplemented endpoint group", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(
      sql,
      baseCtx({ path: "/admin-cockpit/waterfall" }),
      logger,
    );
    expect(result.status).toBe(501);
  });

  it("returns 404 for a genuinely unknown path", async () => {
    const { sql } = makeSql();
    const result = await routeAdminRequest(sql, baseCtx({ path: "/admin-nonexistent" }), logger);
    expect(result.status).toBe(404);
  });
});
