import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Services — Heyloo" };

export default function AgentServicesLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
