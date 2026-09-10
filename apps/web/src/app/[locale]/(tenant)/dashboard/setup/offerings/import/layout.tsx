import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Import menu — Heyloo" };

export default function ImportOfferingsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
