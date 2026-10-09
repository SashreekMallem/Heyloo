import { describe, expect, it } from "vitest";
import {
  OUTBOUND_EVENT_LABELS,
  OUTBOUND_EVENT_TYPES,
  OUTBOUND_TEST_MESSAGE,
  OUTBOUND_URL_PATTERN,
  zOutboundWebhookPayload,
  zTenantWebhooksRequest,
} from "./outbound-webhooks.js";

const TENANT = "0b6c2f3e-8f43-4a43-9d51-6a2d1c0e7f10";
const BOOKING = "4f1d6b7a-2c3e-4d5f-8a9b-0c1d2e3f4a5b";
const ORDER = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const CALL = "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e";
const DEST = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

const business = { id: TENANT, name: "Corner Bistro" };
const customer = { name: "Jordan Lee", phone: "+15551234567", email: null };

describe("outbound webhook payload v1", () => {
  it("accepts a booking event", () => {
    const parsed = zOutboundWebhookPayload.safeParse({
      type: "booking.created",
      timestamp: "2026-10-09T18:00:00.000Z",
      business,
      data: {
        id: BOOKING,
        status: "confirmed",
        start_at: "2026-10-10T17:00:00.000Z",
        end_at: "2026-10-10T18:00:00.000Z",
        timezone: "America/New_York",
        service: "Oil change",
        resource: null,
        party_size: null,
        notes: null,
        cancel_reason: null,
        customer,
        source_call_id: CALL,
        created_at: "2026-10-09T18:00:00.000Z",
        dashboard_url: `https://heyloo.app/dashboard/bookings?booking=${BOOKING}`,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an order event with integer cents and rejects fractional cents", () => {
    const order = {
      type: "order.created",
      timestamp: "2026-10-09T18:00:00.000Z",
      business,
      data: {
        id: ORDER,
        status: "received",
        fulfillment_type: "delivery",
        items: [{ name: "Burger", qty: 2, unit_price_cents: 1250, modifiers: ["no onions"] }],
        subtotal_cents: 2500,
        tax_cents: 200,
        tip_cents: 0,
        delivery_fee_cents: 500,
        total_cents: 3200,
        currency: "USD",
        allergies: ["peanuts"],
        special_instructions: null,
        delivery_address: { street: "1 Main St", city: "Springfield", state: "IL", zip: "62701" },
        customer,
        source_call_id: null,
        created_at: "2026-10-09T18:00:00.000Z",
        dashboard_url: `https://heyloo.app/dashboard/orders/${ORDER}`,
      },
    };
    expect(zOutboundWebhookPayload.safeParse(order).success).toBe(true);
    expect(
      zOutboundWebhookPayload.safeParse({ ...order, data: { ...order.data, total_cents: 32.5 } })
        .success,
    ).toBe(false);
  });

  it("requires E.164 phones and a non-empty message on message.taken", () => {
    const message = {
      type: "message.taken",
      timestamp: "2026-10-09T18:00:00.000Z",
      business,
      data: {
        id: CALL,
        caller: { name: "Sam", phone: "+15557654321" },
        message: "Please call me back about my order",
        callback_window: "after 3pm",
        created_at: "2026-10-09T18:00:00.000Z",
        dashboard_url: `https://heyloo.app/dashboard/calls/${CALL}`,
      },
    };
    expect(zOutboundWebhookPayload.safeParse(message).success).toBe(true);
    expect(
      zOutboundWebhookPayload.safeParse({
        ...message,
        data: { ...message.data, caller: { name: "Sam", phone: "555-765-4321" } },
      }).success,
    ).toBe(false);
    expect(
      zOutboundWebhookPayload.safeParse({ ...message, data: { ...message.data, message: "" } })
        .success,
    ).toBe(false);
  });

  it("accepts the test ping and nothing else under test.ping", () => {
    const ping = {
      type: "test.ping",
      timestamp: "2026-10-09T18:00:00.000Z",
      business,
      data: { message: OUTBOUND_TEST_MESSAGE },
    };
    expect(zOutboundWebhookPayload.safeParse(ping).success).toBe(true);
    expect(zOutboundWebhookPayload.safeParse({ ...ping, data: { message: "hello" } }).success).toBe(
      false,
    );
  });

  it("has an owner-facing label for every event type", () => {
    for (const type of OUTBOUND_EVENT_TYPES) expect(OUTBOUND_EVENT_LABELS[type]).toBeTruthy();
  });
});

describe("api-tenant-webhooks request body", () => {
  it("creates with https only and trims the name", () => {
    const ok = zTenantWebhooksRequest.safeParse({
      action: "create",
      name: "  Zapier  ",
      url: "https://hooks.zapier.com/hooks/catch/1/abc/",
    });
    expect(ok.success && ok.data.action === "create" && ok.data.name).toBe("Zapier");
    expect(
      zTenantWebhooksRequest.safeParse({ action: "create", name: "x", url: "http://a.example" })
        .success,
    ).toBe(false);
    expect(
      zTenantWebhooksRequest.safeParse({ action: "create", name: "", url: "https://a.example" })
        .success,
    ).toBe(false);
  });

  it("normalizes the URL so it always passes the table CHECK (^https://\\S+$, <= 2048)", () => {
    const url = (input: string) => {
      const parsed = zTenantWebhooksRequest.safeParse({ action: "create", name: "x", url: input });
      return parsed.success && parsed.data.action === "create" ? parsed.data.url : null;
    };
    expect(url("HTTPS://Example.com/hook")).toBe("https://example.com/hook");
    expect(url("https:example.com/hook")).toBe("https://example.com/hook");
    expect(url("https:/example.com/hook")).toBe("https://example.com/hook");
    expect(url("https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(url("https://a.example:443/x")).toBe("https://a.example/x");
    expect(url("https://hooks.zapier.com/hooks/catch/1/abc/")).toBe(
      "https://hooks.zapier.com/hooks/catch/1/abc/",
    );
    // Too long only once percent-encoded.
    expect(url(`https://a.example/${"\u00fc".repeat(400)}`)).toBeNull();
    expect(url("https://")).toBeNull();
    expect(OUTBOUND_URL_PATTERN.test("https://example.com/hook")).toBe(true);
    expect(OUTBOUND_URL_PATTERN.test("HTTPS://example.com/hook")).toBe(false);
  });

  it("rejects unknown, duplicate or empty event lists", () => {
    const base = { action: "create", name: "n8n", url: "https://n8n.example/webhook/x" };
    expect(zTenantWebhooksRequest.safeParse({ ...base, event_types: [] }).success).toBe(false);
    expect(
      zTenantWebhooksRequest.safeParse({ ...base, event_types: ["order.created", "order.created"] })
        .success,
    ).toBe(false);
    expect(zTenantWebhooksRequest.safeParse({ ...base, event_types: ["test.ping"] }).success).toBe(
      false,
    );
    expect(
      zTenantWebhooksRequest.safeParse({ ...base, event_types: ["order.created"] }).success,
    ).toBe(true);
  });

  it("parses every action and rejects a non-uuid id", () => {
    for (const body of [
      { action: "update", id: DEST, enabled: false },
      { action: "delete", id: DEST },
      { action: "rotate_secret", id: DEST },
      { action: "send_test", id: DEST },
      { action: "retry", delivery_id: DEST },
    ]) {
      expect(zTenantWebhooksRequest.safeParse(body).success, body.action).toBe(true);
    }
    expect(zTenantWebhooksRequest.safeParse({ action: "delete", id: "nope" }).success).toBe(false);
    expect(zTenantWebhooksRequest.safeParse({ action: "drop_table", id: DEST }).success).toBe(
      false,
    );
  });
});
