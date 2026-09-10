import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Margin waterfall — Heyloo Cockpit" };

export default function MarginWaterfallLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
