import type { Metadata } from "next";
import type { ReactNode } from "react";

// `page.tsx` in this directory is a "use client" component (the component
// gallery), so it cannot export `metadata` itself — a plain server-component
// sibling layout is the only way this route gets a real document title.
export const metadata: Metadata = { title: "Component gallery — Heyloo" };

export default function PreviewSystemLayout({ children }: { children: ReactNode }) {
  return children;
}
