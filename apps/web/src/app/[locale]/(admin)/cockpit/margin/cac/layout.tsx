import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Customer acquisition cost — Heyloo Cockpit" };

export default function MarginCacLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
