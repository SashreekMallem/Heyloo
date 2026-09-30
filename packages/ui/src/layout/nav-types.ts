import type { ComponentType } from "react";

export interface NavItem {
  label: string;
  href: string;
  icon?: ComponentType<{ className?: string }>;
  /** Active only on this exact path, never on a nested one — for a section root (`/dashboard`) that prefixes every other item. */
  exact?: boolean;
}

function normalizePath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
}

/** True when `activeHref` is `item.href` itself, or (unless `item.exact`) a path nested under it. */
export function isNavItemActive(
  item: Pick<NavItem, "href" | "exact">,
  activeHref: string,
): boolean {
  const path = normalizePath(activeHref);
  if (path === item.href) return true;
  return !item.exact && path.startsWith(`${item.href}/`);
}

/**
 * The single item that is "current" for `activeHref`: among every item that
 * matches, the one with the LONGEST `href` wins, so a section root like
 * `/dashboard` is never highlighted alongside `/dashboard/calls` (QA-1 F-01).
 * Returns `undefined` when nothing matches.
 */
export function resolveActiveNavHref(
  items: Pick<NavItem, "href" | "exact">[],
  activeHref: string,
): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    if (!isNavItemActive(item, activeHref)) continue;
    if (best === undefined || item.href.length > best.length) best = item.href;
  }
  return best;
}
