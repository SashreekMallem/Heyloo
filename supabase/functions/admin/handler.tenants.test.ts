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
    path: `/admin-tenants/${TENANT}`,
    claims: { app_metadata: { platform_admin: true } },
    body: undefined,
    adminUserId: "admin_1",
    ...overrides,
  };
}

function makeSql(fixtures: Record<string, unknown[]> = {}) {
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

const tenantRow = (over: Record<string, unknown> = {}) => ({
  id: TENANT,
  name: "Riverside Auto Repair",
  vertical: "auto",
  status: "active",
  stripe_subscription_id: null,
  ...over,
});

// COCKPIT-F12 / F14
describe("GET admin-tenants/:id metrics", () => {
  it("has no margin and no MRR for an unsubscribed tenant with no revenue, and rounds minutes", async () => {
    const { sql } = makeSql({
      "select * from public.tenants where id": [tenantRow()],
      "from public.fn_margin_by_tenant": [{ revenue_cents: "0", margin_cents: "-380" }],
      "from public.platform_settings where key": [{ base_cents: "29900" }],
      "from public.usage_daily": [{ minutes_used: "3.5666667" }],
    });
    const result = await routeAdminRequest(sql, ctx({}), logger);
    expect((result.body as { metrics: unknown }).metrics).toEqual({
      mrr_cents: null,
      list_price_cents: 29900,
      margin_pct: null,
      minutes_used: 3.6,
    });
  });

  it("counts MRR only for an active tenant with a live subscription", async () => {
    const fixtures = (over: Record<string, unknown>) => ({
      "select * from public.tenants where id": [tenantRow(over)],
      "from public.fn_margin_by_tenant": [{ revenue_cents: "29900", margin_cents: "20000" }],
      "from public.platform_settings where key": [{ base_cents: "29900" }],
    });
    const mrr = async (over: Record<string, unknown>) => {
      const result = await routeAdminRequest(makeSql(fixtures(over)).sql, ctx({}), logger);
      return (result.body as { metrics: { mrr_cents: number | null } }).metrics.mrr_cents;
    };
    expect(await mrr({ stripe_subscription_id: "sub_1" })).toBe(29900);
    expect(await mrr({ stripe_subscription_id: "sub_1", status: "past_due" })).toBe(29900);
    expect(await mrr({ stripe_subscription_id: null })).toBeNull();
    expect(await mrr({ stripe_subscription_id: "sub_1", status: "paused" })).toBeNull();
    expect(await mrr({ stripe_subscription_id: "sub_1", status: "canceled" })).toBeNull();
  });
});

describe("GET admin-tenants list MRR (COCKPIT-F14)", () => {
  it("shows list price separately and MRR null when the tenant has no subscription", async () => {
    const { sql } = makeSql({
      "from public.tenants t": [
        {
          id: TENANT,
          name: "Riverside",
          vertical: "auto",
          status: "active",
          plan_code: "standard",
          created_at: "2026-09-01T00:00:00Z",
          stripe_subscription_id: null,
          base_cents: "29900",
          revenue_cents: null,
          margin_cents: null,
        },
      ],
    });
    const result = await routeAdminRequest(sql, ctx({ path: "/admin-tenants" }), logger);
    const [row] = (result.body as { tenants: Record<string, unknown>[] }).tenants;
    expect(row).toMatchObject({ mrr_cents: null, list_price_cents: 29900, margin_pct: null });
  });
});

// COCKPIT-F16
describe("PATCH admin-tenants/:id", () => {
  const patch = (body: unknown, fixtures: Record<string, unknown[]> = {}) => {
    const made = makeSql({
      "select * from public.tenants where id": [tenantRow()],
      ...fixtures,
    });
    return {
      ...made,
      run: () => routeAdminRequest(made.sql, ctx({ method: "PATCH", body }), logger),
    };
  };

  it("requires a reason to pause a tenant and writes nothing without one", async () => {
    const { run, calls } = patch({ status: "paused" });
    const result = await run();
    expect(result).toEqual({ status: 422, body: { error: "reason_required" } });
    expect(calls.some((c) => c.text.includes("update public.tenants"))).toBe(false);
    expect(calls.some((c) => c.text.includes("admin_actions"))).toBe(false);
  });

  it("treats a whitespace-only reason as missing", async () => {
    const { run } = patch({ status: "paused", reason: "   " });
    expect((await run()).body).toEqual({ error: "reason_required" });
  });

  it("stores the reason in the audit row's `after` payload", async () => {
    const { run, calls } = patch({ status: "paused", reason: " chargeback dispute " });
    const result = await run();
    expect(result.status).toBe(200);
    const audit = calls.find((c) => c.text.includes("insert into public.admin_actions"));
    expect(JSON.stringify(audit?.values)).toContain("chargeback dispute");
    expect(calls.some((c) => c.text.includes("update public.tenants set status"))).toBe(true);
  });

  it("lets an admin resume (status active) without a reason", async () => {
    const { run } = patch({ status: "active" });
    expect((await run()).status).toBe(200);
  });

  it.each([
    ["an unknown status", { status: "suspended", reason: "x" }],
    ["a fractional hard cap", { usage_hard_cap_minutes: 12.5 }],
    ["a negative hard cap", { usage_hard_cap_minutes: -1 }],
    ["a string hard cap", { usage_hard_cap_minutes: "lots" }],
    ["zero retention days", { retention_days: 0 }],
    ["a non-boolean manual_mode", { manual_mode: "yes" }],
  ])("422s %s instead of reaching the database", async (_label, body) => {
    const { run, calls } = patch(body);
    const result = await run();
    expect(result.status).toBe(422);
    expect((result.body as { error: string }).error).toBe("invalid_tenant_patch");
    expect(calls.some((c) => c.text.includes("update public.tenants"))).toBe(false);
  });

  it("still accepts a null hard cap (clears it)", async () => {
    const { run } = patch({ usage_hard_cap_minutes: null });
    expect((await run()).status).toBe(200);
  });
});
