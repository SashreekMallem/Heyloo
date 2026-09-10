import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Tool latency & error rate — Heyloo Cockpit" };

export default function MarginBottlenecksLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
