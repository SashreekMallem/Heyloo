import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PartnerShellClient } from "@/components/partner/partner-shell-client";
import { requirePartnerSession } from "@/lib/auth/require-partner-session";
import { SentryInit } from "@/lib/perf/sentry-init";

/** (partner) root layout — guard #2: referral_partner_id claim + FTC disclosure gate, blocking (FRONTEND_SPEC.md §0.1/§8.4). No realtime provider — admin/partner poll (§0.3). Mounts `<SentryInit>` (see that file's docstring) — error monitoring is route-group-scoped, never reachable from the marketing bundle. */
export default async function PartnerLayout({ children }: { children: ReactNode }) {
  const { partner, acknowledged } = await requirePartnerSession("/portal");

  const pathname = (await headers()).get("x-pathname") ?? "";
  if (!acknowledged && !pathname.endsWith("/portal/disclosure")) {
    redirect("/portal/disclosure");
  }

  return (
    <>
      <SentryInit />
      <PartnerShellClient partnerName={partner.name}>{children}</PartnerShellClient>
    </>
  );
}
