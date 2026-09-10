import type { Metadata } from "next";
import { TestAgentClient } from "@/components/tenant/test-agent-client";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Test your agent — Heyloo" };

/** `/dashboard/test-agent` (Cluster H task brief item 2). */
export default async function TestAgentPage() {
  const { supabase, tenant } = await requireTenantSession("/dashboard/test-agent");

  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("id, e164, forwarding_verified_at")
    .eq("tenant_id", tenant.id)
    .is("released_at", null)
    .maybeSingle();

  const { data: agentConfig } = await supabase
    .from("agent_configs")
    .select("published_at")
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  return (
    <TestAgentClient
      tenantId={tenant.id}
      vertical={tenant.vertical}
      phoneNumberId={phoneNumber?.id ?? null}
      liveNumber={phoneNumber?.e164 ?? null}
      forwardingVerified={!!phoneNumber?.forwarding_verified_at}
      agentPublished={!!agentConfig?.published_at}
    />
  );
}
