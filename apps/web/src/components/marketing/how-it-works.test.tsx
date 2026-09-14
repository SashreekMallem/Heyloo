import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOME_CONTENT } from "@/content/marketing/home";
import { HowItWorks } from "./how-it-works";

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

describe("HowItWorks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders all three numbered steps with their real copy", () => {
    render(<HowItWorks />);
    HOME_CONTENT.howItWorks.forEach((step, index) => {
      expect(screen.getByText(String(index + 1))).toBeInTheDocument();
      expect(screen.getByText(step.title)).toBeInTheDocument();
      expect(screen.getByText(step.description)).toBeInTheDocument();
    });
  });

  it("prefers-reduced-motion: renders every step immediately, no pending pulse animation", () => {
    stubMatchMedia(true);
    render(<HowItWorks />);
    for (const step of HOME_CONTENT.howItWorks) {
      expect(screen.getByText(step.title)).toBeInTheDocument();
    }
  });
});
