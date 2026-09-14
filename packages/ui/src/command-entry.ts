/**
 * `@heyloo/ui/command` — the whole cmdk-backed surface (both the raw
 * `Command*` primitives and the admin-only `CommandPalette` built on top
 * of them) as one subpath, kept OUT of the main `@heyloo/ui` barrel. See
 * `custom/index.ts`'s and `primitives/index.ts`'s comments at the
 * exclusion sites, and `index.ts`'s header comment for the `charts`
 * precedent this mirrors — a real 3rd-party dependency (`cmdk`) with a
 * single, non-marketing call site (the admin topbar ⌘K palette,
 * `apps/web/src/components/admin/admin-shell-client.tsx`) has no reason
 * to be reachable from every consumer of the main barrel.
 */

export * from "./custom/command-palette.js";
export * from "./primitives/command.js";
