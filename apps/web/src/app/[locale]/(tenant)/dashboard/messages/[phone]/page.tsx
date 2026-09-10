import type { Metadata } from "next";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { MessageThreadClient } from "./message-thread-client";

export const metadata: Metadata = { title: "Message thread — Heyloo" };

export default async function MessageThreadPage({
  params,
}: {
  params: Promise<{ phone: string }>;
}) {
  const { phone } = await params;
  const { tenant } = await requireTenantSession(`/dashboard/messages/${encodeURIComponent(phone)}`);
  return <MessageThreadClient tenantId={tenant.id} phone={phone} />;
}
