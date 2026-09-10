import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Config Lab — Heyloo Cockpit" };

export default function ConfigLabLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
