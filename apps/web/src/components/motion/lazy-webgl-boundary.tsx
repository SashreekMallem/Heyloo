"use client";

import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { deferUntilInteraction } from "@/lib/perf/defer-non-critical";
import { useDeviceCapability } from "./use-device-capability";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * SITE REPAIR finding (blocker, 2nd pass): a live re-measurement
 * (`node --experimental-strip-types scripts/site-perf/measure.ts`,
 * cross-checked with a raw CDP network capture split on the page's
 * `load` event) found the home route's real dominant contributor was
 * NOT Sentry (confirmed absent — no real SDK markers in any chunk after
 * the route-group-scoped-init fix) but this boundary's own `Scene`
 * (`three`/`@react-three/fiber`/drei, ~230KB gz) — it was being fetched
 * within ~500ms of hydration on a qualifying device (this measurement's
 * own headless Chromium included), well inside the budget script's 1.5s
 * post-load settle window, because `qualifies` used to flip `true` the
 * instant `useDeviceCapability`'s synchronous-on-mount probe resolved,
 * with nothing gating it on the visitor actually reaching/scrolling the
 * pinned hero. `budgets.ts`'s own docstring already describes the
 * INTENDED behavior — "a lazy-loaded chunk ... that only fetches after a
 * LATER scroll/interaction is correctly excluded" — this makes that
 * description actually true for `Scene`'s import, by gating it on
 * `engaged` (first scroll/pointer/key interaction, or a short fallback
 * for a passive visitor who never scrolls) via the same
 * `deferUntilInteraction` primitive `instrumentation-client.ts`'s
 * Sentry/PostHog deferral already established — "scroll" as the trigger
 * is also simply the correct one thematically for a scroll-linked set
 * piece.
 *
 * Deliberately does NOT touch `hero-scroll-scene.tsx`'s own
 * `useScrollProgress`/CSS-reservation pin logic — that pin (and its
 * GSAP chunk) still activates immediately, exactly as before; only
 * `Scene`'s own mount (this boundary's one job) is deferred, so the
 * carefully-tuned CLS fix in that file (0.230 → 0.003, see its own
 * comment) is untouched and cannot regress from this change. `fallback`
 * is a complete, correct rendering on its own the whole time either way
 * — once `Scene` does mount, it reads whichever scroll progress GSAP has
 * already been tracking in the background, so there's no catch-up jump.
 */
const ENGAGE_FALLBACK_MS = 2500;

export interface LazyWebglBoundaryProps<P extends object> {
  /**
   * A component the caller has already wrapped in
   * `next/dynamic(() => import("..."), { ssr: false })` at module scope
   * (never construct `dynamic()` inside a render — that remounts the
   * lazy component every render). See `three/hero-morph-scene.tsx` for
   * the scene this boundary is built for.
   */
  Scene: ComponentType<P>;
  /** Props for `Scene`, once it mounts. */
  sceneProps: P;
  /**
   * Rendered instead of `Scene` under `prefers-reduced-motion`, on a
   * non-qualifying device, before the client-side capability probe
   * resolves, or while `Scene`'s chunk is loading (this is also what a
   * visitor with JS disabled sees, permanently, since it's the only
   * thing that ever renders in that case).
   */
  fallback: ReactNode;
  className?: string;
}

/**
 * Gates a lazily-imported react-three-fiber scene behind BOTH the
 * device-qualification gate (`useDeviceCapability`) and
 * `prefers-reduced-motion` (`useReducedMotion`) — `Scene`'s module is
 * never even requested unless both checks pass on the client, which is
 * what actually keeps the ~150-250KB(gz) three/r3f/drei bundle out of
 * the download for every visitor who doesn't qualify
 * (WEBSITE_CREATIVE_BRIEF.md §6 load strategy, step 2: "Only if it
 * passes does the code lazily import the three.js/r3f/drei bundle").
 *
 * Renders `fallback` synchronously on first paint (both hooks default to
 * their safe/static state before mount) so there is always something
 * correct on screen with zero JS, exactly per §6 step 1.
 */
export function LazyWebglBoundary<P extends object>({
  Scene,
  sceneProps,
  fallback,
  className,
}: LazyWebglBoundaryProps<P>) {
  const reducedMotion = useReducedMotion();
  const { tier, ready } = useDeviceCapability();
  const deviceQualifies = ready && !reducedMotion && tier === "webgl";
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    // Only a device that already qualifies needs to engage — no reason
    // to arm scroll/interaction listeners (or start a timer) for a
    // visitor who was never going to get `Scene` anyway.
    if (!deviceQualifies) return;
    return deferUntilInteraction(() => setEngaged(true), ENGAGE_FALLBACK_MS);
  }, [deviceQualifies]);

  const qualifies = deviceQualifies && engaged;

  if (!qualifies) {
    return <div className={className}>{fallback}</div>;
  }

  return (
    <div className={className}>
      <Scene {...sceneProps} />
    </div>
  );
}
