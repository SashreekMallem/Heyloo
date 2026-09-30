import { describe, expect, it } from "vitest";
import { normalizeReferralCode } from "./referral-cookie";

describe("normalizeReferralCode (PT-01)", () => {
  it("upper-cases and trims a valid code", () => {
    expect(normalizeReferralCode(" abc123 ")).toBe("ABC123");
    expect(normalizeReferralCode("ABCD2345")).toBe("ABCD2345");
  });

  it.each([
    null,
    undefined,
    "",
    "abc",
    "a".repeat(33),
    "AB CD12",
    "ABC-123",
    "ABC123;drop",
    "<script>",
  ])("rejects %j", (raw) => {
    expect(normalizeReferralCode(raw as string | null | undefined)).toBeNull();
  });
});
