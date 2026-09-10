import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Cost vs. billed by call — Heyloo Cockpit" };

export default function MarginCallsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
