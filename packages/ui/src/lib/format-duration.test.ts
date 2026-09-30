import { describe, expect, it } from "vitest";
import { formatDuration } from "./format-duration.js";

describe("formatDuration (QA-1 F-16)", () => {
  it("shows seconds under a minute instead of rounding to 0m", () => {
    expect(formatDuration(20)).toBe("20s");
    expect(formatDuration(0)).toBe("0s");
  });
  it("shows minutes and seconds", () => {
    expect(formatDuration(62)).toBe("1m 2s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(3599)).toBe("59m 59s");
  });
  it("returns an em dash for missing / invalid input", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
});
