import type { ReactNode } from "react";
import { AdminShellClient } from "@/components/admin/admin-shell-client";
import { requireAdminSession } from "@/lib/auth/require-admin-session";

/** (admin) root layout — guard #2: platform_admin claim + AAL2 (FRONTEND_SPEC.md §0.1/§7). No realtime provider — admin/partner poll (§0.3). */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminSession("/cockpit");
  return <AdminShellClient>{children}</AdminShellClient>;
}
