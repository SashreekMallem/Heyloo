import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button.js";

describe("Button", () => {
  it("renders its label", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("disables and marks aria-busy while loading, keeping the label visible", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("stays enabled when not loading", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("defaults to a 44px (h-11) touch target below the lg breakpoint, tightening to 36px (h-9) only at lg+", () => {
    // DESIGN-4: the default size backs nearly every primary CTA — must
    // clear the 44px mobile/tablet touch-target guidance (docs/
    // DESIGN_SYSTEM.md "Touch targets") without bloating desktop density.
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("h-11");
    expect(button.className).toContain("lg:h-9");
  });

  it("keeps size='lg' at a 44px target unconditionally", () => {
    render(<Button size="lg">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("h-11");
  });
});
