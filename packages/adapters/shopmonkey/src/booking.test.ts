import { describe, expect, it } from "vitest";
import { pushShopmonkeyBooking } from "./booking.js";
import { ShopmonkeyClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PARAMS = {
  idempotencyKey: "call_1:slot_1",
  startAt: "2026-09-10T14:00:00Z",
  endAt: "2026-09-10T15:00:00Z",
  customerName: "Jane Doe",
  customerPhoneE164: "+15551234567",
  serviceExternalId: "rate_1",
  resourceExternalId: "bay_1",
};

describe("pushShopmonkeyBooking", () => {
  it("reuses an existing customer found by phone", async () => {
    const client = new ShopmonkeyClient({
      fetchImpl: (async (url: unknown) => {
        const path = String(url);
        if (path.includes("/customer?")) return jsonResponse({ data: [{ id: "cust_1" }] });
        return jsonResponse({ id: "appt_1", status: "confirmed" });
      }) as unknown as typeof fetch,
    });

    const result = await pushShopmonkeyBooking(client, { accessToken: "key" }, PARAMS);
    expect(result).toEqual({
      externalId: "appt_1",
      status: "confirmed",
      deduped: false,
      raw: expect.any(Object),
    });
  });

  it("creates a customer when none matches", async () => {
    let createdBody: any;
    const client = new ShopmonkeyClient({
      fetchImpl: (async (url: unknown, init: any) => {
        const path = String(url);
        if (path.includes("/customer?")) return jsonResponse({ data: [] });
        if (path.endsWith("/customer")) {
          createdBody = JSON.parse(init.body);
          return jsonResponse({ id: "cust_2" });
        }
        return jsonResponse({ id: "appt_2", status: "confirmed" });
      }) as unknown as typeof fetch,
    });

    await pushShopmonkeyBooking(client, { accessToken: "key" }, PARAMS);
    expect(createdBody).toMatchObject({ name: "Jane Doe", phone: "+15551234567" });
  });

  it("throws when the connection has no pasted API key", async () => {
    const client = new ShopmonkeyClient({});
    await expect(pushShopmonkeyBooking(client, {}, PARAMS)).rejects.toThrow(/accessToken/);
  });
});
