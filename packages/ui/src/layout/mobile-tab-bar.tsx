import type { ReactElement } from "react";
import { cn } from "../lib/utils.js";
import type { NavItem } from "./nav-types.js";

export interface MobileTabBarProps {
  items: NavItem[];
  activeHref: string;
  renderLink: (item: NavItem, isActive: boolean) => ReactElement;
  className?: string;
}

/** Bottom tab bar for the tenant dashboard's mobile nav — Overview / Calls / Bookings / Customers / More (FRONTEND_SPEC.md §9.2). */
export function MobileTabBar({ items, activeHref, renderLink, className }: MobileTabBarProps) {
  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background md:hidden",
        className,
      )}
    >
      {items.map((item) => {
        const isActive = activeHref === item.href || activeHref.startsWith(`${item.href}/`);
        return (
          <div key={item.href} className="flex-1">
            {renderLink(item, isActive)}
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
