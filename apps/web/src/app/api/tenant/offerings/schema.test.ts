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
});
