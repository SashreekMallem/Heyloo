import { describe, expect, it } from "vitest";
import { formatPhoneDisplay } from "./format-phone.js";

describe("formatPhoneDisplay", () => {
  it("formats a +1 E.164 number as (XXX) XXX-XXXX", () => {
    expect(formatPhoneDisplay("+15125551000")).toBe("(512) 555-1000");
  });

  it("formats a bare 10-digit E.164-ish number the same way", () => {
    expect(formatPhoneDisplay("+5125551000")).toBe("(512) 555-1000");
  });

  it("returns the original string unchanged for a non-10-digit number", () => {
    expect(formatPhoneDisplay("+442071234567")).toBe("+442071234567");
  });

  it("returns an empty string for null/undefined/empty input", () => {
    expect(formatPhoneDisplay(null)).toBe("");
    expect(formatPhoneDisplay(undefined)).toBe("");
    expect(formatPhoneDisplay("")).toBe("");
  });
});
