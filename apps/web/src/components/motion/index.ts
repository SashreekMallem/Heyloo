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
export { LazyWebglBoundary, type LazyWebglBoundaryProps } from "./lazy-webgl-boundary";
export {
  ScrollOrchestrationProvider,
  type ScrollOrchestrationProviderProps,
} from "./scroll-orchestration-provider";
export { SmoothScrollRegion, type SmoothScrollRegionProps } from "./smooth-scroll-region";
export {
  type DeviceCapability,
  type DeviceTier,
  useDeviceCapability,
} from "./use-device-capability";
export { type UsePlayOnceProgressOptions, usePlayOnceProgress } from "./use-play-once-progress";
export { useReducedMotion } from "./use-reduced-motion";
export { type UseScrollProgressOptions, useScrollProgress } from "./use-scroll-progress";
