import type { Metadata } from "next";
import { LiveScreen } from "@/components/live/live-screen";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Live screen — Heyloo" };

/**
 * `/dashboard/live` — the full-screen live screen / kitchen mode (LIVE-1).
 * The tenant shell renders it without the sidebar, top bar or tab bar
 * (`isLiveScreenPath`), while the (tenant) layout's auth guard and realtime
 * provider still wrap it. Vertical and name come from the session's tenant
 * row; the timezone is read the same way the Overview page reads it.
 */
export default async function LiveScreenPage() {
  const { supabase, tenant } = await requireTenantSession("/dashboard/live");
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("timezone")
    .eq("id", tenant.id)
    .maybeSingle();

  return (
    <LiveScreen
      tenantId={tenant.id}
      businessName={tenant.name}
      vertical={tenant.vertical}
      timeZone={tenantRow?.timezone ?? "UTC"}
    />
  );
}
