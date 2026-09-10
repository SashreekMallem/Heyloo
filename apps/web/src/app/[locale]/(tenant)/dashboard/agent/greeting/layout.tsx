import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Greeting & Persona — Heyloo" };

export default function GreetingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
