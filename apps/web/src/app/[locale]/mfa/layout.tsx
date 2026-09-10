import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Two-factor authentication — Heyloo",
  description: "Verify your identity to continue.",
  icons: { icon: "/favicon.svg" },
};

export default function MfaLayout({ children }: { children: ReactNode }) {
  return children;
}
