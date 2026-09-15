import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetGsapLoaderForTests } from "@/components/motion/gsap-loader";
import { HeroScrollSection } from "./hero-scroll-section";

const registerPlugin = vi.fn();
vi.mock("gsap", () => ({ gsap: { registerPlugin } }));
vi.mock("gsap/ScrollTrigger", () => ({
  default: { create: vi.fn(() => ({ kill: vi.fn(), progress: 0 })), refresh: vi.fn() },
}));

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  __resetGsapLoaderForTests();
});

describe("HeroScrollSection", () => {
  it("renders the headline children and the fallback visual (mobile, non-qualifying tier under jsdom's default narrow-ish width)", async () => {
    stubMatchMedia(false);
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    render(
      <HeroScrollSection visualFallback={<div data-testid="fallback">fallback visual</div>}>
        <h1 data-testid="headline">Every call answered.</h1>
      </HeroScrollSection>,
    );

    expect(screen.getByTestId("headline")).toHaveTextContent("Every call answered.");
    expect(await screen.findByTestId("fallback")).toBeInTheDocument();
  });

  /**
   * Regression test for the review's blocker: `<HeroScrollScene.Visual>`
   * used to be rendered with no `className` at all, so its wrapper div
   * (`position: relative` only) never got a size, and a WebGL canvas
   * child (`position: absolute`) fell out of flow and collapsed to the
   * raw HTML default of 300x150px — a blank hero on every qualifying
   * desktop/tablet view. On a qualifying device, `HeroScrollSection`
   * must supply a real, sized className to the visual slot's wrapper,
   * not an empty/undefined one.
   */
  it("supplies a real, sized className to the visual slot's wrapper on a qualifying device", async () => {
    stubMatchMedia(false);
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

    render(
      <HeroScrollSection visualFallback={<div data-testid="fallback">fallback visual</div>}>
        <h1>Every call answered.</h1>
      </HeroScrollSection>,
    );

    // The film scrubber mounts immediately on a qualifying device (it
    // shows its own theme-correct poster image while frames load — no
    // separate "engage first" gate to simulate here, unlike the old
    // WebGL boundary).
    const canvas = await waitFor(() => {
      // eslint-disable-next-line testing-library/no-node-access -- <canvas> has no accessible role/text for a Testing-Library query
      const found = document.querySelector("canvas");
      expect(found).toBeInTheDocument();
      return found as HTMLCanvasElement;
    });

    // canvas -> .hero-film-mask -> HeroFilmScrubber's own container div
    // -> `<HeroScrollScene.Visual>`'s sized wrapper div — assert THAT
    // carries a real, non-empty sizing className, never the empty one
    // that caused the 300x150px collapse.
    // eslint-disable-next-line testing-library/no-node-access -- asserting a specific DOM ancestor (the sizing wrapper) has no Testing-Library-idiomatic query equivalent
    const visualBox = canvas.parentElement?.parentElement?.parentElement;
    expect(visualBox).toBeInTheDocument();
    expect(visualBox?.className).toContain("aspect-video");
  });

  it("never triggers a scroll on the fallback tier — mounting alone is enough for this smoke test to catch a render crash", async () => {
    stubMatchMedia(false);
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    render(
      <HeroScrollSection visualFallback={<div data-testid="fallback">fallback visual</div>}>
        <h1>Every call answered.</h1>
      </HeroScrollSection>,
    );
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(await screen.findByTestId("fallback")).toBeInTheDocument();
  });
});
