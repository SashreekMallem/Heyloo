/**
 * The hero morph object's 4-beat story, as scroll-progress ranges
 * (WEBSITE_CREATIVE_BRIEF.md §3 — narrative beats 1→5 of §1's 6-beat
 * arc: ring / answer / book / land). `three/morph-geometry.ts` uses
 * these ranges to decide which two keyframe shapes to lerp between at a
 * given progress value — this is an internal detail of the WebGL
 * geometry layer (`hero-morph-scene.tsx`, driven by
 * `hero-scroll-scene.tsx`'s pinned `useScrollProgress`), not a contract
 * PAGES-cluster code needs to consume: `<HeroScrollScene>`'s own
 * `fallback` prop owns its DOM content independently (see
 * `hero-scroll-scene.tsx`). Exported anyway in case a second scroll-
 * linked moment ever wants to reuse the same 4-beat pacing.
 */

export const HERO_STAGES = ["ring", "answer", "book", "land"] as const;

export type HeroStage = (typeof HERO_STAGES)[number];

export interface HeroStageRange {
  stage: HeroStage;
  /** Inclusive start of this stage's overall scroll-progress range (0-1). */
  start: number;
  /** Exclusive end of this stage's overall scroll-progress range (0-1) — 1.0 on the last stage. */
  end: number;
}

/**
 * Beat boundaries verbatim from WEBSITE_CREATIVE_BRIEF.md §3's morph
 * diagram:
 *   ring    0    → 0.2  (waveform straightens)
 *   answer  0.2  → 0.55 (transcript turns, tool-call badge)
 *   book    0.55 → 0.8  (booking card assembles)
 *   land    0.8  → 1.0  (card → dashboard-row shared-element morph)
 */
export const HERO_STAGE_RANGES: readonly HeroStageRange[] = [
  { stage: "ring", start: 0, end: 0.2 },
  { stage: "answer", start: 0.2, end: 0.55 },
  { stage: "book", start: 0.55, end: 0.8 },
  { stage: "land", start: 0.8, end: 1 },
];

/** Resolves a raw 0-1 scroll progress to its stage and 0-1 progress within that stage. */
export function resolveHeroStage(progress: number): { stage: HeroStage; stageProgress: number } {
  const clamped = Math.min(1, Math.max(0, progress));
  for (const range of HERO_STAGE_RANGES) {
    const isLastRange = range.end >= 1;
    if (clamped < range.end || (isLastRange && clamped <= range.end)) {
      const span = range.end - range.start;
      const stageProgress = span > 0 ? (clamped - range.start) / span : 1;
      return { stage: range.stage, stageProgress: Math.min(1, Math.max(0, stageProgress)) };
    }
  }
  // Unreachable: HERO_STAGE_RANGES always covers [0, 1] and clamped ∈ [0, 1].
  const last = HERO_STAGE_RANGES[HERO_STAGE_RANGES.length - 1] as HeroStageRange;
  return { stage: last.stage, stageProgress: 1 };
}
