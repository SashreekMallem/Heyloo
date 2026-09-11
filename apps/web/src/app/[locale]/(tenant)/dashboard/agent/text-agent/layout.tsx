import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Text Agent — Heyloo" };

export default function TextAgentLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
