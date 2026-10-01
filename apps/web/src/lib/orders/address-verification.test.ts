import { describe, expect, it } from "vitest";
import { addressVerificationNote } from "./address-verification";

describe("addressVerificationNote (DELIVERY-1)", () => {
  it("is silent for a verified address and for orders without a check", () => {
    expect(addressVerificationNote("in_range")).toBeNull();
    expect(addressVerificationNote(null)).toBeNull();
    expect(addressVerificationNote(undefined)).toBeNull();
  });

  it("explains every unverified outcome", () => {
    expect(addressVerificationNote("not_found")).toContain("couldn't be found");
    expect(addressVerificationNote("no_radius_set")).toContain("no delivery radius is set");
    expect(addressVerificationNote("no_business_location")).toContain("Agent → Business");
    expect(addressVerificationNote("lookup_unavailable")).toContain("unavailable");
  });
});
