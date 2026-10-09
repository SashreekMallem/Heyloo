"use client";

import { groupOrders, ORDER_COLUMNS } from "@/lib/live/order-status";
import type { LiveOrder, OrderStatus } from "@/lib/live/types";
import { OrderCard } from "./order-card";
import { LiveSection } from "./section";

export function OrdersBoard({
  orders,
  now,
  busyIds,
  state,
  onAdvance,
  onPrint,
}: {
  orders: LiveOrder[];
  now: Date;
  busyIds: ReadonlySet<string>;
  state: "loading" | "error" | "ready";
  onAdvance: (order: LiveOrder, next: OrderStatus) => void;
  onPrint: (order: LiveOrder) => void;
}) {
  const groups = groupOrders(orders);
  return (
    <LiveSection
      id="live-orders"
      title="Orders"
      count={orders.length}
      state={state}
      errorText="Couldn't load orders. Trying again every 15 seconds."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {ORDER_COLUMNS.map((column) => {
          const list = groups[column.id];
          const headingId = `live-orders-${column.id}`;
          return (
            <section key={column.id} aria-labelledby={headingId} className="min-w-0 space-y-3">
              <h3
                id={headingId}
                className="flex items-center justify-between border-b border-border pb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {column.label}
                <span>
                  {list.length}
                  <span className="sr-only"> orders</span>
                </span>
              </h3>
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing here.</p>
              ) : (
                list.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    now={now}
                    busy={busyIds.has(order.id)}
                    onAdvance={onAdvance}
                    onPrint={onPrint}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>
    </LiveSection>
  );
}
