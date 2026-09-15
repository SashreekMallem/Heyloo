/**
 * `@heyloo/ui/notification` — the tenant/admin/partner topbar
 * `NotificationCenter` and the raw `Popover`/`ScrollArea` primitives it's
 * built on, kept OUT of the main `@heyloo/ui` barrel. See
 * `custom/index.ts`'s and `primitives/index.ts`'s comments at the
 * exclusion sites, and `index.ts`'s header comment for the
 * `charts`/`command`/`date-range` precedent this mirrors — a real
 * 3rd-party dependency (`@radix-ui/react-popover`,
 * `@radix-ui/react-scroll-area`) with a single, non-marketing call site
 * (the tenant shell topbar, `apps/web/src/components/tenant/
 * tenant-shell-client.tsx`) has no reason to be reachable from every
 * consumer of the main barrel.
 */

export * from "./custom/notification-center.js";
export * from "./primitives/popover.js";
export * from "./primitives/scroll-area.js";
