import { describe, expect, it } from "vitest";
import { extractClaims, isTenantOwner, isTenantStaff } from "./claims.js";

describe("extractClaims", () => {
  it("extracts a tenant member claim", () => {
    expect(extractClaims({ tenant_id: "t1", role: "owner" })).toEqual({
      tenant_id: "t1",
      role: "owner",
    });
  });

  it("extracts a platform admin claim", () => {
    expect(extractClaims({ platform_admin: true })).toEqual({ platform_admin: true });
  });

  it("extracts a referral partner claim", () => {
    expect(extractClaims({ referral_partner_id: "p1" })).toEqual({ referral_partner_id: "p1" });
  });

  it("ignores an invalid role value rather than trusting it", () => {
    expect(extractClaims({ role: "superuser" })).toEqual({});
  });

  it("returns {} for null/non-object input", () => {
    expect(extractClaims(null)).toEqual({});
    expect(extractClaims(undefined)).toEqual({});
    expect(extractClaims("nope")).toEqual({});
  });
});

describe("role helpers", () => {
  it("isTenantOwner is true only for owner", () => {
    expect(isTenantOwner("owner")).toBe(true);
    expect(isTenantOwner("admin")).toBe(false);
    expect(isTenantOwner(undefined)).toBe(false);
  });

  it("isTenantStaff is true for owner/admin/member", () => {
    expect(isTenantStaff("owner")).toBe(true);
    expect(isTenantStaff("admin")).toBe(true);
    expect(isTenantStaff("member")).toBe(true);
    expect(isTenantStaff(undefined)).toBe(false);
  });
});
