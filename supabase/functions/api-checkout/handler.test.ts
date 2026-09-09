import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleCheckout } from "./handler.ts";

const logger = createLogger();

function makeDeps(overrides: Partial<Parameters<typeof handleCheckout>[3]> = {}) {
  return {
    stripeFetch: (async () =>
      new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }), {
        status: 200,
      })) as never,
    stripeSecretKey: "sk_test",
    successUrl: "https://heyloo.app/success",
    cancelUrl: "https://heyloo.app/cancel",
    randomSuffix: () => "abcd1234",
    logger,
    ...overrides,
  };
}

const VALID_BODY = {
  vertical: "auto",
  business_name: "Joe's Auto",
  email: "joe@example.com",
};

describe("handleCheckout", () => {
  it("rejects an invalid request body", async () => {
    const sql = (() => Promise.resolve([])) as SqlClient;
    const result = await handleCheckout(sql, "user-1", { vertical: "not_a_vertical" }, makeDeps());
    expect(result).toEqual({ ok: false, status: 422, error: "invalid_request" });
  });

  it("returns stripe_not_configured when the price card has no Stripe price ids yet", async () => {
    const sql = (() => Promise.resolve([{ value: { base_cents: 29900 } }])) as SqlClient;
    const result = await handleCheckout(sql, "user-1", VALID_BODY, makeDeps());
    expect(result).toEqual({ ok: false, status: 500, error: "stripe_not_configured" });
  });

  it("creates a new trialing tenant + owner membership, then a checkout session", async () => {
    const calls: unknown[][] = [];
    const sql = ((_s: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      if (calls.length === 1) {
        // price card lookup
        return Promise.resolve([
          {
            value: {
              base_cents: 29900,
              included_minutes: 300,
              overage_cents: 35,
              stripe_base_price_id: "price_base",
              stripe_meter_price_id: "price_meter",
            },
          },
        ]);
      }
      if (calls.length === 2) return Promise.resolve([]); // no existing trialing tenant
      if (calls.length === 3) return Promise.resolve([{ id: "tenant-1" }]); // insert tenants
      return Promise.resolve([]); // insert membership
    }) as SqlClient;

    const result = await handleCheckout(sql, "user-1", VALID_BODY, makeDeps());
    expect(result).toEqual({
      ok: true,
      tenant_id: "tenant-1",
      checkout_url: "https://checkout.stripe.com/cs_1",
    });
    // slug is business_name-slugified + randomSuffix
    const insertValues = calls[2];
    expect(insertValues).toContain("joe-s-auto-abcd1234");
  });

  it("reuses an existing not-yet-paid trialing tenant instead of creating a second one", async () => {
    const calls: unknown[][] = [];
    const sql = ((_s: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      if (calls.length === 1) {
        return Promise.resolve([
          {
            value: {
              base_cents: 29900,
              included_minutes: 300,
              overage_cents: 35,
              stripe_base_price_id: "price_base",
              stripe_meter_price_id: "price_meter",
            },
          },
        ]);
      }
      if (calls.length === 2) return Promise.resolve([{ id: "existing-tenant" }]);
      return Promise.resolve([]);
    }) as SqlClient;

    const result = await handleCheckout(sql, "user-1", VALID_BODY, makeDeps());
    expect(result).toEqual({
      ok: true,
      tenant_id: "existing-tenant",
      checkout_url: "https://checkout.stripe.com/cs_1",
    });
    expect(calls).toHaveLength(2); // no insert tenants / insert membership calls
  });

  it("surfaces a checkout_session_create_failed error when Stripe rejects the session", async () => {
    const sql = ((_s: TemplateStringsArray, ...values: unknown[]) => {
      if (values.length === 0) return Promise.resolve([]);
      return Promise.resolve([
        {
          value: {
            base_cents: 29900,
            included_minutes: 300,
            overage_cents: 35,
            stripe_base_price_id: "price_base",
            stripe_meter_price_id: "price_meter",
          },
        },
      ]);
    }) as SqlClient;
    const failingSql = (() => Promise.resolve([{ id: "tenant-1" }])) as SqlClient;
    let call = 0;
    const combinedSql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      call += 1;
      if (call === 1) return sql(strings, ...values);
      if (call === 2) return Promise.resolve([]);
      return failingSql(strings, ...values);
    }) as SqlClient;

    const result = await handleCheckout(
      combinedSql,
      "user-1",
      VALID_BODY,
      makeDeps({
        stripeFetch: (async () => new Response("{}", { status: 402 })) as never,
      }),
    );
    expect(result).toEqual({ ok: false, status: 502, error: "checkout_session_create_failed" });
  });
});
