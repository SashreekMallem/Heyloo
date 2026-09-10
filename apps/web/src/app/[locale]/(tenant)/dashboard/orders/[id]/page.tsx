import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { OrderDetailClient, type OrderDetailData } from "./order-detail-client";

export const metadata: Metadata = { title: "Order — Heyloo" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenant } = await requireTenantSession(`/dashboard/orders/${id}`);

  const { data: rawOrder } = await supabase
    .from("orders")
    // `allergies`/`special_instructions`/`delivery_fee_cents` are real
    // columns (20260910120000_orders_delivery_allergies_columns.sql) not
    // yet on the hand-maintained `OrderRow` type (docs/audit/FIX_REQUESTS.md)
    // — cast the whole row immediately so every field below is typed.
    .select(
      "id, created_at, status, items, fulfillment_type, delivery_address, subtotal_cents, tax_cents, tip_cents, total_cents, customer_id, allergies, special_instructions, delivery_fee_cents",
    )
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();
  const order = rawOrder as unknown as {
    id: string;
    created_at: string;
    status: string;
    items: {
      offering_id?: string;
      name: string;
      qty: number;
      unit_price_cents?: number;
      modifiers?: string[];
    }[];
    fulfillment_type: string;
    delivery_address: Record<string, unknown> | null;
    subtotal_cents: number;
    tax_cents: number;
    tip_cents: number;
    total_cents: number;
    customer_id: string | null;
    allergies: string[] | null;
    special_instructions: string | null;
    delivery_fee_cents: number | null;
  } | null;
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
    deliveryFeeCents: order.delivery_fee_cents ?? 0,
    allergies: order.allergies ?? [],
    specialInstructions: order.special_instructions,
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
