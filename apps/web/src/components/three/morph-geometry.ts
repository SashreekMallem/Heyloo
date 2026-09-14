import { resolveHeroStage } from "@/components/motion/hero-story";

/**
 * The hero set piece's flagship object, authored as data (control
 * points), never an imported glTF model — WEBSITE_CREATIVE_BRIEF.md §3:
 * "authored as data (control points) directly in code... no external
 * glTF model needed for this object; it's authored as data, not
 * imported geometry, which also keeps the asset weight near zero." One
 * continuous line, four keyframe shapes, lerped per-point by scroll
 * progress — consumed identically by the WebGL scene
 * (`hero-morph-scene.tsx`, a `THREE.Line`) and the Canvas2D fallback
 * (`hero-morph-canvas2d.tsx`, a `path` draw), so both tiers render the
 * exact same authored shape.
 *
 * Four keyframes, three morphs between them (matching the §3 diagram
 * and its own asset #2 Higgsfield-prompt description, "straightening
 * from a soft wave shape into a straight horizontal line, then folding
 * once into a rounded rectangle outline" — which is this file's whole
 * shape story in one sentence):
 *   K0 "ring"   — a thin waveform with a gentle low-frequency undertone
 *                 that reads as a handset's curved silhouette (§3: "a
 *                 thin-line waveform... rendered as a handset silhouette
 *                 built from the same line weight").
 *   K1 "answer" — the waveform has straightened into a flat baseline
 *                 (the visual root the transcript text "grows" from).
 *   K2 "book"   — the same line folded into the booking card's rounded-
 *                 rectangle outline.
 *   K3 "land"   — the same outline, flattened and widened into a
 *                 dashboard row's proportions (the shared-element morph
 *                 target `dashboard-preview.tsx`'s `CallFeedItem` rows
 *                 already use further down the page).
 *
 * Every keyframe is parametrized by the same `t ∈ [0,1]` walking
 * left-to-right (the two rounded-rectangle keyframes deliberately start
 * their perimeter walk at the LEFTMOST point, for the same reason) so a
 * per-point lerp between any two adjacent keyframes reads as a fold, not
 * a swirl.
 */

export type Point = readonly [number, number];

export const HERO_MORPH_POINT_COUNT = 64;

function lerpPoint(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function sample(count: number, fn: (t: number) => Point): Point[] {
  return Array.from({ length: count }, (_, i) => fn(i / (count - 1)));
}

/** K0 — "ring": waveform-as-handset-silhouette. */
export function ringPoint(t: number): Point {
  const x = -1.1 + t * 2.2;
  const envelope = Math.sin(t * Math.PI); // 0 at both ends, peaks mid-line
  const undertone = 0.22 * Math.sin(t * Math.PI * 1.4 + Math.PI / 5); // the "handset" curve
  const ripple = 0.1 * Math.sin(t * Math.PI * 11) * envelope; // the "waveform" texture
  return [x, undertone + ripple];
}

/** K1 — "answer": straightened to a flat baseline. */
export function answerPoint(t: number): Point {
  return [-1.1 + t * 2.2, 0];
}

/**
 * A superellipse (`|x/a|^n + |y/b|^n = 1`, n=4) — a smooth, cheap stand-in
 * for a rounded rectangle's outline that needs no piecewise arc-length
 * walking around straight edges + corner arcs. `t=0` starts at the
 * leftmost point and travels clockwise, matching `ringPoint`/
 * `answerPoint`'s own left-to-right travel direction.
 */
function superellipsePoint(t: number, halfWidth: number, halfHeight: number): Point {
  const SUPERELLIPSE_EXPONENT = 4;
  const theta = Math.PI + t * Math.PI * 2;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const x = halfWidth * Math.sign(cos) * Math.abs(cos) ** (2 / SUPERELLIPSE_EXPONENT);
  const y = halfHeight * Math.sign(sin) * Math.abs(sin) ** (2 / SUPERELLIPSE_EXPONENT);
  return [x, y];
}

/** K2 — "book": folded into the booking card's outline. */
export function bookPoint(t: number): Point {
  return superellipsePoint(t, 0.55, 0.4);
}

/** K3 — "land": the same outline, flattened/widened into a dashboard row. */
export function landPoint(t: number): Point {
  return superellipsePoint(t, 1.1, 0.12);
}

/**
 * Resolves the flagship object's full point set for a raw 0-1 scroll
 * progress — the single function both the WebGL and Canvas2D renderers
 * call every frame. Only one of the three morphs (K0↔K1, K1↔K2, K2↔K3)
 * is ever active at a time, matching `resolveHeroStage`'s stage
 * boundaries (`hero-story.ts`); the "answer" stage deliberately holds
 * geometry static at K1 while the DOM transcript layer does its own
 * animation on top — see WEBSITE_CREATIVE_BRIEF.md §3's diagram.
 */
export function getMorphPoints(progress: number, pointCount = HERO_MORPH_POINT_COUNT): Point[] {
  const { stage, stageProgress } = resolveHeroStage(progress);

  switch (stage) {
    case "ring":
      return sample(pointCount, (t) => lerpPoint(ringPoint(t), answerPoint(t), stageProgress));
    case "answer":
      return sample(pointCount, answerPoint);
    case "book":
      return sample(pointCount, (t) => lerpPoint(answerPoint(t), bookPoint(t), stageProgress));
    case "land":
      return sample(pointCount, (t) => lerpPoint(bookPoint(t), landPoint(t), stageProgress));
    default:
      return sample(pointCount, answerPoint);
  }
}
