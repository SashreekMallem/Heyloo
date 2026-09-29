import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "No access — Heyloo",
  description: "Your account can't open that page.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false },
};

export default function NoAccessLayout({ children }: { children: ReactNode }) {
  return children;
}
