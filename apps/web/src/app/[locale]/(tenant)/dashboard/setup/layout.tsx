import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Setup — Heyloo" };

export default function SetupLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
