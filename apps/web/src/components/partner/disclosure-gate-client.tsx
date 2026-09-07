"use client";

import { FTCDisclosureGate } from "@heyloo/ui";
import { useRouter } from "@/i18n/navigation";

export function DisclosureGateClient({ policyVersion }: { policyVersion: string }) {
  const router = useRouter();

  async function acknowledge(version: string) {
    const res = await fetch("/api/partner/disclosure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy_version: version, acknowledged: true }),
    });
    if (res.ok) router.push("/portal");
  }

  return <FTCDisclosureGate policyVersion={policyVersion} onAcknowledge={acknowledge} />;
}
