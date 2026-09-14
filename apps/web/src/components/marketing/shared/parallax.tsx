"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/marketing/use-in-view";

export interface ParallaxProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /**
   * Max px offset at either scroll extreme — keep this SUBTLE
   * (WEBSITE_CREATIVE_BRIEF.md §2's business-type grid ships ≤4px of
   * pointer-parallax; this is the scroll-driven equivalent and should
   * read the same way — a drift, not a slide). Default 12.
   */
  strength?: number;
  /** Invert the drift direction (foreground-feels-faster vs. background-feels-slower layers in the same section). Default false. */
  invert?: boolean;
}

/**
 * A subtle scroll-linked vertical drift — `transform: translate3d`
 * ONLY (WEBSITE_CREATIVE_BRIEF.md's "no jank: transform/opacity only on
 * the main thread" rule; this never touches layout/paint-triggering
 * properties). Driven by a `requestAnimationFrame` loop gated by
 * `IntersectionObserver` so it costs nothing while the element is off
 * screen — see docs/DESIGN_SYSTEM.md's "add a section without breaking
 * the budget" note.
 *
 * `prefers-reduced-motion`: renders children with no transform and never
 * starts the scroll loop at all (WEBSITE_CREATIVE_BRIEF.md's adaptive
 * rule — "prefers-reduced-motion → static composition").
 *
 * `reduced` is real React state, never a value computed by calling
 * `prefersReducedMotion()` directly in the render body — that reads
 * `window.matchMedia`, always `false` during SSR but possibly already
 * `true` on the client's very first render (before hydration completes)
 * under a real reduced-motion preference, which would make the inline
 * `transform`/`willChange` style disagree between the server tree and the
 * client's first paint (the same mismatch `use-in-view.ts` documents and
 * `LiveCallHero`/`Sticky` are fixed for). Both start non-reduced; the real
 * check happens inside the SAME effect that would otherwise start
 * observing — not a separate earlier effect — specifically so a reduced-
 * motion visitor's `IntersectionObserver` is never created at all, not
 * created-then-immediately-torn-down a tick later: `window.matchMedia` is
 * always safe to call from an effect body (effects only ever run
 * post-mount, client-side, so there's no SSR value to disagree with) —
 * only the RENDER output needed to stop branching on it directly.
 */
export function Parallax({
  children,
  className,
  style,
  strength = 12,
  invert = false,
}: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only reduced-motion check (window.matchMedia); must run post-mount to avoid an SSR/hydration mismatch
      setReduced(true);
      return;
    }
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const node = ref.current;
    if (!node) return;

    let rafId = 0;
    let active = false;

    const tick = () => {
      const rect = node.getBoundingClientRect();
      const viewportMid = window.innerHeight / 2;
      const elementMid = rect.top + rect.height / 2;
      // -1 (element centered above viewport mid) .. +1 (below), scaled to `strength` px.
      const normalized = Math.min(1, Math.max(-1, (elementMid - viewportMid) / viewportMid));
      setOffset(normalized * strength * (invert ? -1 : 1));
      if (active) rafId = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting && !active) {
          active = true;
          rafId = requestAnimationFrame(tick);
        } else if (!entry.isIntersecting && active) {
          active = false;
          cancelAnimationFrame(rafId);
        }
      },
      { threshold: 0, rootMargin: "20% 0px 20% 0px" },
    );
    observer.observe(node);

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
    // `reduced` deliberately not a dependency — it's only ever SET here,
    // never read (the fresh `prefersReducedMotion()` check above is the
    // source of truth every time this effect runs), so including it
    // would only cause one redundant extra run with nothing to clean up.
  }, [strength, invert]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        transform: reduced ? undefined : `translate3d(0, ${offset}px, 0)`,
        willChange: reduced ? undefined : "transform",
      }}
    >
      {children}
    </div>
  );
}
