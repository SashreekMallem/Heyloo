import { describe, expect, it } from "vitest";
import { computeDeliveryFeeCents } from "./delivery-fee.ts";

const POLICY = { baseCents: 300, perMileCents: 100, includedMiles: 2 };

describe("computeDeliveryFeeCents (DELIVERY-1)", () => {
  it("base + ceil(per_mile * max(0, miles - included))", () => {
    expect(computeDeliveryFeeCents(POLICY, 6)).toBe(700);
    expect(computeDeliveryFeeCents(POLICY, 2)).toBe(300);
    expect(computeDeliveryFeeCents(POLICY, 1.2)).toBe(300);
    expect(computeDeliveryFeeCents(POLICY, 2.01)).toBe(301);
    expect(computeDeliveryFeeCents(POLICY, 3.333)).toBe(433); // 3.33 - 2 = 1.33 mi * 100
  });

  it("rounds the per-mile part UP to the cent", () => {
    expect(
      computeDeliveryFeeCents({ baseCents: 0, perMileCents: 75, includedMiles: 0 }, 1.01),
    ).toBe(76); // 75.75
  });

  it("never charges a cent of floating-point noise (250 * 1.2 = 300.00000000000006)", () => {
    expect(
      computeDeliveryFeeCents({ baseCents: 0, perMileCents: 250, includedMiles: 0 }, 1.2),
    ).toBe(300);
    expect(
      computeDeliveryFeeCents({ baseCents: 0, perMileCents: 10, includedMiles: 0.1 }, 0.3),
    ).toBe(2);
  });

  it("unknown distance charges the base fee only", () => {
    expect(computeDeliveryFeeCents(POLICY, null)).toBe(300);
    expect(computeDeliveryFeeCents(POLICY, undefined)).toBe(300);
    expect(computeDeliveryFeeCents(POLICY, Number.NaN)).toBe(300);
  });

  it("unset parts count as zero", () => {
    expect(
      computeDeliveryFeeCents({ baseCents: null, perMileCents: null, includedMiles: null }, 9),
    ).toBe(0);
    expect(
      computeDeliveryFeeCents({ baseCents: null, perMileCents: 50, includedMiles: null }, 3),
    ).toBe(150);
    expect(
      computeDeliveryFeeCents({ baseCents: 499, perMileCents: null, includedMiles: 1 }, 30),
    ).toBe(499);
  });

  it("ignores negative inputs instead of producing a negative or reduced fee", () => {
    expect(
      computeDeliveryFeeCents({ baseCents: -100, perMileCents: -5, includedMiles: -3 }, 4),
    ).toBe(0);
    expect(computeDeliveryFeeCents(POLICY, -4)).toBe(300);
  });
});
