import { normalizeE164 } from "../phone.ts";
import {
  OUTBOUND_TEST_EVENT_TYPE,
  OUTBOUND_TEST_MESSAGE,
  type OutboundAnyEventType,
  type OutboundBookingData,
  type OutboundEntityType,
  type OutboundMessageData,
  type OutboundOrderData,
  type OutboundWebhookPayload,
  zOutboundWebhookPayload,
} from "../schemas/outbound-webhooks.ts";
import type { SqlClient } from "../types.ts";

/**
 * OUTBOUND-1 payload builder (contract v1, `_shared/schemas/
 * outbound-webhooks.ts`). The worker builds an event's body ONCE, on its
 * first attempt, from the CURRENT database rows, stores it in
 * `outbound_events.payload`, and every later attempt (and every other
 * destination of the same event) re-sends exactly that stored body.
 *
 * Every query filters by the event's own tenant_id (CLAUDE.md Rule 2), and
 * joined lookups (customer, offering, resource) are also tenant-matched so a
 * stray foreign id can never pull another tenant's data into a payload.
 * Money stays integer cents; phones are E.164 or null; timestamps are ISO.
 */

export interface OutboundEventRef {
  id: string;
  tenant_id: string;
  event_type: OutboundAnyEventType;
  entity_type: OutboundEntityType;
  entity_id: string | null;
  occurred_at: Date | string;
}

export type BuildPayloadResult =
  | { status: "built"; payload: OutboundWebhookPayload }
  /** The booking/order/call (or the tenant) no longer exists, or the message
   * was cleared: nothing truthful left to send. */
  | { status: "missing" };

export class OutboundPayloadInvalidError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`outbound_payload_invalid: ${issues.join("; ")}`);
    this.name = "OutboundPayloadInvalidError";
    this.issues = issues;
  }
}

type Timestamp = Date | string;

export function toIso(value: Timestamp): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new OutboundPayloadInvalidError(["bad timestamp"]);
  return date.toISOString();
}

function baseUrl(appBaseUrl: string): string {
  return appBaseUrl.replace(/\/+$/, "");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function customer(name: unknown, phone: unknown, email: unknown) {
  return {
    name: text(name),
    phone: normalizeE164(typeof phone === "string" ? phone : null),
    email: text(email),
  };
}

// ---------------------------------------------------------------------------
// Row -> data (pure)
// ---------------------------------------------------------------------------

export interface BookingPayloadRow {
  id: string;
  status: OutboundBookingData["status"];
  start_at: Timestamp;
  end_at: Timestamp;
  party_size: number | null;
  notes: string | null;
  cancel_reason: string | null;
  source_call_id: string | null;
  created_at: Timestamp;
  tenant_name: string;
  timezone: string;
  service: string | null;
  resource: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
}

export function bookingData(row: BookingPayloadRow, appBaseUrl: string): OutboundBookingData {
  return {
    id: row.id,
    status: row.status,
    start_at: toIso(row.start_at),
    end_at: toIso(row.end_at),
    timezone: row.timezone,
    service: text(row.service),
    resource: text(row.resource),
    party_size: row.party_size,
    notes: text(row.notes),
    cancel_reason: text(row.cancel_reason),
    customer: customer(row.customer_name, row.customer_phone, row.customer_email),
    source_call_id: row.source_call_id,
    created_at: toIso(row.created_at),
    dashboard_url: `${baseUrl(appBaseUrl)}/dashboard/bookings?booking=${encodeURIComponent(row.id)}`,
  };
}

export interface OrderPayloadRow {
  id: string;
  status: OutboundOrderData["status"];
  fulfillment_type: OutboundOrderData["fulfillment_type"];
  items: unknown;
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  allergies: string[] | null;
  special_instructions: string | null;
  delivery_address: unknown;
  source_call_id: string | null;
  created_at: Timestamp;
  tenant_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
}

/** `orders.items` is jsonb `[{offering_id?, name, qty, unit_price_cents?, modifiers?}]`. */
function orderItems(raw: unknown): OutboundOrderData["items"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      name: typeof item["name"] === "string" ? item["name"] : "",
      qty: typeof item["qty"] === "number" ? item["qty"] : Number.NaN,
      unit_price_cents:
        typeof item["unit_price_cents"] === "number" ? item["unit_price_cents"] : null,
      modifiers: Array.isArray(item["modifiers"])
        ? item["modifiers"].filter((m): m is string => typeof m === "string")
        : [],
    }));
}

/** Only the public address lines; internal keys (address_id, set_as_default, ...) are dropped. */
function deliveryAddress(raw: unknown): OutboundOrderData["delivery_address"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  const address = {
    street: text(a["street"]) ?? text(a["line1"]),
    city: text(a["city"]),
    state: text(a["state"]),
    zip: text(a["zip"]),
  };
  return Object.values(address).some((v) => v !== null) ? address : null;
}

export function orderData(row: OrderPayloadRow, appBaseUrl: string): OutboundOrderData {
  return {
    id: row.id,
    status: row.status,
    fulfillment_type: row.fulfillment_type,
    items: orderItems(row.items),
    subtotal_cents: row.subtotal_cents,
    tax_cents: row.tax_cents,
    tip_cents: row.tip_cents,
    delivery_fee_cents: row.delivery_fee_cents,
    total_cents: row.total_cents,
    currency: "USD",
    allergies: (row.allergies ?? []).filter((a) => typeof a === "string" && a.trim() !== ""),
    special_instructions: text(row.special_instructions),
    delivery_address: deliveryAddress(row.delivery_address),
    customer: customer(row.customer_name, row.customer_phone, row.customer_email),
    source_call_id: row.source_call_id,
    created_at: toIso(row.created_at),
    dashboard_url: `${baseUrl(appBaseUrl)}/dashboard/orders/${encodeURIComponent(row.id)}`,
  };
}

export interface MessagePayloadRow {
  id: string;
  message_text: string | null;
  caller_number: string | null;
  structured_booking_payload: unknown;
  created_at: Timestamp;
  tenant_name: string;
}

/** Null when there is no message text (nothing to send). The caller's spoken
 * name/callback number are what `take_message` folded into
 * `structured_booking_payload`; the call's own caller id is the fallback phone. */
export function messageData(
  row: MessagePayloadRow,
  appBaseUrl: string,
): OutboundMessageData | null {
  const message = text(row.message_text);
  if (!message) return null;
  const extra =
    row.structured_booking_payload &&
    typeof row.structured_booking_payload === "object" &&
    !Array.isArray(row.structured_booking_payload)
      ? (row.structured_booking_payload as Record<string, unknown>)
      : {};
  const spokenPhone = typeof extra["caller_phone"] === "string" ? extra["caller_phone"] : null;
  return {
    id: row.id,
    caller: {
      name: text(extra["caller_name"]),
      phone: normalizeE164(spokenPhone) ?? normalizeE164(row.caller_number),
    },
    message,
    callback_window: text(extra["callback_window"]),
    created_at: toIso(row.created_at),
    dashboard_url: `${baseUrl(appBaseUrl)}/dashboard/calls/${encodeURIComponent(row.id)}`,
  };
}

/** Validates against the contract; throws `OutboundPayloadInvalidError` on drift. */
export function finalizePayload(candidate: unknown): OutboundWebhookPayload {
  const parsed = zOutboundWebhookPayload.safeParse(candidate);
  if (!parsed.success) {
    throw new OutboundPayloadInvalidError(
      parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// DB -> payload
// ---------------------------------------------------------------------------

export async function buildOutboundPayload(
  sql: SqlClient,
  event: OutboundEventRef,
  appBaseUrl: string,
): Promise<BuildPayloadResult> {
  const timestamp = toIso(event.occurred_at);
  const business = (name: string) => ({ id: event.tenant_id, name });

  if (event.entity_type === "test" || event.event_type === OUTBOUND_TEST_EVENT_TYPE) {
    const rows = await sql<{ tenant_name: string }>`
      select t.name as tenant_name from public.tenants t where t.id = ${event.tenant_id}
    `;
    const row = rows[0];
    if (!row) return { status: "missing" };
    return {
      status: "built",
      payload: finalizePayload({
        type: OUTBOUND_TEST_EVENT_TYPE,
        timestamp,
        business: business(row.tenant_name),
        data: { message: OUTBOUND_TEST_MESSAGE },
      }),
    };
  }

  if (!event.entity_id) return { status: "missing" };

  if (event.entity_type === "booking") {
    const rows = await sql<BookingPayloadRow>`
      select b.id, b.status, b.start_at, b.end_at, b.party_size, b.notes, b.cancel_reason,
        b.source_call_id, b.created_at, t.name as tenant_name, t.timezone,
        o.name as service, r.name as resource,
        c.name as customer_name, c.phone_e164 as customer_phone, c.email as customer_email
      from public.bookings b
      join public.tenants t on t.id = b.tenant_id
      left join public.offerings o on o.id = b.offering_id and o.tenant_id = b.tenant_id
      left join public.resources r on r.id = b.resource_id and r.tenant_id = b.tenant_id
      left join public.customers c on c.id = b.customer_id and c.tenant_id = b.tenant_id
      where b.id = ${event.entity_id} and b.tenant_id = ${event.tenant_id}
    `;
    const row = rows[0];
    if (!row) return { status: "missing" };
    return {
      status: "built",
      payload: finalizePayload({
        type: event.event_type,
        timestamp,
        business: business(row.tenant_name),
        data: bookingData(row, appBaseUrl),
      }),
    };
  }

  if (event.entity_type === "order") {
    const rows = await sql<OrderPayloadRow>`
      select o.id, o.status, o.fulfillment_type, o.items, o.subtotal_cents, o.tax_cents,
        o.tip_cents, o.delivery_fee_cents, o.total_cents, o.allergies, o.special_instructions,
        o.delivery_address, o.source_call_id, o.created_at, t.name as tenant_name,
        c.name as customer_name, c.phone_e164 as customer_phone, c.email as customer_email
      from public.orders o
      join public.tenants t on t.id = o.tenant_id
      left join public.customers c on c.id = o.customer_id and c.tenant_id = o.tenant_id
      where o.id = ${event.entity_id} and o.tenant_id = ${event.tenant_id}
    `;
    const row = rows[0];
    if (!row) return { status: "missing" };
    return {
      status: "built",
      payload: finalizePayload({
        type: event.event_type,
        timestamp,
        business: business(row.tenant_name),
        data: orderData(row, appBaseUrl),
      }),
    };
  }

  const rows = await sql<MessagePayloadRow>`
    select cl.id, cl.message_text, cl.caller_number, cl.structured_booking_payload,
      cl.created_at, t.name as tenant_name
    from public.call_logs cl
    join public.tenants t on t.id = cl.tenant_id
    where cl.id = ${event.entity_id} and cl.tenant_id = ${event.tenant_id}
  `;
  const row = rows[0];
  const data = row ? messageData(row, appBaseUrl) : null;
  if (!row || !data) return { status: "missing" };
  return {
    status: "built",
    payload: finalizePayload({
      type: event.event_type,
      timestamp,
      business: business(row.tenant_name),
      data,
    }),
  };
}
