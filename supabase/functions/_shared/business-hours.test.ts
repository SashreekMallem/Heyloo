import { describe, expect, it } from "vitest";
import {
  computeGreetingHoursContext,
  computeUpcomingWeekdayDates,
  isOpenAt,
} from "./business-hours.ts";

const TZ = "America/New_York"; // EST = UTC-5 in January
const HOURS = {
  mon: [{ open: "08:00", close: "18:00" }],
  tue: [{ open: "08:00", close: "18:00" }],
  wed: [{ open: "08:00", close: "18:00" }],
  thu: [{ open: "08:00", close: "18:00" }],
  fri: [{ open: "08:00", close: "18:00" }],
  sat: [{ open: "09:00", close: "13:00" }],
  sun: [],
};

describe("computeGreetingHoursContext", () => {
  it("reports open-until when the current local time is within today's window", () => {
    // 2026-01-12 is a Monday; 14:00 UTC = 09:00 local (EST).
    const result = computeGreetingHoursContext(new Date("2026-01-12T14:00:00.000Z"), TZ, HOURS);
    expect(result).toBe("We're open until 6 PM.");
  });

  it("reports closed-today when the weekday has no windows", () => {
    // 2026-01-11 is a Sunday.
    const result = computeGreetingHoursContext(new Date("2026-01-11T18:00:00.000Z"), TZ, HOURS);
    expect(result).toBe("We're closed today.");
  });

  it("reports opening-later when before today's window starts", () => {
    // Monday 06:00 local = 11:00 UTC.
    const result = computeGreetingHoursContext(new Date("2026-01-12T11:00:00.000Z"), TZ, HOURS);
    expect(result).toBe("We're currently closed, opening today at 8 AM.");
  });

  it("reports closed-for-the-day when after today's window ends", () => {
    // Monday 20:00 local = 01:00 UTC next day.
    const result = computeGreetingHoursContext(new Date("2026-01-13T01:00:00.000Z"), TZ, HOURS);
    expect(result).toBe("We're closed for the day.");
  });

  it("formats a non-hour-aligned close time with minutes", () => {
    const hours = { mon: [{ open: "08:00", close: "13:30" }] };
    const result = computeGreetingHoursContext(new Date("2026-01-12T14:00:00.000Z"), TZ, hours);
    expect(result).toBe("We're open until 1:30 PM.");
  });

  it("a holiday exception marking the day fully closed overrides the weekly schedule", () => {
    const exceptions = [{ date: "2026-01-12", closed: true, note: "Holiday" }];
    const result = computeGreetingHoursContext(
      new Date("2026-01-12T14:00:00.000Z"),
      TZ,
      HOURS,
      exceptions,
    );
    expect(result).toBe("We're closed today.");
  });

  it("a special-hours exception overrides the weekly schedule for that date", () => {
    const exceptions = [{ date: "2026-01-12", hours: [{ open: "08:00", close: "13:00" }] }];
    const result = computeGreetingHoursContext(
      new Date("2026-01-12T14:00:00.000Z"),
      TZ,
      HOURS,
      exceptions,
    );
    expect(result).toBe("We're open until 1 PM.");
  });
});

describe("computeUpcomingWeekdayDates", () => {
  it("CALL-6: lists the next 7 calendar days' weekday->date mapping, tenant-timezone-local, starting tomorrow", () => {
    // 2026-01-12T14:00:00Z is Monday 09:00 America/New_York.
    const result = computeUpcomingWeekdayDates(new Date("2026-01-12T14:00:00.000Z"), TZ);
    expect(result).toBe(
      "Tuesday=2026-01-13, Wednesday=2026-01-14, Thursday=2026-01-15, " +
        "Friday=2026-01-16, Saturday=2026-01-17, Sunday=2026-01-18, Monday=2026-01-19",
    );
  });

  it("never includes today (already covered by current_date/current_weekday) — starts strictly tomorrow", () => {
    const result = computeUpcomingWeekdayDates(new Date("2026-01-12T14:00:00.000Z"), TZ);
    expect(result).not.toContain("2026-01-12");
    expect(result.split(", ")).toHaveLength(7);
  });

  it("wraps correctly across a month boundary", () => {
    // 2026-01-29T14:00:00Z is Thursday 09:00 America/New_York.
    const result = computeUpcomingWeekdayDates(new Date("2026-01-29T14:00:00.000Z"), TZ);
    expect(result).toBe(
      "Friday=2026-01-30, Saturday=2026-01-31, Sunday=2026-02-01, " +
        "Monday=2026-02-02, Tuesday=2026-02-03, Wednesday=2026-02-04, Thursday=2026-02-05",
    );
  });
});

describe("isOpenAt (SETTINGS-2 call routing)", () => {
  it("is true inside a window, false before/after it and on a closed weekday", () => {
    expect(isOpenAt(new Date("2026-01-12T14:00:00.000Z"), TZ, HOURS)).toBe(true); // Mon 09:00
    expect(isOpenAt(new Date("2026-01-12T11:00:00.000Z"), TZ, HOURS)).toBe(false); // Mon 06:00
    expect(isOpenAt(new Date("2026-01-13T01:00:00.000Z"), TZ, HOURS)).toBe(false); // Mon 20:00
    expect(isOpenAt(new Date("2026-01-11T18:00:00.000Z"), TZ, HOURS)).toBe(false); // Sun
  });

  it("closes at the closing minute exactly (end-exclusive)", () => {
    expect(isOpenAt(new Date("2026-01-12T22:59:00.000Z"), TZ, HOURS)).toBe(true); // 17:59
    expect(isOpenAt(new Date("2026-01-12T23:00:00.000Z"), TZ, HOURS)).toBe(false); // 18:00
  });

  it("honors closed-day and special-hours exceptions", () => {
    const monday = new Date("2026-01-12T14:00:00.000Z");
    expect(isOpenAt(monday, TZ, HOURS, [{ date: "2026-01-12", closed: true }])).toBe(false);
    expect(
      isOpenAt(monday, TZ, HOURS, [
        { date: "2026-01-12", closed: false, hours: [{ open: "12:00", close: "13:00" }] },
      ]),
    ).toBe(false);
  });

  it("SETTINGS-2-REVIEW: an all-day 00:00-23:59 window (how 24-hour tenants are stored) is open at 23:59 too", () => {
    const allDay = { mon: [{ open: "00:00", close: "23:59" }] };
    expect(isOpenAt(new Date("2026-01-13T04:59:00.000Z"), TZ, allDay)).toBe(true); // Mon 23:59
    expect(isOpenAt(new Date("2026-01-12T05:00:00.000Z"), TZ, allDay)).toBe(true); // Mon 00:00
  });

  it("treats a business with no hours configured at all as always open", () => {
    expect(isOpenAt(new Date("2026-01-11T18:00:00.000Z"), TZ, {})).toBe(true);
  });
});
