import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { AnchorHTMLAttributes, Ref } from "react";
import { cn } from "../lib/utils.js";

/**
 * `NavLink` — a new shared primitive (this pass) for a single top-level
 * nav link: the marketing header's desktop nav, the tenant/admin sidebar
 * nav item, a footer link list. (Named `NavLink`, not `NavItem` — that
 * name is already `layout/nav-types.ts`'s plain nav-config data
 * interface, `{label, href, icon}`, consumed by `AppSidebarNav`/
 * `MobileTabBar`; this is the rendered link itself, a different kind of
 * thing, so it needed a different name to avoid a `tsc -b` re-export
 * collision — `layout/index.ts`'s `NavItem` type export and this
 * component both flow through `primitives/index.ts` → `index.ts`.)
 * Not a replacement for `AppSidebarNav`/`MobileTabBar`, which own the
 * full nav chrome (icons, collapsed states, active-route wiring) — this
 * is the one link primitive underneath, so every nav surface's link
 * gets the same touch target, focus ring, and hover affordance instead
 * of each screen hand-rolling its own.
 *
 * Micro-interaction: an underline that grows in from the left on
 * hover/focus (`::after`, `scaleX` — `transform`-only, main-thread-cheap,
 * WEBSITE_CREATIVE_BRIEF.md's "no jank" rule) rather than a background
 * fill — reads as premium restraint per docs/DESIGN_SYSTEM.md, not a
 * shadcn-demo hover state. `active` (the current route) shows the same
 * underline permanently, full width, no hover motion needed. Collapses
 * to an instant show/hide under `prefers-reduced-motion` via the
 * blanket rule in `theme/globals.css`.
 */
export const navLinkVariants = cva(
  [
    "relative inline-flex h-11 items-center px-1 text-sm font-medium text-muted-foreground",
    "outline-none transition-colors duration-(--duration-fast) ease-(--ease-out)",
    "hover:text-foreground focus-visible:text-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xs",
    "lg:h-9",
    // The underline itself: an absolutely-positioned ::after, scaled
    // from 0 on the transform axis only (never animating width/left,
    // which would trigger layout) — see docstring.
    "after:absolute after:inset-x-1 after:bottom-1 after:h-px after:origin-left after:scale-x-0",
    "after:bg-accent after:transition-transform after:duration-(--duration-fast) after:ease-(--ease-out)",
    "hover:after:scale-x-100 focus-visible:after:scale-x-100",
  ].join(" "),
  {
    variants: {
      active: {
        true: "text-foreground after:scale-x-100",
        false: "",
      },
    },
    defaultVariants: { active: false },
  },
);

export interface NavLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof navLinkVariants> {
  /** Render as the single child element instead of an `<a>` — the usual pattern for wrapping next-intl's/next's own `<Link>` so client-side routing keeps working. */
  asChild?: boolean;
  ref?: Ref<HTMLAnchorElement> | undefined;
}

export function NavLink({ className, active, asChild = false, ref, ...props }: NavLinkProps) {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      ref={ref}
      className={cn(navLinkVariants({ active }), className)}
      aria-current={active ? "page" : undefined}
      {...props}
    />
  );
}
