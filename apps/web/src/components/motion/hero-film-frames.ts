/**
 * Frame-sequence math for the hero film scrubber
 * (`hero-film-scrubber.tsx`) — the scroll-scrubbed replacement for the
 * old WebGL line morph (`components/three/*`, deleted). Pure functions
 * only (no DOM/React), so every rule here is unit-testable without a
 * browser: which asset frame a given scroll progress resolves to, the
 * order frames should be prefetched in, and the cover-fit placement math
 * the canvas draw loop uses every tick.
 *
 * Asset paths: `apps/web/public/site/hero-film/{light,dark}/f001.webp`
 * … `f097.webp` + `poster.webp` (frame 1) + `final.webp`/`final-720.webp`
 * (frame 97, full + mobile-width). Already generated and committed — see
 * this task's own CLAUDE.md instructions: never regenerate the numbered
 * frames themselves.
 */

import { HERO_STAGE_RANGES, type HeroStage, resolveHeroStage } from "./hero-story";

export const HERO_FILM_FRAME_COUNT = 97;

export type HeroFilmTheme = "light" | "dark";

export const HERO_FILM_THEMES: readonly HeroFilmTheme[] = ["light", "dark"];

/**
 * How many frames load immediately after hydration, before the visitor
 * has scrolled or interacted at all — small enough to stay well inside
 * the initial-JS/network budget, large enough that a fast, deliberate
 * scroll straight into the pin already has real nearby frames instead of
 * holding on frame 1 (see `computeHeroFilmLoadOrder`: these are simply
 * the first 12 entries of that same priority order).
 */
export const HERO_FILM_EAGER_FRAME_COUNT = 12;

/**
 * First/last frame (1-indexed, inclusive) shown across each
 * `hero-story.ts` stage — verified by opening the actual frames (see
 * this task's own instructions) against the choreography the hero film
 * was generated from:
 *   ring   1–30  — phone rests (1–20), then rings/lifts/tilts (20–34,
 *                  straddling this boundary — the frames themselves
 *                  don't snap cleanly at 30, matching the brief's own
 *                  "±3 frames" tolerance).
 *   answer 30–66 — the ember sound ribbon flows and undulates under the
 *                  lifted phone (AI talking) — verified: frame 34 is the
 *                  ribbon's first visible frame, it's still visibly
 *                  undulating through the high-40s/mid-50s, and has
 *                  largely straightened by the mid-60s.
 *   book   66–82 — the ribbon straightens/thickens into a bar, then
 *                  resolves into the white card — verified: by frame 78
 *                  the card shape already reads clearly in both themes.
 *   land   82–97 — the card finishes settling flat/centred-low as the
 *                  phone drifts out of frame — verified: the phone is
 *                  fully gone and the card fully still by the high-80s
 *                  in both themes.
 * Confirmed the same (well within ±3 frames) in BOTH `light/` and
 * `dark/` — a single shared table drives both frame sets; there is no
 * per-theme divergence to encode.
 */
export const HERO_FILM_STAGE_FRAMES: Readonly<Record<HeroStage, { first: number; last: number }>> =
  {
    ring: { first: 1, last: 30 },
    answer: { first: 30, last: 66 },
    book: { first: 66, last: 82 },
    land: { first: 82, last: 97 },
  };

function clampFrame(frame: number, frameCount: number): number {
  return Math.min(frameCount, Math.max(1, Math.round(frame)));
}

/**
 * Resolves a raw 0-1 scroll progress to the exact hero-film frame to
 * draw — a PIECEWISE-LINEAR map pinned at `hero-story.ts`'s own stage
 * boundaries (via `resolveHeroStage`), never one global ease across the
 * whole 1-97 range. This is what keeps the DOM story overlay
 * (`hero-story-overlay.tsx`, driven by the same `resolveHeroStage`) in
 * lockstep with the physical object: at any given progress, both this
 * function and the overlay agree on which stage (and how far through it)
 * the visitor is at.
 */
export function frameForProgress(progress: number, frameCount = HERO_FILM_FRAME_COUNT): number {
  const { stage, stageProgress } = resolveHeroStage(progress);
  const range = HERO_FILM_STAGE_FRAMES[stage];
  const frame = range.first + (range.last - range.first) * stageProgress;
  return clampFrame(frame, frameCount);
}

/**
 * Binary-subdivision prefetch order: load the two endpoints first, then
 * repeatedly bisect every still-un-loaded gap, breadth-first — so a
 * visitor who scrolls straight to any point in the timeline is never
 * more than a shrinking handful of frames away from one already loaded
 * (`hero-film-scrubber.tsx` draws the nearest loaded frame while the
 * exact one is still in flight). For 97 frames this produces
 * `1, 97, 49, 25, 73, 13, 37, 61, 85, …` — the first
 * `HERO_FILM_EAGER_FRAME_COUNT` of this exact order are what load
 * immediately post-hydration; the rest load in this same order, just
 * deferred (idle time, after the visitor engages).
 */
export function computeHeroFilmLoadOrder(frameCount = HERO_FILM_FRAME_COUNT): number[] {
  if (frameCount <= 0) return [];
  if (frameCount === 1) return [1];

  const order: number[] = [1, frameCount];
  const seen = new Set(order);
  let intervals: Array<[number, number]> = [[1, frameCount]];

  while (intervals.length > 0) {
    const next: Array<[number, number]> = [];
    for (const [lo, hi] of intervals) {
      if (hi - lo <= 1) continue; // no integer strictly between lo and hi
      const mid = Math.round((lo + hi) / 2);
      if (!seen.has(mid)) {
        order.push(mid);
        seen.add(mid);
      }
      if (mid > lo) next.push([lo, mid]);
      if (hi > mid) next.push([mid, hi]);
    }
    intervals = next;
  }

  // Safety net only — the bisection above always reaches every integer
  // in [1, frameCount] for any frameCount, so this loop is a no-op in
  // practice; kept so a future caller can never end up with a partial
  // order for some pathological frameCount.
  for (let i = 1; i <= frameCount; i++) {
    if (!seen.has(i)) {
      order.push(i);
      seen.add(i);
    }
  }

  return order;
}

export interface HeroFilmCoverFit {
  /** Destination x/y/width/height (canvas pixel space) to draw the FULL source image at, so it covers the box, centered, cropping overflow. */
  dx: number;
  dy: number;
  dWidth: number;
  dHeight: number;
  scale: number;
}

/**
 * `background-size: cover`-equivalent placement for `ctx.drawImage`:
 * scales the source image up just enough that it fully covers the
 * destination box on both axes, then centers it (the box clips whatever
 * hangs outside its own bounds — canvas does this automatically). Pure
 * math, no DOM access, so it's usable from both the real draw loop and a
 * test.
 */
export function computeHeroFilmCoverFit(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): HeroFilmCoverFit {
  if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { dx: 0, dy: 0, dWidth: containerWidth, dHeight: containerHeight, scale: 1 };
  }
  const scale = Math.max(containerWidth / imageWidth, containerHeight / imageHeight);
  const dWidth = imageWidth * scale;
  const dHeight = imageHeight * scale;
  return {
    dx: (containerWidth - dWidth) / 2,
    dy: (containerHeight - dHeight) / 2,
    dWidth,
    dHeight,
    scale,
  };
}

/** Zero-padded `f001`…`f097` frame basename (no extension). */
export function heroFilmFrameBasename(frameIndex: number): string {
  return `f${String(frameIndex).padStart(3, "0")}`;
}

const HERO_FILM_BASE_PATH = "/site/hero-film";

export function heroFilmFramePath(theme: HeroFilmTheme, frameIndex: number): string {
  return `${HERO_FILM_BASE_PATH}/${theme}/${heroFilmFrameBasename(frameIndex)}.webp`;
}

export function heroFilmPosterPath(theme: HeroFilmTheme): string {
  return `${HERO_FILM_BASE_PATH}/${theme}/poster.webp`;
}

export function heroFilmFinalPath(theme: HeroFilmTheme): string {
  return `${HERO_FILM_BASE_PATH}/${theme}/final.webp`;
}

export function heroFilmFinal720Path(theme: HeroFilmTheme): string {
  return `${HERO_FILM_BASE_PATH}/${theme}/final-720.webp`;
}

export interface HeroFilmRect {
  /** Left/right edge, as a 0-1 fraction of the 16:9 frame's width. */
  x0: number;
  x1: number;
  /** Top/bottom edge, as a 0-1 fraction of the 16:9 frame's height. */
  y0: number;
  y1: number;
}

/**
 * Screen rect the white booking card settles into by the end of the
 * film (frame 97, held from the "land" stage's start) — measured
 * directly off the committed frames (a thresholded pixel scan of
 * `f090.webp`/`f097.webp` in both themes, cross-checked by eye), NOT
 * estimated. The two themes genuinely differ (the dark set's card sits
 * higher and wider in frame than the light set's), so this is two
 * independently-measured rects, not one shared guess.
 *
 * `hero-story-overlay.tsx`'s "book"/"land" panels are positioned against
 * this exact rect (in the theme the visitor is seeing) so the real
 * booking-card/dashboard-row DOM panel lands ON the film's own white
 * card, not just "somewhere over the canvas."
 */
export const HERO_FILM_CARD_RECT: Readonly<Record<HeroFilmTheme, HeroFilmRect>> = {
  light: { x0: 0.185, x1: 0.79, y0: 0.625, y1: 0.785 },
  dark: { x0: 0.16, x1: 0.845, y0: 0.5, y1: 0.775 },
};

// Re-exported so callers of this module don't also need to import
// `hero-story.ts` directly just to iterate stages in sync with the
// frame table above.
export { HERO_STAGE_RANGES };
