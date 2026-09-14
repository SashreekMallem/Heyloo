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
 */
export function Parallax({
  children,
  className,
  style,
  strength = 12,
  invert = false,
}: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = prefersReducedMotion();
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (reduced) return;
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
  }, [reduced, strength, invert]);

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
