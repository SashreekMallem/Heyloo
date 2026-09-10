import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Margin by customer — Heyloo Cockpit" };

export default function MarginCustomersLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
