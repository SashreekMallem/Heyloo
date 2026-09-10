import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Tenant detail — Heyloo Cockpit" };

export default function TenantsDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
