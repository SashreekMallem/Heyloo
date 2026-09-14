"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/marketing/use-in-view";

/**
 * Counts from 0 to `target` once `active` first becomes true, then holds —
 * the dashboard-reveal metric count-up (DESIGN BRIEF §2, "Dashboard
 * reveal"): "scroll-triggered once on enter (not scrubbed — a counter that
 * reverses when you scroll up reads as a bug, not a feature)". Reduced
 * motion (or no `active` trigger yet) skips the animation and lands
 * directly on `target`/`0` — never a mid-count frozen value.
 */
/** No `requestAnimationFrame`-driven count is worth running — render the target directly. */
function skipAnimating(): boolean {
  return prefersReducedMotion() || typeof requestAnimationFrame === "undefined";
}

export function useCountUp(target: number, active: boolean, durationMs = 800): number {
  const [animated, setAnimated] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active || startedRef.current || skipAnimating()) return;
    startedRef.current = true;

    let raf = 0;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) ** 3; // ease-out cubic
      setAnimated(target * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, durationMs]);

  // Not `setState` in an effect: these are values derivable synchronously
  // from props on every render (no count-up worth running yet, or reduced
  // motion means skip straight to the answer) — `animated` state exists
  // only to hold the in-progress rAF value for the one path that actually
  // animates.
  if (!active) return 0;
  if (skipAnimating()) return target;
  return animated;
}
