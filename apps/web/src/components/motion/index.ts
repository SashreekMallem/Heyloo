/**
 * `apps/web/src/components/motion` — the scroll/motion orchestration
 * engine for the marketing site (WEBSITE_CREATIVE_BRIEF.md). See
 * `docs/audit/SITE_REQUESTS.md` for the full ENGINE → PAGES API and a
 * worked example. `HeroScrollScene` is the main entry point most PAGES-
 * cluster code needs; the individual hooks/providers below are exported
 * for anything that needs to build a second, lighter scroll-linked
 * moment without going through `HeroScrollScene`.
 */
export {
  computeHeroFilmCoverFit,
  computeHeroFilmLoadOrder,
  frameForProgress,
  HERO_FILM_CARD_RECT,
  HERO_FILM_EAGER_FRAME_COUNT,
  HERO_FILM_FRAME_COUNT,
  HERO_FILM_STAGE_FRAMES,
  HERO_FILM_THEMES,
  type HeroFilmCoverFit,
  type HeroFilmRect,
  type HeroFilmTheme,
  heroFilmFinal720Path,
  heroFilmFinalPath,
  heroFilmFrameBasename,
  heroFilmFramePath,
  heroFilmPosterPath,
} from "./hero-film-frames";
export { HeroFilmScrubber, type HeroFilmScrubberProps } from "./hero-film-scrubber";
export { HeroFilmFinalImage, HeroFilmStatic } from "./hero-film-static";
export {
  HeroFilmThemedImage,
  type HeroFilmThemedImageProps,
  type HeroFilmThemeSrc,
} from "./hero-film-themed-image";
export {
  HeroScrollScene,
  type HeroScrollSceneProps,
  type HeroScrollVisualProps,
} from "./hero-scroll-scene";
export {
  HERO_STAGE_RANGES,
  HERO_STAGES,
  type HeroStage,
  type HeroStageRange,
  resolveHeroStage,
} from "./hero-story";
export { HeroStoryOverlay, type HeroStoryOverlayProps } from "./hero-story-overlay";
export {
  ScrollOrchestrationProvider,
  type ScrollOrchestrationProviderProps,
} from "./scroll-orchestration-provider";
export { SmoothScrollRegion, type SmoothScrollRegionProps } from "./smooth-scroll-region";
export {
  type DeviceCapability,
  MIN_QUALIFYING_WIDTH,
  useDeviceCapability,
} from "./use-device-capability";
export { type UsePlayOnceProgressOptions, usePlayOnceProgress } from "./use-play-once-progress";
export { useReducedMotion } from "./use-reduced-motion";
export { useResolvedTheme } from "./use-resolved-theme";
export { type UseScrollProgressOptions, useScrollProgress } from "./use-scroll-progress";
