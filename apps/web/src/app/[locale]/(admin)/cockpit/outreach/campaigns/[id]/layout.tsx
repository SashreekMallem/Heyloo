import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Campaign detail — Heyloo Cockpit" };

export default function OutreachCampaignsDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
