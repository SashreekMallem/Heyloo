import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveCallHero } from "./live-call-hero";

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

describe("LiveCallHero", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the opening turn of the storyboard without crashing", () => {
    render(<LiveCallHero />);
    expect(screen.getByText(/check engine light/i)).toBeInTheDocument();
    expect(screen.getByText("Riverside Auto Repair")).toBeInTheDocument();
  });

  it("prefers-reduced-motion: renders the resolved final frame immediately — every turn, the tool-call badge, and the confirmed booking — no journey, no timer", () => {
    stubMatchMedia(true);
    render(<LiveCallHero />);
    expect(screen.getByText(/Yes, please/)).toBeInTheDocument();
    expect(screen.getByText("check_availability()")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("2019 Honda Civic")).toBeInTheDocument();
  });
});
