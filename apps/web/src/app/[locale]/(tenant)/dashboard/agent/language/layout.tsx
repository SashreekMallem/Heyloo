import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Language — Heyloo" };

export default function LanguageLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
