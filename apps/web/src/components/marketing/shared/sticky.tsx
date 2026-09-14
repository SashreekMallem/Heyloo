"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/marketing/use-in-view";

export interface StickyProps {
  /** Either plain content, or a render function receiving 0-1 scroll progress through the pin range — for a section-local morph (e.g. a card settling into place) that doesn't need the full GSAP ScrollTrigger pin `components/motion/` owns for the flagship hero. */
  children: ReactNode | ((progress: number) => ReactNode);
  className?: string;
  /** Extra class on the sticky inner element. */
  innerClassName?: string;
  /** Scroll distance the content stays pinned for, as a multiple of the viewport height. Default 1.5 (150vh of scroll for one pin). */
  rangeVh?: number;
  /** `top` offset for the sticky element (e.g. below a fixed marketing header). Default 0. */
  topOffsetPx?: number;
}

/**
 * A lightweight, CSS-native pin: `position: sticky` (main-thread-free —
 * the browser compositor handles it, no scroll listener needed for the
 * pinning itself) wrapped in a taller spacer so there's scroll distance
 * to pin across. This is the section-author-facing building block for
 * "content stays put while the page scrolls past it" layouts (a sticky
 * side panel next to a longer scrolling column, a card that settles into
 * place as its section passes) — NOT a replacement for
 * `components/motion/`'s GSAP `ScrollTrigger` pin, which owns the
 * flagship hero/dashboard-reveal set pieces specifically because those
 * need scrubbed multi-stage timelines. Reach for `Sticky` first per
 * docs/DESIGN_SYSTEM.md's "add a section without breaking the budget"
 * note; only pull in `components/motion/`'s heavier machinery when a
 * section genuinely needs a multi-beat scrubbed timeline.
 *
 * The optional scroll-progress (only computed when `children` is a
 * function — a plain-node `children` never starts the below loop at
 * all) comes from a `requestAnimationFrame` loop gated by
 * `IntersectionObserver` so it only runs while the pinned range is
 * actually on screen, never for the page's full scroll lifetime.
 *
 * `prefers-reduced-motion`: renders `children` (progress locked at 1,
 * the settled/final state — matching every other set piece in this
 * codebase's "show the outcome, skip the journey" rule) in normal
 * document flow, no `position: sticky`, no scroll listening at all —
 * a user who has asked for reduced motion should not get a pinned
 * scroll section, even one whose own internal morph is off.
 */
export function Sticky({
  children,
  className,
  innerClassName,
  rangeVh = 150,
  topOffsetPx = 0,
}: StickyProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const reduced = prefersReducedMotion();
  const isRenderProp = typeof children === "function";
  const [progress, setProgress] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced || !isRenderProp) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let rafId = 0;
    let active = false;

    const tick = () => {
      const rect = wrapper.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      const raw = scrollable > 0 ? -rect.top / scrollable : 0;
      setProgress(Math.min(1, Math.max(0, raw)));
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
      { threshold: 0 },
    );
    observer.observe(wrapper);

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [reduced, isRenderProp]);

  const content = isRenderProp ? (children as (progress: number) => ReactNode)(progress) : children;

  if (reduced) {
    return <div className={className}>{content}</div>;
  }

  return (
    <div ref={wrapperRef} className={className} style={{ height: `${rangeVh}vh` }}>
      <div
        className={innerClassName}
        style={{ position: "sticky", top: topOffsetPx, height: "100vh", overflow: "hidden" }}
      >
        {content}
      </div>
    </div>
  );
}
