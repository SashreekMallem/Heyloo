import { describe, expect, it } from "vitest";
import {
  centsToDollarsInput,
  isAddressComplete,
  milesToInput,
  normalizeState,
  normalizeZip,
  parseHundredths,
} from "./business-address";
import { deliveryFeeExample } from "./delivery-fee";
import { businessProfileFormSchema, businessProfileRequestSchema } from "./schemas";

describe("business address normalizers (DELIVERY-1)", () => {
  it("state: two letters, upper-cased", () => {
    expect(normalizeState(" tx ")).toBe("TX");
    expect(normalizeState("Texas")).toBeNull();
    expect(normalizeState("T1")).toBeNull();
  });

  it("ZIP: 5 digits or ZIP+4 (dash added)", () => {
    expect(normalizeZip("75081")).toBe("75081");
    expect(normalizeZip("75081-1234")).toBe("75081-1234");
    expect(normalizeZip("750811234")).toBe("75081-1234");
    expect(normalizeZip("7508")).toBeNull();
    expect(normalizeZip("75081-12")).toBeNull();
  });

  it("parseHundredths: dollars from the digits, rejecting negatives and 3+ decimals", () => {
    expect(parseHundredths("4.5")).toEqual({ ok: true, hundredths: 450 });
    expect(parseHundredths("$4.50")).toEqual({ ok: true, hundredths: 450 });
    expect(parseHundredths("12")).toEqual({ ok: true, hundredths: 1200 });
    expect(parseHundredths(".99")).toEqual({ ok: true, hundredths: 99 });
    expect(parseHundredths(0.29)).toEqual({ ok: true, hundredths: 29 }); // 0.29 * 100 is 28.999... as a float
    expect(parseHundredths("-1")).toEqual({ ok: false, reason: "negative" });
    expect(parseHundredths("1.255")).toEqual({ ok: false, reason: "decimals" });
    expect(parseHundredths("abc")).toEqual({ ok: false, reason: "format" });
  });

  it("input helpers", () => {
    expect(centsToDollarsInput(450)).toBe("4.50");
    expect(centsToDollarsInput(null)).toBe("");
    expect(milesToInput(2.5)).toBe("2.5");
    expect(milesToInput("5.00")).toBe("5");
    expect(milesToInput(null)).toBe("");
  });

  it("isAddressComplete: a street plus a ZIP, or a city and state", () => {
    expect(isAddressComplete({ street: "1 Main", city: null, state: null, zip: "75081" })).toBe(
      true,
    );
    expect(isAddressComplete({ street: "1 Main", city: "Dallas", state: "TX", zip: null })).toBe(
      true,
    );
    expect(isAddressComplete({ street: "1 Main", city: "Dallas", state: null, zip: null })).toBe(
      false,
    );
    expect(isAddressComplete({ street: "", city: "Dallas", state: "TX", zip: "75081" })).toBe(
      false,
    );
  });
});

describe("businessProfileRequestSchema — address + delivery (DELIVERY-1)", () => {
  const base = { name: "Taco Town", timezone: "America/Chicago" };

  it("normalizes the address and converts dollars to cents, miles to hundredths", () => {
    expect(
      businessProfileRequestSchema.parse({
        ...base,
        business_street: "  500   Main St ",
        business_state: "tx",
        business_zip: "750811234",
        delivery_radius_miles: "7.5",
        delivery_fee_base: "3",
        delivery_fee_per_mile: 1.25,
        delivery_fee_included_miles: "2",
        delivery_min_order: "$15",
      }),
    ).toMatchObject({
      business_street: "500 Main St",
      business_state: "TX",
      business_zip: "75081-1234",
      delivery_radius_miles: 750,
      delivery_fee_base: 300,
      delivery_fee_per_mile: 125,
      delivery_fee_included_miles: 200,
      delivery_min_order: 1500,
    });
  });

  it("missing keys stay undefined (leave alone); blanks clear (null)", () => {
    const older = businessProfileRequestSchema.parse(base);
    expect(older.business_street).toBeUndefined();
    expect(older.delivery_fee_base).toBeUndefined();
    const cleared = businessProfileRequestSchema.parse({
      ...base,
      business_street: " ",
      business_zip: "",
      delivery_radius_miles: "",
      delivery_fee_base: null,
    });
    expect(cleared.business_street).toBeNull();
    expect(cleared.business_zip).toBeNull();
    expect(cleared.delivery_radius_miles).toBeNull();
    expect(cleared.delivery_fee_base).toBeNull();
  });

  it("rejects negatives, 3 decimals, out-of-range radius, bad state/ZIP", () => {
    for (const extra of [
      { delivery_fee_base: "-0.50" },
      { delivery_fee_per_mile: "0.555" },
      { delivery_radius_miles: "500" },
      { delivery_radius_miles: "0" },
      { delivery_fee_included_miles: "101" },
      { delivery_min_order: "20000" },
      { business_state: "Texas" },
      { business_zip: "ABCDE" },
    ]) {
      expect(
        businessProfileRequestSchema.safeParse({ ...base, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it("the client form accepts blanks and rejects the same bad values", () => {
    const blank = {
      ...base,
      business_phone: "",
      website_url: "",
      business_street: "",
      business_city: "",
      business_state: "",
      business_zip: "",
      delivery_radius_miles: "",
      delivery_fee_base: "",
      delivery_fee_per_mile: "",
      delivery_fee_included_miles: "",
      delivery_min_order: "",
    };
    expect(businessProfileFormSchema.safeParse(blank).success).toBe(true);
    expect(businessProfileFormSchema.safeParse({ ...blank, delivery_fee_base: "-1" }).success).toBe(
      false,
    );
    expect(
      businessProfileFormSchema.safeParse({ ...blank, delivery_radius_miles: "0.05" }).success,
    ).toBe(false);
  });
});

describe("deliveryFeeExample (DELIVERY-1)", () => {
  it("prices the radius (or 6 miles) with the shared formula", () => {
    expect(
      deliveryFeeExample({
        delivery_fee_base: "3",
        delivery_fee_per_mile: "1",
        delivery_fee_included_miles: "2",
      }),
    ).toBe("A 6-mile delivery costs $7.00.");
    expect(
      deliveryFeeExample({
        delivery_radius_miles: "4.5",
        delivery_fee_base: "2.50",
        delivery_fee_per_mile: "0.75",
        delivery_fee_included_miles: "",
      }),
    ).toBe("A 4.5-mile delivery costs $5.88.");
    expect(deliveryFeeExample({ delivery_radius_miles: "5" })).toBeNull();
  });
});
