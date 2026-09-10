import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Vertical details — Heyloo" };

export default function VerticalDetailsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
