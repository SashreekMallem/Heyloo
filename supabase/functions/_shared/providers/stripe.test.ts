import { describe, expect, it, vi } from "vitest";
import {
  createBillingMeterEvent,
  createBillingPortalSession,
  createInvoiceItem,
  createMeter,
  createSubscriptionCheckoutSession,
  endSubscriptionTrialNow,
  formatMeterValue,
  retrieveSubscriptionTrialState,
} from "./stripe.ts";

function jsonFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as unknown as Response,
  );
}

const CHECKOUT_BASE = {
  customerEmail: "owner@example.com",
  basePriceId: "price_base",
  meteredPriceId: "price_meter",
  successUrl: "https://heyloo.app/s",
  cancelUrl: "https://heyloo.app/c",
  metadata: { tenant_id: "t1" },
};

describe("createSubscriptionCheckoutSession trial (TRIAL-1)", () => {
  it("sends subscription_data[trial_period_days] and payment_method_collection=always", async () => {
    const fetchImpl = jsonFetch(200, { id: "cs_1", url: "https://checkout.stripe.com/x" });
    await createSubscriptionCheckoutSession(fetchImpl, "sk_test_x", {
      ...CHECKOUT_BASE,
      trialPeriodDays: 7,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("subscription_data[trial_period_days]")).toBe("7");
    expect(body.get("payment_method_collection")).toBe("always");
    expect(body.get("subscription_data[metadata][tenant_id]")).toBe("t1");
  });

  it("sends no trial fields without a trial", async () => {
    const fetchImpl = jsonFetch(200, { id: "cs_1", url: "https://checkout.stripe.com/x" });
    await createSubscriptionCheckoutSession(fetchImpl, "sk_test_x", CHECKOUT_BASE);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("subscription_data[trial_period_days]")).toBeNull();
    expect(body.get("payment_method_collection")).toBeNull();
  });

  it.each([0, 731, 2.5, Number.NaN])(
    "rejects trialPeriodDays=%s before calling Stripe",
    async (days) => {
      const fetchImpl = jsonFetch(200, {});
      await expect(
        createSubscriptionCheckoutSession(fetchImpl, "sk_test_x", {
          ...CHECKOUT_BASE,
          trialPeriodDays: days,
        }),
      ).rejects.toThrow(RangeError);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});

describe("subscription trial state (TRIAL-1)", () => {
  it("retrieveSubscriptionTrialState GETs the subscription and validates the slice it needs", async () => {
    const fetchImpl = jsonFetch(200, {
      id: "sub_1",
      object: "subscription",
      status: "trialing",
      trial_end: 1_790_604_800,
      cancel_at_period_end: true,
      cancel_at: 1_790_604_800,
      items: { data: [] },
    });
    const result = await retrieveSubscriptionTrialState(fetchImpl, "sk_test_x", "sub_1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_1");
    expect(init.method).toBe("GET");
    // bounded: a hung Stripe request cannot hold the background task
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      ok: true,
      subscription: {
        id: "sub_1",
        status: "trialing",
        trialEnd: 1_790_604_800,
        cancelAtPeriodEnd: true,
        cancelAt: 1_790_604_800,
      },
    });
  });

  it("endSubscriptionTrialNow POSTs trial_end=now with the idempotency key", async () => {
    const fetchImpl = jsonFetch(200, {
      id: "sub_1",
      status: "active",
      trial_end: 1_790_100_000,
      cancel_at_period_end: false,
      cancel_at: null,
    });
    const result = await endSubscriptionTrialNow(fetchImpl, "sk_test_x", "sub_1", {
      idempotencyKey: "trial-cap:sub_1:2026101112",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_1");
    expect(init.method).toBe("POST");
    expect(new URLSearchParams(String(init.body)).get("trial_end")).toBe("now");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "trial-cap:sub_1:2026101112",
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      ok: true,
      subscription: {
        id: "sub_1",
        status: "active",
        trialEnd: 1_790_100_000,
        cancelAtPeriodEnd: false,
        cancelAt: null,
      },
    });
  });

  it("a subscription with no trial reads trialEnd null", async () => {
    const result = await retrieveSubscriptionTrialState(
      jsonFetch(200, {
        id: "sub_1",
        status: "active",
        trial_end: null,
        cancel_at_period_end: false,
      }),
      "sk_test_x",
      "sub_1",
    );
    expect(result).toEqual({
      ok: true,
      subscription: {
        id: "sub_1",
        status: "active",
        trialEnd: null,
        cancelAtPeriodEnd: false,
        cancelAt: null,
      },
    });
  });

  it("a body that does not say whether a cancellation is pending is a failure", async () => {
    const result = await retrieveSubscriptionTrialState(
      jsonFetch(200, { id: "sub_1", status: "trialing", trial_end: 1_790_604_800 }),
      "sk_test_x",
      "sub_1",
    );
    expect(result).toEqual({ ok: false, status: 200, error: "unexpected_response" });
  });

  it("a timeout or network error is a failure with status 0, never a throw", async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(await retrieveSubscriptionTrialState(timeout, "sk_test_x", "sub_1")).toEqual({
      ok: false,
      status: 0,
      error: "timeout",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(
      await endSubscriptionTrialNow(offline, "sk_test_x", "sub_1", { idempotencyKey: "k" }),
    ).toEqual({ ok: false, status: 0, error: "network_error" });
  });

  it("an unexpected body is a failure, never a guess", async () => {
    const result = await retrieveSubscriptionTrialState(
      jsonFetch(200, { id: "sub_1", status: "mystery" }),
      "sk_test_x",
      "sub_1",
    );
    expect(result).toEqual({ ok: false, status: 200, error: "unexpected_response" });
  });

  it("surfaces the Stripe error code on a non-2xx", async () => {
    const result = await endSubscriptionTrialNow(
      jsonFetch(400, { error: { type: "invalid_request_error", code: "resource_missing" } }),
      "sk_test_x",
      "sub_missing",
      { idempotencyKey: "k" },
    );
    expect(result).toEqual({ ok: false, status: 400, error: "resource_missing" });
  });
});

describe("createBillingPortalSession (QA-1 SEC-08)", () => {
  it("posts customer and return_url to /billing_portal/sessions", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ id: "bps_1", url: "https://billing.stripe.com/p/session/x" }),
        }) as unknown as Response,
    );
    const res = await createBillingPortalSession(fetchImpl, "sk_test_x", {
      customerId: "cus_1",
      returnUrl: "https://app.example/dashboard/billing",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("customer")).toBe("cus_1");
    expect(body.get("return_url")).toBe("https://app.example/dashboard/billing");
    expect(res.body).toMatchObject({ url: "https://billing.stripe.com/p/session/x" });
  });
});

describe("createMeter", () => {
  it("sends the required default_aggregation (sum) with the meter fields", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ id: "mtr_test_1" }),
        }) as unknown as Response,
    );

    await createMeter(fetchImpl, "sk_test_x", {
      displayName: "Heyloo call minutes",
      eventName: "heyloo_call_minutes",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/billing/meters");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("default_aggregation[formula]")).toBe("sum");
    expect(body.get("event_name")).toBe("heyloo_call_minutes");
    expect(body.get("customer_mapping[type]")).toBe("by_id");
    expect(body.get("customer_mapping[event_payload_key]")).toBe("stripe_customer_id");
    expect(body.get("value_settings[event_payload_key]")).toBe("value");
  });
});

describe("formatMeterValue (BILL-1: Stripe rejects > 12 decimals or > 15 digits)", () => {
  it.each([
    ["250.500000000000000", "250.5"],
    ["300.000000000000005", "300"],
    [3.566666666666667, "3.566667"],
    [1.3333333333333333, "1.333333"],
    [0, "0"],
    [112, "112"],
    [0.1 + 0.2, "0.3"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatMeterValue(input)).toBe(expected);
  });

  it("never emits more than 12 decimals or 15 digits, nor exponent form", () => {
    for (const n of [123456789.12345679, 999999999999.9999, 1e-9, 0.0000004]) {
      const out = formatMeterValue(n);
      expect(out).toMatch(/^\d+(\.\d+)?$/);
      expect(out.replace(".", "").length).toBeLessThanOrEqual(15);
      expect((out.split(".")[1] ?? "").length).toBeLessThanOrEqual(12);
    }
  });

  it("rejects negative, non-finite and absurdly large values instead of sending them", () => {
    expect(() => formatMeterValue(-1)).toThrow(RangeError);
    expect(() => formatMeterValue(Number.NaN)).toThrow(RangeError);
    expect(() => formatMeterValue(1e16)).toThrow(RangeError);
  });
});

describe("createBillingMeterEvent / createInvoiceItem / createBillingPortalSession", () => {
  const okFetch = () =>
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response);

  it("formats the value and passes the timestamp", async () => {
    const f = okFetch();
    await createBillingMeterEvent(f, "sk", {
      eventName: "m",
      stripeCustomerId: "cus_1",
      value: 3.566666666666667,
      identifier: "id1",
      timestamp: 1790812799.9,
    });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("payload[value]")).toBe("3.566667");
    expect(body.get("timestamp")).toBe("1790812799");
  });

  it("sends the Idempotency-Key header on invoice items only when given", async () => {
    const f = okFetch();
    await createInvoiceItem(f, "sk", {
      customerId: "cus_1",
      amountCents: 300,
      currency: "usd",
      description: "d",
      periodStart: 1,
      periodEnd: 2,
      idempotencyKey: "k1",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/invoiceitems");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
    expect(new URLSearchParams(String(init.body)).get("period[end]")).toBe("2");
  });

  it("creates a billing portal session for the customer", async () => {
    const f = okFetch();
    await createBillingPortalSession(f, "sk", { customerId: "cus_1", returnUrl: "https://x/y" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/billing_portal/sessions");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("customer")).toBe("cus_1");
    expect(body.get("return_url")).toBe("https://x/y");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });
});
