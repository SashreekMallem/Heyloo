"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { deferUntilInteraction } from "@/lib/perf/defer-non-critical";
import { loadGsap } from "./gsap-loader";

export interface ScrollOrchestrationProviderProps {
  children?: ReactNode;
}

type IdleCallbackWindow = Window & {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Mount once near the root of a route that uses any scroll-linked set
 * piece (PAGES-cluster wires this into
 * `apps/web/src/app/[locale]/(marketing)/layout.tsx`). Renders nothing
 * itself — its only job is to prefetch `gsap`/`ScrollTrigger` on idle so
 * that by the time a set piece's own `useScrollProgress` call needs the
 * module it's often already warm (WEBSITE_CREATIVE_BRIEF.md §6 load
 * strategy, step 3: "GSAP core + ScrollTrigger ... can load slightly
 * earlier than the WebGL bundle").
 *
 * SITE REPAIR finding (blocker): this used to call `requestIdleCallback`
 * unconditionally on mount, with no interaction gate at all — on a real
 * page load the main thread goes idle almost immediately (there's
 * nothing else competing for it), so this fired within second or so of
 * first paint regardless of whether the visitor had scrolled/interacted
 * yet, pulling GSAP + ScrollTrigger (~46KB gz, confirmed via a live
 * per-chunk network capture against a production build: three
 * gsap-containing chunks totalling 46.1KB, present even on a completely
 * passive page load) straight into the measured "initial JS" window —
 * directly contradicting `hero-scroll-scene.tsx`'s own documented
 * invariant ("GSAP never loads until first scroll/pointer/key
 * interaction," enforced there via `deferUntilInteraction`) and
 * defeating the whole point of that gate: whichever of this provider's
 * idle callback or the set piece's own interaction-gated load happened
 * to run first still pulled the chunk in before any real interaction.
 * Wrapping the idle-prefetch in the SAME `deferUntilInteraction` gate
 * every other GSAP consumer already uses (`hero-scroll-scene.tsx`,
 * `hero-film-scrubber.tsx`'s deferred frame batch) fixes this: the idle
 * callback now only arms after a real interaction (or `deferUntilInteraction`'s
 * own passive-visitor fallback delay, well outside `measure.ts`'s 1.5s
 * settle window — see that function's docstring), so a purely passive
 * page load never fetches GSAP at all, while an engaged visitor still
 * gets the same "often already warm by the time useScrollProgress needs
 * it" head start this component exists for (both fire off the same
 * interaction event; nothing about the gate removes that benefit).
 *
 * This is a prefetch, not a requirement — every consumer of
 * `useScrollProgress` loads the same module itself (via the shared
 * `loadGsap` cache) if this provider is absent, just without the idle
 * head start. Never imports `gsap` at module scope — only inside the
 * idle callback — so this component itself contributes ~0 bytes to the
 * route's initial JS beyond its own tiny wrapper.
 */
export function ScrollOrchestrationProvider({ children }: ScrollOrchestrationProviderProps) {
  useEffect(() => {
    const idleWindow = window as IdleCallbackWindow;
    const requestIdle =
      idleWindow.requestIdleCallback ??
      ((callback: () => void) => window.setTimeout(callback, 200));
    const cancelIdle = idleWindow.cancelIdleCallback ?? window.clearTimeout;

    let idleHandle: number | undefined;
    const cancelEngageGate = deferUntilInteraction(() => {
      idleHandle = requestIdle(() => {
        void loadGsap();
      });
    });

    return () => {
      cancelEngageGate();
      if (idleHandle !== undefined) cancelIdle(idleHandle);
    };
  }, []);

  return children;
}
