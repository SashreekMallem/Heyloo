import { describe, expect, it } from "vitest";
import { verticalDetailsSchema } from "./vertical-details.js";

const baseCancellationPolicy = { window_hours: 24, text: "24-hour notice required" };

describe("verticalDetailsSchema", () => {
  it("accepts just the universal cancellation policy", () => {
    expect(
      verticalDetailsSchema.parse({ cancellation_policy: baseCancellationPolicy }),
    ).toMatchObject({ cancellation_policy: baseCancellationPolicy });
  });

  it("rejects a negative cancellation window", () => {
    expect(
      verticalDetailsSchema.safeParse({
        cancellation_policy: { window_hours: -1, text: "x" },
      }).success,
    ).toBe(false);
  });

  it("accepts every dental/vet/auto/legal field", () => {
    const parsed = verticalDetailsSchema.parse({
      cancellation_policy: baseCancellationPolicy,
      insurances_accepted: ["Delta Dental", "Cigna"],
      species_treated: ["dogs", "cats"],
      emergency_referral: { name: "Metro Animal ER", phone: "+15555551234" },
      tow_partner: { name: "Ace Towing", phone: "+15555556789" },
      vehicle_makes_serviced: ["Toyota", "Honda"],
      practice_areas: ["family law", "estate planning"],
      consult_fee_cents: 25000,
    });
    expect(parsed.consult_fee_cents).toBe(25000);
  });

  it("accepts motel's rate_table as an array of integer-cent entries, matching zMotelOverrides", () => {
    const parsed = verticalDetailsSchema.parse({
      cancellation_policy: baseCancellationPolicy,
      deposit_policy: {
        required: true,
        amount_cents: 5000,
        hold_window_hours: 24,
        text: "A $50 deposit is required to hold your room.",
      },
      rate_table: [
        { room_type: "Standard", nightly_rate_cents: 8900 },
        { room_type: "Suite", nightly_rate_cents: 12900 },
      ],
    });
    expect(parsed.rate_table).toEqual([
      { room_type: "Standard", nightly_rate_cents: 8900 },
      { room_type: "Suite", nightly_rate_cents: 12900 },
    ]);
  });

  it("rejects motel's legacy dollars-record rate_table shape", () => {
    expect(
      verticalDetailsSchema.safeParse({
        cancellation_policy: baseCancellationPolicy,
        rate_table: { Standard: 89 },
      }).success,
    ).toBe(false);
  });

  it("rejects motel's legacy bare-string deposit_policy shape", () => {
    expect(
      verticalDetailsSchema.safeParse({
        cancellation_policy: baseCancellationPolicy,
        deposit_policy: "A deposit is required.",
      }).success,
    ).toBe(false);
  });

  it("accepts restaurant's tax_rate_bps/prep_time_minutes/menu_text override", () => {
    const parsed = verticalDetailsSchema.parse({
      cancellation_policy: baseCancellationPolicy,
      delivery_radius_m: 4000,
      min_order_cents: 1500,
      tax_rate_bps: 825,
      prep_time_minutes: 20,
      menu_text: "Cheeseburger $9.99; Fries $3.50",
    });
    expect(parsed.tax_rate_bps).toBe(825);
    expect(parsed.prep_time_minutes).toBe(20);
    expect(parsed.menu_text).toBe("Cheeseburger $9.99; Fries $3.50");
  });

  it("rejects a tax_rate_bps above 10000 (100%)", () => {
    expect(
      verticalDetailsSchema.safeParse({
        cancellation_policy: baseCancellationPolicy,
        tax_rate_bps: 10001,
      }).success,
    ).toBe(false);
  });

  it("accepts restaurant's delivery_fee_cents (FIX_REQUESTS.md)", () => {
    const parsed = verticalDetailsSchema.parse({
      cancellation_policy: baseCancellationPolicy,
      delivery_fee_cents: 399,
    });
    expect(parsed.delivery_fee_cents).toBe(399);
  });
});
