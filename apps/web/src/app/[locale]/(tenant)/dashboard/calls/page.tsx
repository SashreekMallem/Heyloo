import type { Metadata } from "next";
import { CallsListClient } from "@/components/tenant/calls-list-client";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Calls — Heyloo" };

export default async function CallsPage() {
  const { tenant } = await requireTenantSession("/dashboard/calls");
  return <CallsListClient tenantId={tenant.id} />;
}
