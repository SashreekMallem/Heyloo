/**
 * Motion tokens for scroll-linked / set-piece animation
 * (docs/design/WEBSITE_CREATIVE_BRIEF.md). JS-side companions to the CSS
 * custom properties in `theme/globals.css` (`--duration-fast/base/slow`,
 * `--ease-out`, `--ease-in-out`) — GSAP timelines, `useFrame` lerps, and
 * plain `requestAnimationFrame` loops all need numeric milliseconds /
 * cubic-bezier control points, which a CSS custom property can't hand to
 * JS directly (and some of these are needed before any DOM element
 * exists to read a computed style from, e.g. configuring a GSAP tween at
 * call time). Kept hand-in-sync with `globals.css`'s own motion tokens
 * rather than derived from them — if one changes, change both.
 *
 * These are the durations/easings ENGINE and PAGES-cluster motion code
 * shares; the underlying design decision ("150-250ms, ease-out") is
 * `docs/DESIGN_SYSTEM.md`'s, this file just makes it addressable from JS.
 */

/** Mirrors `--duration-fast/base/slow` (globals.css), in milliseconds. */
export const MOTION_DURATIONS_MS = {
  fast: 150,
  base: 200,
  slow: 250,
} as const;

export type MotionDurationToken = keyof typeof MOTION_DURATIONS_MS;

/**
 * Mirrors `--ease-out` / `--ease-in-out` (globals.css). Both the CSS
 * string (drop into an inline `transition`/`animation-timing-function`)
 * and the bare cubic-bezier control points (GSAP's `ease` option also
 * accepts a `"cubic-bezier(x1,y1,x2,y2)"` string — `css` works there too
 * — but a hand-rolled lerp, e.g. driving a Three.js morph off a manual
 * easing curve, needs the raw numbers) are exported.
 */
export const MOTION_EASES = {
  out: { css: "cubic-bezier(0.16, 1, 0.3, 1)", points: [0.16, 1, 0.3, 1] },
  inOut: { css: "cubic-bezier(0.65, 0, 0.35, 1)", points: [0.65, 0, 0.35, 1] },
} as const;

export type MotionEaseToken = keyof typeof MOTION_EASES;

/**
 * GSAP ScrollTrigger `scrub` value for every scroll-linked set piece
 * (WEBSITE_CREATIVE_BRIEF.md §2: "a value near 0.5, never `true`/`1:1`,
 * so motion has a hair of inertia rather than feeling glued to the
 * wheel"). A single shared constant so no set piece accidentally ships
 * `scrub: true`.
 */
export const SCROLL_SCRUB = 0.5;

/**
 * Pin distance (in viewport-height units) for the hero set piece's
 * pinned scroll timeline, by qualifying device tier
 * (WEBSITE_CREATIVE_BRIEF.md §3: "~250vh" desktop, "~180vh" tablet —
 * non-qualifying/mobile tiers don't pin at all, see
 * `apps/web/src/components/motion/hero-scroll-scene.tsx`).
 */
export const HERO_PIN_VH = {
  desktop: 250,
  tablet: 180,
} as const;

/**
 * Entrance-stagger timing for grid/list reveal sections that are
 * triggered once on enter, never scroll-scrubbed (business-types grid,
 * dashboard-reveal call-feed rows — WEBSITE_CREATIVE_BRIEF.md §2).
 */
export const ENTRANCE_STAGGER_MS = {
  grid: 40,
  row: 50,
} as const;
