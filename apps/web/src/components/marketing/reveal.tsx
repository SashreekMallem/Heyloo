"use client";

import { MOTION_DURATIONS_MS } from "@heyloo/ui";
import type { ReactNode } from "react";
import { useInView } from "@/lib/marketing/use-in-view";

export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** ms delay before the transition starts — used for staggered groups (business-type grid, dashboard call rows). */
  delayMs?: number;
  /** transition duration in ms. Brief default: 150ms fast entrances (trust strip), 200ms for staggered cards. */
  durationMs?: number;
  /** px the element travels from on entrance. */
  translateY?: number;
  /** IntersectionObserver threshold — how much of the element must be visible to trigger. */
  threshold?: number;
  /** Element tag to render — "li" for a list item so the wrapper never breaks `<ul>`/`<ol>` semantics. Default "div". */
  as?: "div" | "li";
}

/**
 * The single fade/slide-up entrance used everywhere the brief calls for
 * "entrance-triggered, not scroll-scrubbed" motion (`IntersectionObserver`-
 * driven, matching §2's trust strip / business-types / pricing-teaser /
 * demo-CTA treatment) — never a scroll-linked transform. `useInView`
 * already resolves to "visible, no animation" under reduced motion or
 * without `IntersectionObserver` support, so this component is correct
 * with motion fully off.
 */
export function Reveal({
  children,
  className,
  delayMs = 0,
  durationMs = MOTION_DURATIONS_MS.fast,
  translateY = 6,
  threshold = 0.15,
  as = "div",
}: RevealProps) {
  const [ref, inView] = useInView<HTMLElement>({ threshold });

  const style = {
    opacity: inView ? 1 : 0,
    transform: inView ? "translateY(0)" : `translateY(${translateY}px)`,
    transition: `opacity ${durationMs}ms var(--ease-out) ${delayMs}ms, transform ${durationMs}ms var(--ease-out) ${delayMs}ms`,
  };

  // `as` is a fixed, narrow union (never re-typed at runtime), so a ref
  // typed for `HTMLElement` — the common supertype of both target
  // elements — is safe for either tag; a generic/polymorphic component
  // here would cost more type complexity than the two literal branches
  // below.
  if (as === "li") {
    return (
      <li ref={ref as React.RefObject<HTMLLIElement>} className={className} style={style}>
        {children}
      </li>
    );
  }

  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className={className} style={style}>
      {children}
    </div>
  );
}
