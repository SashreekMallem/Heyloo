import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Template detail — Heyloo Cockpit" };

export default function TemplatesDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
