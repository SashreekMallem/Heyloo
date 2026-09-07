import { describe, expect, it } from "vitest";
import { UI_PACKAGE_VERSION } from "./index.js";

describe("@heyloo/ui", () => {
  it("exports a version constant", () => {
    expect(UI_PACKAGE_VERSION).toBe("0.0.0");
  });
});
