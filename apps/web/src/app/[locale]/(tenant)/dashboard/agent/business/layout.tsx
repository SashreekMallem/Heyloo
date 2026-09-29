import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Business profile — Heyloo" };

export default function BusinessLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
