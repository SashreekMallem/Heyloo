/**
 * `@heyloo/ui/date-range` — the calendar/date-range surface (the raw
 * `Calendar`/`DateRangePicker` primitives and the `DateRangePills` row
 * built on top of them) as one subpath, kept OUT of the main
 * `@heyloo/ui` barrel. See `custom/index.ts`'s, `forms/index.ts`'s, and
 * `primitives/index.ts`'s comments at the exclusion sites, and
 * `index.ts`'s header comment for the `charts`/`command` precedent this
 * mirrors — a real 3rd-party dependency (`react-day-picker`, which pulls
 * in `date-fns`) with a single, non-marketing call site (the tenant
 * dashboard overview's date-range filter,
 * `apps/web/src/components/tenant/overview-client.tsx`) has no reason to
 * be reachable from every consumer of the main barrel.
 */

export * from "./custom/date-range-pills.js";
export * from "./forms/date-range-picker.js";
export * from "./primitives/calendar.js";
