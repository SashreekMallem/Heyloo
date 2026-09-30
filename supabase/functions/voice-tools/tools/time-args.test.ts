import { describe, expect, it, vi } from "vitest";
import { localizeNaiveTimes, normalizeInstant, normalizeTimeRange } from "./time-args.ts";

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

describe("F1 / F-VET-AVAIL-1: offset-less times are the tenant's wall clock", () => {
  it("reads a naive date-time in the tenant timezone, not UTC (America/Chicago, CDT)", () => {
    expect(normalizeInstant("2026-09-30T09:00:00", "America/Chicago")).toBe(
      "2026-09-30T14:00:00.000Z",
    );
    expect(normalizeInstant("2026-10-01 12:00", "America/Denver")).toBe("2026-10-01T18:00:00.000Z");
  });

  it("uses the standard-time offset after the fall-back date and the DST offset before it", () => {
    expect(normalizeInstant("2026-11-02T09:00:00", "America/Chicago")).toBe(
      "2026-11-02T15:00:00.000Z",
    );
    expect(normalizeInstant("2026-03-08T12:00:00", "America/Chicago")).toBe(
      "2026-03-08T17:00:00.000Z",
    );
  });

  it("reads a date-only string as local midnight", () => {
    expect(normalizeInstant("2026-10-01", "America/Denver")).toBe("2026-10-01T06:00:00.000Z");
  });

  it("leaves strings that already carry an offset or Z untouched", () => {
    expect(normalizeInstant("2026-09-30T09:00:00-05:00", "America/Denver")).toBe(
      "2026-09-30T14:00:00.000Z",
    );
    expect(normalizeInstant("2026-09-30T09:00:00Z", "America/Denver")).toBe(
      "2026-09-30T09:00:00.000Z",
    );
  });

  it("falls back to the legacy reading without a zone or with an unknown zone", () => {
    expect(normalizeInstant("2026-09-30T09:00:00")).toBe(
      new Date("2026-09-30T09:00:00").toISOString(),
    );
    expect(normalizeInstant("2026-09-30T09:00:00", "Not/AZone")).toBe(
      new Date("2026-09-30T09:00:00").toISOString(),
    );
  });

  it("normalizeTimeRange applies the zone to both ends", () => {
    expect(
      normalizeTimeRange("2026-10-01T12:00:00", "2026-10-01T17:00:00", {
        timeZone: "America/Denver",
      }),
    ).toEqual({ start: "2026-10-01T18:00:00.000Z", end: "2026-10-01T23:00:00.000Z" });
  });

  it("localizeNaiveTimes reads the zone only when something is offset-less", async () => {
    const read = vi.fn(async () => "America/Chicago");
    const same = await localizeNaiveTimes(read, { a: "2026-09-30T09:00:00-05:00" });
    expect(same).toEqual({ a: "2026-09-30T09:00:00-05:00" });
    expect(read).not.toHaveBeenCalled();
    const out = await localizeNaiveTimes(read, {
      a: "2026-09-30T09:00:00",
      b: "2026-09-30T10:00:00Z",
      c: undefined,
    });
    expect(out).toEqual({ a: "2026-09-30T14:00:00.000Z", b: "2026-09-30T10:00:00Z", c: undefined });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("localizeNaiveTimes keeps the values when the zone cannot be read", async () => {
    const onError = vi.fn();
    const out = await localizeNaiveTimes(
      async () => {
        throw new Error("db down");
      },
      { a: "2026-09-30T09:00:00" },
      onError,
    );
    expect(out).toEqual({ a: "2026-09-30T09:00:00" });
    expect(onError).toHaveBeenCalled();
  });
});
