import { describe, expect, it } from "vitest";
import { formatDollars, formatPhoneDisplay, parseDollarsToCents } from "./format";
import { currentTimeIn, isValidTimezone } from "./timezone";

describe("formatPhoneDisplay", () => {
  it("formats +1 numbers and leaves others alone", () => {
    expect(formatPhoneDisplay("+16105550122")).toBe("(610) 555-0122");
    expect(formatPhoneDisplay("+442079460958")).toBe("+442079460958");
    expect(formatPhoneDisplay(null)).toBe("");
  });
});

describe("dollars <-> cents", () => {
  it.each([
    ["89", 8900],
    ["$89.5", 8950],
    ["89.99", 8999],
    ["1,200", 120000],
    ["0", 0],
  ])("parses %s as %i cents", (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "-5", "8.999", "$"])("rejects %s", (input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });

  it("formats cents", () => {
    expect(formatDollars(8950)).toBe("$89.50");
  });
});

describe("timezone helpers", () => {
  it("validates IANA names", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/Nowhere")).toBe(false);
    expect(isValidTimezone("'; drop table tenants; --")).toBe(false);
  });

  it("renders the local time in a zone", () => {
    // ICU may use a narrow no-break space before AM/PM.
    expect(
      currentTimeIn("America/New_York", new Date("2026-09-29T16:05:00Z"))?.replace(/\s/g, " "),
    ).toBe("Tue 12:05 PM");
    expect(currentTimeIn("Nope/Zone")).toBeNull();
  });
});
