"use client";

import type Lenis from "lenis";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export interface SmoothScrollRegionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Scopes Lenis smooth-scroll to a self-contained scrollable subtree —
 * NOT a page-wide smooth-scroll layer. Lenis is constructed with this
 * component's own `wrapper`/`content` element pair (lenis's documented
 * way to scope it to a specific scrollable container instead of
 * `window`/`document.documentElement`) rather than mounted globally.
 *
 * **Never wrap the hero or the dashboard-reveal set piece in this** —
 * WEBSITE_CREATIVE_BRIEF.md §3, citing
 * `docs/design/FABLE5_SITE_TECHNIQUES.md` §5.1 (dappasol.com's build-path
 * writeup): Lenis "breaks stacked and pinned ScrollTriggers". Any
 * `useScrollProgress({ pin: true })` target must live entirely outside
 * (never nested inside) a `<SmoothScrollRegion>`.
 *
 * Disabled entirely under `prefers-reduced-motion` — Lenis intercepts
 * native scroll physics, which is itself a motion effect; reduced-motion
 * visitors get this region's plain native scroll instead. `lenis` loads
 * lazily (dynamic `import()`), so a page that never renders this
 * component never pays for the dependency at all.
 */
export function SmoothScrollRegion({ children, className }: SmoothScrollRegionProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    let cancelled = false;
    let lenis: Lenis | undefined;

    void import("lenis").then(({ default: LenisConstructor }) => {
      if (cancelled) return;
      lenis = new LenisConstructor({ wrapper, content, autoRaf: true });
    });

    return () => {
      cancelled = true;
      lenis?.destroy();
    };
  }, []);

  return (
    <div ref={wrapperRef} className={className}>
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
