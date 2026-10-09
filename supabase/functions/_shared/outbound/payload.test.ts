import { describe, expect, it } from "vitest";
import type { SqlClient } from "../types.ts";
import {
  type BookingPayloadRow,
  bookingData,
  buildOutboundPayload,
  finalizePayload,
  type MessagePayloadRow,
  messageData,
  type OrderPayloadRow,
  OutboundPayloadInvalidError,
  orderData,
} from "./payload.ts";

const TENANT = "0b6c2f3e-8f43-4a43-9d51-6a2d1c0e7f10";
const BOOKING = "4f1d6b7a-2c3e-4d5f-8a9b-0c1d2e3f4a5b";
const ORDER = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const CALL = "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e";
const EVENT = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const BASE = "https://heyloo.app/";

type Call = { text: string; values: unknown[] };
function recordingSql(answers: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [marker, rows] of Object.entries(answers)) {
      if (text.includes(marker)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const bookingRow: BookingPayloadRow = {
  id: BOOKING,
  status: "confirmed",
  // postgres.js returns timestamptz as Date objects.
  start_at: new Date("2026-10-10T17:00:00Z"),
  end_at: new Date("2026-10-10T18:00:00Z"),
  party_size: null,
  notes: "  ",
  cancel_reason: null,
  source_call_id: CALL,
  created_at: "2026-10-09T18:00:00+00:00",
  tenant_name: "Joe's Garage",
  timezone: "America/Chicago",
  service: "Oil change",
  resource: "Bay 2",
  customer_name: "Jordan Lee",
  customer_phone: "+15551234567",
  customer_email: "jordan@example.com",
};

const orderRow: OrderPayloadRow = {
  id: ORDER,
  status: "received",
  fulfillment_type: "delivery",
  items: [
    { offering_id: "x", name: "Burger", qty: 2, unit_price_cents: 1250, modifiers: ["no onions"] },
    { name: "Fries", qty: 1 },
  ],
  subtotal_cents: 2500,
  tax_cents: 206,
  tip_cents: 0,
  delivery_fee_cents: 499,
  total_cents: 3205,
  allergies: ["peanuts", ""],
  special_instructions: null,
  delivery_address: {
    address_id: "internal",
    street: "1 Main St",
    city: "Springfield",
    state: "IL",
    zip: "62701",
    set_as_default: true,
  },
  source_call_id: null,
  created_at: new Date("2026-10-09T18:00:00Z"),
  tenant_name: "Corner Bistro",
  customer_name: null,
  customer_phone: null,
  customer_email: null,
};

const messageRow: MessagePayloadRow = {
  id: CALL,
  message_text: "Please call me back about the estimate",
  caller_number: "+15550001111",
  structured_booking_payload: {
    caller_name: "Sam",
    caller_phone: "(555) 765-4321",
    callback_window: "after 3pm",
  },
  created_at: new Date("2026-10-09T18:00:00Z"),
  tenant_name: "Joe's Garage",
};

describe("row -> data", () => {
  it("maps a booking with ISO times, nulls for blanks and a deep link", () => {
    expect(bookingData(bookingRow, BASE)).toEqual({
      id: BOOKING,
      status: "confirmed",
      start_at: "2026-10-10T17:00:00.000Z",
      end_at: "2026-10-10T18:00:00.000Z",
      timezone: "America/Chicago",
      service: "Oil change",
      resource: "Bay 2",
      party_size: null,
      notes: null,
      cancel_reason: null,
      customer: { name: "Jordan Lee", phone: "+15551234567", email: "jordan@example.com" },
      source_call_id: CALL,
      created_at: "2026-10-09T18:00:00.000Z",
      dashboard_url: `https://heyloo.app/dashboard/bookings?booking=${BOOKING}`,
    });
  });

  it("maps an order: integer cents, items normalized, internal address keys dropped", () => {
    const data = orderData(orderRow, BASE);
    expect(data.items).toEqual([
      { name: "Burger", qty: 2, unit_price_cents: 1250, modifiers: ["no onions"] },
      { name: "Fries", qty: 1, unit_price_cents: null, modifiers: [] },
    ]);
    expect(data.delivery_address).toEqual({
      street: "1 Main St",
      city: "Springfield",
      state: "IL",
      zip: "62701",
    });
    expect(data.allergies).toEqual(["peanuts"]);
    expect(data.currency).toBe("USD");
    expect(data.total_cents).toBe(3205);
    expect(data.customer).toEqual({ name: null, phone: null, email: null });
    expect(data.dashboard_url).toBe(`https://heyloo.app/dashboard/orders/${ORDER}`);
  });

  it("returns a null address for pickup orders and empty address objects", () => {
    expect(orderData({ ...orderRow, delivery_address: null }, BASE).delivery_address).toBeNull();
    expect(orderData({ ...orderRow, delivery_address: {} }, BASE).delivery_address).toBeNull();
  });

  it("maps a taken message with the spoken callback number normalized to E.164", () => {
    expect(messageData(messageRow, BASE)).toEqual({
      id: CALL,
      caller: { name: "Sam", phone: "+15557654321" },
      message: "Please call me back about the estimate",
      callback_window: "after 3pm",
      created_at: "2026-10-09T18:00:00.000Z",
      dashboard_url: `https://heyloo.app/dashboard/calls/${CALL}`,
    });
  });

  it("falls back to the call's caller id, and to null when nothing normalizes", () => {
    expect(messageData({ ...messageRow, structured_booking_payload: null }, BASE)?.caller).toEqual({
      name: null,
      phone: "+15550001111",
    });
    expect(
      messageData(
        { ...messageRow, structured_booking_payload: { caller_phone: "12" }, caller_number: null },
        BASE,
      )?.caller.phone,
    ).toBeNull();
  });

  it("has nothing to send for an empty message", () => {
    expect(messageData({ ...messageRow, message_text: "   " }, BASE)).toBeNull();
  });
});

describe("finalizePayload", () => {
  it("rejects anything off-contract (never sends a malformed payload)", () => {
    expect(() =>
      finalizePayload({
        type: "order.created",
        timestamp: "2026-10-09T18:00:00.000Z",
        business: { id: TENANT, name: "x" },
        data: { ...orderData(orderRow, BASE), total_cents: 12.5 },
      }),
    ).toThrow(OutboundPayloadInvalidError);
  });
});

describe("buildOutboundPayload", () => {
  const event = {
    id: EVENT,
    tenant_id: TENANT,
    occurred_at: new Date("2026-10-09T18:00:00Z"),
  };

  it("builds a booking event from tenant-scoped joins", async () => {
    const { sql, calls } = recordingSql({ "from public.bookings b": [bookingRow] });
    const result = await buildOutboundPayload(
      sql,
      { ...event, event_type: "booking.created", entity_type: "booking", entity_id: BOOKING },
      BASE,
    );
    expect(result.status).toBe("built");
    if (result.status !== "built") return;
    expect(result.payload).toMatchObject({
      type: "booking.created",
      timestamp: "2026-10-09T18:00:00.000Z",
      business: { id: TENANT, name: "Joe's Garage" },
      data: { id: BOOKING, service: "Oil change" },
    });
    const query = calls[0];
    expect(query?.values).toEqual([BOOKING, TENANT]);
    // Every joined lookup is matched on the booking's own tenant.
    expect(query?.text).toContain("o.tenant_id = b.tenant_id");
    expect(query?.text).toContain("r.tenant_id = b.tenant_id");
    expect(query?.text).toContain("c.tenant_id = b.tenant_id");
  });

  it("builds an order event and a message event", async () => {
    const order = await buildOutboundPayload(
      recordingSql({ "from public.orders o": [orderRow] }).sql,
      { ...event, event_type: "order.updated", entity_type: "order", entity_id: ORDER },
      BASE,
    );
    expect(order.status === "built" && order.payload.type).toBe("order.updated");

    const { sql, calls } = recordingSql({ "from public.call_logs cl": [messageRow] });
    const message = await buildOutboundPayload(
      sql,
      { ...event, event_type: "message.taken", entity_type: "call_log", entity_id: CALL },
      BASE,
    );
    expect(message.status === "built" && message.payload.data).toMatchObject({ id: CALL });
    expect(calls[0]?.values).toEqual([CALL, TENANT]);
  });

  it("builds the test ping from the tenant name", async () => {
    const { sql, calls } = recordingSql({ "from public.tenants t": [{ tenant_name: "Shop" }] });
    const result = await buildOutboundPayload(
      sql,
      { ...event, event_type: "test.ping", entity_type: "test", entity_id: null },
      BASE,
    );
    expect(result).toEqual({
      status: "built",
      payload: {
        type: "test.ping",
        timestamp: "2026-10-09T18:00:00.000Z",
        business: { id: TENANT, name: "Shop" },
        data: { message: "This is a test event from Heyloo." },
      },
    });
    expect(calls[0]?.values).toEqual([TENANT]);
  });

  it("reports missing when the entity is gone (or another tenant's)", async () => {
    const { sql } = recordingSql({});
    for (const [event_type, entity_type, entity_id] of [
      ["booking.cancelled", "booking", BOOKING],
      ["order.created", "order", ORDER],
      ["message.taken", "call_log", CALL],
      ["order.created", "order", null],
    ] as const) {
      expect(
        await buildOutboundPayload(sql, { ...event, event_type, entity_type, entity_id }, BASE),
      ).toEqual({ status: "missing" });
    }
  });
});
