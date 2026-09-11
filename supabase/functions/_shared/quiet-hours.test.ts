import { describe, expect, it } from "vitest";
import { isQuietHours, localHour, resolveQuietHoursWindow } from "./quiet-hours.ts";

const TZ = "America/New_York"; // EST = UTC-5 in January (no DST)

describe("localHour", () => {
  it("resolves the wall-clock hour in the given timezone", () => {
    expect(localHour(new Date("2026-01-15T14:00:00.000Z"), TZ)).toBe(9);
    expect(localHour(new Date("2026-01-15T02:00:00.000Z"), TZ)).toBe(21);
  });
});

describe("isQuietHours (default 9pm-9am tenant-local, MASTER_SPEC §3.6)", () => {
  it("is quiet at 8am local (just before the 9am end)", () => {
    expect(isQuietHours(new Date("2026-01-15T13:00:00.000Z"), TZ)).toBe(true);
  });

  it("is NOT quiet at exactly 9am local (window end is exclusive)", () => {
    expect(isQuietHours(new Date("2026-01-15T14:00:00.000Z"), TZ)).toBe(false);
  });

  it("is quiet at exactly 9pm local (window start is inclusive)", () => {
    expect(isQuietHours(new Date("2026-01-15T02:00:00.000Z"), TZ)).toBe(true);
  });

  it("is NOT quiet at 8pm local (just before the 9pm start)", () => {
    expect(isQuietHours(new Date("2026-01-15T01:00:00.000Z"), TZ)).toBe(false);
  });

  it("is NOT quiet at 2pm local (mid-afternoon)", () => {
    expect(isQuietHours(new Date("2026-01-15T19:00:00.000Z"), TZ)).toBe(false);
  });

  it("respects a custom, non-wrapping quiet window", () => {
    // 1pm-2pm local quiet window, non-wrapping.
    expect(isQuietHours(new Date("2026-01-15T18:30:00.000Z"), TZ, 13, 14)).toBe(true);
    expect(isQuietHours(new Date("2026-01-15T20:00:00.000Z"), TZ, 13, 14)).toBe(false);
  });
});

describe("resolveQuietHoursWindow (tenants.quiet_hours jsonb, BACKEND_SPEC.md §13.2)", () => {
  it("falls back to enabled/21/9 for the unconfigured default ({})", () => {
    expect(resolveQuietHoursWindow({})).toEqual({ enabled: true, startHour: 21, endHour: 9 });
  });

  it("falls back to enabled/21/9 for null/undefined", () => {
    expect(resolveQuietHoursWindow(null)).toEqual({ enabled: true, startHour: 21, endHour: 9 });
    expect(resolveQuietHoursWindow(undefined)).toEqual({
      enabled: true,
      startHour: 21,
      endHour: 9,
    });
  });

  it("parses a tenant's custom start/end HH:MM into hours", () => {
    expect(resolveQuietHoursWindow({ start: "22:00", end: "08:00", enabled: true })).toEqual({
      enabled: true,
      startHour: 22,
      endHour: 8,
    });
  });

  it("honors enabled: false, ignoring any start/end also present", () => {
    expect(resolveQuietHoursWindow({ start: "22:00", end: "08:00", enabled: false })).toEqual({
      enabled: false,
      startHour: 22,
      endHour: 8,
    });
  });

  it("falls back to the default hour for a malformed start/end rather than throwing", () => {
    expect(resolveQuietHoursWindow({ start: "not-a-time", end: 5 })).toEqual({
      enabled: true,
      startHour: 21,
      endHour: 9,
    });
  });
});
