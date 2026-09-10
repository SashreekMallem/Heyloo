import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Customer margin detail — Heyloo Cockpit" };

export default function MarginCustomersDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
