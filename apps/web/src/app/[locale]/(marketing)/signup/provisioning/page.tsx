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
    <div className="px-4 py-16">
      <h1 className="mb-10 text-center text-2xl font-semibold">Setting up your AI receptionist</h1>
      <ProvisioningClient tenantId={tenant.id} />
    </div>
  );
}
