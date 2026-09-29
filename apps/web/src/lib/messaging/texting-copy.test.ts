import { describe, expect, it } from "vitest";
import { customerNotifiedToast, paymentLinkResentToast } from "./texting-copy";

describe("portal texting copy (MSG-3)", () => {
  it("never claims a customer was notified by SMS while texting is off", () => {
    for (const smsQueued of [true, false]) {
      const message = customerNotifiedToast({ textingOn: false, smsQueued });
      expect(message).toMatch(/Texting is off until it's set up/);
      expect(message).toMatch(/wasn't texted/);
      expect(message).not.toMatch(/notified by SMS/);
    }
  });

  it("keeps the original wording once texting is on", () => {
    expect(customerNotifiedToast({ textingOn: true, smsQueued: true })).toBe(
      "Customer notified by SMS",
    );
    expect(customerNotifiedToast({ textingOn: true, smsQueued: false })).toBe(
      "Saved — SMS notification pending",
    );
  });

  it("never claims a payment link was re-sent by SMS while texting is off", () => {
    const off = paymentLinkResentToast({ textingOn: false });
    expect(off).toMatch(/Texting is off until it's set up/);
    expect(off).toMatch(/wasn't texted/);
    expect(off).not.toMatch(/re-sent by SMS/);
    expect(paymentLinkResentToast({ textingOn: true })).toBe("Payment link re-sent by SMS");
  });
});
