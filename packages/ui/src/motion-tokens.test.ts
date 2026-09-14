import { describe, expect, it } from "vitest";
import {
  ENTRANCE_STAGGER_MS,
  HERO_PIN_VH,
  MOTION_DURATIONS_MS,
  MOTION_EASES,
  SCROLL_SCRUB,
} from "./motion-tokens.js";

describe("motion-tokens", () => {
  it("mirrors globals.css's --duration-fast/base/slow in milliseconds", () => {
    expect(MOTION_DURATIONS_MS).toEqual({ fast: 150, base: 200, slow: 250 });
  });

  it("mirrors globals.css's --ease-out/--ease-in-out as both a CSS string and raw control points", () => {
    expect(MOTION_EASES.out.css).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(MOTION_EASES.out.points).toEqual([0.16, 1, 0.3, 1]);
    expect(MOTION_EASES.inOut.css).toBe("cubic-bezier(0.65, 0, 0.35, 1)");
    expect(MOTION_EASES.inOut.points).toEqual([0.65, 0, 0.35, 1]);
  });

  it("never lets the shared scroll scrub value drift to true/1:1", () => {
    expect(SCROLL_SCRUB).toBeGreaterThan(0);
    expect(SCROLL_SCRUB).toBeLessThan(1);
  });

  it("gives the hero a shorter pin on tablet than desktop", () => {
    expect(HERO_PIN_VH.tablet).toBeLessThan(HERO_PIN_VH.desktop);
  });

  it("keeps stagger delays small enough to read as one motion, not a cascade", () => {
    expect(ENTRANCE_STAGGER_MS.grid).toBeLessThanOrEqual(100);
    expect(ENTRANCE_STAGGER_MS.row).toBeLessThanOrEqual(100);
  });
});
