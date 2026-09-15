"use client";

import { useRef } from "react";
import { heroFilmFinal720Path, heroFilmFinalPath } from "./hero-film-frames";
import { HERO_FILM_MASK_CSS } from "./hero-film-scrubber";
import { HeroFilmThemedImage } from "./hero-film-themed-image";
import { HeroStoryOverlay } from "./hero-story-overlay";

/**
 * The hero film's LAST frame (97 — the settled white card) as a plain
 * `<img>`, theme-matched, with a 720w mobile candidate alongside the
 * full 1440w frame (`scripts` generated `final-720.webp` via `sharp`
 * into the same committed `hero-film/{theme}/` directory — see
 * `docs/BUILD_NOTES.md`). Used on its own above `<LiveCallHero>` for the
 * <768px tier (no frame *sequence* downloads on mobile, just this one
 * static image) and inside `HeroFilmStatic` below for the
 * `prefers-reduced-motion` tier.
 */
export function HeroFilmFinalImage({ className }: { className?: string }) {
  return (
    <HeroFilmThemedImage
      light={{
        src: heroFilmFinalPath("light"),
        srcSet: `${heroFilmFinal720Path("light")} 720w, ${heroFilmFinalPath("light")} 1440w`,
      }}
      dark={{
        src: heroFilmFinalPath("dark"),
        srcSet: `${heroFilmFinal720Path("dark")} 720w, ${heroFilmFinalPath("dark")} 1440w`,
      }}
      alt=""
      className={className}
      sizes="(max-width: 768px) 100vw, 50vw"
    />
  );
}

/**
 * `prefers-reduced-motion: reduce` tier (any qualifying width) — "show
 * the outcome, skip the journey," same philosophy `live-call-hero.tsx`
 * already applies for its own reduced-motion path. No scroll pin, no
 * frame sequence, no `requestAnimationFrame` loop: just the settled
 * final frame plus `hero-story-overlay.tsx`'s own "land" panel (the
 * booking landed in the dashboard), pinned at `progress: 1` via a ref
 * that never changes.
 */
export function HeroFilmStatic({ className }: { className?: string }) {
  const progressRef = useRef(1);

  return (
    <div className={className} aria-hidden="true">
      <div className="hero-film-mask relative size-full overflow-hidden">
        <style>{HERO_FILM_MASK_CSS}</style>
        <HeroFilmFinalImage />
        <HeroStoryOverlay progressRef={progressRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
