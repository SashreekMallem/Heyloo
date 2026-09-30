import { describe, expect, it, vi } from "vitest";
import {
  createBillingMeterEvent,
  createBillingPortalSession,
  createInvoiceItem,
  createMeter,
  formatMeterValue,
} from "./stripe.ts";

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
