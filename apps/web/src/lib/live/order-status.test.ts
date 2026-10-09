import { describe, expect, it } from "vitest";
import {
  groupOrders,
  nextOrderAction,
  orderColumn,
  withOrderRestored,
  withOrderStatus,
} from "./order-status";
import type { LiveOrder, OrderStatus } from "./types";

function order(id: string, status: OrderStatus, createdAt: string): LiveOrder {
  return {
    id,
    createdAt,
    status,
    fulfillmentType: "pickup",
    customerName: null,
    customerPhone: null,
    items: [],
    allergies: [],
    specialInstructions: null,
    deliveryAddress: null,
    addressVerification: null,
    subtotalCents: 0,
    taxCents: 0,
    tipCents: 0,
    deliveryFeeCents: 0,
    totalCents: 0,
  };
}

describe("order status transitions (LIVE-1)", () => {
  it("walks received → confirmed → preparing → ready → completed, one button each", () => {
    expect(nextOrderAction("received")).toEqual({ label: "Confirm", next: "confirmed" });
    expect(nextOrderAction("confirmed")).toEqual({ label: "Start", next: "preparing" });
    expect(nextOrderAction("preparing")).toEqual({ label: "Ready", next: "ready" });
    expect(nextOrderAction("ready")).toEqual({ label: "Done", next: "completed" });
  });

  it("offers nothing once an order is completed or cancelled", () => {
    expect(nextOrderAction("completed")).toBeNull();
    expect(nextOrderAction("cancelled")).toBeNull();
  });

  it("maps statuses onto the New / In progress / Ready columns", () => {
    expect(orderColumn("received")).toBe("new");
    expect(orderColumn("confirmed")).toBe("in_progress");
    expect(orderColumn("preparing")).toBe("in_progress");
    expect(orderColumn("ready")).toBe("ready");
    expect(orderColumn("completed")).toBeNull();
    expect(orderColumn("cancelled")).toBeNull();
  });

  it("groups open orders oldest first and drops finished ones", () => {
    const groups = groupOrders([
      order("b", "received", "2026-10-09T18:05:00Z"),
      order("a", "received", "2026-10-09T18:00:00Z"),
      order("c", "preparing", "2026-10-09T17:00:00Z"),
      order("d", "ready", "2026-10-09T16:00:00Z"),
      order("e", "completed", "2026-10-09T15:00:00Z"),
    ]);
    expect(groups.new.map((o) => o.id)).toEqual(["a", "b"]);
    expect(groups.in_progress.map((o) => o.id)).toEqual(["c"]);
    expect(groups.ready.map((o) => o.id)).toEqual(["d"]);
  });

  it("applies an optimistic status change and removes an order that leaves the board", () => {
    const orders = [order("a", "received", "x"), order("b", "ready", "y")];
    expect(withOrderStatus(orders, "a", "confirmed").map((o) => [o.id, o.status])).toEqual([
      ["a", "confirmed"],
      ["b", "ready"],
    ]);
    expect(withOrderStatus(orders, "b", "completed").map((o) => o.id)).toEqual(["a"]);
    expect(orders[0]?.status).toBe("received");
  });

  it("rolls back only the failed order, keeping another order's change", () => {
    const a = order("a", "received", "x");
    const b = order("b", "confirmed", "y");
    // a → confirmed, then b → preparing, then a's request fails.
    const current = withOrderStatus(withOrderStatus([a, b], "a", "confirmed"), "b", "preparing");
    expect(withOrderRestored(current, a).map((o) => [o.id, o.status])).toEqual([
      ["b", "preparing"],
      ["a", "received"],
    ]);
  });

  it("puts back an order the optimistic change had dropped off the board", () => {
    const a = order("a", "ready", "x");
    const b = order("b", "received", "y");
    const current = withOrderStatus([a, b], "a", "completed");
    expect(current.map((o) => o.id)).toEqual(["b"]);
    expect(withOrderRestored(current, a).map((o) => [o.id, o.status])).toEqual([
      ["b", "received"],
      ["a", "ready"],
    ]);
  });
});
