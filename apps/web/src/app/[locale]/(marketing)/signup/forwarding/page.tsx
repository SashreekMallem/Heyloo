import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PhoneSetupWizard } from "@/components/phone-setup/phone-setup-wizard";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { getLineReadiness } from "@/lib/signup/line-readiness";

export const metadata: Metadata = { title: "Forward your number — Heyloo" };

/**
 * Signup step 6 — the same wizard as `/dashboard/phone-setup`, in onboarding
 * mode (FRONTEND_SPEC.md §4.6). Guard: authenticated tenant whose line is
 * live. Without a number there is nothing to forward to, so the codes are
 * never rendered: the customer goes back to the provisioning timeline
 * (SIGNUP-BILL-FIX C).
 */
export default async function SignupForwardingPage() {
  const { supabase, tenant } = await requireTenantSession("/signup/forwarding");

  const line = await getLineReadiness(supabase, tenant.id);
  if (!line.ready || !line.number) redirect("/signup/provisioning");

  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("e164, forwarding_verified_at")
    .eq("tenant_id", tenant.id)
    .is("released_at", null)
    .maybeSingle();
  // Read here rather than in the shared session guard: a failed read only
  // means the carrier step asks for the business phone again.
  const { data: contact } = await supabase
    .from("tenants")
    .select("business_phone")
    .eq("id", tenant.id)
    .maybeSingle();

  return (
    <Section spacing="default" className="pb-24">
      <Container size="content">
        <h1 className="mb-10 text-center font-display text-h2 font-semibold">Almost there</h1>
        <PhoneSetupWizard
          tenantId={tenant.id}
          forwardingNumber={phoneNumber?.e164 ?? line.number}
          forwardingVerifiedAt={phoneNumber?.forwarding_verified_at}
          businessPhone={contact?.business_phone ?? null}
          onboarding
        />
      </Container>
    </Section>
  );
}
