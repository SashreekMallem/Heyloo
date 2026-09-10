import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "New campaign — Heyloo Cockpit" };

export default function OutreachCampaignsNewLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
