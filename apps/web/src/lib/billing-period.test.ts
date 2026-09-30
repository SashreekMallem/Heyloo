import { describe, expect, it } from "vitest";
import { localMonthStart } from "./billing-period";

describe("localMonthStart", () => {
  it("uses the tenant's local month, not UTC: 22:00 ET on Aug 31 is still August", () => {
    // 2026-09-01T02:00Z is 22:00 EDT on Aug 31.
    const now = new Date("2026-09-01T02:00:00Z");
    expect(localMonthStart("America/New_York", now)).toBe("2026-08-01");
    expect(localMonthStart("UTC", now)).toBe("2026-09-01");
  });

  it("ahead-of-UTC zones roll into the next month earlier", () => {
    const now = new Date("2026-08-31T20:00:00Z"); // 06:00 Sep 1 in Sydney
    expect(localMonthStart("Australia/Sydney", now)).toBe("2026-09-01");
  });

  it("falls back to a valid first-of-month for an unknown zone", () => {
    expect(localMonthStart("Not/AZone", new Date("2026-09-15T12:00:00Z"))).toMatch(/^2026-09-01$/);
  });
});
