import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetGsapLoaderForTests } from "@/components/motion/gsap-loader";
import { HeroScrollSection } from "./hero-scroll-section";

const registerPlugin = vi.fn();
vi.mock("gsap", () => ({ gsap: { registerPlugin } }));
vi.mock("gsap/ScrollTrigger", () => ({
  default: { create: vi.fn(() => ({ kill: vi.fn(), progress: 0 })) },
}));
// The real scene mounts a react-three-fiber `<Canvas>`, which needs a
// real `ResizeObserver` (unavailable under jsdom) — this test only cares
// about the sizing className wired onto the slot around it.
vi.mock("@/components/three/hero-morph-scene", () => ({
  default: () => <div data-testid="hero-morph-scene-stub" />,
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
  it("renders the headline children and the fallback visual (non-qualifying tier under jsdom)", async () => {
    stubMatchMedia(false);
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
   * (`position: relative` only) never got a size, its WebGL canvas child
   * (`position: absolute`) fell out of flow, and the canvas collapsed to
   * the raw HTML default of 300x150px — a blank hero on every qualifying
   * desktop/tablet view. On a qualifying device (mocked below — jsdom has
   * no real WebGL, but `HTMLCanvasElement.getContext` is stubbed so the
   * capability probe passes), `HeroScrollSection` must supply a real,
   * sized className to the visual slot's wrapper, not an empty/undefined
   * one.
   */
  it("supplies a real, sized className to the visual slot's wrapper on a qualifying device", async () => {
    stubMatchMedia(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

    render(
      <HeroScrollSection visualFallback={<div data-testid="fallback">fallback visual</div>}>
        <h1>Every call answered.</h1>
      </HeroScrollSection>,
    );

    // `LazyWebglBoundary` (SITE REPAIR: the home route's real dominant JS
    // contributor) no longer mounts `Scene` on bare device-qualification
    // — it also waits for the visitor to scroll/interact (or a short
    // fallback delay), so this qualifying-device test has to simulate
    // that engagement before the stub appears.
    expect(await screen.findByTestId("fallback")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(await screen.findByTestId("hero-morph-scene-stub")).toBeInTheDocument();
    // The stub's grandparent is `<HeroScrollScene.Visual>`'s own sized
    // wrapper div (the stub's immediate parent is `LazyWebglBoundary`'s
    // `absolute inset-0` div) — assert IT carries a real, non-empty
    // sizing className, never the empty one that caused the 300x150px
    // collapse.
    // eslint-disable-next-line testing-library/no-node-access -- asserting a specific DOM ancestor (the sizing wrapper two levels up) has no Testing-Library-idiomatic query equivalent
    const visualBox = screen.getByTestId("hero-morph-scene-stub").parentElement?.parentElement;
    expect(visualBox).toBeInTheDocument();
    expect(visualBox?.className).toContain("aspect-");
  });
});
