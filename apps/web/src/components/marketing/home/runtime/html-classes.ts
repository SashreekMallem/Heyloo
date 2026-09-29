/**
 * The classes the home page keeps on `<html>` while it is mounted. `home.css`
 * keys the whole motion layout off them:
 *
 * - `fx` or `rm`: motion allowed, or reduced motion (nothing pinned, nothing timed)
 * - `stage` or `flow`: desktop pinned layout, or the phone / short-window layout
 * - `gl-on` / `gl-off`: the 3D scene is drawing, or the static poster stays
 * - `scrolled`: the page has left the top (the header gets its rule)
 * - `intro-pre`: the hero letters are still at their thin starting weight
 */
export const HOME_CLASSES = {
  fx: "fx",
  rm: "rm",
  stage: "stage",
  flow: "flow",
  glOn: "gl-on",
  glOff: "gl-off",
  scrolled: "scrolled",
  introPre: "intro-pre",
} as const;

/** The stage media query: pinned desktop layout needs 900 x 560 or more. */
export const STAGE_QUERY = "(min-width: 900px) and (min-height: 560px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Sets the tier classes from the two media queries. Idempotent. */
export function applyTierClasses(root: HTMLElement): void {
  const list = root.classList;
  const reduced = matchMedia(REDUCED_MOTION_QUERY).matches;
  list.toggle(HOME_CLASSES.rm, reduced);
  list.toggle(HOME_CLASSES.fx, !reduced);
  const stage = matchMedia(STAGE_QUERY).matches;
  list.toggle(HOME_CLASSES.stage, stage);
  list.toggle(HOME_CLASSES.flow, !stage);
}

/** Removes every class this page put on `<html>`. */
export function clearHomeClasses(root: HTMLElement): void {
  for (const name of Object.values(HOME_CLASSES)) root.classList.remove(name);
}

/**
 * Inline, runs before first paint (like the theme bootstrap in the locale
 * layout): sets the tier classes so the very first frame already has the
 * final layout (pinned runways reserved, no shift when the runtime starts).
 * Kept in step with `applyTierClasses` by `html-classes.test.ts`.
 */
export const HOME_BOOTSTRAP_SCRIPT = `(function(){var d=document.documentElement,c=d.classList;c.add(matchMedia('${REDUCED_MOTION_QUERY}').matches?'rm':'fx');c.add(matchMedia('${STAGE_QUERY}').matches?'stage':'flow');})();`;
