import type { Metadata } from "next";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { OrdersListClient } from "./orders-list-client";

export const metadata: Metadata = { title: "Orders — Heyloo" };

export default async function OrdersPage() {
  const { tenant } = await requireTenantSession("/dashboard/orders");
  return <OrdersListClient tenantId={tenant.id} />;
}
