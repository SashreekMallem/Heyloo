import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Log in — Heyloo",
  description: "Log in to your Heyloo dashboard.",
  icons: { icon: "/favicon.svg" },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
