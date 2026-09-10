import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Referral P&L — Heyloo Cockpit" };

export default function MarginReferralsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
