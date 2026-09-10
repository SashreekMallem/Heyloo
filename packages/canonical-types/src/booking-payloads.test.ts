import { describe, expect, it } from "vitest";
import {
  BOOKING_STRUCTURED_PAYLOAD_PROPERTIES,
  zAutoBookingPayload,
  zBookingStructuredPayloadFor,
  zDentalBookingPayload,
  zGenericBookingPayload,
  zLegalBookingPayload,
  zMotelBookingPayload,
  zRealEstateBookingPayload,
  zRestaurantBookingPayload,
  zVetBookingPayload,
} from "./booking-payloads.js";
import { VERTICALS } from "./vertical.js";

const SCHEMA_BY_VERTICAL: Record<string, { shape: Record<string, unknown> }> = {
  auto: zAutoBookingPayload,
  vet: zVetBookingPayload,
  legal: zLegalBookingPayload,
  dental: zDentalBookingPayload,
  real_estate: zRealEstateBookingPayload,
  motel: zMotelBookingPayload,
  restaurant: zRestaurantBookingPayload,
  generic: zGenericBookingPayload,
};

describe("zBookingStructuredPayloadFor", () => {
  it("resolves every canonical vertical to a schema, never throwing", () => {
    for (const vertical of VERTICALS) {
      expect(() => zBookingStructuredPayloadFor(vertical)).not.toThrow();
    }
  });

  it("falls back to the generic loose object for an unknown vertical string", () => {
    const schema = zBookingStructuredPayloadFor("not_a_real_vertical");
    expect(schema.parse({ anything: "goes" })).toEqual({ anything: "goes" });
  });

  it("never rejects an empty payload for any vertical (hot-path: never blocks a real booking)", () => {
    for (const vertical of VERTICALS) {
      expect(() => zBookingStructuredPayloadFor(vertical).parse({})).not.toThrow();
    }
  });

  it("never strips unknown extra keys (authoring aid, not a strict gate)", () => {
    for (const vertical of VERTICALS) {
      const parsed = zBookingStructuredPayloadFor(vertical).parse({
        totally_unexpected_field: "keep me",
      });
      expect(parsed["totally_unexpected_field"]).toBe("keep me");
    }
  });
});

describe("per-vertical payload shapes", () => {
  it("auto accepts a typical vehicle-details capture", () => {
    expect(
      zAutoBookingPayload.parse({
        vehicle_year: 2019,
        vehicle_make: "Honda",
        vehicle_model: "Civic",
        symptom_category: "brakes",
        drop_off_or_wait: "drop_off",
      }),
    ).toBeTruthy();
  });

  it("motel accepts quoted_rate_cents as integer cents", () => {
    expect(zMotelBookingPayload.parse({ quoted_rate_cents: 12900, room_type: "queen" })).toEqual({
      quoted_rate_cents: 12900,
      room_type: "queen",
    });
  });

  it("motel rejects a non-integer quoted_rate_cents (never a float dollar amount)", () => {
    expect(() => zMotelBookingPayload.parse({ quoted_rate_cents: 129.5 })).toThrow();
  });

  it("restaurant accepts an allergies array + special_instructions", () => {
    expect(
      zRestaurantBookingPayload.parse({
        allergies: ["peanuts", "shellfish"],
        special_instructions: "extra spicy",
      }),
    ).toBeTruthy();
  });
});

describe("BOOKING_STRUCTURED_PAYLOAD_PROPERTIES stays in sync with the Zod shapes", () => {
  it("declares an entry for every canonical vertical", () => {
    for (const vertical of VERTICALS) {
      expect(BOOKING_STRUCTURED_PAYLOAD_PROPERTIES[vertical]).toBeDefined();
    }
  });

  it("every JSON-Schema property key exists on the matching Zod schema's shape", () => {
    for (const [vertical, properties] of Object.entries(BOOKING_STRUCTURED_PAYLOAD_PROPERTIES)) {
      const schema = SCHEMA_BY_VERTICAL[vertical];
      expect(schema, `no Zod schema registered for vertical '${vertical}'`).toBeDefined();
      const shapeKeys = new Set(Object.keys(schema?.shape ?? {}));
      for (const key of Object.keys(properties)) {
        expect(shapeKeys.has(key), `'${vertical}.${key}' has no matching Zod field`).toBe(true);
      }
    }
  });

  it("every optional Zod field has a matching JSON-Schema property (no silent authoring gaps)", () => {
    for (const [vertical, schema] of Object.entries(SCHEMA_BY_VERTICAL)) {
      const properties =
        BOOKING_STRUCTURED_PAYLOAD_PROPERTIES[
          vertical as keyof typeof BOOKING_STRUCTURED_PAYLOAD_PROPERTIES
        ];
      const propertyKeys = new Set(Object.keys(properties ?? {}));
      for (const key of Object.keys(schema.shape)) {
        expect(propertyKeys.has(key), `'${vertical}.${key}' has no JSON-Schema property`).toBe(
          true,
        );
      }
    }
  });
});
