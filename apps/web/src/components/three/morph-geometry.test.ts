import { describe, expect, it } from "vitest";
import {
  answerPoint,
  bookPoint,
  getMorphPoints,
  HERO_MORPH_POINT_COUNT,
  landPoint,
  ringPoint,
} from "./morph-geometry";

function sampleAt(fn: (t: number) => readonly [number, number], count: number) {
  return Array.from({ length: count }, (_, i) => fn(i / (count - 1)));
}

describe("getMorphPoints", () => {
  it("always returns the requested point count", () => {
    for (const progress of [0, 0.1, 0.2, 0.4, 0.55, 0.7, 0.8, 0.9, 1]) {
      expect(getMorphPoints(progress, 16)).toHaveLength(16);
    }
    expect(getMorphPoints(0.5)).toHaveLength(HERO_MORPH_POINT_COUNT);
  });

  it("resolves to the ring keyframe exactly at progress 0", () => {
    expect(getMorphPoints(0, 8)).toEqual(sampleAt(ringPoint, 8));
  });

  it("resolves to the answer (straightened) keyframe across the whole answer stage", () => {
    const expected = sampleAt(answerPoint, 8);
    expect(getMorphPoints(0.2, 8)).toEqual(expected);
    expect(getMorphPoints(0.35, 8)).toEqual(expected);
    expect(getMorphPoints(0.549, 8)).toEqual(expected);
  });

  it("resolves to the booking-card keyframe exactly at progress 0.8", () => {
    const points = getMorphPoints(0.8, 8);
    const expected = sampleAt(bookPoint, 8);
    for (let i = 0; i < points.length; i++) {
      expect(points[i]?.[0]).toBeCloseTo(expected[i]?.[0] ?? Number.NaN, 5);
      expect(points[i]?.[1]).toBeCloseTo(expected[i]?.[1] ?? Number.NaN, 5);
    }
  });

  it("resolves to the dashboard-row keyframe exactly at progress 1", () => {
    const points = getMorphPoints(1, 8);
    const expected = sampleAt(landPoint, 8);
    for (let i = 0; i < points.length; i++) {
      expect(points[i]?.[0]).toBeCloseTo(expected[i]?.[0] ?? Number.NaN, 5);
      expect(points[i]?.[1]).toBeCloseTo(expected[i]?.[1] ?? Number.NaN, 5);
    }
  });

  it("interpolates strictly between the ring and answer keyframes mid-stage", () => {
    const ring = sampleAt(ringPoint, 8);
    const answer = sampleAt(answerPoint, 8);
    const mid = getMorphPoints(0.1, 8); // halfway through the 0-0.2 "ring" stage

    for (let i = 0; i < mid.length; i++) {
      const r = ring[i] as readonly [number, number];
      const a = answer[i] as readonly [number, number];
      const m = mid[i] as readonly [number, number];
      // x is identical across every keyframe (all walk left-to-right the
      // same way) — only y should move, and only when ring's y differs
      // from the flat baseline's y=0.
      expect(m[0]).toBeCloseTo((r[0] + a[0]) / 2, 5);
      if (r[1] !== 0) {
        expect(m[1]).not.toBeCloseTo(r[1], 3);
        expect(m[1]).not.toBeCloseTo(a[1], 3);
      }
    }
  });

  it("clamps out-of-range progress instead of throwing", () => {
    expect(() => getMorphPoints(-0.5)).not.toThrow();
    expect(() => getMorphPoints(1.5)).not.toThrow();
    expect(getMorphPoints(-0.5)).toEqual(getMorphPoints(0));
    expect(getMorphPoints(1.5)).toEqual(getMorphPoints(1));
  });
});
