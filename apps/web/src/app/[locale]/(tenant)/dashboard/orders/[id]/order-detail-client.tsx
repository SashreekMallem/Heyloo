"use client";

import { formatCentsUSD } from "@heyloo/canonical-types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Separator } from "@heyloo/ui";
import { useState } from "react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";

export interface OrderDetailData {
  id: string;
  createdAt: string;
  status: string;
  items: { offering_id?: string; name: string; qty: number; unit_price_cents?: number }[];
  fulfillmentType: string;
  deliveryAddress: Record<string, unknown> | null;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  customerName: string | null;
  customerPhone: string | null;
  paymentLinks: {
    id: string;
    amountCents: number;
    purpose: string;
    status: string;
    createdAt: string;
  }[];
}

const ORDER_STATUSES = [
  "received",
  "confirmed",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;

const ORDER_STATUS_VARIANT: Record<
  string,
  "outline" | "secondary" | "success" | "destructive" | "warning"
> = {
  received: "outline",
  confirmed: "secondary",
  preparing: "secondary",
  ready: "warning",
  completed: "success",
  cancelled: "destructive",
};

const PAYMENT_STATUS_VARIANT: Record<string, "outline" | "secondary" | "success" | "destructive"> =
  {
    pending: "outline",
    sent: "secondary",
    paid: "success",
    expired: "destructive",
    cancelled: "destructive",
  };

export function OrderDetailClient({ order }: { order: OrderDetailData }) {
  const router = useRouter();
  const [status, setStatus] = useState(order.status);
  const [savingStatus, setSavingStatus] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  async function saveStatus(next: string) {
    setSavingStatus(true);
    const res = await fetch(`/api/tenant/orders/${order.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setSavingStatus(false);
    if (!res.ok) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    setStatus(next);
    toast.success("Saved");
    router.refresh();
  }

  async function resend(id: string) {
    setResendingId(id);
    const res = await fetch(`/api/tenant/payment-links/${id}/resend`, { method: "POST" });
    setResendingId(null);
    if (!res.ok) {
      toast.error("Couldn't resend the payment link — please try again shortly.");
      return;
    }
    toast.success("Payment link re-sent by SMS");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Order</h1>
        <Badge variant={ORDER_STATUS_VARIANT[status] ?? "outline"}>{status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="text-muted-foreground">Placed</span>{" "}
            {new Date(order.createdAt).toLocaleString()}
          </p>
          <p>
            <span className="text-muted-foreground">Customer</span>{" "}
            {order.customerName ?? order.customerPhone ?? "Unknown"}
            {order.customerPhone && (
              <>
                {" — "}
                <Link
                  href={`/dashboard/messages/${encodeURIComponent(order.customerPhone)}`}
                  className="text-primary underline underline-offset-2"
                >
                  Message
                </Link>
              </>
            )}
          </p>
          <p>
            <span className="text-muted-foreground">Fulfillment</span> {order.fulfillmentType}
          </p>
          {order.deliveryAddress && (
            <p>
              <span className="text-muted-foreground">Delivery address</span>{" "}
              {[
                order.deliveryAddress["street"],
                order.deliveryAddress["city"],
                order.deliveryAddress["state"],
              ]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}

          <Separator />

          <ul className="space-y-1">
            {order.items.map((item, i) => (
              <li key={item.offering_id ?? `${item.name}-${i}`} className="flex justify-between">
                <span>
                  {item.qty}× {item.name}
                </span>
                {item.unit_price_cents !== undefined && (
                  <span>{formatCentsUSD(item.unit_price_cents * item.qty)}</span>
                )}
              </li>
            ))}
          </ul>

          <Separator />

          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCentsUSD(order.subtotalCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatCentsUSD(order.taxCents)}</span>
            </div>
            {order.tipCents > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tip</span>
                <span>{formatCentsUSD(order.tipCents)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span>{formatCentsUSD(order.totalCents)}</span>
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            {ORDER_STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === status ? "default" : "outline"}
                disabled={savingStatus}
                onClick={() => saveStatus(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent>
          {order.paymentLinks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment link for this order.</p>
          ) : (
            <ul className="space-y-2">
              {order.paymentLinks.map((link) => (
                <li
                  key={link.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
                >
                  <div>
                    <p className="text-sm">
                      {formatCentsUSD(link.amountCents)} — {link.purpose}
                    </p>
                    <Badge variant={PAYMENT_STATUS_VARIANT[link.status] ?? "outline"}>
                      {link.status}
                    </Badge>
                  </div>
                  {link.status !== "paid" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resendingId === link.id}
                      onClick={() => resend(link.id)}
                    >
                      Resend link
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
