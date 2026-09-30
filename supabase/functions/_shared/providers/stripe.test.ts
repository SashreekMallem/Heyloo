import { describe, expect, it, vi } from "vitest";
import { createBillingPortalSession, createMeter } from "./stripe.ts";

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
