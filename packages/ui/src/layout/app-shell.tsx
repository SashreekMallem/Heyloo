import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import { SidebarProvider } from "../primitives/sidebar.js";

export interface AppShellProps {
  sidebar: ReactNode;
  topBar: ReactNode;
  children: ReactNode;
  banner?: ReactNode;
  mobileTabBar?: ReactNode;
  className?: string;
}

/**
 * `<AppShell>` — tenant/admin/partner variants share this composition; the
 * variant-specific pieces (nav sections, topbar contents, the
 * `ManualModeBanner`/`ImpersonationBanner` slot) are supplied by the caller
 * (FRONTEND_SPEC.md §9.2). Admin's "desktop-primary" rule (§0.5) is applied
 * by the caller choosing what to render inside `children` below `md`, not
 * by this shell.
 */
export function AppShell({
  sidebar,
  topBar,
  children,
  banner,
  mobileTabBar,
  className,
}: AppShellProps) {
  return (
    <SidebarProvider>
      {/* MAP-08: first tab stop; lets keyboard users skip the sidebar's ~20 links. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to content
      </a>
      {sidebar}
      <div className={cn("flex min-h-svh min-w-0 flex-1 flex-col", className)}>
        {topBar}
        {banner}
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 focus:outline-none overflow-x-hidden p-4 pb-20 md:pb-4"
        >
          {children}
        </main>
        {mobileTabBar}
      </div>
    </SidebarProvider>
  );
}
