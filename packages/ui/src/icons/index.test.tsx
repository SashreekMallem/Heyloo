import type { Vertical } from "@heyloo/canonical-types";
import { VERTICALS } from "@heyloo/canonical-types";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VERTICAL_ICONS, VerticalIcon } from "./index.js";

describe("VerticalIcon", () => {
  it("has a curated icon for every vertical (no emoji fallback)", () => {
    for (const vertical of VERTICALS) {
      expect(VERTICAL_ICONS[vertical]).toBeDefined();
    }
  });

  it("renders an svg for a known vertical", () => {
    const { container } = render(<VerticalIcon vertical={"restaurant" as Vertical} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
