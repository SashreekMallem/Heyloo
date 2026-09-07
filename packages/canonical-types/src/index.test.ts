import { describe, expect, it } from "vitest";
import { CANONICAL_TYPES_VERSION } from "./index.js";

describe("@heyloo/canonical-types", () => {
  it("exports a version constant", () => {
    expect(CANONICAL_TYPES_VERSION).toBe("0.0.0");
  });
});
