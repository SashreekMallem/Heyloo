import { describe, expect, it, vi } from "vitest";
import { createMeter } from "./stripe.ts";

describe("createMeter", () => {
  it("sends the required default_aggregation (sum) with the meter fields", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ id: "mtr_test_1" }) }) as unknown as Response,
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
