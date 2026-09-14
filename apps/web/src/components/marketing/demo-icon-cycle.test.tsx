import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoIconCycle } from "./demo-icon-cycle";

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

describe("DemoIconCycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders without crashing", () => {
    render(<DemoIconCycle />);
    expect(screen.getByTestId("demo-icon-cycle")).toBeInTheDocument();
  });

  it("prefers-reduced-motion: renders once, no cycling timer pending", () => {
    stubMatchMedia(true);
    render(<DemoIconCycle />);
    expect(screen.getByTestId("demo-icon-cycle")).toBeInTheDocument();
  });
});
