import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatDeliveryAddress,
  formatTimeInZone,
  fulfillmentLabel,
  shortOrderNumber,
} from "./format";

describe("live screen formatters (LIVE-1)", () => {
  const now = new Date("2026-10-09T18:00:00Z");

  it("formats ages", () => {
    expect(formatAge("2026-10-09T17:59:30Z", now)).toBe("Just now");
    expect(formatAge("2026-10-09T17:56:00Z", now)).toBe("4 min ago");
    expect(formatAge("2026-10-09T17:00:00Z", now)).toBe("1 hr ago");
    expect(formatAge("2026-10-09T16:55:00Z", now)).toBe("1 hr 5 min ago");
  });

  it("formats times in the tenant timezone, falling back to UTC for a bad zone", () => {
    expect(formatTimeInZone("2026-10-09T23:05:00Z", "America/Chicago")).toBe("6:05 PM");
    expect(formatTimeInZone("2026-10-09T23:05:00Z", "Not/AZone")).toBe("11:05 PM");
  });

  it("builds a short order number from the id", () => {
    expect(shortOrderNumber("8c1e2f4a-0000-4000-8000-00000000ab12")).toBe("#00AB12");
  });

  it("labels fulfillment types", () => {
    expect(fulfillmentLabel("dine_in")).toBe("Dine-in");
    expect(fulfillmentLabel("pickup")).toBe("Pickup");
  });

  it("formats create_order's street/city/state/zip and the older line1 shape", () => {
    expect(
      formatDeliveryAddress({ street: "1 Main St", city: "Austin", state: "TX", zip: "78701" }),
    ).toBe("1 Main St, Austin, TX 78701");
    expect(formatDeliveryAddress({ line1: "142 Riverside Dr", city: "Austin" })).toBe(
      "142 Riverside Dr, Austin",
    );
    expect(formatDeliveryAddress({ address_id: "x" })).toBeNull();
    expect(formatDeliveryAddress(null)).toBeNull();
  });
});
