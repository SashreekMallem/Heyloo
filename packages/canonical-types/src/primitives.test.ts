import { describe, expect, it } from "vitest";
import {
  addCents,
  centsFromDollars,
  dollarsFromCents,
  E164_PATTERN,
  formatCentsUSD,
  ISO_TIMESTAMP_PATTERN,
  normalizeToE164,
  zCents,
  zCurrency,
  zE164,
  zIsoTimestamp,
  zSignedCents,
} from "./primitives.js";

describe("money", () => {
  it("zCents accepts a non-negative integer", () => {
    expect(zCents.parse(1050)).toBe(1050);
    expect(zCents.parse(0)).toBe(0);
  });

  it("zCents rejects fractional cents", () => {
    expect(() => zCents.parse(10.5)).toThrow();
  });

  it("zCents rejects negative cents", () => {
    expect(() => zCents.parse(-100)).toThrow();
  });

  it("zSignedCents allows negative integers (refunds)", () => {
    expect(zSignedCents.parse(-500)).toBe(-500);
  });

  it("zSignedCents still rejects fractional values", () => {
    expect(() => zSignedCents.parse(-5.5)).toThrow();
  });

  it("centsFromDollars rounds to avoid float drift", () => {
    expect(centsFromDollars(19.99)).toBe(1999);
    expect(centsFromDollars(10)).toBe(1000);
  });

  it("centsFromDollars rejects non-finite input", () => {
    expect(() => centsFromDollars(Number.NaN)).toThrow(RangeError);
  });

  it("dollarsFromCents converts back", () => {
    expect(dollarsFromCents(1999)).toBeCloseTo(19.99);
  });

  it("formatCentsUSD formats positive and negative amounts", () => {
    expect(formatCentsUSD(1050)).toBe("$10.50");
    expect(formatCentsUSD(5)).toBe("$0.05");
    expect(formatCentsUSD(-250)).toBe("-$2.50");
    expect(formatCentsUSD(100000)).toBe("$1,000.00");
  });

  it("addCents sums integer cent values", () => {
    expect(addCents(100, 250, 50)).toBe(400);
    expect(addCents()).toBe(0);
  });

  it("zCurrency only accepts USD", () => {
    expect(zCurrency.parse("USD")).toBe("USD");
    expect(() => zCurrency.parse("EUR")).toThrow();
  });
});

describe("phone / E.164", () => {
  it("E164_PATTERN matches valid E.164 numbers", () => {
    expect(E164_PATTERN.test("+15551234567")).toBe(true);
    expect(E164_PATTERN.test("+442071234567")).toBe(true);
  });

  it("E164_PATTERN rejects missing +, leading zero, or non-digits", () => {
    expect(E164_PATTERN.test("15551234567")).toBe(false);
    expect(E164_PATTERN.test("+05551234567")).toBe(false);
    expect(E164_PATTERN.test("+1555-123-4567")).toBe(false);
  });

  it("zE164 parses and brands a valid number", () => {
    expect(zE164.parse("+15551234567")).toBe("+15551234567");
  });

  it("zE164 rejects an invalid number", () => {
    expect(() => zE164.parse("555-123-4567")).toThrow();
  });

  it("normalizeToE164 passes through an already-E.164 number", () => {
    expect(normalizeToE164("+15551234567")).toBe("+15551234567");
  });

  it("normalizeToE164 assumes NANP for a bare 10-digit US number", () => {
    expect(normalizeToE164("(555) 123-4567")).toBe("+15551234567");
    expect(normalizeToE164("555.123.4567")).toBe("+15551234567");
  });

  it("normalizeToE164 handles a leading-1 11-digit number", () => {
    expect(normalizeToE164("1-555-123-4567")).toBe("+15551234567");
  });

  it("normalizeToE164 returns null for unnormalizable input", () => {
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164("not a phone number")).toBeNull();
    expect(normalizeToE164("+0123")).toBeNull();
  });
});

describe("ISO timestamp", () => {
  it("ISO_TIMESTAMP_PATTERN matches Z and numeric-offset timestamps", () => {
    expect(ISO_TIMESTAMP_PATTERN.test("2026-09-07T14:03:00Z")).toBe(true);
    expect(ISO_TIMESTAMP_PATTERN.test("2026-09-07T14:03:00.123Z")).toBe(true);
    expect(ISO_TIMESTAMP_PATTERN.test("2026-09-07T14:03:00+05:30")).toBe(true);
  });

  it("ISO_TIMESTAMP_PATTERN rejects a timestamp with no timezone", () => {
    expect(ISO_TIMESTAMP_PATTERN.test("2026-09-07T14:03:00")).toBe(false);
  });

  it("zIsoTimestamp parses a valid timestamp", () => {
    expect(zIsoTimestamp.parse("2026-09-07T14:03:00Z")).toBe("2026-09-07T14:03:00Z");
  });

  it("zIsoTimestamp rejects a plain date", () => {
    expect(() => zIsoTimestamp.parse("2026-09-07")).toThrow();
  });
});
