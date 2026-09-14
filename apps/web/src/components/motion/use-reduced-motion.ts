"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * `prefers-reduced-motion: reduce`, reactively (WEBSITE_CREATIVE_BRIEF.md
 * §3/§6/§7 — every set piece must render a complete, correct STATIC
 * composition when this is true, not merely "not crash"). Defaults to
 * `false` before mount (SSR-safe — there is no media query on the
 * server), which is the correct default here: every motion.* / three.*
 * component in this cluster already renders its reduced-motion-safe
 * static frame as the synchronous default and only swaps to a scroll
 * story once this hook (client-side) reports `false` is confirmed, so a
 * `false`-until-mounted default never causes an unwanted motion flash —
 * see `hero-scroll-scene.tsx`.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);

    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}
