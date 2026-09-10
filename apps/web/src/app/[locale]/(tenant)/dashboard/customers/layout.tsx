import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Customers — Heyloo" };

export default function CustomersLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
