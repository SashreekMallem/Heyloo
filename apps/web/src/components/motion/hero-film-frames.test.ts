import { describe, expect, it } from "vitest";
import {
  computeHeroFilmCoverFit,
  computeHeroFilmLoadOrder,
  frameForProgress,
  HERO_FILM_CARD_RECT,
  HERO_FILM_EAGER_FRAME_COUNT,
  HERO_FILM_FRAME_COUNT,
  HERO_FILM_STAGE_FRAMES,
  heroFilmFinal720Path,
  heroFilmFinalPath,
  heroFilmFramePath,
  heroFilmPosterPath,
} from "./hero-film-frames";
import { HERO_STAGE_RANGES } from "./hero-story";

describe("frameForProgress", () => {
  it("maps every stage boundary to its exact documented frame", () => {
    expect(frameForProgress(0)).toBe(1);
    expect(frameForProgress(0.2)).toBe(30);
    expect(frameForProgress(0.55)).toBe(66);
    expect(frameForProgress(0.8)).toBe(82);
    expect(frameForProgress(1)).toBe(97);
  });

  it("interpolates linearly within a stage, pinned at that stage's own frame range", () => {
    // Midway through "answer" (0.2-0.55, frames 30-66).
    expect(frameForProgress(0.375)).toBe(48);
    // Midway through "book" (0.55-0.8, frames 66-82).
    expect(frameForProgress(0.675)).toBe(74);
  });

  it("never returns a frame outside [1, frameCount] even for out-of-range progress", () => {
    expect(frameForProgress(-5)).toBe(1);
    expect(frameForProgress(5)).toBe(HERO_FILM_FRAME_COUNT);
  });

  it("is monotonically non-decreasing as progress advances (no visual jump-back)", () => {
    let previous = frameForProgress(0);
    for (let p = 0; p <= 1; p += 0.01) {
      const frame = frameForProgress(p);
      expect(frame).toBeGreaterThanOrEqual(previous);
      previous = frame;
    }
  });

  it("covers every hero-story.ts stage with a frame table entry, using the exact same stage set", () => {
    for (const range of HERO_STAGE_RANGES) {
      expect(HERO_FILM_STAGE_FRAMES[range.stage]).toBeDefined();
    }
  });
});

describe("computeHeroFilmLoadOrder", () => {
  it("matches the documented binary-subdivision order for 97 frames", () => {
    const order = computeHeroFilmLoadOrder(97);
    expect(order.slice(0, 9)).toEqual([1, 97, 49, 25, 73, 13, 37, 61, 85]);
  });

  it("is a permutation of every frame index exactly once", () => {
    const order = computeHeroFilmLoadOrder(97);
    expect(order).toHaveLength(97);
    expect(new Set(order).size).toBe(97);
    for (let i = 1; i <= 97; i++) {
      expect(order).toContain(i);
    }
  });

  it("front-loads the eager window with the two endpoints and their nearest midpoints", () => {
    const order = computeHeroFilmLoadOrder(97);
    const eager = order.slice(0, HERO_FILM_EAGER_FRAME_COUNT);
    expect(eager).toHaveLength(HERO_FILM_EAGER_FRAME_COUNT);
    expect(eager).toContain(1);
    expect(eager).toContain(97);
    expect(eager).toContain(49);
  });

  it("handles small/edge frame counts without dropping or duplicating an index", () => {
    expect(computeHeroFilmLoadOrder(1)).toEqual([1]);
    expect(computeHeroFilmLoadOrder(2)).toEqual([1, 2]);
    const three = computeHeroFilmLoadOrder(3);
    expect(new Set(three)).toEqual(new Set([1, 2, 3]));
    expect(computeHeroFilmLoadOrder(0)).toEqual([]);
  });
});

describe("computeHeroFilmCoverFit", () => {
  it("scales a wider-than-box image to fill height, centering horizontally", () => {
    // 16:9 image into a taller-than-16:9 (square) box.
    const fit = computeHeroFilmCoverFit(800, 800, 1440, 810);
    expect(fit.dHeight).toBeCloseTo(800);
    expect(fit.dWidth).toBeGreaterThan(800);
    expect(fit.dx).toBeLessThan(0); // overflow is cropped equally off both sides
    expect(fit.dy).toBeCloseTo(0);
  });

  it("scales a taller-than-box image to fill width, centering vertically", () => {
    const fit = computeHeroFilmCoverFit(1200, 300, 1440, 810);
    expect(fit.dWidth).toBeCloseTo(1200);
    expect(fit.dHeight).toBeGreaterThan(300);
    expect(fit.dy).toBeLessThan(0);
    expect(fit.dx).toBeCloseTo(0);
  });

  it("always produces a destination rect at least as large as the container on both axes", () => {
    for (const [cw, ch] of [
      [1440, 810],
      [400, 900],
      [900, 400],
      [720, 405],
    ]) {
      const fit = computeHeroFilmCoverFit(cw as number, ch as number, 1440, 810);
      expect(fit.dWidth).toBeGreaterThanOrEqual((cw as number) - 0.01);
      expect(fit.dHeight).toBeGreaterThanOrEqual((ch as number) - 0.01);
    }
  });

  it("degrades to an identity box rather than NaN/Infinity for a zero-size input", () => {
    const fit = computeHeroFilmCoverFit(0, 0, 1440, 810);
    expect(Number.isFinite(fit.dx)).toBe(true);
    expect(Number.isFinite(fit.dWidth)).toBe(true);
  });
});

describe("asset path builders", () => {
  it("build the exact committed directory layout, per theme", () => {
    expect(heroFilmFramePath("light", 1)).toBe("/site/hero-film/light/f001.webp");
    expect(heroFilmFramePath("dark", 97)).toBe("/site/hero-film/dark/f097.webp");
    expect(heroFilmPosterPath("light")).toBe("/site/hero-film/light/poster.webp");
    expect(heroFilmFinalPath("dark")).toBe("/site/hero-film/dark/final.webp");
    expect(heroFilmFinal720Path("dark")).toBe("/site/hero-film/dark/final-720.webp");
  });
});

describe("HERO_FILM_CARD_RECT", () => {
  it("describes a valid, roughly-lower-centred rect for both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const rect = HERO_FILM_CARD_RECT[theme];
      expect(rect.x0).toBeGreaterThanOrEqual(0);
      expect(rect.x1).toBeLessThanOrEqual(1);
      expect(rect.x0).toBeLessThan(rect.x1);
      expect(rect.y0).toBeGreaterThanOrEqual(0);
      expect(rect.y1).toBeLessThanOrEqual(1);
      expect(rect.y0).toBeLessThan(rect.y1);
      // "centred-low" per the film's choreography brief.
      expect(rect.y0).toBeGreaterThan(0.4);
    }
  });
});
