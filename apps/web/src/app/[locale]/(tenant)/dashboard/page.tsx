import type { Metadata } from "next";
import { OverviewClient } from "@/components/tenant/overview-client";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Overview — Heyloo" };

/** `/dashboard` — Overview (FRONTEND_SPEC.md §6.1). */
export default async function DashboardOverviewPage() {
  const { supabase, tenant } = await requireTenantSession("/dashboard");

  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("e164, forwarding_verified_at")
    .eq("tenant_id", tenant.id)
    .is("released_at", null)
    .maybeSingle();

  const { count: callCount } = await supabase
    .from("call_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id);

  return (
    <OverviewClient
      tenantId={tenant.id}
      hasPhoneNumber={!!phoneNumber?.forwarding_verified_at}
      hasAnyCallEver={(callCount ?? 0) > 0}
      liveNumber={phoneNumber?.e164 ?? null}
    />
  );
}
