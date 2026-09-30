import { describe, expect, it } from "vitest";
import {
  BUSINESS_PHONE_ERROR_MESSAGE,
  normalizeBusinessPhone,
  normalizeWebsiteUrl,
  WEBSITE_ERROR_MESSAGE,
  zBusinessPhoneFormField,
  zOptionalBusinessPhone,
  zOptionalWebsite,
  zWebsiteFormField,
} from "./business-contact";

describe("normalizeBusinessPhone", () => {
  it.each([
    ["(262) 755-1967", "+12627551967"],
    ["262-755-1967", "+12627551967"],
    ["+1 262 755 1967", "+12627551967"],
    ["1 (262) 755-1967", "+12627551967"],
    ["+12627551967", "+12627551967"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizeBusinessPhone(input)).toBe(expected);
  });

  it.each([
    "",
    "755-1967",
    "(162) 755-1967",
    "262-755-1967 ext 2",
    "1-800-FLOWERS",
    "+44 20 7946 0958", // valid elsewhere in the portal, but the forwarding test is US/Canada only
  ])("rejects %s", (input) => {
    expect(normalizeBusinessPhone(input)).toBeNull();
  });
});

describe("normalizeWebsiteUrl", () => {
  it.each([
    ["yourbusiness.com", "https://yourbusiness.com"],
    ["  www.yourbusiness.com/menu ", "https://www.yourbusiness.com/menu"],
    ["https://yourbusiness.com", "https://yourbusiness.com"],
    ["http://yourbusiness.com", "http://yourbusiness.com"],
    ["HTTPS://YourBusiness.com", "https://YourBusiness.com"],
    ["yourbusiness.com:8080/x", "https://yourbusiness.com:8080/x"],
  ])("normalizes %s -> %s", (input, expected) => {
    const result = normalizeWebsiteUrl(input);
    expect(result).toBe(expected);
    // Always satisfies tenants_website_url_format_chk.
    expect(result).toMatch(/^https?:\/\/[^\s]+$/i);
  });

  it.each([
    "",
    "   ",
    "your business.com",
    "ftp://yourbusiness.com",
    "javascript:alert(1)",
    "mailto:owner@yourbusiness.com",
    "localhost",
    "yourbusiness",
  ])("rejects %s", (input) => {
    expect(normalizeWebsiteUrl(input)).toBeNull();
  });
});

describe("form fields (blank allowed)", () => {
  it("accept blank or valid, reject invalid with the field message", () => {
    expect(zBusinessPhoneFormField.safeParse("").success).toBe(true);
    expect(zBusinessPhoneFormField.safeParse("262-755-1967").success).toBe(true);
    const phone = zBusinessPhoneFormField.safeParse("12345");
    expect(phone.success).toBe(false);
    expect(phone.error?.issues[0]?.message).toBe(BUSINESS_PHONE_ERROR_MESSAGE);

    expect(zWebsiteFormField.safeParse("").success).toBe(true);
    expect(zWebsiteFormField.safeParse("yourbusiness.com").success).toBe(true);
    const site = zWebsiteFormField.safeParse("not a site");
    expect(site.success).toBe(false);
    expect(site.error?.issues[0]?.message).toBe(WEBSITE_ERROR_MESSAGE);
  });
});

describe("server boundary transforms", () => {
  it("normalize, clear on blank/null, and leave a missing key undefined", () => {
    expect(zOptionalBusinessPhone.parse("(262) 755-1967")).toBe("+12627551967");
    expect(zOptionalBusinessPhone.parse("")).toBeNull();
    expect(zOptionalBusinessPhone.parse(null)).toBeNull();
    expect(zOptionalBusinessPhone.parse(undefined)).toBeUndefined();
    expect(zOptionalBusinessPhone.safeParse("555").success).toBe(false);

    expect(zOptionalWebsite.parse("yourbusiness.com")).toBe("https://yourbusiness.com");
    expect(zOptionalWebsite.parse(" ")).toBeNull();
    expect(zOptionalWebsite.parse(undefined)).toBeUndefined();
    expect(zOptionalWebsite.safeParse("ftp://x.com").success).toBe(false);
  });
});
