import { describe, expect, it } from "vitest";
import { TEMPLATES_PACKAGE_VERSION } from "./index.js";

describe("@heyloo/templates", () => {
  it("exports a version constant", () => {
    expect(TEMPLATES_PACKAGE_VERSION).toBe("0.0.0");
  });
});
