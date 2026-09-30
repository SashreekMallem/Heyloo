import { describe, expect, it } from "vitest";
import { NO_ACCESS_PATH, roleHome } from "./role-home";

describe("roleHome", () => {
  it.each([
    [{ platform_admin: true, tenant_id: "t1" }, {}, "/cockpit"],
    [{}, { adminMfaRequired: true }, "/cockpit"],
    [{ referral_partner_id: "p1", tenant_id: "t1" }, {}, "/portal"],
    [{ tenant_id: "t1", role: "owner" as const }, {}, "/dashboard"],
    [{}, {}, NO_ACCESS_PATH],
  ])("%j %j -> %s", (claims, options, expected) => {
    expect(roleHome(claims, options)).toBe(expected);
  });
});
