import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Hours — Heyloo" };

export default function HoursLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
