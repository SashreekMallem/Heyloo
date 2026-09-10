import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Leads — Heyloo Cockpit" };

export default function OutreachLeadsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
