import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { VerticalGrid } from "./vertical-grid";

describe("VerticalGrid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers-reduced-motion: every card still renders, fully visible, no pointer-parallax crash", () => {
    stubMatchMedia(true);
    render(<VerticalGrid />);
    expect(screen.getAllByRole("link")).toHaveLength(VERTICAL_CONTENT.length);
  });

  it("renders one card per business type, linking to its own vertical page", () => {
    render(<VerticalGrid />);
    for (const vertical of VERTICAL_CONTENT) {
      const link = screen.getByRole("link", {
        name: (accessibleName) => accessibleName.includes(vertical.displayName),
      });
      expect(link).toHaveAttribute("href", `/${vertical.slug}`);
    }
  });

  it("never renders the internal word 'vertical' in visitor-facing copy", () => {
    render(<VerticalGrid />);
    expect(screen.queryByText(/\bvertical\b/i)).not.toBeInTheDocument();
  });
});
