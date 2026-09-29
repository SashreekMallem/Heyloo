import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEMO_VERTICAL,
  DEMO_VERTICAL_IDS,
  DEMO_VERTICALS,
  demoVerticalLabel,
  isDemoVertical,
} from "./demo-verticals";

describe("demo verticals", () => {
  it("lists the eight business types with their labels, in selector order", () => {
    expect(DEMO_VERTICALS).toEqual([
      { id: "auto", label: "Auto repair" },
      { id: "dental", label: "Dental" },
      { id: "vet", label: "Veterinary" },
      { id: "legal", label: "Legal" },
      { id: "real_estate", label: "Real estate" },
      { id: "motel", label: "Motel" },
      { id: "restaurant", label: "Restaurant" },
      { id: "generic", label: "Local services" },
    ]);
  });

  it("defaults to auto repair", () => {
    expect(DEFAULT_DEMO_VERTICAL).toBe("auto");
    expect(demoVerticalLabel(DEFAULT_DEMO_VERTICAL)).toBe("Auto repair");
  });

  it("accepts exactly the allowlisted ids", () => {
    for (const id of DEMO_VERTICAL_IDS) expect(isDemoVertical(id)).toBe(true);
    for (const bad of ["plumber", "demo-dental", "", "AUTO", null, undefined, 1, {}]) {
      expect(isDemoVertical(bad)).toBe(false);
    }
  });
});
