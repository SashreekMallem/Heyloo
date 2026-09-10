import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Integrations — Heyloo" };

export default function IntegrationsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
