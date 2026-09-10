import type { Metadata } from "next";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { MessagesListClient } from "./messages-list-client";

export const metadata: Metadata = { title: "Messages — Heyloo" };

export default async function MessagesPage() {
  const { tenant } = await requireTenantSession("/dashboard/messages");
  return <MessagesListClient tenantId={tenant.id} />;
}
