import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { billOneTenant, previousCalendarMonth } from "./handler.ts";

const logger = createLogger();

describe("previousCalendarMonth", () => {
  it("computes the prior month's [start, end) date range", () => {
    expect(previousCalendarMonth(new Date("2026-03-15T00:00:00Z"))).toEqual({
      periodStart: "2026-02-01",
      periodEnd: "2026-03-01",
    });
  });

  it("handles a January cutover correctly (wraps to the prior year)", () => {
    expect(previousCalendarMonth(new Date("2026-01-15T00:00:00Z"))).toEqual({
      periodStart: "2025-12-01",
      periodEnd: "2026-01-01",
    });
  });
});

describe("billOneTenant", () => {
  const row = {
    tenant_id: "t1",
    stripe_customer_id: "cus_1",
    vertical: "auto",
    price_version: "v1",
    base_cents: 9900,
    included_minutes: 500,
    overage_cents_per_minute: 20,
    billable_minutes: 600,
  };

  it("computes overage and writes a draft invoice, reporting a Stripe meter event", async () => {
    const calls: unknown[][] = [];
    const sql = ((_s: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      return Promise.resolve([{ id: "inv_1" }]);
    }) as SqlClient;
    let meterReported = false;
    const inserted = await billOneTenant(sql, row, "2026-02-01", "2026-03-01", {
      stripeFetch: (() => {
        meterReported = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as never,
      stripeSecretKey: "sk_test",
      billingMeterEventName: "voice_minutes",
      logger,
    });
    expect(meterReported).toBe(true);
    expect(inserted).toBe(true);
    // overage = 600 - 500 = 100 minutes * 20 cents = 2000; total = 9900 + 2000 = 11900
    const insertValues = calls.at(-1);
    expect(insertValues).toContain(2000);
    expect(insertValues).toContain(11900);
  });

  it("still writes the invoice row when the Stripe meter report fails (never silently drops billing data)", async () => {
    const sql = (() => Promise.resolve([{ id: "inv_1" }])) as SqlClient;
    const inserted = await billOneTenant(sql, row, "2026-02-01", "2026-03-01", {
      stripeFetch: (() => Promise.resolve(new Response("{}", { status: 500 }))) as never,
      stripeSecretKey: "sk_test",
      billingMeterEventName: "voice_minutes",
      logger,
    });
    expect(inserted).toBe(true);
  });

  it("returns false when the invoice already exists (idempotent no-op on conflict)", async () => {
    const sql = (() => Promise.resolve([])) as SqlClient; // ON CONFLICT DO NOTHING -> no row
    const inserted = await billOneTenant(sql, row, "2026-02-01", "2026-03-01", {
      stripeFetch: (() => Promise.resolve(new Response("{}", { status: 200 }))) as never,
      stripeSecretKey: "sk_test",
      billingMeterEventName: "voice_minutes",
      logger,
    });
    expect(inserted).toBe(false);
  });
});
