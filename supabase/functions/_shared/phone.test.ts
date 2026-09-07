import { describe, expect, it } from "vitest";
import { normalizeE164, samePhone } from "./phone.js";

describe("normalizeE164", () => {
  it("passes through an already-E.164 number", () => {
    expect(normalizeE164("+15551234567")).toBe("+15551234567");
  });

  it("normalizes a bare 10-digit US number", () => {
    expect(normalizeE164("555-123-4567")).toBe("+15551234567");
    expect(normalizeE164("(555) 123-4567")).toBe("+15551234567");
    expect(normalizeE164("5551234567")).toBe("+15551234567");
  });

  it("normalizes an 11-digit number with a leading country code", () => {
    expect(normalizeE164("15551234567")).toBe("+15551234567");
    expect(normalizeE164("1 555 123 4567")).toBe("+15551234567");
  });

  it("normalizes an international 00-prefixed number", () => {
    expect(normalizeE164("00442071838750")).toBe("+442071838750");
  });

  it("rejects nonsense input rather than guessing", () => {
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164(null)).toBeNull();
    expect(normalizeE164(undefined)).toBeNull();
    expect(normalizeE164("12345")).toBeNull();
    expect(normalizeE164("not a phone number")).toBeNull();
  });
});

describe("samePhone", () => {
  it("treats differently-formatted equivalents as the same number", () => {
    expect(samePhone("(555) 123-4567", "+15551234567")).toBe(true);
    expect(samePhone("555-123-4567", "15551234567")).toBe(true);
  });

  it("is false when either side fails to normalize", () => {
    expect(samePhone("bad", "+15551234567")).toBe(false);
    expect(samePhone("+15551234567", "bad")).toBe(false);
  });

  it("is false for genuinely different numbers", () => {
    expect(samePhone("+15551234567", "+15559998888")).toBe(false);
  });
});
