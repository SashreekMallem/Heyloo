import { describe, expect, it } from "vitest";
import { HERO_STAGE_RANGES, resolveHeroStage } from "./hero-story";

describe("HERO_STAGE_RANGES", () => {
  it("covers [0, 1] with no gaps or overlaps, in order", () => {
    expect(HERO_STAGE_RANGES[0]?.start).toBe(0);
    expect(HERO_STAGE_RANGES.at(-1)?.end).toBe(1);
    for (let i = 1; i < HERO_STAGE_RANGES.length; i++) {
      expect(HERO_STAGE_RANGES[i]?.start).toBe(HERO_STAGE_RANGES[i - 1]?.end);
    }
  });
});

describe("resolveHeroStage", () => {
  it("resolves the exact boundaries from WEBSITE_CREATIVE_BRIEF.md §3's diagram", () => {
    expect(resolveHeroStage(0).stage).toBe("ring");
    expect(resolveHeroStage(0.1).stage).toBe("ring");
    expect(resolveHeroStage(0.2).stage).toBe("answer");
    expect(resolveHeroStage(0.4).stage).toBe("answer");
    expect(resolveHeroStage(0.55).stage).toBe("book");
    expect(resolveHeroStage(0.7).stage).toBe("book");
    expect(resolveHeroStage(0.8).stage).toBe("land");
    expect(resolveHeroStage(1).stage).toBe("land");
  });

  it("gives 0 at the start of a stage and 1 at its end", () => {
    expect(resolveHeroStage(0).stageProgress).toBeCloseTo(0);
    expect(resolveHeroStage(0.1).stageProgress).toBeCloseTo(0.5);
    expect(resolveHeroStage(0.55).stageProgress).toBeCloseTo(0);
    expect(resolveHeroStage(1).stageProgress).toBeCloseTo(1);
  });

  it("clamps out-of-range input instead of throwing or returning an invalid stage", () => {
    expect(resolveHeroStage(-1)).toEqual(resolveHeroStage(0));
    expect(resolveHeroStage(2)).toEqual(resolveHeroStage(1));
  });
});
