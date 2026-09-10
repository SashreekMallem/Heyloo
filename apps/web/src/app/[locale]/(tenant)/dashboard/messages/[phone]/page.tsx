import type { Metadata } from "next";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { MessageThreadClient } from "./message-thread-client";

export const metadata: Metadata = { title: "Message thread — Heyloo" };

export default async function MessageThreadPage({
  params,
}: {
  params: Promise<{ phone: string }>;
}) {
  const { phone: rawPhone } = await params;
  // The URL segment is percent-encoded (`+` → `%2B`) by every in-app link
  // via `encodeURIComponent`. Next.js does NOT decode dynamic segments for
  // us, so a hard navigation / refresh / bookmarked link lands here with
  // the raw encoded string — decode once, here, before it's used for
  // display or passed down into any Supabase `.eq()` filter (round-3
  // tenant design review, high).
  const phone = decodeURIComponent(rawPhone);
  const { tenant } = await requireTenantSession(`/dashboard/messages/${encodeURIComponent(phone)}`);
  return <MessageThreadClient tenantId={tenant.id} phone={phone} />;
}
