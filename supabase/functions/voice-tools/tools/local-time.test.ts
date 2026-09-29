import { describe, expect, it } from "vitest";
import { toTenantLocalIso } from "./local-time.ts";

describe("toTenantLocalIso (HOTPATH)", () => {
  it("renders a Date in the tenant's timezone with its offset, standard and daylight time", () => {
    expect(toTenantLocalIso(new Date("2026-01-15T14:00:00Z"), "America/New_York")).toBe(
      "2026-01-15T09:00:00-05:00",
    );
    expect(toTenantLocalIso(new Date("2026-07-15T14:00:00Z"), "America/New_York")).toBe(
      "2026-07-15T10:00:00-04:00",
    );
    expect(toTenantLocalIso(new Date("2026-07-15T14:00:00Z"), "America/Denver")).toBe(
      "2026-07-15T08:00:00-06:00",
    );
  });

  it("keeps the same instant (round-trips through Date.parse / Postgres timestamptz)", () => {
    const instant = new Date("2026-11-01T06:30:00Z"); // US DST ends that morning
    const rendered = toTenantLocalIso(instant, "America/Chicago") as string;
    expect(Date.parse(rendered)).toBe(instant.getTime());
  });

  it("handles midnight and the local date change", () => {
    expect(toTenantLocalIso(new Date("2026-09-29T05:00:00Z"), "America/Chicago")).toBe(
      "2026-09-29T00:00:00-05:00",
    );
    expect(toTenantLocalIso(new Date("2026-09-29T03:00:00Z"), "America/Los_Angeles")).toBe(
      "2026-09-28T20:00:00-07:00",
    );
  });

  it("accepts an ISO string value", () => {
    expect(toTenantLocalIso("2026-01-15T14:00:00.000Z", "UTC")).toBe("2026-01-15T14:00:00+00:00");
  });

  it("falls back to the pre-HOTPATH shape when the timezone is missing or invalid", () => {
    const d = new Date("2026-01-15T14:00:00Z");
    expect(toTenantLocalIso(d, null)).toBe("2026-01-15T14:00:00.000Z");
    expect(toTenantLocalIso(d, "Not/AZone")).toBe("2026-01-15T14:00:00.000Z");
    expect(toTenantLocalIso("2026-01-15T14:00:00.000Z", undefined)).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });

  it("returns a non-date value unchanged, never throwing", () => {
    expect(toTenantLocalIso("not a date", "America/New_York")).toBe("not a date");
    expect(toTenantLocalIso(null, "America/New_York")).toBeNull();
  });
});
