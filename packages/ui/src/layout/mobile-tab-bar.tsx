import { Slot } from "@radix-ui/react-slot";
import type { ReactElement } from "react";
import { cn } from "../lib/utils.js";
import { useSidebar } from "../primitives/sidebar.js";
import { type NavItem, resolveActiveNavHref } from "./nav-types.js";

export interface MobileTabBarProps {
  items: NavItem[];
  activeHref: string;
  renderLink: (item: NavItem, isActive: boolean) => ReactElement;
  /** Accessible name of the `<nav>` landmark (distinct from the sidebar's "Main"). */
  ariaLabel?: string;
  className?: string;
}

/** Bottom tab bar for the tenant dashboard's mobile nav — Overview / Calls / Bookings / Customers / More (FRONTEND_SPEC.md §9.2). */
export function MobileTabBar({
  items,
  activeHref,
  renderLink,
  ariaLabel = "Primary",
  className,
}: MobileTabBarProps) {
  // Same rule as the sidebar (QA-1 F-01): one current tab, longest href wins,
  // and a root item marked `exact` never matches a nested route.
  const currentHref = resolveActiveNavHref(items, activeHref);
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background md:hidden",
        className,
      )}
    >
      {items.map((item) => {
        const isActive = item.href === currentHref;
        return (
          <div key={item.href} className="flex-1">
            <Slot aria-current={isActive ? "page" : undefined}>{renderLink(item, isActive)}</Slot>
          </div>
        );
      })}
    </nav>
  );
}

export function MobileTabBarLabel({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;
  return (
    <span
      className={cn(
        "flex flex-col items-center gap-0.5 py-2 text-[11px]",
        // text-accent-text, not text-primary: this 11px active-tab label is
        // real text, and the base accent-500 falls below WCAG AA's 4.5:1
        // for normal-weight text (DESIGN-4).
        isActive ? "text-accent-text" : "text-muted-foreground",
      )}
    >
      {Icon && <Icon className="size-5" />}
      {item.label}
    </span>
  );
}

/**
 * The "More" tab: not a destination but a door to every section the four
 * tabs don't cover — it opens the same navigation drawer the top-bar toggle
 * does (QA-1 F-13/MAP-12; it used to link straight to Support). Must render
 * inside `<AppShell>` (it reads the sidebar context).
 */
export function MobileTabBarMenuButton({ item }: { item: NavItem }) {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <button
      type="button"
      className="block w-full"
      aria-haspopup="dialog"
      aria-expanded={openMobile}
      onClick={() => setOpenMobile(true)}
    >
      <MobileTabBarLabel item={item} isActive={false} />
    </button>
  );
}
