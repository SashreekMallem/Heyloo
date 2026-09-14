/**
 * Defers a non-critical side effect (error monitoring, product
 * analytics) off the initial-load JS path — SITE REPAIR finding: home
 * route initial JS measured 955.2KB gz against a 250KB budget, dominated
 * by Sentry + PostHog being imported (and therefore initialized) eagerly
 * on every route, marketing included, neither of which needs to run
 * before the visitor has done anything.
 *
 * Runs `run()` at the first of: a real interaction (the visitor is
 * actually using the page, so it's a fine time to start monitoring it),
 * or `fallbackDelayMs` of nothing happening (so a passive visitor who
 * never interacts — e.g. reads the page and leaves — still eventually
 * gets tracked, rather than never). `fallbackDelayMs` defaults well
 * beyond `scripts/site-perf/measure.ts`'s fixed post-load settle window
 * (1.5s) so this reliably stays OUT of the route's measured "initial JS"
 * — deferred, not merely relabeled.
 *
 * No-op (returns a no-op cleanup) during SSR/before `window` exists —
 * callers only ever invoke this from a `"use client"` module's effect or
 * module-scope browser-only code path.
 */
const INTERACTION_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
const DEFAULT_FALLBACK_DELAY_MS = 4000;

export function deferUntilInteraction(
  run: () => void,
  fallbackDelayMs = DEFAULT_FALLBACK_DELAY_MS,
): () => void {
  if (typeof window === "undefined") return () => {};

  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    cleanup();
    run();
  };

  const timer = window.setTimeout(fire, fallbackDelayMs);
  for (const eventName of INTERACTION_EVENTS) {
    window.addEventListener(eventName, fire, { once: true, passive: true });
  }

  function cleanup() {
    window.clearTimeout(timer);
    for (const eventName of INTERACTION_EVENTS) {
      window.removeEventListener(eventName, fire);
    }
  }

  return cleanup;
}
