import { describe, expect, it } from "vitest";
import { haversineMeters, isWithinRadius } from "./geo.js";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 40.7128, lng: -74.006 }, { lat: 40.7128, lng: -74.006 })).toBe(0);
  });

  it("approximates the known NYC-to-Philadelphia distance (~130km)", () => {
    const nyc = { lat: 40.7128, lng: -74.006 };
    const philly = { lat: 39.9526, lng: -75.1652 };
    const meters = haversineMeters(nyc, philly);
    expect(meters).toBeGreaterThan(120_000);
    expect(meters).toBeLessThan(140_000);
  });
});

describe("isWithinRadius", () => {
  const restaurant = { lat: 40.7128, lng: -74.006 };

  it("is true for a point well inside the radius", () => {
    const nearby = { lat: 40.7135, lng: -74.0065 }; // ~90m away
    expect(isWithinRadius(restaurant, nearby, 5_000)).toBe(true);
  });

  it("is false for a point outside the radius (delivery-radius decline path)", () => {
    const philly = { lat: 39.9526, lng: -75.1652 };
    expect(isWithinRadius(restaurant, philly, 5_000)).toBe(false);
  });

  it("treats exactly-at-radius as within (<=)", () => {
    const point = { lat: 40.7128, lng: -74.006 };
    expect(isWithinRadius(restaurant, point, 0)).toBe(true);
  });
});
