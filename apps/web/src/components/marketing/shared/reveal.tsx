"use client";

import { MOTION_DURATIONS_MS } from "@heyloo/ui";
import type { ReactNode } from "react";
import { useInView } from "@/lib/marketing/use-in-view";

export type RevealDirection = "up" | "down" | "left" | "right" | "none";

export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Which edge the content travels in from. "none" fades only (no translate) — for content where a directional slide would read as gimmicky. Default "up". */
  direction?: RevealDirection;
  /** px the element travels from on entrance. Default 16. */
  distance?: number;
  /** ms delay before the transition starts — for staggered groups. */
  delayMs?: number;
  /** transition duration in ms. Default `MOTION_DURATIONS_MS.base` (200ms, DESIGN_SYSTEM.md's Motion token). */
  durationMs?: number;
  /** IntersectionObserver threshold — how much of the element must be visible to trigger. */
  threshold?: number;
  /** Element tag to render — "li" keeps a staggered list's `<ul>`/`<li>` semantics intact. Default "div". */
  as?: "div" | "li" | "section";
}

const AXIS: Record<RevealDirection, { x: number; y: number }> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  none: { x: 0, y: 0 },
};

/**
 * `components/marketing/shared`'s general-purpose entrance reveal —
 * `IntersectionObserver`-driven, once-only, transform/opacity-only
 * (WEBSITE_CREATIVE_BRIEF.md's "no jank" rule: only main-thread-cheap
 * properties). Adds a `direction` axis on top of the fade/slide-up
 * `components/marketing/reveal.tsx` already ships, for section authors
 * who need left/right/down entrances too (a two-column feature row
 * entering from opposite sides, say) without hand-rolling the transform
 * math each time — see docs/DESIGN_SYSTEM.md's "add a section without
 * breaking the budget" note for when to reach for this vs. that one.
 * `useInView` already resolves to "visible, no animation" under
 * `prefers-reduced-motion`, missing `IntersectionObserver` support, or
 * SSR, so this component is correct with motion fully off with no
 * extra branch here.
 */
export function Reveal({
  children,
  className,
  direction = "up",
  distance = 16,
  delayMs = 0,
  durationMs = MOTION_DURATIONS_MS.base,
  threshold = 0.15,
  as = "div",
}: RevealProps) {
  const [ref, inView] = useInView<HTMLElement>({ threshold });
  const axis = AXIS[direction];

  const style = {
    opacity: inView ? 1 : 0,
    transform: inView
      ? "translate3d(0,0,0)"
      : `translate3d(${axis.x * distance}px, ${axis.y * distance}px, 0)`,
    transition: `opacity ${durationMs}ms var(--ease-out) ${delayMs}ms, transform ${durationMs}ms var(--ease-out) ${delayMs}ms`,
  };

  const Tag = as as "div";
  return (
    <Tag ref={ref as React.RefObject<HTMLDivElement>} className={className} style={style}>
      {children}
    </Tag>
  );
}
