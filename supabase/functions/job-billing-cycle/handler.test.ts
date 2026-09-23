import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { billOneTenant, computeInvoiceAmounts, previousCalendarMonth } from "./handler.ts";

const logger = createLogger();

describe("computeInvoiceAmounts (pure, no Stripe call — QA-BILL deliverable 2)", () => {
  it("computes plan base fee + rounded per-minute overage in integer cents, hand-calculated against a price card", () => {
    // Hand calculation from platform_settings.price_card_auto (live project,
    // 2026-09-23): base_cents=29900, included_minutes=300, overage_cents=35.
    // 412 billable minutes -> 112 overage minutes * 35 cents = 3920 cents
    // overage; total = 29900 + 3920 = 33820.
    const result = computeInvoiceAmounts({
      base_cents: 29900,
      included_minutes: 300,
      overage_cents_per_minute: 35,
      billable_minutes: 412,
    });
    expect(result).toEqual({ overageMinutes: 112, overageCents: 3920, totalCents: 33820 });
  });

  it("never goes negative when usage is under the included allowance (no overage)", () => {
    const result = computeInvoiceAmounts({
      base_cents: 29900,
      included_minutes: 300,
      overage_cents_per_minute: 35,
      billable_minutes: 120,
    });
    expect(result).toEqual({ overageMinutes: 0, overageCents: 0, totalCents: 29900 });
  });

  it("rounds fractional overage cents to the nearest integer cent (money in integer cents, CLAUDE.md Rule 2)", () => {
    // 0.5 overage minutes * 35 cents = 17.5 -> rounds to 18.
    const result = computeInvoiceAmounts({
      base_cents: 0,
      included_minutes: 300,
      overage_cents_per_minute: 35,
      billable_minutes: 300.5,
    });
    expect(result.overageCents).toBe(18);
  });
});

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

  it("skips the Stripe meter report and never crashes when STRIPE_SECRET_KEY/STRIPE_METER_EVENT_NAME are unset (QA-BILL — Stripe not configured on this platform)", async () => {
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join(" "), values });
      return Promise.resolve([{ id: "inv_1" }]);
    }) as SqlClient;
    let stripeCalled = false;
    const inserted = await billOneTenant(sql, row, "2026-02-01", "2026-03-01", {
      stripeFetch: (() => {
        stripeCalled = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as never,
      stripeSecretKey: undefined,
      billingMeterEventName: undefined,
      logger,
    });
    expect(stripeCalled).toBe(false);
    expect(inserted).toBe(true);
    // Draft invoice still written with the correct computed amounts — never
    // silently dropped, and never marked paid, just because Stripe isn't
    // configured (CLAUDE.md Rule 2: "never mark anything paid, never crash").
    const insertCall = calls.at(-1);
    expect(insertCall?.text).toContain("'draft'");
    expect(insertCall?.values).toContain(2000);
    expect(insertCall?.values).toContain(11900);
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
