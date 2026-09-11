import type { Metadata } from "next";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { WebsiteWidgetClient } from "./website-widget-client";

export const metadata: Metadata = { title: "Website Widget — Heyloo" };

export default async function WebsiteWidgetPage() {
  const { tenant } = await requireTenantSession("/dashboard/website-widget");
  return <WebsiteWidgetClient tenantId={tenant.id} />;
}
