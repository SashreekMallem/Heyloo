import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Support ticket — Heyloo Cockpit" };

export default function SupportDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
