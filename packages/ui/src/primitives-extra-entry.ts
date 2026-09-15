/**
 * `@heyloo/ui/primitives-extra` — the raw Radix-backed primitives with
 * ZERO consumers anywhere in `apps/web` today (`Collapsible`,
 * `DropdownMenu*`, `HoverCard*`, `NavigationMenu*`, `RadioGroup*`), kept
 * OUT of the main `@heyloo/ui` barrel. See `primitives/index.ts`'s
 * comment at the exclusion site, and `index.ts`'s header comment for the
 * `charts`/`command`/`date-range` precedent this mirrors — grep-confirmed
 * (SITE REPAIR, 5th pass) that none of these are imported by name
 * anywhere in `apps/web` or elsewhere in `packages/ui/src`, so there is
 * no reason for their Radix packages to be reachable (and therefore
 * bundled) from every consumer of the main barrel, marketing routes
 * included. If/when a real consumer needs one of these, import it from
 * here rather than adding it back to the main barrel.
 */

export * from "./primitives/collapsible.js";
export * from "./primitives/dropdown-menu.js";
export * from "./primitives/hover-card.js";
export * from "./primitives/navigation-menu.js";
export * from "./primitives/radio-group.js";
