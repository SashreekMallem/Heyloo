import { Container, Section } from "@heyloo/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PhoneSetupWizard } from "@/components/phone-setup/phone-setup-wizard";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Forward your number — Heyloo" };

/** Signup step 6 — the same wizard as `/dashboard/phone-setup`, in onboarding mode (FRONTEND_SPEC.md §4.6). Guard: authenticated tenant, active. */
export default async function SignupForwardingPage() {
  const { supabase, tenant } = await requireTenantSession("/signup/forwarding");

  if (tenant.status !== "active") redirect("/signup/provisioning");

  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("e164, forwarding_verified_at")
    .eq("tenant_id", tenant.id)
    .is("released_at", null)
    .maybeSingle();

  return (
    <Section spacing="default" className="pb-24">
      <Container size="content">
        <h1 className="mb-10 text-center font-display text-h2 font-semibold">Almost there</h1>
        <PhoneSetupWizard
          tenantId={tenant.id}
          forwardingNumber={phoneNumber?.e164 ?? ""}
          forwardingVerifiedAt={phoneNumber?.forwarding_verified_at}
          onboarding
        />
      </Container>
    </Section>
  );
}
