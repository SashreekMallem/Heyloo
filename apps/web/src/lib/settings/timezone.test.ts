import { describe, expect, it } from "vitest";
import { formatInTimezone, timezoneLabel } from "./timezone";

describe("timezoneLabel / formatInTimezone (QA-1 F-18)", () => {
  it("maps a common IANA id to a friendly label and softens other ids", () => {
    expect(timezoneLabel("America/New_York")).toBe("Eastern (New York)");
    expect(timezoneLabel("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos Aires");
  });

  it("formats an instant in the business zone, not the browser zone", () => {
    const iso = "2026-09-30T01:42:40Z";
    expect(formatInTimezone(iso, "America/New_York")).toBe("Sep 29, 2026, 9:42 PM EDT");
    expect(formatInTimezone(iso, "America/Los_Angeles")).toBe("Sep 29, 2026, 6:42 PM PDT");
  });

  it("does not throw on a bad zone or bad date", () => {
    expect(formatInTimezone("2026-09-30T01:42:40Z", "Not/AZone")).toContain("2026");
    expect(formatInTimezone("nope", "America/New_York")).toBe("nope");
  });
});
