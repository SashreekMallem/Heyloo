import { describe, expect, it } from "vitest";
import type { AdapterConnectionCredentials, PushOrderParams } from "./adapter-types.js";
import { pushSquareBooking, pushSquareOrder } from "./booking.js";
import { SquareClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CONNECTION: AdapterConnectionCredentials = {
  accessToken: "token",
  metadata: { locationId: "loc_1", defaultTeamMemberId: "team_1" },
};

describe("pushSquareBooking", () => {
  it("creates a booking carrying the required location_id/team_member_id/service_variation_id fields", async () => {
    let capturedBody: unknown;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ booking: { id: "booking_1", status: "ACCEPTED" } });
    }) as unknown as typeof fetch;

    const client = new SquareClient({ fetchImpl });
    const result = await pushSquareBooking(client, CONNECTION, {
      idempotencyKey: "call_1:2026-09-10T14:00:00Z",
      startAt: "2026-09-10T14:00:00Z",
      endAt: "2026-09-10T14:30:00Z",
      customerName: "Jane Doe",
      customerPhoneE164: "+15551234567",
      serviceExternalId: "svc_1",
    });

    expect(result).toEqual({
      externalId: "booking_1",
      status: "confirmed",
      deduped: false,
      raw: expect.any(Object),
    });
    expect(capturedBody).toMatchObject({
      idempotency_key: "call_1:2026-09-10T14:00:00Z",
      booking: {
        location_id: "loc_1",
        start_at: "2026-09-10T14:00:00Z",
        appointment_segments: [
          { team_member_id: "team_1", service_variation_id: "svc_1", service_variation_version: 1 },
        ],
      },
    });
  });

  it("throws a validation error rather than silently omitting a required field", async () => {
    const client = new SquareClient({
      fetchImpl: (async () => jsonResponse({})) as unknown as typeof fetch,
    });
    await expect(
      pushSquareBooking(
        client,
        { accessToken: "token" },
        {
          idempotencyKey: "k",
          startAt: "2026-09-10T14:00:00Z",
          endAt: "2026-09-10T14:30:00Z",
          customerName: "Jane",
          customerPhoneE164: "+15551234567",
        },
      ),
    ).rejects.toThrow(/requires accessToken|location_id/i);
  });
});

describe("pushSquareOrder", () => {
  const baseParams: PushOrderParams = {
    idempotencyKey: "order-key-1",
    items: [{ name: "Burger", qty: 2, unitPriceCents: 899 }],
    fulfillmentType: "pickup",
    totalCents: 1798,
    customerName: "Jane Doe",
  };

  it("builds a PICKUP fulfillment for a pickup order", async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ order: { id: "order_1" } });
    }) as unknown as typeof fetch;
    const client = new SquareClient({ fetchImpl });

    const result = await pushSquareOrder(client, CONNECTION, baseParams);
    expect(result.externalId).toBe("order_1");
    expect(capturedBody.order.fulfillments).toEqual([
      { type: "PICKUP", pickup_details: { recipient: { display_name: "Jane Doe" } } },
    ]);
    expect(capturedBody.order.line_items).toEqual([
      { name: "Burger", quantity: "2", base_price_money: { amount: 899, currency: "USD" } },
    ]);
  });

  it("builds a DELIVERY fulfillment (a different shape from pickup) for a delivery order", async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ order: { id: "order_2" } });
    }) as unknown as typeof fetch;
    const client = new SquareClient({ fetchImpl });

    await pushSquareOrder(client, CONNECTION, {
      ...baseParams,
      fulfillmentType: "delivery",
      customerPhoneE164: "+15551234567",
      deliveryAddress: { address_line_1: "42 Oak St" },
    });

    expect(capturedBody.order.fulfillments).toEqual([
      {
        type: "DELIVERY",
        delivery_details: {
          recipient: {
            display_name: "Jane Doe",
            phone_number: "+15551234567",
            address: { address_line_1: "42 Oak St" },
          },
        },
      },
    ]);
  });

  it("omits fulfillments entirely for a dine-in order (Square has no native dine-in fulfillment type)", async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ order: { id: "order_3" } });
    }) as unknown as typeof fetch;
    const client = new SquareClient({ fetchImpl });

    await pushSquareOrder(client, CONNECTION, { ...baseParams, fulfillmentType: "dine_in" });
    expect(capturedBody.order.fulfillments).toBeUndefined();
  });
});
