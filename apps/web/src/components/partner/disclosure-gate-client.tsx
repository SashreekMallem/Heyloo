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

  return (
    <>
      {/* `<FTCDisclosureGate>`'s own "FTC disclosure requirement" heading
          is a `CardTitle` (`packages/ui`'s `Card` primitive renders it as
          a plain `<div>`, not an `<hN>`) — this page otherwise has no
          heading at all, failing axe `page-has-heading-one` (admin-partner
          design review round 5, moderate). `sr-only` since the gate is
          already a self-explanatory, single-purpose full-screen card;
          adding a second *visible* title above it would just repeat the
          card's own heading. */}
      <h1 className="sr-only">Disclosure</h1>
      <FTCDisclosureGate policyVersion={policyVersion} onAcknowledge={acknowledge} />
    </>
  );
}
