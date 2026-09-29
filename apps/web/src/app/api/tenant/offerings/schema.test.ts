import { describe, expect, it } from "vitest";
import { offeringUpdateSchema, offeringWriteSchema } from "./schema";

describe("offering schemas", () => {
  it("create applies defaults (active, empty metadata)", () => {
    expect(offeringWriteSchema.parse({ name: "Oil change" })).toMatchObject({
      name: "Oil change",
      active: true,
      metadata: {},
    });
  });

  it("SETTINGS-1: a partial update never injects defaults that would wipe metadata or re-activate", () => {
    expect(offeringUpdateSchema.parse({ name: "Synthetic oil change" })).toEqual({
      name: "Synthetic oil change",
    });
  });

  it("SETTINGS-1 review: an update can clear a length or price (null), but not set a bad one", () => {
    expect(offeringUpdateSchema.parse({ duration_minutes: null, price_cents: null })).toEqual({
      duration_minutes: null,
      price_cents: null,
    });
    expect(offeringUpdateSchema.safeParse({ price_cents: -1 }).success).toBe(false);
    expect(offeringUpdateSchema.safeParse({ duration_minutes: 0 }).success).toBe(false);
    expect(offeringUpdateSchema.parse({ price_cents: 3999 })).toEqual({ price_cents: 3999 });
  });

  it("create still rejects null (a new item simply omits the field)", () => {
    expect(offeringWriteSchema.safeParse({ name: "Oil change", price_cents: null }).success).toBe(
      false,
    );
  });
});
