import * as canonical from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import type { ZodObject } from "zod";
import * as mirror from "./outbound-webhooks.ts";

/**
 * OUTBOUND-1: the Deno runtime can't import `@heyloo/canonical-types`, so
 * `outbound-webhooks.ts` mirrors `packages/canonical-types/src/
 * outbound-webhooks.ts`. This diffs the two (same convention as
 * `providers/messaging/canonical-parity.test.ts`): enum values, object key
 * sets (recursively for nested objects), each field's optional-ness, and the
 * same accept/reject samples through both payload and request schemas.
 */

const ENUMS: Array<[string, readonly string[], readonly string[]]> = [
  ["OUTBOUND_EVENT_TYPES", canonical.OUTBOUND_EVENT_TYPES, mirror.OUTBOUND_EVENT_TYPES],
  ["OUTBOUND_ALL_EVENT_TYPES", canonical.OUTBOUND_ALL_EVENT_TYPES, mirror.OUTBOUND_ALL_EVENT_TYPES],
  ["OUTBOUND_ENTITY_TYPES", canonical.OUTBOUND_ENTITY_TYPES, mirror.OUTBOUND_ENTITY_TYPES],
  [
    "OUTBOUND_DELIVERY_STATUSES",
    canonical.OUTBOUND_DELIVERY_STATUSES,
    mirror.OUTBOUND_DELIVERY_STATUSES,
  ],
  [
    "OUTBOUND_DISABLED_REASONS",
    canonical.OUTBOUND_DISABLED_REASONS,
    mirror.OUTBOUND_DISABLED_REASONS,
  ],
  [
    "OUTBOUND_BOOKING_STATUSES",
    canonical.OUTBOUND_BOOKING_STATUSES,
    mirror.OUTBOUND_BOOKING_STATUSES,
  ],
  ["OUTBOUND_ORDER_STATUSES", canonical.OUTBOUND_ORDER_STATUSES, mirror.OUTBOUND_ORDER_STATUSES],
  ["FULFILLMENT_TYPES", canonical.FULFILLMENT_TYPES, mirror.OUTBOUND_FULFILLMENT_TYPES],
];

const OBJECTS: Array<[string, ZodObject, ZodObject]> = [
  ["Business", canonical.zOutboundBusiness, mirror.zOutboundBusiness],
  ["Customer", canonical.zOutboundCustomer, mirror.zOutboundCustomer],
  ["BookingData", canonical.zOutboundBookingData, mirror.zOutboundBookingData],
  ["OrderItem", canonical.zOutboundOrderItem, mirror.zOutboundOrderItem],
  ["DeliveryAddress", canonical.zOutboundDeliveryAddress, mirror.zOutboundDeliveryAddress],
  ["OrderData", canonical.zOutboundOrderData, mirror.zOutboundOrderData],
  ["MessageCaller", canonical.zOutboundMessageCaller, mirror.zOutboundMessageCaller],
  ["MessageData", canonical.zOutboundMessageData, mirror.zOutboundMessageData],
  ["TestData", canonical.zOutboundTestData, mirror.zOutboundTestData],
  ["BookingEvent", canonical.zOutboundBookingEvent, mirror.zOutboundBookingEvent],
  ["OrderEvent", canonical.zOutboundOrderEvent, mirror.zOutboundOrderEvent],
  ["MessageEvent", canonical.zOutboundMessageEvent, mirror.zOutboundMessageEvent],
  ["TestEvent", canonical.zOutboundTestEvent, mirror.zOutboundTestEvent],
];

function isOptional(schema: unknown): boolean {
  return (schema as { safeParse: (v: unknown) => { success: boolean } }).safeParse(undefined)
    .success;
}

const TENANT = "0b6c2f3e-8f43-4a43-9d51-6a2d1c0e7f10";
const ID = "4f1d6b7a-2c3e-4d5f-8a9b-0c1d2e3f4a5b";
const business = { id: TENANT, name: "Corner Bistro" };
const customer = { name: "Jordan", phone: "+15551234567", email: "j@example.com" };
const booking = {
  type: "booking.updated",
  timestamp: "2026-10-09T18:00:00.000Z",
  business,
  data: {
    id: ID,
    status: "confirmed",
    start_at: "2026-10-10T17:00:00.000Z",
    end_at: "2026-10-10T18:00:00+00:00",
    timezone: "America/Chicago",
    service: null,
    resource: "Bay 2",
    party_size: 4,
    notes: "window seat",
    cancel_reason: null,
    customer,
    source_call_id: null,
    created_at: "2026-10-09T18:00:00.000Z",
    dashboard_url: `https://heyloo.app/dashboard/bookings?booking=${ID}`,
  },
};
const order = {
  type: "order.cancelled",
  timestamp: "2026-10-09T18:00:00.000Z",
  business,
  data: {
    id: ID,
    status: "cancelled",
    fulfillment_type: "pickup",
    items: [{ name: "Tacos", qty: 3, unit_price_cents: null, modifiers: [] }],
    subtotal_cents: 900,
    tax_cents: 0,
    tip_cents: 0,
    delivery_fee_cents: 0,
    total_cents: 900,
    currency: "USD",
    allergies: [],
    special_instructions: "extra salsa",
    delivery_address: null,
    customer: { name: null, phone: null, email: null },
    source_call_id: ID,
    created_at: "2026-10-09T18:00:00.000Z",
    dashboard_url: `https://heyloo.app/dashboard/orders/${ID}`,
  },
};
const message = {
  type: "message.taken",
  timestamp: "2026-10-09T18:00:00.000Z",
  business,
  data: {
    id: ID,
    caller: { name: null, phone: "+15557654321" },
    message: "Call me",
    callback_window: null,
    created_at: "2026-10-09T18:00:00.000Z",
    dashboard_url: `https://heyloo.app/dashboard/calls/${ID}`,
  },
};
const ping = {
  type: "test.ping",
  timestamp: "2026-10-09T18:00:00.000Z",
  business,
  data: { message: "This is a test event from Heyloo." },
};

const PAYLOAD_SAMPLES: unknown[] = [
  booking,
  order,
  message,
  ping,
  { ...booking, type: "booking.deleted" },
  { ...booking, data: { ...booking.data, status: "pending" } },
  { ...booking, data: { ...booking.data, start_at: "2026-10-10 17:00" } },
  { ...order, data: { ...order.data, tip_cents: -1 } },
  { ...order, data: { ...order.data, currency: "EUR" } },
  {
    ...order,
    data: { ...order.data, items: [{ name: "x", qty: 0, unit_price_cents: 1, modifiers: [] }] },
  },
  { ...message, data: { ...message.data, caller: { name: "x", phone: "5551234567" } } },
  { ...ping, data: { message: "hi" } },
  { ...ping, business: { id: "not-a-uuid", name: "x" } },
  { ...message, type: "order.created" },
];

const REQUEST_SAMPLES: unknown[] = [
  { action: "create", name: "Zapier", url: "https://hooks.zapier.com/hooks/catch/1/a/" },
  { action: "create", name: " ", url: "https://a.example" },
  { action: "create", name: "x".repeat(81), url: "https://a.example" },
  { action: "create", name: "x", url: "http://a.example" },
  { action: "create", name: "x", url: `https://a.example/${"p".repeat(2050)}` },
  { action: "create", name: "x", url: "https://a.example", event_types: ["message.taken"] },
  { action: "create", name: "x", url: "https://a.example", event_types: ["test.ping"] },
  { action: "update", id: ID, enabled: true, event_types: ["order.created", "order.updated"] },
  { action: "update", id: ID, url: "ftp://a.example" },
  // Normalized to the href the table CHECK accepts (review: these used to
  // pass the schema and then fail the CHECK with a 500).
  { action: "create", name: "x", url: "HTTPS://Example.com/hook" },
  { action: "create", name: "x", url: "https:example.com/hook" },
  { action: "create", name: "x", url: "https:/example.com/hook" },
  { action: "create", name: "x", url: "https://example.com/a b" },
  { action: "create", name: "x", url: `https://a.example/${"\u00fc".repeat(400)}` },
  { action: "update", id: ID, url: "https://" },
  { action: "delete", id: ID },
  { action: "rotate_secret", id: "1" },
  { action: "send_test", id: ID },
  { action: "retry", delivery_id: ID },
  { action: "retry", id: ID },
  { action: "unknown" },
];

describe("outbound webhook schemas mirror @heyloo/canonical-types", () => {
  it.each(ENUMS)("%s has identical values", (_name, a, b) => {
    expect([...b]).toEqual([...a]);
  });

  it("has the same constants and labels", () => {
    expect(mirror.OUTBOUND_TEST_EVENT_TYPE).toBe(canonical.OUTBOUND_TEST_EVENT_TYPE);
    expect(mirror.OUTBOUND_TEST_MESSAGE).toBe(canonical.OUTBOUND_TEST_MESSAGE);
    expect(mirror.OUTBOUND_MAX_DESTINATIONS).toBe(canonical.OUTBOUND_MAX_DESTINATIONS);
    expect(mirror.OUTBOUND_DESTINATION_NAME_MAX).toBe(canonical.OUTBOUND_DESTINATION_NAME_MAX);
    expect(mirror.OUTBOUND_URL_MAX).toBe(canonical.OUTBOUND_URL_MAX);
    expect(mirror.OUTBOUND_EVENT_LABELS).toEqual(canonical.OUTBOUND_EVENT_LABELS);
  });

  it.each(OBJECTS)("%s has identical keys and optional-ness", (_name, a, b) => {
    expect(Object.keys(b.shape).sort()).toEqual(Object.keys(a.shape).sort());
    for (const key of Object.keys(a.shape)) {
      expect(isOptional(b.shape[key]), key).toBe(isOptional(a.shape[key]));
    }
  });

  it.each(PAYLOAD_SAMPLES.map((s, i) => [i, s]))(
    "payload sample %i is accepted or rejected by both",
    (_i, sample) => {
      expect(mirror.zOutboundWebhookPayload.safeParse(sample).success).toBe(
        canonical.zOutboundWebhookPayload.safeParse(sample).success,
      );
    },
  );

  it("the valid payload samples really are valid (the parity check is not vacuous)", () => {
    for (const sample of [booking, order, message, ping]) {
      expect(mirror.zOutboundWebhookPayload.safeParse(sample).success).toBe(true);
    }
  });

  it.each(REQUEST_SAMPLES.map((s, i) => [i, s]))(
    "request sample %i is accepted or rejected by both, with the same output",
    (_i, sample) => {
      const a = mirror.zTenantWebhooksRequest.safeParse(sample);
      const b = canonical.zTenantWebhooksRequest.safeParse(sample);
      expect(a.success).toBe(b.success);
      if (a.success && b.success) expect(a.data).toEqual(b.data);
    },
  );

  it("every accepted URL satisfies the table CHECK (outbound_destinations_url_chk)", () => {
    expect(mirror.OUTBOUND_URL_PATTERN.source).toBe(canonical.OUTBOUND_URL_PATTERN.source);
    for (const sample of REQUEST_SAMPLES) {
      const parsed = mirror.zTenantWebhooksRequest.safeParse(sample);
      if (!parsed.success || !("url" in parsed.data) || parsed.data.url === undefined) continue;
      expect(parsed.data.url).toMatch(/^https:\/\/\S+$/);
      expect(parsed.data.url.length).toBeLessThanOrEqual(2048);
    }
  });
});
