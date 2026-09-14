"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
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
 * itself — its only job is to prefetch `gsap`/`ScrollTrigger` on idle,
 * after first paint, so that by the time a set piece's own
 * `useScrollProgress` call needs the module it's often already warm
 * (WEBSITE_CREATIVE_BRIEF.md §6 load strategy, step 3: "GSAP core +
 * ScrollTrigger ... can load slightly earlier than the WebGL bundle").
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

    const handle = requestIdle(() => {
      void loadGsap();
    });

    return () => cancelIdle(handle);
  }, []);

  return children;
}
