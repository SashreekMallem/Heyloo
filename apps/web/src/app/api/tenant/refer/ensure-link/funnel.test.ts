import { describe, expect, it } from "vitest";
import { computeReferralFunnel, isApproachingW9Threshold, W9_THRESHOLD_CENTS } from "./funnel";

describe("computeReferralFunnel", () => {
  it("returns all zeros for no referrals", () => {
    expect(computeReferralFunnel([])).toEqual({ signups: 0, qualified: 0, paid: 0 });
  });

  it("counts qualified as qualified-or-paid, and paid as paid only (FRONTEND_AUDIT.md H7)", () => {
    const rows = [
      { status: "pending" },
      { status: "qualified" },
      { status: "paid" },
      { status: "paid" },
      { status: "disqualified" },
    ];
    expect(computeReferralFunnel(rows)).toEqual({ signups: 5, qualified: 3, paid: 2 });
  });
});

describe("isApproachingW9Threshold", () => {
  it("is false well below 80% of the threshold", () => {
    expect(isApproachingW9Threshold(10000, "not_submitted")).toBe(false);
  });

  it("is true at exactly 80% of the threshold", () => {
    expect(isApproachingW9Threshold(W9_THRESHOLD_CENTS * 0.8, "not_submitted")).toBe(true);
  });

  it("is never true once the W-9 is already verified, no matter the payout", () => {
    expect(isApproachingW9Threshold(1_000_000, "verified")).toBe(false);
  });
});
