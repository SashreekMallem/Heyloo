import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "AI Instructions — Heyloo" };

export default function InstructionsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
