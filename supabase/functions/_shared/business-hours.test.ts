import { describe, expect, it } from "vitest";
import { computeGreetingHoursContext } from "./business-hours.ts";

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
