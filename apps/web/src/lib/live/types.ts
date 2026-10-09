/**
 * View models for the live screen (LIVE-1). Built from the tenant's own
 * `orders` / `bookings` / `call_logs` rows by `queries.ts`; every component
 * and the ticket printer consume only these shapes.
 */

export type OrderStatus =
  | "received"
  | "confirmed"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export type FulfillmentType = "pickup" | "delivery" | "dine_in";

export interface LiveOrderItem {
  name: string;
  qty: number;
  /** Integer cents, or null when the agent didn't price the line. */
  unitPriceCents: number | null;
  modifiers: string[];
}

export interface LiveOrder {
  id: string;
  createdAt: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  customerName: string | null;
  /** E.164. */
  customerPhone: string | null;
  items: LiveOrderItem[];
  allergies: string[];
  specialInstructions: string | null;
  /** One-line delivery address, or null for pickup / dine-in. */
  deliveryAddress: string | null;
  /** `orders.address_verification` — anything but "in_range" means unverified. */
  addressVerification: string | null;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  deliveryFeeCents: number;
  totalCents: number;
}

export interface LiveBooking {
  id: string;
  createdAt: string;
  startAt: string;
  status: string;
  serviceName: string | null;
  customerName: string | null;
  /** E.164. */
  customerPhone: string | null;
  partySize: number | null;
  notes: string | null;
}

export interface LiveMessage {
  /** The `call_logs` row id. */
  id: string;
  createdAt: string;
  callerName: string | null;
  /** E.164. */
  callerPhone: string | null;
  message: string;
  callbackWindow: string | null;
}

export interface LiveOrdersResult {
  /** Open orders (not completed / cancelled) from the last 24 hours, oldest first. */
  orders: LiveOrder[];
  /** Any real order at all (any status) in the last 24 hours. */
  hasRecentOrders: boolean;
}
