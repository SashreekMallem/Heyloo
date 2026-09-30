import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import CockpitUnknownPage from "./[...slug]/page";
import CockpitNotFound from "./not-found";

describe("cockpit 404 (QA-1 COCKPIT-F22)", () => {
  it("renders a styled not-found with a way back", () => {
    render(<CockpitNotFound />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the cockpit" })).toHaveAttribute(
      "href",
      "/cockpit",
    );
  });

  it("the catch-all page raises Next's not-found signal for unknown paths", () => {
    expect(() => CockpitUnknownPage()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
});
