import type { LiveOrder, OrderStatus } from "./types";

/**
 * The live screen's one-tap kitchen flow (LIVE-1): each open status has
 * exactly one forward step. `PATCH /api/tenant/orders/[id]` accepts any
 * status; this keeps the counter UI to a single obvious button per card.
 */
export interface OrderAction {
  label: string;
  next: OrderStatus;
}

const NEXT_ACTION: Partial<Record<OrderStatus, OrderAction>> = {
  received: { label: "Confirm", next: "confirmed" },
  confirmed: { label: "Start", next: "preparing" },
  preparing: { label: "Ready", next: "ready" },
  ready: { label: "Done", next: "completed" },
};

export function nextOrderAction(status: OrderStatus): OrderAction | null {
  return NEXT_ACTION[status] ?? null;
}

export type OrderColumn = "new" | "in_progress" | "ready";

export const ORDER_COLUMNS: { id: OrderColumn; label: string }[] = [
  { id: "new", label: "New" },
  { id: "in_progress", label: "In progress" },
  { id: "ready", label: "Ready" },
];

/** Board column for an open order; null once it is completed or cancelled. */
export function orderColumn(status: OrderStatus): OrderColumn | null {
  switch (status) {
    case "received":
      return "new";
    case "confirmed":
    case "preparing":
      return "in_progress";
    case "ready":
      return "ready";
    default:
      return null;
  }
}

export const OPEN_ORDER_STATUSES: OrderStatus[] = ["received", "confirmed", "preparing", "ready"];

/** Orders grouped into the board's columns, each oldest first (the order they should be made in). */
export function groupOrders(orders: LiveOrder[]): Record<OrderColumn, LiveOrder[]> {
  const groups: Record<OrderColumn, LiveOrder[]> = { new: [], in_progress: [], ready: [] };
  const sorted = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const order of sorted) {
    const column = orderColumn(order.status);
    if (column) groups[column].push(order);
  }
  return groups;
}

/** Applies an optimistic status change; an order that leaves the board is dropped. */
export function withOrderStatus(
  orders: LiveOrder[],
  orderId: string,
  status: OrderStatus,
): LiveOrder[] {
  return orders.flatMap((o) => {
    if (o.id !== orderId) return [o];
    return orderColumn(status) ? [{ ...o, status }] : [];
  });
}

/**
 * Undoes one failed optimistic change: puts `original` back (re-adding it if
 * the change had dropped it off the board) without touching any other
 * order, so a rollback never wipes a second order's change in flight.
 */
export function withOrderRestored(orders: LiveOrder[], original: LiveOrder): LiveOrder[] {
  const rest = orders.filter((o) => o.id !== original.id);
  return orderColumn(original.status) ? [...rest, original] : rest;
}
