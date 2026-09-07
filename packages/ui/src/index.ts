/**
 * @heyloo/ui — shared component library for the tenant dashboard, admin
 * cockpit, and partner portal (FRONTEND_SPEC.md §1). shadcn/ui-style
 * primitives (Radix + Tailwind v4, owned in-repo per FRONTEND_STACK.md, not
 * a runtime dependency) plus the custom components named in §1.3.
 * `./styles.css` (see package.json exports) carries the Tailwind v4 theme
 * tokens — import it once from the app root.
 */
export const UI_PACKAGE_VERSION = "0.1.0" as const;

export * from "./charts/index.js";
export * from "./custom/index.js";
export * from "./forms/index.js";
export * from "./layout/index.js";
export * from "./lib/utils.js";
export * from "./primitives/index.js";
