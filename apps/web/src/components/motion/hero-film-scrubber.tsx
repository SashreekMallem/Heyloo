"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { deferUntilInteraction } from "@/lib/perf/defer-non-critical";
import {
  computeHeroFilmCoverFit,
  computeHeroFilmLoadOrder,
  frameForProgress,
  HERO_FILM_EAGER_FRAME_COUNT,
  HERO_FILM_FRAME_COUNT,
  heroFilmFramePath,
  heroFilmPosterPath,
} from "./hero-film-frames";
import { HeroFilmThemedImage } from "./hero-film-themed-image";
import { useResolvedTheme } from "./use-resolved-theme";

/**
 * The scroll-scrubbed frame-sequence film that replaced the WebGL line
 * morph (`components/three/*`, deleted) — the technique behind Apple's
 * product pages: a `<canvas>` painted, every scroll tick, with whichever
 * of the 97 pre-rendered frames the current progress resolves to
 * (`hero-film-frames.ts`'s `frameForProgress`), cover-fit into the box.
 *
 * Mounted ONLY on the qualifying tier (`hero-scroll-scene.tsx`: desktop/
 * tablet ≥768px, `prefers-reduced-motion: no-preference`) — the
 * reduced-motion and mobile tiers render `hero-film-static.tsx`'s static
 * `final.webp` instead and never import this module's frame-loading
 * logic at all.
 */

export interface HeroFilmScrubberProps {
  /** Same ref `hero-scroll-scene.tsx` feeds from `ScrollTrigger`'s own progress — read every animation frame, never React state. */
  progressRef: RefObject<number>;
  className?: string;
}

type FrameSource = ImageBitmap | HTMLImageElement;

function sourceSize(source: FrameSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function disposeSource(source: FrameSource | undefined) {
  if (source && "close" in source && typeof source.close === "function") {
    source.close();
  }
}

function loadImageElement(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const img = new Image();
    const onAbort = () => {
      reject(new DOMException("aborted", "AbortError"));
    };
    img.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`hero film frame failed to load: ${url}`));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    img.src = url;
  });
}

async function loadFrameSource(url: string, signal: AbortSignal): Promise<FrameSource> {
  if (typeof createImageBitmap !== "function") {
    return loadImageElement(url, signal);
  }
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`hero film frame failed to load: ${url} (${response.status})`);
  }
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/** Nearest already-loaded frame to `target` — searches outward both directions so a fast scroll always has SOMETHING to draw instead of blocking. */
function nearestLoadedFrame(
  cache: Map<number, FrameSource>,
  target: number,
  frameCount: number,
): FrameSource | undefined {
  if (cache.has(target)) return cache.get(target);
  for (let delta = 1; delta < frameCount; delta++) {
    const below = target - delta;
    if (below >= 1 && cache.has(below)) return cache.get(below);
    const above = target + delta;
    if (above <= frameCount && cache.has(above)) return cache.get(above);
  }
  return undefined;
}

function scheduleIdle(run: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const ric = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    const handle = ric(run, { timeout: 2000 });
    return () =>
      (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(
        handle,
      );
  }
  const handle = window.setTimeout(run, 200);
  return () => window.clearTimeout(handle);
}

const MAX_DPR = 2;

/**
 * Dissolves the film's hard rectangular edge into the surrounding page
 * background — a checked-in beige/charcoal backdrop meeting the page's
 * own `--background` at a visible seam is a blocker per this task's own
 * instructions. Shared with `hero-film-static.tsx`'s reduced-motion tier
 * so both the scrubbed and static renditions get the identical fade.
 */
export const HERO_FILM_MASK_CSS = `.hero-film-mask { mask-image: radial-gradient(ellipse 62% 62% at 50% 50%, black 68%, transparent 100%); -webkit-mask-image: radial-gradient(ellipse 62% 62% at 50% 50%, black 68%, transparent 100%); }`;

export function HeroFilmScrubber({ progressRef, className }: HeroFilmScrubberProps) {
  const theme = useResolvedTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef<Map<number, FrameSource>>(new Map());
  const [canvasVisible, setCanvasVisible] = useState(false);

  // Frame loading: eager window immediately on mount/theme change, the
  // rest deferred (idle time, after the visitor engages). Re-runs
  // whenever `theme` changes so a mid-visit theme toggle fetches the
  // OTHER theme's frames instead of continuing to draw the old one.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const cache = new Map<number, FrameSource>();
    cacheRef.current = cache;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: resets visibility synchronously at the start of every mount/theme-change run so a theme toggle never draws a stale frame from the OLD theme while the new one's frames are still loading (see this effect's own docstring)
    setCanvasVisible(false);
    let firstReady = false;

    async function loadFrame(index: number) {
      if (cancelled || cache.has(index)) return;
      try {
        const source = await loadFrameSource(heroFilmFramePath(theme, index), controller.signal);
        if (cancelled) {
          disposeSource(source);
          return;
        }
        cache.set(index, source);
        if (!firstReady) {
          firstReady = true;
          setCanvasVisible(true);
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        // A single missing/failed frame just means the nearest-loaded
        // fallback keeps covering for it — never block the rest of the
        // sequence or crash the scrubber over one bad frame.
      }
    }

    const order = computeHeroFilmLoadOrder(HERO_FILM_FRAME_COUNT);
    const eager = order.slice(0, HERO_FILM_EAGER_FRAME_COUNT);
    const deferred = order.slice(HERO_FILM_EAGER_FRAME_COUNT);

    void Promise.all(eager.map(loadFrame));

    let idleCancel: (() => void) | undefined;
    const cancelEngageGate = deferUntilInteraction(() => {
      idleCancel = scheduleIdle(() => {
        void (async () => {
          for (const index of deferred) {
            if (cancelled) return;
            await loadFrame(index);
          }
        })();
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
      cancelEngageGate();
      idleCancel?.();
      for (const source of cache.values()) disposeSource(source);
      cache.clear();
    };
  }, [theme]);

  // Draw loop: reads `progressRef` every animation frame (never React
  // state — WEBSITE_CREATIVE_BRIEF.md §3), paused whenever the section
  // leaves the viewport or the tab is hidden (same GPU/CPU discipline as
  // `hero-morph-scene.tsx`/`hero-story-overlay.tsx`).
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let rafId: number | undefined;
    let running = true;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    };
    resize();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
    resizeObserver?.observe(container);

    const ctx = canvas.getContext("2d");

    const draw = () => {
      if (!running) return;
      if (ctx) {
        const progress = progressRef.current ?? 0;
        const frameIndex = frameForProgress(progress);
        const source = nearestLoadedFrame(cacheRef.current, frameIndex, HERO_FILM_FRAME_COUNT);
        if (source) {
          const { width: iw, height: ih } = sourceSize(source);
          if (iw > 0 && ih > 0) {
            const fit = computeHeroFilmCoverFit(canvas.width, canvas.height, iw, ih);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(source, fit.dx, fit.dy, fit.dWidth, fit.dHeight);
          }
        }
      }
      rafId = requestAnimationFrame(draw);
    };

    const updateFromVisibility = () => {
      const shouldRun = !document.hidden;
      if (shouldRun && !running) {
        running = true;
        rafId = requestAnimationFrame(draw);
      } else if (!shouldRun && running) {
        running = false;
        if (rafId !== undefined) cancelAnimationFrame(rafId);
      }
    };
    let intersectionObserver: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          /**
           * SITE REPAIR blocker (production-build repro, 2026-09-15): see
           * the identical guard in `hero-story-overlay.tsx`'s own
           * IntersectionObserver callback for the full root-cause writeup
           * — GSAP's `pin: true` setup (`use-scroll-progress.ts`) briefly
           * detaches this pinned descendant from the document while
           * reparenting it into a spacer wrapper (even with `pinSpacing:
           * false`), which fires a spurious `isIntersecting: false` /
           * `rootBounds: null` callback that nothing afterward corrects —
           * permanently freezing this draw loop (confirmed: the canvas
           * never advanced past its poster frame). Re-observe instead of
           * trusting a `rootBounds: null` reading while the element is
           * ACTUALLY still connected to the document.
           */
          if (entry && entry.rootBounds === null && document.contains(container)) {
            intersectionObserver?.unobserve(container);
            intersectionObserver?.observe(container);
            return;
          }
          const intersecting = entry?.isIntersecting ?? true;
          if (intersecting && !document.hidden) {
            if (!running) {
              running = true;
              rafId = requestAnimationFrame(draw);
            }
          } else {
            running = false;
            if (rafId !== undefined) cancelAnimationFrame(rafId);
          }
        },
        { threshold: 0 },
      );
    }
    intersectionObserver?.observe(container);
    document.addEventListener("visibilitychange", updateFromVisibility);

    rafId = requestAnimationFrame(draw);

    return () => {
      running = false;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", updateFromVisibility);
    };
  }, [progressRef]);

  return (
    <div ref={containerRef} className={className} aria-hidden="true">
      <div className="hero-film-mask relative size-full overflow-hidden">
        <style>{HERO_FILM_MASK_CSS}</style>
        <HeroFilmThemedImage
          light={{ src: heroFilmPosterPath("light") }}
          dark={{ src: heroFilmPosterPath("dark") }}
          alt=""
          priority
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block size-full transition-opacity duration-300"
          style={{ opacity: canvasVisible ? 1 : 0 }}
        />
      </div>
    </div>
  );
}

export const __internal = { nearestLoadedFrame, sourceSize };
