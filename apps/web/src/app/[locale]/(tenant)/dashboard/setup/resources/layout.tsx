import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Resources — Heyloo" };

export default function SetupResourcesLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
