/**
 * Perf budget thresholds — verbatim from the marketing-site creative
 * brief's binding STANDARD ("Performance is part of premium"):
 *
 *   "LCP < 2.5s on a mid-range laptop, CLS < 0.05, initial JS for the
 *   home route < 250KB gz (3D engine lazy-loaded after first paint and
 *   only when the device qualifies)"
 *
 * `scripts/site-perf/measure.ts` checks a real production build+server
 * against these; `.github/workflows/ci.yml`'s `site-perf-budget` job
 * fails the build on any violation. Kept as a separate, dependency-free
 * module (no import of `measure.ts`'s Playwright/child_process code) so
 * a reviewer — or a future budget change — can read/adjust the numbers
 * without touching the measurement mechanics, and so a unit test can
 * import just this file.
 */

export interface RouteBudget {
  /** Route path to measure, relative to the app's origin (no locale prefix needed — `localePrefix: "as-needed"`, docs/DESIGN_SYSTEM.md/i18n routing). */
  path: string;
  /** Human label for report output. */
  label: string;
  /** Largest Contentful Paint budget, in milliseconds. */
  lcpMs: number;
  /** Cumulative Layout Shift budget (unitless, windowed score). */
  cls: number;
  /**
   * Initial same-origin JS transferred (gzip/br-encoded — i.e. the
   * `Content-Length` actually sent over the wire, not decompressed
   * size), in bytes, for everything loaded during first paint/hydration
   * of THIS route — a lazy-loaded chunk (the 3D engine, GSAP) that only
   * fetches after a later scroll/interaction is correctly excluded,
   * matching the brief's own "lazy-loaded after first paint" carve-out.
   */
  initialJsBytesGz: number;
}

/** CPU throttling applied via CDP before navigating, approximating "a mid-range laptop" rather than measuring on the CI runner's own (typically fast, cloud-grade) CPU unthrottled. */
export const CPU_THROTTLE_RATE = 4;

export const ROUTE_BUDGETS: RouteBudget[] = [
  {
    path: "/",
    label: "Home",
    lcpMs: 2500,
    cls: 0.05,
    initialJsBytesGz: 250 * 1024,
  },
];
