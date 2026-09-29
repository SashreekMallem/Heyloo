import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Text messaging — Heyloo" };

export default function TextingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
