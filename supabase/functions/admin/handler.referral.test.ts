import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { AdminRequestContext } from "./handler.ts";
import { routeAdminRequest } from "./handler.ts";

const logger = createLogger();

function ctx(overrides: Partial<AdminRequestContext>): AdminRequestContext {
  return {
    method: "GET",
    path: "/admin-platform-settings",
    claims: { app_metadata: { platform_admin: true } },
    body: undefined,
    adminUserId: "admin_1",
    ...overrides,
  };
}

/** The exact rows `supabase/seed/seed.sql` writes (what fn_check_referral_qualification reads). */
const SEEDED = [
  { key: "referral_flat_amount_cents", value: { flat_amount_cents: 20000 } },
  { key: "referral_qualification_rule", value: { rule: "paid_invoices_gte", value: 2 } },
];

/** A tiny in-memory `platform_settings` so GET -> PATCH -> GET round-trips against the real SQL text. */
function memorySettings(seed = SEEDED) {
  const store = new Map<string, Record<string, unknown>>(seed.map((r) => [r.key, r.value]));
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    if (text.includes("key = any")) {
      return Promise.resolve([...store].map(([key, value]) => ({ key, value })));
    }
    if (text.includes("where key in ('referral_flat_amount_cents'")) {
      return Promise.resolve([...store].map(([key, value]) => ({ key, value })));
    }
    const upsert = /values \('(referral_[a-z_]+)'/.exec(text);
    if (upsert?.[1]) {
      store.set(upsert[1], values[0] as Record<string, unknown>);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, store };
}

describe("platform settings — referral round trip (COCKPIT-F06)", () => {
  it("GET shows the seeded 200.00 and rule instead of $0.00", async () => {
    const { sql } = memorySettings();
    const res = await routeAdminRequest(sql, ctx({}), logger);
    expect((res.body as { referral: unknown }).referral).toEqual({
      flat_amount_cents: 20000,
      qualification_rule: "paid_invoices_gte",
      qualification_value: 2,
    });
  });

  it("still reads the legacy amount_cents key an earlier save may have written", async () => {
    const { sql } = memorySettings([
      { key: "referral_flat_amount_cents", value: { amount_cents: 15000 } },
      { key: "referral_qualification_rule", value: { rule: "paid_invoices_gte" } },
    ]);
    const res = await routeAdminRequest(sql, ctx({}), logger);
    expect(
      (res.body as { referral: { flat_amount_cents: number } }).referral.flat_amount_cents,
    ).toBe(15000);
  });

  it("PATCH writes the keys the SQL function reads and preserves the qualification value", async () => {
    const { sql, store } = memorySettings();
    const res = await routeAdminRequest(
      sql,
      ctx({
        method: "PATCH",
        path: "/admin-platform-settings/referral",
        body: { flat_amount_cents: 25000, qualification_rule: "paid_invoices_gte" },
      }),
      logger,
    );
    expect(res.status).toBe(200);
    expect(store.get("referral_flat_amount_cents")).toEqual({ flat_amount_cents: 25000 });
    expect(store.get("referral_qualification_rule")).toEqual({
      rule: "paid_invoices_gte",
      value: 2,
    });

    const again = await routeAdminRequest(sql, ctx({}), logger);
    expect(
      (again.body as { referral: { flat_amount_cents: number } }).referral.flat_amount_cents,
    ).toBe(25000);
  });

  it("PATCH can change the required paid-invoice count and drops the legacy key", async () => {
    const { sql, store } = memorySettings([
      { key: "referral_flat_amount_cents", value: { amount_cents: 15000 } },
      { key: "referral_qualification_rule", value: { rule: "paid_invoices_gte", value: 2 } },
    ]);
    await routeAdminRequest(
      sql,
      ctx({
        method: "PATCH",
        path: "/admin-platform-settings/referral",
        body: {
          flat_amount_cents: 15000,
          qualification_rule: "paid_invoices_gte",
          qualification_value: 3,
        },
      }),
      logger,
    );
    expect(store.get("referral_flat_amount_cents")).toEqual({ flat_amount_cents: 15000 });
    expect(store.get("referral_qualification_rule")).toEqual({
      rule: "paid_invoices_gte",
      value: 3,
    });
  });

  it("422s a rule the SQL function does not understand instead of saving dead text", async () => {
    const { sql, store } = memorySettings();
    const res = await routeAdminRequest(
      sql,
      ctx({
        method: "PATCH",
        path: "/admin-platform-settings/referral",
        body: { flat_amount_cents: 20000, qualification_rule: "after the 2nd paid month" },
      }),
      logger,
    );
    expect(res.status).toBe(422);
    expect(store.get("referral_qualification_rule")).toEqual({
      rule: "paid_invoices_gte",
      value: 2,
    });
  });
});
