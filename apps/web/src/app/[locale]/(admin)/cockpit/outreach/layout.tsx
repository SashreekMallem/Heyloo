import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Outreach — Heyloo Cockpit" };

export default function OutreachLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
