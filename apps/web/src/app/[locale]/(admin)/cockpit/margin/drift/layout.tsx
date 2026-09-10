import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Repricing drift — Heyloo Cockpit" };

export default function MarginDriftLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
