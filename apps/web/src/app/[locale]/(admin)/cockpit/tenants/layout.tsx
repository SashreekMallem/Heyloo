import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Tenants — Heyloo Cockpit" };

export default function TenantsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
