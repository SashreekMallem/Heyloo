"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True once the viewer has `prefers-reduced-motion: reduce` set. Safe to
 * call during SSR (always `false` there — the server has no `window`; the
 * real answer resolves on the client after hydration, same as every other
 * check in this module).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface UseInViewOptions {
  /** IntersectionObserver threshold. Default 0.2. */
  threshold?: number;
  /** IntersectionObserver rootMargin — e.g. a negative vertical margin to detect "crossing center." */
  rootMargin?: string;
  /** Once true, stop observing (the default — matches the brief's "entrance-triggered, not scroll-scrubbed" rule for every non-set-piece motion moment). */
  once?: boolean;
}

/**
 * The shared primitive behind every "entrance stagger, no scroll-scrub"
 * moment in `docs/design/WEBSITE_CREATIVE_BRIEF.md` §2 (trust strip,
 * business-type grid, how-it-works, dashboard-reveal settle, pricing
 * teaser, demo CTA). Resolves to "already visible" — no animation, correct
 * content — whenever motion shouldn't run: `prefers-reduced-motion`, no
 * `IntersectionObserver` support (SSR, some test environments), or no
 * element to observe yet. Every consumer is therefore correct with zero JS
 * and the entrance effect is strictly a progressive enhancement.
 */
/** True when there's nothing to observe — resolve straight to "visible" and skip creating an observer at all. */
function skipObserving(): boolean {
  return (
    typeof window === "undefined" ||
    typeof IntersectionObserver === "undefined" ||
    prefersReducedMotion()
  );
}

export function useInView<T extends Element>(
  options: UseInViewOptions = {},
): [React.RefObject<T | null>, boolean] {
  const { threshold = 0.2, rootMargin = "0px", once = true } = options;
  const ref = useRef<T | null>(null);
  // Lazy initializer, not a `setState` call inside the effect below: the
  // "nothing to observe" case is knowable synchronously at mount, so it's
  // the element's real initial state, not a state update in response to an
  // effect running.
  const [inView, setInView] = useState(() => skipObserving());

  useEffect(() => {
    if (skipObserving()) return; // already resolved to `true` at mount — see above
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return [ref, inView];
}
