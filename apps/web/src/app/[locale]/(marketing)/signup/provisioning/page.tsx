import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProvisioningClient } from "@/components/signup/provisioning-client";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { getLineReadiness } from "@/lib/signup/line-readiness";

export const metadata: Metadata = { title: "Setting up your account — Heyloo" };

/**
 * Signup step 5 (FRONTEND_SPEC.md §4.5). Guard: authenticated tenant session.
 * Moves on to forwarding only once the line is REALLY live (saga's
 * `publish_agent` succeeded + a phone number exists), never on
 * `tenants.status = 'active'`: that flips at payment confirmation, before
 * the number is bought, which used to skip this timeline entirely
 * (SIGNUP-BILL-FIX C).
 */
export default async function SignupProvisioningPage() {
  const { supabase, tenant } = await requireTenantSession("/signup/provisioning");

  const line = await getLineReadiness(supabase, tenant.id);
  if (line.ready) redirect("/signup/forwarding");

  return (
    <Section spacing="default" className="flex min-h-svh items-center pb-24">
      <Container size="content">
        <ProvisioningClient tenantId={tenant.id} />
      </Container>
    </Section>
  );
}
