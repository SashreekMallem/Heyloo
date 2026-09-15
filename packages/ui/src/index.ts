/**
 * @heyloo/ui — shared component library for the tenant dashboard, admin
 * cockpit, and partner portal (FRONTEND_SPEC.md §1). shadcn/ui-style
 * primitives (Radix + Tailwind v4, owned in-repo per FRONTEND_STACK.md, not
 * a runtime dependency) plus the custom components named in §1.3.
 * `./styles.css` (see package.json exports) carries the Tailwind v4 theme
 * tokens — import it once from the app root.
 *
 * Charts (`recharts`) are deliberately NOT re-exported from here — import
 * them from `@heyloo/ui/charts` instead (a separate `exports` subpath,
 * `package.json`). SITE REPAIR finding: the marketing home route's
 * initial JS measured 955.2KB gz against a 250KB budget, with a single
 * 292KB gz chunk containing `recharts`/`date-fns`/`zod` pulled in purely
 * by `DashboardPreview` (a marketing-route component) importing OTHER,
 * unrelated named exports from this same barrel (`MetricCard`,
 * `CallFeedItem`, etc.) — `"sideEffects": false` (package.json) plus
 * Next's `optimizePackageImports` were both added first and neither
 * fully eliminated it in a real measured build; physically keeping
 * `charts/*` out of this entry point's own module graph is the fix that
 * actually guarantees it, regardless of bundler tree-shaking heuristics.
 *
 * Same pattern, same finding's own documented follow-up: the admin ⌘K
 * palette (`cmdk`) and the MFA OTP input (`input-otp`) are likewise NOT
 * re-exported from here — import from `@heyloo/ui/command` /
 * `@heyloo/ui/input-otp` instead. Both were confirmed present (by
 * literal string-marker search) in the home route's built chunks despite
 * having zero marketing-route call sites.
 *
 * Same pattern again (SITE REPAIR, next round): the calendar/date-range
 * surface (`Calendar`, `DateRangePicker`, `DateRangePills` — pulls in
 * `react-day-picker`/`date-fns`, its only call site the tenant dashboard
 * overview's date-range filter) is likewise NOT re-exported from here —
 * import from `@heyloo/ui/date-range` instead.
 */
// Kept in its own module so this file stays a PURE re-export barrel: Next's
// `optimizePackageImports` barrel optimizer (next.config.ts) only rewrites
// `import { X } from "@heyloo/ui"` into direct module imports when the entry
// contains nothing but re-exports. One `export const` here made it bail,
// which leaked every "use client" primitive reachable from this barrel into
// the marketing home route's initial JS (Radix, react-hook-form, table-core,
// zod via price-card → canonical-types) — measured ~120KB gz of dead weight.

export * from "./custom/index.js";
export * from "./forms/index.js";
export * from "./icons/index.js";
export * from "./layout/index.js";
export * from "./lib/format-phone.js";
export * from "./lib/utils.js";
export * from "./motion-tokens.js";
export * from "./primitives/index.js";
export { UI_PACKAGE_VERSION } from "./version.js";
