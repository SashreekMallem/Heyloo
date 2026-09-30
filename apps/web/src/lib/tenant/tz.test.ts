import { describe, expect, it } from "vitest";
import {
  shiftDateKey,
  tenantDateKey,
  tenantDateKeyDaysAgo,
  tenantDayStartIso,
  tenantMidnightIso,
} from "./tz";

describe("tenant-local day helpers (F-02 / F-21)", () => {
  it("uses the tenant's local date, not the UTC date", () => {
    // 2026-09-30T01:30Z is still the evening of Sep 29 in New York (EDT, UTC-4).
    const instant = new Date("2026-09-30T01:30:00Z");
    expect(tenantDateKey("America/New_York", instant)).toBe("2026-09-29");
    expect(tenantDateKey("UTC", instant)).toBe("2026-09-30");
    expect(tenantDateKey("Pacific/Auckland", instant)).toBe("2026-09-30");
  });

  it("finds the UTC instant of local midnight", () => {
    const instant = new Date("2026-09-30T01:30:00Z");
    expect(tenantDayStartIso("America/New_York", instant)).toBe("2026-09-29T04:00:00.000Z");
    expect(tenantDayStartIso("UTC", instant)).toBe("2026-09-30T00:00:00.000Z");
    expect(tenantDayStartIso("Asia/Kolkata", instant)).toBe("2026-09-29T18:30:00.000Z");
  });

  it("is DST-safe on transition days", () => {
    // US spring-forward 2026-03-08: midnight is still EST (UTC-5).
    expect(tenantMidnightIso("America/New_York", "2026-03-08")).toBe("2026-03-08T05:00:00.000Z");
    // The next day is EDT (UTC-4).
    expect(tenantMidnightIso("America/New_York", "2026-03-09")).toBe("2026-03-09T04:00:00.000Z");
    // Fall-back 2026-11-01: midnight is still EDT (UTC-4).
    expect(tenantMidnightIso("America/New_York", "2026-11-01")).toBe("2026-11-01T04:00:00.000Z");
  });

  it("falls back to UTC for an unknown zone rather than throwing", () => {
    const instant = new Date("2026-09-29T12:00:00Z");
    expect(tenantDateKey("Mars/Phobos", instant)).toBe("2026-09-29");
    expect(tenantDayStartIso(null, instant)).toBe("2026-09-29T00:00:00.000Z");
  });

  it("walks back N tenant-local days", () => {
    const instant = new Date("2026-09-30T01:30:00Z");
    expect(tenantDateKeyDaysAgo("America/New_York", 0, instant)).toBe("2026-09-29");
    expect(tenantDateKeyDaysAgo("America/New_York", 6, instant)).toBe("2026-09-23");
    expect(tenantDateKeyDaysAgo("UTC", 30, new Date("2026-03-05T00:00:00Z"))).toBe("2026-02-03");
  });
});

describe("shiftDateKey", () => {
  it("shifts calendar days across month/year boundaries", () => {
    expect(shiftDateKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateKey("2026-02-27", 2)).toBe("2026-03-01");
  });
});
