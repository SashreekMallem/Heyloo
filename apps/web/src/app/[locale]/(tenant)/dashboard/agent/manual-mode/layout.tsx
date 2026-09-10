import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Manual Mode — Heyloo" };

export default function ManualModeLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
