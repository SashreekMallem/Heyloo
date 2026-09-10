"use client";

import { cn, type NavSection } from "@heyloo/ui";
import { Link } from "@/i18n/navigation";

export interface AdminIconRailProps {
  sections: NavSection[];
  activeHref: string;
}

/**
 * Collapsed icon-only sidebar for the 768–1023px range (admin-partner
 * design review round 5, moderate: at 768 the full `<Sidebar>` primitive
 * still renders its uncollapsed w-64 rail, cramping the content column).
 * `packages/ui`'s `Sidebar` has no built-in "icon rail" mode — a real prop
 * for that is requested in `docs/audit/DESIGN_REQUESTS.md`; this is the
 * local fallback that ships the fix now rather than waiting on it,
 * reusing the same `NavSection`/`NavItem` config `<AppSidebarNav>` takes so
 * the two stay in sync automatically.
 */
export function AdminIconRail({ sections, activeHref }: AdminIconRailProps) {
  return (
    <aside
      aria-label="Cockpit navigation, collapsed"
      className="sticky top-0 flex h-svh w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-3"
    >
      {sections
        .flatMap((section) => section.items)
        .map((item) => {
          const isActive = activeHref === item.href || activeHref.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                isActive && "bg-secondary font-medium text-foreground",
              )}
            >
              {Icon && <Icon className="size-4" aria-hidden="true" />}
              <span className="sr-only">{item.label}</span>
            </Link>
          );
        })}
    </aside>
  );
}
