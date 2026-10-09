import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { shiftDateKey, tenantDateKey, tenantMidnightIso } from "@/lib/tenant/tz";
import { formatDeliveryAddress } from "./format";
import { OPEN_ORDER_STATUSES } from "./order-status";
import type {
  FulfillmentType,
  LiveBooking,
  LiveMessage,
  LiveOrder,
  LiveOrderItem,
  LiveOrdersResult,
  OrderStatus,
} from "./types";

/**
 * Live-screen reads (LIVE-1). RLS-scoped browser client plus an explicit
 * `tenant_id` filter on every query, test rows excluded, last 24 hours.
 * The TanStack resources these back are `orders` / `bookings` /
 * `call_logs`, so the tenant realtime broadcast invalidates them.
 */

export const LIVE_WINDOW_MS = 24 * 3_600_000;
const ROW_LIMIT = 200;
/** Booking statuses that are still "on" (not finished, cancelled or moved). */
const ACTIVE_BOOKING_STATUSES = ["scheduled", "confirmed", "checked_in"] as const;

function sinceIso(now: Date): string {
  return new Date(now.getTime() - LIVE_WINDOW_MS).toISOString();
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** `orders.items` is jsonb: tolerate a malformed line rather than blanking the board. */
export function normalizeItems(items: unknown): LiveOrderItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((raw): LiveOrderItem => {
    const item = asRecord(raw);
    const qty = Number(item["qty"]);
    const price = item["unit_price_cents"];
    const modifiers = item["modifiers"];
    return {
      name: textOrNull(item["name"]) ?? "Item",
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unitPriceCents: typeof price === "number" && Number.isFinite(price) ? price : null,
      modifiers: Array.isArray(modifiers)
        ? modifiers.filter((m): m is string => typeof m === "string" && m.trim() !== "")
        : [],
    };
  });
}

async function customersById(
  tenantId: string,
  ids: (string | null)[],
): Promise<Map<string, { name: string | null; phone: string | null }>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const { data } = await supabaseBrowserClient
    .from("customers")
    .select("id, name, phone_e164")
    .eq("tenant_id", tenantId)
    .in("id", unique);
  return new Map(
    (data ?? []).map((c) => [c.id, { name: textOrNull(c.name), phone: c.phone_e164 ?? null }]),
  );
}

export async function fetchLiveOrders(
  tenantId: string,
  now: Date = new Date(),
): Promise<LiveOrdersResult> {
  const since = sinceIso(now);
  const [open, recent] = await Promise.all([
    supabaseBrowserClient
      .from("orders")
      .select(
        "id, created_at, status, fulfillment_type, customer_id, items, allergies, special_instructions, delivery_address, address_verification, subtotal_cents, tax_cents, tip_cents, delivery_fee_cents, total_cents",
      )
      .eq("tenant_id", tenantId)
      .eq("is_test", false)
      .in("status", OPEN_ORDER_STATUSES)
      .gte("created_at", since)
      // Newest first so a backlog past the limit cuts off the oldest, never
      // a new arrival; groupOrders re-sorts each column oldest first.
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT),
    supabaseBrowserClient
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_test", false)
      .gte("created_at", since),
  ]);
  if (open.error) throw new Error(open.error.message);

  const rows = open.data ?? [];
  const customers = await customersById(
    tenantId,
    rows.map((o) => o.customer_id),
  );
  const orders = rows
    // The preview fixtures (and any future status) may carry rows outside
    // the open set; the board only ever shows open orders.
    .filter((o) => (OPEN_ORDER_STATUSES as string[]).includes(o.status))
    .map((o): LiveOrder => {
      const customer = o.customer_id ? customers.get(o.customer_id) : undefined;
      return {
        id: o.id,
        createdAt: o.created_at,
        status: o.status as OrderStatus,
        fulfillmentType: o.fulfillment_type as FulfillmentType,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        items: normalizeItems(o.items),
        allergies: (o.allergies ?? []).filter((a) => typeof a === "string" && a.trim() !== ""),
        specialInstructions: textOrNull(o.special_instructions),
        deliveryAddress:
          o.fulfillment_type === "delivery"
            ? formatDeliveryAddress(o.delivery_address ? asRecord(o.delivery_address) : null)
            : null,
        addressVerification: o.address_verification ?? null,
        subtotalCents: o.subtotal_cents ?? 0,
        taxCents: o.tax_cents ?? 0,
        tipCents: o.tip_cents ?? 0,
        deliveryFeeCents: o.delivery_fee_cents ?? 0,
        totalCents: o.total_cents ?? 0,
      };
    });

  return { orders, hasRecentOrders: orders.length > 0 || (recent.count ?? 0) > 0 };
}

/**
 * Bookings created in the last 24 hours plus the rest of today's upcoming
 * ones (tenant-local day). Two simple windowed queries merged by id.
 * Unpaid motel deposit holds (`scheduled` + `hold_expires_at`) are not
 * real bookings yet and are left out.
 */
export async function fetchLiveBookings(
  tenantId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<LiveBooking[]> {
  const columns =
    "id, created_at, start_at, status, customer_id, offering_id, party_size, notes, hold_expires_at";
  const dayEnd = tenantMidnightIso(timeZone, shiftDateKey(tenantDateKey(timeZone, now), 1));
  const base = () =>
    supabaseBrowserClient
      .from("bookings")
      .select(columns)
      .eq("tenant_id", tenantId)
      .eq("is_test", false)
      .in("status", [...ACTIVE_BOOKING_STATUSES]);

  const [created, today] = await Promise.all([
    base()
      .gte("created_at", sinceIso(now))
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT),
    base()
      .gte("start_at", now.toISOString())
      .lt("start_at", dayEnd)
      .order("start_at", { ascending: true })
      .limit(ROW_LIMIT),
  ]);
  if (created.error) throw new Error(created.error.message);
  if (today.error) throw new Error(today.error.message);

  const byId = new Map<string, NonNullable<typeof created.data>[number]>();
  for (const row of [...(created.data ?? []), ...(today.data ?? [])]) {
    const isHold = row.status === "scheduled" && row.hold_expires_at !== null;
    if (!isHold && (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(row.status)) {
      byId.set(row.id, row);
    }
  }
  const rows = [...byId.values()];

  const offeringIds = [
    ...new Set(rows.map((b) => b.offering_id).filter((id): id is string => !!id)),
  ];
  const [customers, offerings] = await Promise.all([
    customersById(
      tenantId,
      rows.map((b) => b.customer_id),
    ),
    offeringIds.length
      ? supabaseBrowserClient
          .from("offerings")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", offeringIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const offeringName = new Map((offerings.data ?? []).map((o) => [o.id, o.name]));

  return rows
    .map((b): LiveBooking => {
      const customer = b.customer_id ? customers.get(b.customer_id) : undefined;
      return {
        id: b.id,
        createdAt: b.created_at,
        startAt: b.start_at,
        status: b.status,
        serviceName: (b.offering_id && offeringName.get(b.offering_id)) || null,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        partySize: b.party_size ?? null,
        notes: textOrNull(b.notes),
      };
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Messages the agent took (non-empty `call_logs.message_text`) in the last 24 hours, newest first. */
export async function fetchLiveMessages(
  tenantId: string,
  now: Date = new Date(),
): Promise<LiveMessage[]> {
  const { data, error } = await supabaseBrowserClient
    .from("call_logs")
    .select("id, created_at, caller_number, message_text, structured_booking_payload")
    .eq("tenant_id", tenantId)
    .eq("is_test_call", false)
    .not("message_text", "is", null)
    .neq("message_text", "")
    .gte("created_at", sinceIso(now))
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);
  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row): LiveMessage[] => {
    const message = textOrNull(row.message_text);
    if (!message) return [];
    // take_message folds the caller's spoken name / callback number and
    // callback window into structured_booking_payload (CALL-8).
    const payload = asRecord(row.structured_booking_payload);
    return [
      {
        id: row.id,
        createdAt: row.created_at,
        callerName: textOrNull(payload["caller_name"]),
        callerPhone: textOrNull(payload["caller_phone"]) ?? row.caller_number ?? null,
        message,
        callbackWindow: textOrNull(payload["callback_window"]),
      },
    ];
  });
}
