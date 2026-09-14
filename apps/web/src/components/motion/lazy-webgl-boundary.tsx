"use client";

import type { ComponentType, ReactNode } from "react";
import { useDeviceCapability } from "./use-device-capability";
import { useReducedMotion } from "./use-reduced-motion";

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
  const qualifies = ready && !reducedMotion && tier === "webgl";

  if (!qualifies) {
    return <div className={className}>{fallback}</div>;
  }

  return (
    <div className={className}>
      <Scene {...sceneProps} />
    </div>
  );
}
