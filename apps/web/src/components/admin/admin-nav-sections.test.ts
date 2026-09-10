import { describe, expect, it } from "vitest";
import { currentSectionLabel } from "./admin-nav-sections";

describe("currentSectionLabel", () => {
  it("matches a real cockpit route", () => {
    expect(currentSectionLabel("/cockpit/tenants")).toBe("Tenants");
  });

  it("matches a real cockpit detail route via prefix", () => {
    expect(currentSectionLabel("/cockpit/partners/p1")).toBe("Partners");
  });

  it("matches the same route mirrored under /preview", () => {
    expect(currentSectionLabel("/preview/cockpit/tenants")).toBe("Tenants");
  });

  it("matches a preview-mirrored detail route via prefix", () => {
    expect(currentSectionLabel("/preview/cockpit/partners/p1")).toBe("Partners");
  });

  it("falls back to null for an unrecognized route", () => {
    expect(currentSectionLabel("/cockpit/nonexistent-section")).toBe(null);
  });
});
