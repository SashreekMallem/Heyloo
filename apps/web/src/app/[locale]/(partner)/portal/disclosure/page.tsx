import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DisclosureGateClient } from "@/components/partner/disclosure-gate-client";
import { requirePartnerSession } from "@/lib/auth/require-partner-session";

export const metadata: Metadata = { title: "Disclosure — Heyloo" };

export default async function DisclosurePage() {
  const { acknowledged, policyVersion } = await requirePartnerSession("/portal/disclosure");
  if (acknowledged) redirect("/portal");
  return <DisclosureGateClient policyVersion={policyVersion} />;
}
