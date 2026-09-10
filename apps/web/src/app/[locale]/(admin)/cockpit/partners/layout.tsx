import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Partners — Heyloo Cockpit" };

export default function PartnersLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
