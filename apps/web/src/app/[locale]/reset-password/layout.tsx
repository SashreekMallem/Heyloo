import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Reset your password — Heyloo",
  description: "Request a password reset link or set a new password.",
  icons: { icon: "/favicon.svg" },
};

export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
