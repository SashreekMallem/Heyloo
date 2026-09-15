"use client";

import { useEffect, useState } from "react";
import type { HeroFilmTheme } from "./hero-film-frames";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Resolves the SAME theme `app/[locale]/layout.tsx`'s inline bootstrap
 * script (and `@heyloo/ui`'s `<ThemeToggle>`) already decide with:
 * `<html data-theme="light"|"dark">` wins if present, otherwise
 * `prefers-color-scheme`. Not exported/used for anything rendered on
 * first paint (that would reopen the exact hydration-mismatch problem
 * `useReducedMotion`'s own docstring describes — SSR has no `window` to
 * read either signal from) — `hero-film-scrubber.tsx` uses this only to
 * decide which theme's frame FILES to fetch into its canvas, which is
 * pure client-side effect work with no server-rendered counterpart to
 * mismatch. The theme-correct `poster`/`final` `<img>` on first paint is
 * a separate, CSS-only mechanism (see `hero-film-scrubber.tsx`'s
 * `HeroFilmThemedImage`) that doesn't depend on this hook at all.
 */
function resolveTheme(): HeroFilmTheme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  if (typeof window !== "undefined" && window.matchMedia?.(DARK_QUERY).matches) return "dark";
  return "light";
}

export function useResolvedTheme(): HeroFilmTheme {
  const [theme, setTheme] = useState<HeroFilmTheme>("light");

  // Pre-paint on the client (see useReducedMotion's identical reasoning)
  // — resolves the real theme before the browser's first client-rendered
  // paint rather than after, even though (per the docstring above)
  // nothing here is relied on for the actual zero-flash guarantee.
  useIsomorphicLayoutEffect(() => {
    setTheme(resolveTheme());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => setTheme(resolveTheme());

    const mql = window.matchMedia?.(DARK_QUERY);
    mql?.addEventListener("change", sync);

    const observer =
      typeof MutationObserver !== "undefined" ? new MutationObserver(sync) : undefined;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      mql?.removeEventListener("change", sync);
      observer?.disconnect();
    };
  }, []);

  return theme;
}
