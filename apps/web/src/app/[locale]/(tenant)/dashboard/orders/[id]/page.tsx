import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { OrderDetailClient, type OrderDetailData } from "./order-detail-client";

export const metadata: Metadata = { title: "Order — Heyloo" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenant } = await requireTenantSession(`/dashboard/orders/${id}`);

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, created_at, status, items, fulfillment_type, delivery_address, subtotal_cents, tax_cents, tip_cents, total_cents, customer_id",
    )
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (!order) notFound();

  const [{ data: customer }, { data: paymentLinks }] = await Promise.all([
    order.customer_id
      ? supabase
          .from("customers")
          .select("id, name, phone_e164")
          .eq("id", order.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("payment_links")
      .select("id, amount_cents, purpose, status, created_at")
      .eq("tenant_id", tenant.id)
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const data: OrderDetailData = {
    id: order.id,
    createdAt: order.created_at,
    status: order.status,
    items: order.items,
    fulfillmentType: order.fulfillment_type,
    deliveryAddress: order.delivery_address as Record<string, unknown> | null,
    subtotalCents: order.subtotal_cents,
    taxCents: order.tax_cents,
    tipCents: order.tip_cents,
    totalCents: order.total_cents,
    customerName: customer?.name ?? null,
    customerPhone: customer?.phone_e164 ?? null,
    paymentLinks: (paymentLinks ?? []).map((p) => ({
      id: p.id,
      amountCents: p.amount_cents,
      purpose: p.purpose,
      status: p.status,
      createdAt: p.created_at,
    })),
  };

  return <OrderDetailClient order={data} />;
}
