import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Replies — Heyloo Cockpit" };

export default function OutreachRepliesLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
