import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrustStrip } from "./trust-strip";

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

describe("TrustStrip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders all three disclosure/reassurance lines", () => {
    render(<TrustStrip />);
    expect(screen.getByText("Every call discloses it's an AI")).toBeInTheDocument();
    expect(screen.getByText("Recorded with consent, every time")).toBeInTheDocument();
    expect(screen.getByText("Your business number stays yours")).toBeInTheDocument();
  });

  it("prefers-reduced-motion: renders fully visible immediately, no animation pending", () => {
    stubMatchMedia(true);
    render(<TrustStrip />);
    expect(screen.getByText("Every call discloses it's an AI")).toBeInTheDocument();
  });
});
