"use client";

import type { gsap as gsapType } from "gsap";
import type ScrollTriggerType from "gsap/ScrollTrigger";

export interface GsapModules {
  gsap: typeof gsapType;
  ScrollTrigger: typeof ScrollTriggerType;
}

let modulesPromise: Promise<GsapModules> | null = null;

/**
 * Loads `gsap` + `gsap/ScrollTrigger` exactly once per page — every
 * caller across the marketing route shares the same in-flight/resolved
 * module-scope promise, so `ScrollOrchestrationProvider` (a prefetch on
 * idle) and `useScrollProgress` (an await at the moment a set piece
 * actually needs it) never double-fetch the bundle. Registers the plugin
 * the first time (`gsap.registerPlugin` is itself idempotent, but this
 * still only runs it once).
 *
 * Dynamic `import()` here — never a static top-level import — is what
 * keeps `gsap`/`ScrollTrigger` out of the home route's initial JS chunk
 * (WEBSITE_CREATIVE_BRIEF.md §6 load strategy, step 2-3): the marketing
 * route ships a correct static page with zero motion-engine JS until
 * this is called from an effect, after first paint.
 */
export function loadGsap(): Promise<GsapModules> {
  modulesPromise ??= Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(
    ([gsapModule, scrollTriggerModule]) => {
      const { gsap } = gsapModule;
      const ScrollTrigger = scrollTriggerModule.default;
      gsap.registerPlugin(ScrollTrigger);
      return { gsap, ScrollTrigger };
    },
  );
  return modulesPromise;
}

/** Test-only: clears the module-scope cache so each test gets a fresh load. */
export function __resetGsapLoaderForTests(): void {
  modulesPromise = null;
}
