import type { ReactNode } from "react";
import { MarginControlsProvider } from "@/components/admin/margin-controls";

/** Keeps the margin pages' period / "include test data" choice alive while navigating between them (COCKPIT-F20). */
export default function MarginLayout({ children }: { children: ReactNode }) {
  return <MarginControlsProvider>{children}</MarginControlsProvider>;
}
