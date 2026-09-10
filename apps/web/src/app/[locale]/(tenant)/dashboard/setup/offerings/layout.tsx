import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Offerings & menu — Heyloo" };

export default function OfferingsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
