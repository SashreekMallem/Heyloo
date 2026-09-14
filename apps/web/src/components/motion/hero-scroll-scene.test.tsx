import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroScrollScene } from "./hero-scroll-scene";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function FallbackHero() {
  return <div data-testid="fallback-hero">existing hero visual</div>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HeroScrollScene", () => {
  it("renders every child, including the headline block, unchanged", async () => {
    stubMatchMedia(false);
    render(
      <HeroScrollScene>
        <h1 data-testid="headline">Every call answered.</h1>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );

    expect(screen.getByTestId("headline")).toHaveTextContent("Every call answered.");
    await waitFor(() => expect(screen.getByTestId("fallback-hero")).toBeInTheDocument());
  });

  it("Visual renders `fallback` under jsdom (no WebGL context available) and never mounts a canvas", async () => {
    stubMatchMedia(false);
    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );
    await waitFor(() => expect(screen.getByTestId("fallback-hero")).toBeInTheDocument());
    expect(document.querySelector("canvas")).not.toBeInTheDocument();
  });

  it("Visual renders `fallback` under prefers-reduced-motion, even on a device that would otherwise qualify", async () => {
    stubMatchMedia(true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );
    await waitFor(() => expect(screen.getByTestId("fallback-hero")).toBeInTheDocument());
  });

  it("Visual throws a clear error when rendered outside HeroScrollScene", () => {
    const { Visual } = HeroScrollScene;
    // Suppress the expected React error-boundary console noise for this one assertion.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Visual fallback={<FallbackHero />} />)).toThrow(
      /<HeroScrollScene.Visual> must be rendered inside <HeroScrollScene>/,
    );
    consoleError.mockRestore();
  });
});
