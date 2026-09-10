import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Refer & earn — Heyloo" };

export default function ReferLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
