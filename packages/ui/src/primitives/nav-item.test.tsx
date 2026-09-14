import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavLink } from "./nav-item.js";

describe("NavLink", () => {
  it("renders as a link", () => {
    render(<NavLink href="/pricing">Pricing</NavLink>);
    const link = screen.getByRole("link", { name: "Pricing" });
    expect(link).toHaveAttribute("href", "/pricing");
  });

  it("meets the 44px touch target below lg, tightening to 36px at lg+ (same convention as Button)", () => {
    render(<NavLink href="/pricing">Pricing</NavLink>);
    const link = screen.getByRole("link", { name: "Pricing" });
    expect(link.className).toContain("h-11");
    expect(link.className).toContain("lg:h-9");
  });

  it("active: sets aria-current and the permanent underline state, no hover needed", () => {
    render(
      <NavLink href="/pricing" active>
        Pricing
      </NavLink>,
    );
    const link = screen.getByRole("link", { name: "Pricing" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("after:scale-x-100");
  });

  it("inactive: no aria-current, underline starts collapsed (grows on hover/focus via CSS only)", () => {
    render(<NavLink href="/pricing">Pricing</NavLink>);
    const link = screen.getByRole("link", { name: "Pricing" });
    expect(link).not.toHaveAttribute("aria-current");
    expect(link.className).toContain("after:scale-x-0");
    expect(link.className).toContain("hover:after:scale-x-100");
  });

  it("asChild renders the single child element instead of an <a>", () => {
    render(
      <NavLink asChild>
        <button type="button">Custom trigger</button>
      </NavLink>,
    );
    const el = screen.getByRole("button", { name: "Custom trigger" });
    expect(el.tagName).toBe("BUTTON");
  });
});
