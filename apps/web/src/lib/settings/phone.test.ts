import { describe, expect, it } from "vitest";
import { isBlankOrValidPhone, normalizePhone, zOptionalPhone, zPhoneFormField } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["(610) 555-0122", "+16105550122"],
    ["610.555.0122", "+16105550122"],
    ["610-555-0122", "+16105550122"],
    ["1 610 555 0122", "+16105550122"],
    ["1-610-555-0122", "+16105550122"],
    ["+1 (610) 555-0122", "+16105550122"],
    ["+16105550122", "+16105550122"],
    ["+44 20 7946 0958", "+442079460958"],
    ["  +52 55 1234 5678 ", "+525512345678"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ["", null],
    ["   ", null],
    ["555-0122", null], // 7 digits, no area code
    ["+1", null],
    ["+1 610 555", null],
    ["(110) 555-0122", null], // NANP area code can't start with 1
    ["(610) 155-0122", null], // NANP exchange can't start with 1
    ["1-800-FLOWERS", null], // letters are never silently dropped
    ["610-555-0122 ext 4", null],
    ["+0 123 456 7890", null],
    ["12345678901234567", null],
  ])("rejects %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("treats null/undefined as blank", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(isBlankOrValidPhone(null)).toBe(true);
    expect(isBlankOrValidPhone("")).toBe(true);
    expect(isBlankOrValidPhone("555")).toBe(false);
  });
});

describe("zOptionalPhone (server boundary)", () => {
  it("returns E.164 for a friendly number", () => {
    expect(zOptionalPhone.parse("(610) 555-0122")).toBe("+16105550122");
  });

  it("maps blank and null to null (clears the stored value)", () => {
    expect(zOptionalPhone.parse("")).toBeNull();
    expect(zOptionalPhone.parse("  ")).toBeNull();
    expect(zOptionalPhone.parse(null)).toBeNull();
  });

  it("keeps undefined as undefined (field not sent -> leave stored value alone)", () => {
    expect(zOptionalPhone.parse(undefined)).toBeUndefined();
  });

  it("rejects an invalid number with a friendly message", () => {
    const result = zOptionalPhone.safeParse("555");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/full phone number/);
  });
});

describe("zPhoneFormField (client form)", () => {
  it("accepts blank or valid, rejects partial numbers", () => {
    expect(zPhoneFormField.safeParse("").success).toBe(true);
    expect(zPhoneFormField.safeParse("+16105550122").success).toBe(true);
    expect(zPhoneFormField.safeParse("+1610").success).toBe(false);
  });
});
