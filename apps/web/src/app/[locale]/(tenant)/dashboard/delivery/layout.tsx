import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Delivery preferences — Heyloo" };

export default function DeliveryLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
