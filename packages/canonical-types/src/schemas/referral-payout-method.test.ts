import { describe, expect, it } from "vitest";
import { referralPayoutMethodSchema } from "./referral-payout-method.js";

describe("referralPayoutMethodSchema (PT-08)", () => {
  it("accepts a normal address and trims surrounding whitespace", () => {
    const parsed = referralPayoutMethodSchema.parse({ paypal_email: "  pay@example.com " });
    expect(parsed.paypal_email).toBe("pay@example.com");
  });

  it("rejects a 300-char local part", () => {
    const result = referralPayoutMethodSchema.safeParse({
      paypal_email: `${"a".repeat(300)}@example.com`,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a local part over 64 chars but accepts exactly 64", () => {
    expect(
      referralPayoutMethodSchema.safeParse({ paypal_email: `${"a".repeat(65)}@example.com` })
        .success,
    ).toBe(false);
    expect(
      referralPayoutMethodSchema.safeParse({ paypal_email: `${"a".repeat(64)}@example.com` })
        .success,
    ).toBe(true);
  });

  it("rejects an address longer than 254 characters overall", () => {
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.${"e".repeat(63)}.com`;
    const result = referralPayoutMethodSchema.safeParse({ paypal_email: `user@${domain}` });
    expect(result.success).toBe(false);
  });

  it("rejects empty and malformed input with the user-facing message", () => {
    for (const paypal_email of ["", "not-an-email", "a@"]) {
      const result = referralPayoutMethodSchema.safeParse({ paypal_email });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("Enter a valid PayPal email address");
      }
    }
  });
});
