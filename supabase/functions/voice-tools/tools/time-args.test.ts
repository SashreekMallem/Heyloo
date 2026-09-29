import { describe, expect, it } from "vitest";
import { normalizeInstant, normalizeTimeRange } from "./time-args.ts";

/** What postgres@3.4.9's stock date serializer sends for a valid value. */
const stockSerialize = (x: string) => new Date(x).toISOString();

describe("normalizeInstant (HOTPATH-REVIEW)", () => {
  it("returns exactly what postgres.js would bind for every parseable form", () => {
    for (const value of [
      "2026-09-29T10:00:00-04:00",
      "2026-09-29T14:00:00Z",
      "2026-09-29T14:00:00.000Z",
      "2026-09-29",
      "2026-09-29 10:00",
    ]) {
      expect(normalizeInstant(value)).toBe(stockSerialize(value));
    }
  });

  it("maps the same instant written differently to one form (the idempotency key needs this)", () => {
    expect(normalizeInstant("2026-09-29T10:00:00-04:00")).toBe("2026-09-29T14:00:00.000Z");
    expect(normalizeInstant("2026-09-29T14:00:00Z")).toBe("2026-09-29T14:00:00.000Z");
    expect(normalizeInstant("2026-09-29T14:00:00.000Z")).toBe("2026-09-29T14:00:00.000Z");
  });

  it("returns null (never throws) for what the stock serializer would throw on", () => {
    for (const value of ["tomorrow", "today", "10:30 AM", "Sep 29 2026 10am", "", "Invalid Date"]) {
      expect(() => new Date(value).toISOString()).toThrow(RangeError);
      expect(normalizeInstant(value)).toBeNull();
    }
  });
});

describe("normalizeTimeRange (HOTPATH-REVIEW)", () => {
  it("normalizes both ends", () => {
    expect(normalizeTimeRange("2026-09-29T10:00:00-04:00", "2026-09-29T10:30:00-04:00")).toEqual({
      start: "2026-09-29T14:00:00.000Z",
      end: "2026-09-29T14:30:00.000Z",
    });
  });

  it("rejects an unparseable end, a backwards range, and an empty range", () => {
    expect(normalizeTimeRange("2026-09-29T10:00:00Z", "later")).toBeNull();
    expect(normalizeTimeRange("tomorrow", "2026-09-29T10:00:00Z")).toBeNull();
    expect(normalizeTimeRange("2026-09-29T11:00:00Z", "2026-09-29T10:00:00Z")).toBeNull();
    expect(normalizeTimeRange("2026-09-29T10:00:00Z", "2026-09-29T06:00:00-04:00")).toBeNull();
  });

  it("allowEmpty keeps an empty window (check_availability's historical behavior) but still rejects a backwards one", () => {
    expect(normalizeTimeRange("2026-09-29", "2026-09-29", { allowEmpty: true })).toEqual({
      start: "2026-09-29T00:00:00.000Z",
      end: "2026-09-29T00:00:00.000Z",
    });
    expect(normalizeTimeRange("2026-09-30", "2026-09-29", { allowEmpty: true })).toBeNull();
  });
});
