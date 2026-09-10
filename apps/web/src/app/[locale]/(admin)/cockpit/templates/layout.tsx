import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Templates — Heyloo Cockpit" };

export default function TemplatesLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
