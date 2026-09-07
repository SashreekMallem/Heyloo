import { describe, expect, it } from "vitest";
import { VERTICALS, zVertical } from "./vertical.js";

describe("vertical", () => {
  it("accepts every declared vertical", () => {
    for (const v of VERTICALS) {
      expect(zVertical.parse(v)).toBe(v);
    }
  });

  it("has exactly the 8 verticals from SYSTEM_DESIGN §1/§3.8", () => {
    expect(VERTICALS).toEqual([
      "auto",
      "vet",
      "legal",
      "dental",
      "real_estate",
      "motel",
      "restaurant",
      "generic",
    ]);
  });

  it("rejects an unknown vertical", () => {
    expect(() => zVertical.parse("plumbing")).toThrow();
  });
});
