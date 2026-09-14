import type { ReactNode } from "react";
import { AdminShellClient } from "@/components/admin/admin-shell-client";
import { requireAdminSession } from "@/lib/auth/require-admin-session";
import { SentryInit } from "@/lib/perf/sentry-init";

/** (admin) root layout — guard #2: platform_admin claim + AAL2 (FRONTEND_SPEC.md §0.1/§7). No realtime provider — admin/partner poll (§0.3). Mounts `<SentryInit>` (see that file's docstring) — error monitoring is route-group-scoped, never reachable from the marketing bundle. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminSession("/cockpit");
  return (
    <>
      <SentryInit />
      <AdminShellClient>{children}</AdminShellClient>
    </>
  );
}
