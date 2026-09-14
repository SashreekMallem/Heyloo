/**
 * `apps/web/src/components/three` — react-three-fiber scenes for the
 * marketing site's set pieces (WEBSITE_CREATIVE_BRIEF.md). See
 * `docs/audit/SITE_REQUESTS.md` for the full ENGINE → PAGES API.
 *
 * `HeroMorphScene` is intentionally NOT re-exported from this barrel —
 * PAGES-cluster code must import it via a module-scope
 * `next/dynamic(() => import("@/components/three/hero-morph-scene"), {
 * ssr: false })` (see `hero-scroll-scene.tsx` for the reference
 * implementation) so its `three`/`@react-three/fiber` bundle stays
 * code-split; re-exporting it here would let a careless static import
 * pull the whole WebGL stack into a page's initial chunk.
 */
export { HeroMorphCanvas2d, type HeroMorphCanvas2dProps } from "./hero-morph-canvas2d";
export {
  answerPoint,
  bookPoint,
  getMorphPoints,
  HERO_MORPH_POINT_COUNT,
  landPoint,
  type Point,
  ringPoint,
} from "./morph-geometry";
export { readCssColor } from "./read-css-color";
