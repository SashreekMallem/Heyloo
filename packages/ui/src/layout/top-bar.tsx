import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import { SidebarTrigger } from "../primitives/sidebar.js";

export interface TopBarProps {
  logo?: ReactNode;
  children?: ReactNode;
  className?: string;
  showSidebarTrigger?: boolean;
}

/** Tenant/admin/partner topbar shell — logo/branding, then role-specific slots (NotificationCenter, RealtimeIndicator, CommandPalette, user menu, ImpersonationBanner) supplied by the caller (FRONTEND_SPEC.md §9.2). */
export function TopBar({ logo, children, className, showSidebarTrigger = true }: TopBarProps) {
  return (
    <header
      className={cn("flex h-14 shrink-0 items-center gap-3 border-b border-border px-4", className)}
    >
      {showSidebarTrigger && <SidebarTrigger />}
      {logo && <div className="flex items-center gap-2">{logo}</div>}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}
