import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Alert rules — Heyloo Cockpit" };

export default function AlertsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
