import type { Metadata } from "next";
import { CallsListClient } from "@/components/tenant/calls-list-client";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Calls — Heyloo" };

export default async function CallsPage() {
  const { supabase, tenant } = await requireTenantSession("/dashboard/calls");
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("timezone")
    .eq("id", tenant.id)
    .maybeSingle();
  return <CallsListClient tenantId={tenant.id} tenantTz={tenantRow?.timezone ?? "UTC"} />;
}
