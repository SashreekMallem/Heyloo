import { describe, expect, it } from "vitest";
import { getTemplateDefinition, TEMPLATE_DEFINITIONS, TEMPLATES_PACKAGE_VERSION } from "./index.js";

describe("@heyloo/templates", () => {
  it("exports a version constant", () => {
    expect(TEMPLATES_PACKAGE_VERSION).toBe("1.0.0");
  });

  it("registers exactly the 8 verticals, each with a unique key", () => {
    expect(TEMPLATE_DEFINITIONS).toHaveLength(8);
    const keys = TEMPLATE_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(8);
  });

  it("getTemplateDefinition resolves a known key and returns undefined for an unknown one", () => {
    expect(getTemplateDefinition("generic")?.template.vertical).toBe("generic");
    expect(getTemplateDefinition("not_a_real_vertical")).toBeUndefined();
  });
});
