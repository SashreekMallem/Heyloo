import { PageHeader } from "@heyloo/ui/layout/page-header";
import type { Metadata } from "next";
import { PhoneSetupWizard } from "@/components/phone-setup/phone-setup-wizard";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Phone setup — Heyloo" };

export default async function PhoneSetupPage() {
  const { supabase, tenant } = await requireTenantSession("/dashboard/phone-setup");

  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("e164, forwarding_verified_at")
    .eq("tenant_id", tenant.id)
    .is("released_at", null)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Phone setup"
        description="Forward your business number so your AI can start answering calls."
      />
      <PhoneSetupWizard
        tenantId={tenant.id}
        forwardingNumber={phoneNumber?.e164 ?? ""}
        forwardingVerifiedAt={phoneNumber?.forwarding_verified_at}
        onboarding={false}
      />
    </div>
  );
}
