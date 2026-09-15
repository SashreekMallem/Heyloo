"use client";

import { useState } from "react";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

export interface DeviceCapability {
  /** Whether this viewport/motion-preference qualifies for the pinned, scroll-scrubbed hero film (`hero-film-scrubber.tsx`) — desktop/tablet width AND `prefers-reduced-motion: no-preference`. */
  qualifiesForFilm: boolean;
  /**
   * `false` until the client-side probe has run once. Every set piece
   * must render its non-qualifying tier's composition (or better: the
   * reduced-motion static frame) as its synchronous default so there is
   * always something correct on screen before this flips — never gate
   * first paint on `ready`.
   */
  ready: boolean;
}

/** Exported so `hero-scroll-scene.tsx`'s CSS-only space reservation (see its own comment on why this gate can't be JS-driven) mirrors this exact breakpoint. */
export const MIN_QUALIFYING_WIDTH = 768;

/**
 * The hero film's two-part qualification gate — width and motion
 * preference, nothing else. (An earlier version of this hook also probed
 * for a real WebGL context and read `navigator.deviceMemory`/
 * `connection.saveData`: that was specific to the old three.js/r3f line
 * morph this cluster replaced with a `<canvas>` frame-sequence player,
 * which has no GPU/API dependency to probe for — a `<canvas>` 2D context
 * and `fetch` are universally available, so those checks no longer
 * apply. Width/motion-preference are still real gates: the pin/scrub
 * choreography needs room to breathe and a visitor who's asked for less
 * motion needs the static tier instead.)
 */
function qualifiesForFilm(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  if (window.innerWidth < MIN_QUALIFYING_WIDTH) return false;
  return true;
}

/**
 * Runs the device-qualification gate once on mount (client-only — SSR
 * has no `window` to probe) and reports whether a set piece should
 * render the qualifying (pinned/scrubbed) tier. Resolves via
 * `useIsomorphicLayoutEffect` (before the browser's own next paint)
 * rather than a plain `useEffect` (after it) — cheap insurance against
 * an unnecessary extra re-render on a pure client-side mount, though
 * `hero-scroll-scene.tsx`'s CLS fix does NOT rely on this timing (see
 * its own comment): on a real SSR'd page load the browser paints the
 * server-rendered HTML (necessarily computed with `ready: false`) before
 * ANY client JS — including this hook's effect — has run at all.
 */
export function useDeviceCapability(): DeviceCapability {
  const [capability, setCapability] = useState<DeviceCapability>({
    qualifiesForFilm: false,
    ready: false,
  });

  useIsomorphicLayoutEffect(() => {
    setCapability({ qualifiesForFilm: qualifiesForFilm(), ready: true });
  }, []);

  return capability;
}
