import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProvisioningClient } from "@/components/signup/provisioning-client";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Setting up your account — Heyloo" };

/** Signup step 5 (FRONTEND_SPEC.md §4.5). Guard: authenticated tenant session, status not yet active. */
export default async function SignupProvisioningPage() {
  const { tenant } = await requireTenantSession("/signup/provisioning");

  if (tenant.status === "active") redirect("/signup/forwarding");

  return (
    <Section spacing="default" className="flex min-h-svh items-center pb-24">
      <Container size="content">
        <ProvisioningClient tenantId={tenant.id} />
      </Container>
    </Section>
  );
}
