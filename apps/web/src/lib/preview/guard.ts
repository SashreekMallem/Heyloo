/**
 * UI PREVIEW MODE guard (docs/DESIGN_SYSTEM.md §UI Preview Mode). Every
 * route under `apps/web/src/app/[locale]/(preview)/` calls
 * `assertPreviewEnabled()` at the very top of its render — the check is a
 * RUNTIME one (not just "the route wasn't built"), so a stray build that
 * somehow includes this route group still 404s on request in production.
 *
 * Deliberately two independent conditions, both required:
 *  - `UI_PREVIEW_MODE === "1"` — an explicit opt-in, never on by default.
 *  - `NODE_ENV !== "production"` — a hard floor; there is no env var that
 *    can re-enable this in a production deployment.
 *
 * `UI_PREVIEW_MODE` (no `NEXT_PUBLIC_` prefix) is only ever visible where
 * `process.env` is the real process environment — server render, Route
 * Handlers, `next.config.ts` itself. A client bundle can't see it at all
 * (it's compiled away), which is exactly why `installPreviewFetchMock()`
 * silently never ran for browser-side `fetch()` calls (admin/partner
 * `"use client"` hooks) even with the server correctly mocked — see
 * `docs/audit/DESIGN_REQUESTS.md`'s ADMIN/PARTNER entry.
 * `NEXT_PUBLIC_UI_PREVIEW_MODE` is `next.config.ts`'s build-time mirror of
 * this same, already NODE_ENV-gated value (`env: {...}`), so also
 * checking it here covers the browser without weakening the floor above —
 * a production build always inlines it as `"0"`.
 */
export function isPreviewModeEnabled(): boolean {
  const explicitlyEnabled =
    process.env["UI_PREVIEW_MODE"] === "1" || process.env.NEXT_PUBLIC_UI_PREVIEW_MODE === "1";
  return explicitlyEnabled && process.env.NODE_ENV !== "production";
}
