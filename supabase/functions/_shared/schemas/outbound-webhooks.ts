import { z } from "zod";

/**
 * OUTBOUND-1 — Deno-side mirror of `packages/canonical-types/src/
 * outbound-webhooks.ts` (the Deno runtime cannot import that package; same
 * constraint as `booking-payloads.ts` here). Field-for-field identical:
 * `outbound-webhooks.test.ts` diffs the enums, the object key sets and
 * optional-ness, and runs the same accept/reject samples through both.
 *
 * The delivery worker parses every payload it builds against
 * `zOutboundWebhookPayload` before storing it (the contract boundary), and
 * `api-tenant-webhooks` parses its request body with `zTenantWebhooksRequest`.
 */

export const OUTBOUND_EVENT_TYPES = [
  "booking.created",
  "booking.updated",
  "booking.cancelled",
  "order.created",
  "order.updated",
  "order.cancelled",
  "message.taken",
] as const;
export type OutboundEventType = (typeof OUTBOUND_EVENT_TYPES)[number];
export const zOutboundEventType = z.enum(OUTBOUND_EVENT_TYPES);

export const OUTBOUND_TEST_EVENT_TYPE = "test.ping" as const;
export const OUTBOUND_ALL_EVENT_TYPES = [
  ...OUTBOUND_EVENT_TYPES,
  OUTBOUND_TEST_EVENT_TYPE,
] as const;
export type OutboundAnyEventType = (typeof OUTBOUND_ALL_EVENT_TYPES)[number];

export const OUTBOUND_ENTITY_TYPES = ["booking", "order", "call_log", "test"] as const;
export type OutboundEntityType = (typeof OUTBOUND_ENTITY_TYPES)[number];

export const OUTBOUND_DELIVERY_STATUSES = [
  "pending",
  "sending",
  "retrying",
  "delivered",
  "failed",
  "cancelled",
] as const;
export type OutboundDeliveryStatus = (typeof OUTBOUND_DELIVERY_STATUSES)[number];

export const OUTBOUND_DISABLED_REASONS = ["owner", "gone_410"] as const;
export type OutboundDisabledReason = (typeof OUTBOUND_DISABLED_REASONS)[number];

export const OUTBOUND_MAX_DESTINATIONS = 5;
export const OUTBOUND_DESTINATION_NAME_MAX = 80;
export const OUTBOUND_URL_MAX = 2048;

export const OUTBOUND_EVENT_LABELS: Record<OutboundAnyEventType, string> = {
  "booking.created": "New booking",
  "booking.updated": "Booking changed",
  "booking.cancelled": "Booking cancelled",
  "order.created": "New order",
  "order.updated": "Order status changed",
  "order.cancelled": "Order cancelled",
  "message.taken": "Message taken",
  "test.ping": "Test event",
};

export const OUTBOUND_BOOKING_STATUSES = [
  "scheduled",
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
  "rescheduled",
] as const;

export const OUTBOUND_ORDER_STATUSES = [
  "received",
  "confirmed",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;

export const OUTBOUND_FULFILLMENT_TYPES = ["pickup", "delivery", "dine_in"] as const;

export const OUTBOUND_TEST_MESSAGE = "This is a test event from Heyloo." as const;

const E164 = /^\+[1-9]\d{1,14}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const zE164 = z.string().regex(E164, "must be E.164 format, e.g. +15551234567");
const zIsoTimestamp = z
  .string()
  .regex(ISO_TIMESTAMP, "must be an ISO-8601 timestamp with an explicit timezone/offset");
const zCents = z.number().int().nonnegative();

export const zOutboundBusiness = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const zOutboundCustomer = z.object({
  name: z.string().nullable(),
  phone: zE164.nullable(),
  email: z.string().nullable(),
});

export const zOutboundBookingData = z.object({
  id: z.uuid(),
  status: z.enum(OUTBOUND_BOOKING_STATUSES),
  start_at: zIsoTimestamp,
  end_at: zIsoTimestamp,
  timezone: z.string().min(1),
  service: z.string().nullable(),
  resource: z.string().nullable(),
  party_size: z.number().int().nullable(),
  notes: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  customer: zOutboundCustomer,
  source_call_id: z.uuid().nullable(),
  created_at: zIsoTimestamp,
  dashboard_url: z.url(),
});
export type OutboundBookingData = z.infer<typeof zOutboundBookingData>;

export const zOutboundOrderItem = z.object({
  name: z.string(),
  qty: z.number().int().positive(),
  unit_price_cents: zCents.nullable(),
  modifiers: z.array(z.string()),
});

export const zOutboundDeliveryAddress = z.object({
  street: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
});

export const zOutboundOrderData = z.object({
  id: z.uuid(),
  status: z.enum(OUTBOUND_ORDER_STATUSES),
  fulfillment_type: z.enum(OUTBOUND_FULFILLMENT_TYPES),
  items: z.array(zOutboundOrderItem),
  subtotal_cents: zCents,
  tax_cents: zCents,
  tip_cents: zCents,
  delivery_fee_cents: zCents,
  total_cents: zCents,
  currency: z.literal("USD"),
  allergies: z.array(z.string()),
  special_instructions: z.string().nullable(),
  delivery_address: zOutboundDeliveryAddress.nullable(),
  customer: zOutboundCustomer,
  source_call_id: z.uuid().nullable(),
  created_at: zIsoTimestamp,
  dashboard_url: z.url(),
});
export type OutboundOrderData = z.infer<typeof zOutboundOrderData>;

export const zOutboundMessageCaller = z.object({
  name: z.string().nullable(),
  phone: zE164.nullable(),
});

export const zOutboundMessageData = z.object({
  id: z.uuid(),
  caller: zOutboundMessageCaller,
  message: z.string().min(1),
  callback_window: z.string().nullable(),
  created_at: zIsoTimestamp,
  dashboard_url: z.url(),
});
export type OutboundMessageData = z.infer<typeof zOutboundMessageData>;

export const zOutboundTestData = z.object({
  message: z.literal(OUTBOUND_TEST_MESSAGE),
});

const envelope = {
  timestamp: zIsoTimestamp,
  business: zOutboundBusiness,
};

export const zOutboundBookingEvent = z.object({
  type: z.enum(["booking.created", "booking.updated", "booking.cancelled"]),
  ...envelope,
  data: zOutboundBookingData,
});

export const zOutboundOrderEvent = z.object({
  type: z.enum(["order.created", "order.updated", "order.cancelled"]),
  ...envelope,
  data: zOutboundOrderData,
});

export const zOutboundMessageEvent = z.object({
  type: z.literal("message.taken"),
  ...envelope,
  data: zOutboundMessageData,
});

export const zOutboundTestEvent = z.object({
  type: z.literal(OUTBOUND_TEST_EVENT_TYPE),
  ...envelope,
  data: zOutboundTestData,
});

export const zOutboundWebhookPayload = z.union([
  zOutboundBookingEvent,
  zOutboundOrderEvent,
  zOutboundMessageEvent,
  zOutboundTestEvent,
]);
export type OutboundWebhookPayload = z.infer<typeof zOutboundWebhookPayload>;

export const zOutboundDestinationName = z
  .string()
  .trim()
  .min(1, "Give this destination a name")
  .max(OUTBOUND_DESTINATION_NAME_MAX, `Use ${OUTBOUND_DESTINATION_NAME_MAX} characters or fewer`);

/**
 * Mirrors the table CHECK `outbound_destinations_url_chk`
 * (`url ~ '^https://\S+$' and char_length(url) <= 2048`).
 */
export const OUTBOUND_URL_PATTERN = /^https:\/\/\S+$/;

/**
 * Shape only: whether the host is public is checked server-side
 * (safe-fetch). The value is normalized to the WHATWG URL `href` (lowercase
 * scheme and host, default port dropped, spaces and non-ASCII
 * percent-encoded), then re-checked against the table's CHECK, so anything
 * accepted here is stored as-is: `HTTPS://Example.com/a b` becomes
 * `https://example.com/a%20b` instead of failing that CHECK with a 500.
 */
export const zOutboundDestinationUrl = z
  .string()
  .trim()
  .max(OUTBOUND_URL_MAX, "That web address is too long")
  .pipe(
    z.url({
      protocol: /^https$/,
      normalize: true,
      error: "Enter a web address that starts with https://",
    }),
  )
  .pipe(
    z
      .string()
      .max(OUTBOUND_URL_MAX, "That web address is too long")
      .regex(OUTBOUND_URL_PATTERN, "Enter a web address that starts with https://"),
  );

export const zOutboundEventTypeList = z
  .array(zOutboundEventType)
  .min(1, "Pick at least one event")
  .refine((list) => new Set(list).size === list.length, "Each event can be picked once");

export const zTenantWebhooksRequest = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: zOutboundDestinationName,
    url: zOutboundDestinationUrl,
    event_types: zOutboundEventTypeList.optional(),
  }),
  z.object({
    action: z.literal("update"),
    id: z.uuid(),
    name: zOutboundDestinationName.optional(),
    url: zOutboundDestinationUrl.optional(),
    event_types: zOutboundEventTypeList.optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({ action: z.literal("delete"), id: z.uuid() }),
  z.object({ action: z.literal("rotate_secret"), id: z.uuid() }),
  z.object({ action: z.literal("send_test"), id: z.uuid() }),
  z.object({ action: z.literal("retry"), delivery_id: z.uuid() }),
]);
export type TenantWebhooksRequest = z.infer<typeof zTenantWebhooksRequest>;
