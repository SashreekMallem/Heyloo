"use client";

import type ScrollTriggerType from "gsap/ScrollTrigger";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { loadGsap } from "./gsap-loader";

export interface UseScrollProgressOptions {
  /** Element whose position/pin defines the scroll-progress range. */
  target: RefObject<HTMLElement | null>;
  /** Pin `target` in place for the scroll distance in `end` (the hero and dashboard-reveal set pieces; WEBSITE_CREATIVE_BRIEF.md §3). */
  pin?: boolean;
  /**
   * ScrollTrigger `pinSpacing` — default `true` (GSAP's own default:
   * insert a spacer that reserves the pin distance automatically).
   * `hero-scroll-scene.tsx` passes `false` and reserves that space
   * itself instead, as a plain sibling element present continuously
   * from before the pin ever activates (CLS: GSAP's own spacer only
   * exists once its async chunk loads and `.create()` has actually run,
   * so relying on it means the page's height jumps the moment it
   * activates — a real, measured regression, see that file's comment).
   */
  pinSpacing?: boolean;
  /** ScrollTrigger `start`. Defaults to `"top top"` when pinned, `"top bottom"` otherwise. */
  start?: string;
  /** ScrollTrigger `end` (e.g. `"+=150%"`). Defaults to `"+=150%"` when pinned, `"bottom top"` otherwise. */
  end?: string;
  /** Scrub smoothing — WEBSITE_CREATIVE_BRIEF.md §2: near 0.5, never `true`/`1:1`. Defaults to 0.5. */
  scrub?: number;
  /** Skip entirely — e.g. this component's reduced-motion or play-once-on-enter tier owns progress instead. */
  disabled?: boolean;
  /**
   * Called on every native-scroll tick with the raw 0-1 progress value,
   * read directly off `ScrollTrigger`. Write it into a ref for a
   * `useFrame`/canvas consumer rather than `setState`
   * (WEBSITE_CREATIVE_BRIEF.md §3: "read from ScrollTrigger's own
   * progress value... not from React state, to avoid re-render cost");
   * reserve `setState` for coarse, infrequent things like the current
   * story stage.
   */
  onUpdate?: (progress: number) => void;
  /**
   * Dev/test only (WEBSITE_CREATIVE_BRIEF.md §6 step 9 — automated
   * scroll-motion verification): publishes the live `ScrollTrigger`
   * instance at `window.__heylooScrollDebug[debugKey]` so a Playwright
   * test can set scroll position, call `.update()`, and assert each
   * story beat's resulting transform/opacity/text state. No-op in
   * production builds.
   */
  debugKey?: string;
}

type DebugWindow = { __heylooScrollDebug?: Record<string, ScrollTriggerType> };

function publishDebugScrollTrigger(key: string, scrollTrigger: ScrollTriggerType) {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
  const globalWindow = window as unknown as DebugWindow;
  globalWindow.__heylooScrollDebug = {
    ...(globalWindow.__heylooScrollDebug ?? {}),
    [key]: scrollTrigger,
  };
}

function clearDebugScrollTrigger(key: string) {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
  const globalWindow = window as unknown as DebugWindow;
  if (!globalWindow.__heylooScrollDebug) return;
  delete globalWindow.__heylooScrollDebug[key];
}

/**
 * Drives `onUpdate(progress)` off a GSAP `ScrollTrigger` tied to
 * `target`'s native scroll position — the pinned/scrubbed mechanism the
 * hero and dashboard-reveal set pieces use (WEBSITE_CREATIVE_BRIEF.md
 * §3). Deliberately reads native browser scroll, never Lenis — see
 * `smooth-scroll-region.tsx`'s docstring for why pinned ScrollTriggers
 * and Lenis don't mix, and never wrap a `useScrollProgress({ pin: true
 * })` target in `<SmoothScrollRegion>`.
 *
 * `gsap`/`ScrollTrigger` load lazily (`loadGsap`, dynamic import) the
 * first time this effect runs — mounting this hook is what actually
 * pulls GSAP into the bundle; `ScrollOrchestrationProvider` can prefetch
 * that same load earlier, on idle, but nothing here imports it eagerly.
 */
export function useScrollProgress({
  target,
  pin = false,
  pinSpacing,
  start,
  end,
  scrub = 0.5,
  disabled = false,
  onUpdate,
  debugKey,
}: UseScrollProgressOptions): void {
  const onUpdateRef = useRef(onUpdate);
  // eslint-disable-next-line react-hooks/refs -- deliberate "latest callback ref" sync so the effect below can read a fresh `onUpdate` every rAF/scrub tick without re-subscribing ScrollTrigger on every render
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (disabled) return;
    const element = target.current;
    if (!element) return;

    let cancelled = false;
    let scrollTrigger: ScrollTriggerType | undefined;

    void loadGsap().then(({ ScrollTrigger }) => {
      if (cancelled) return;
      scrollTrigger = ScrollTrigger.create({
        trigger: element,
        start: start ?? (pin ? "top top" : "top bottom"),
        end: end ?? (pin ? "+=150%" : "bottom top"),
        pin,
        pinSpacing,
        scrub,
        onUpdate: (self) => onUpdateRef.current?.(self.progress),
      });
      if (debugKey) publishDebugScrollTrigger(debugKey, scrollTrigger);
    });

    return () => {
      cancelled = true;
      scrollTrigger?.kill();
      if (debugKey) clearDebugScrollTrigger(debugKey);
    };
  }, [target, pin, pinSpacing, start, end, scrub, disabled, debugKey]);
}
