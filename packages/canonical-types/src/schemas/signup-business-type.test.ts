import { describe, expect, it } from "vitest";
import { signupBusinessTypeSchema } from "./signup-business-type.js";

const base = { business_type: "auto", business_name: "Joe's Garage" } as const;

describe("signupBusinessTypeSchema", () => {
  it("still accepts a draft saved before business_phone/website_url existed", () => {
    expect(signupBusinessTypeSchema.parse(base)).toEqual(base);
  });

  it("accepts an E.164 business phone and an http(s) website", () => {
    const parsed = signupBusinessTypeSchema.parse({
      ...base,
      business_phone: "+12627551967",
      website_url: "https://joesgarage.com",
    });
    expect(parsed.business_phone).toBe("+12627551967");
    expect(parsed.website_url).toBe("https://joesgarage.com");
  });

  it.each(["(262) 755-1967", "2627551967", "+0123", "+1 262 755 1967"])(
    "rejects a non-E.164 business phone %s (friendly input is normalized before this schema)",
    (business_phone) => {
      expect(signupBusinessTypeSchema.safeParse({ ...base, business_phone }).success).toBe(false);
    },
  );

  it.each([
    "joesgarage.com",
    "ftp://joesgarage.com",
    "javascript:alert(1)",
    "https://joes garage.com",
    "https:joesgarage.com",
  ])("rejects a website that would fail tenants.website_url's check: %s", (website_url) => {
    expect(signupBusinessTypeSchema.safeParse({ ...base, website_url }).success).toBe(false);
  });
});
