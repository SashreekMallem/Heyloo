"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Badge, Button, formatPhoneDisplay } from "@heyloo/ui";
import { Printer } from "lucide-react";
import { formatAge, fulfillmentLabel, shortOrderNumber } from "@/lib/live/format";
import { nextOrderAction } from "@/lib/live/order-status";
import type { LiveOrder, OrderStatus } from "@/lib/live/types";

export function OrderCard({
  order,
  now,
  busy,
  onAdvance,
  onPrint,
}: {
  order: LiveOrder;
  now: Date;
  busy: boolean;
  onAdvance: (order: LiveOrder, next: OrderStatus) => void;
  onPrint: (order: LiveOrder) => void;
}) {
  const number = shortOrderNumber(order.id);
  const action = nextOrderAction(order.status);
  const headingId = `live-order-${order.id}`;
  const unverified =
    order.fulfillmentType === "delivery" &&
    !!order.addressVerification &&
    order.addressVerification !== "in_range";

  return (
    <article
      aria-labelledby={headingId}
      className={
        order.status === "received"
          ? "rounded-lg border-2 border-primary bg-card p-3 shadow-sm"
          : "rounded-lg border border-border bg-card p-3 shadow-sm"
      }
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {/* h4: the card sits under the board's h2 and its column's h3. */}
        <h4 id={headingId} className="font-display text-xl font-semibold">
          {number}
        </h4>
        <span className="text-sm text-muted-foreground">{formatAge(order.createdAt, now)}</span>
      </header>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{fulfillmentLabel(order.fulfillmentType)}</Badge>
        {order.status === "preparing" && <Badge variant="outline">Preparing</Badge>}
        <span className="text-sm font-medium">{formatCentsUSD(order.totalCents)}</span>
      </div>

      {(order.customerName || order.customerPhone) && (
        <p className="mt-2 text-sm">
          {order.customerName ?? "Customer"}
          {order.customerPhone && (
            <span className="text-muted-foreground">
              {" "}
              · {formatPhoneDisplay(order.customerPhone)}
            </span>
          )}
        </p>
      )}

      {order.allergies.length > 0 && (
        <p className="mt-2 rounded-md border-2 border-destructive bg-destructive/10 p-2 text-base font-semibold">
          <Badge variant="destructive" className="mr-2 uppercase">
            Allergy
          </Badge>
          {order.allergies.join(", ")}
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {order.items.map((item, i) => (
          // Lines have no id of their own and never reorder on this card.
          // biome-ignore lint/suspicious/noArrayIndexKey: index is stable for a given order's items.
          <li key={`${item.name}-${i}`} className="text-base">
            <span className="font-semibold">{item.qty}×</span> {item.name}
            {item.modifiers.length > 0 && (
              <span className="block pl-5 text-sm text-muted-foreground">
                {item.modifiers.join(", ")}
              </span>
            )}
          </li>
        ))}
      </ul>

      {order.specialInstructions && (
        <p className="mt-2 rounded-md bg-warning/10 p-2 text-sm">
          <span className="font-semibold">Note:</span> {order.specialInstructions}
        </p>
      )}

      {order.deliveryAddress && (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Deliver to</span> {order.deliveryAddress}
          {unverified && (
            <Badge variant="warning" className="ml-2">
              Address not verified
            </Badge>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {action && (
          <Button
            type="button"
            size="lg"
            className="flex-1"
            loading={busy}
            onClick={() => onAdvance(order, action.next)}
            aria-label={`${action.label} order ${number}`}
          >
            {action.label}
          </Button>
        )}
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={() => onPrint(order)}
          aria-label={`Print ticket for order ${number}`}
        >
          <Printer aria-hidden="true" />
          Print
        </Button>
      </div>
    </article>
  );
}
