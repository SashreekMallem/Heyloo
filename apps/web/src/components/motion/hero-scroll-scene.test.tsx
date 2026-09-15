import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HERO_CALL_BUSINESS_NAME, HERO_CALL_TOOL_CALL } from "@/content/marketing/hero-call";
import { __resetGsapLoaderForTests } from "./gsap-loader";
import { HeroScrollScene } from "./hero-scroll-scene";

const registerPlugin = vi.fn();
let scrollTriggerConfigs: Array<{
  start?: string;
  end?: string;
  pin?: boolean;
  pinSpacing?: boolean;
}> = [];
const scrollTriggerCreate = vi.fn(
  (config: { start?: string; end?: string; pin?: boolean; pinSpacing?: boolean }) => {
    scrollTriggerConfigs.push(config);
    return { kill: vi.fn(), progress: 0 };
  },
);

vi.mock("gsap", () => ({ gsap: { registerPlugin } }));
vi.mock("gsap/ScrollTrigger", () => ({
  default: { create: scrollTriggerCreate, refresh: vi.fn() },
}));

function stubMatchMedia(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

/** Makes the device-capability + reduced-motion gate resolve to `qualifies: true` (the pinned-hero tests need the film tier, not a fallback). */
function stubQualifyingDevice() {
  stubMatchMedia(false);
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
}

function stubNarrowDevice() {
  stubMatchMedia(false);
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
}

function FallbackHero() {
  return <div data-testid="fallback-hero">existing hero visual</div>;
}

/**
 * `ScrollTrigger.create()` (and the `gsap` chunk behind it) is deferred
 * until the visitor engages — first scroll/pointer/key, or a fallback
 * timer (`ENGAGE_FALLBACK_MS`). Every qualifying-tier test that asserts
 * on the created `ScrollTrigger` needs to fire this first.
 */
function dispatchScroll() {
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  scrollTriggerConfigs = [];
  __resetGsapLoaderForTests();
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
  });

  it("Visual renders `fallback` on a narrow (mobile) viewport, alongside the film's final-frame image, never a canvas", async () => {
    stubNarrowDevice();
    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );
    expect(await screen.findByTestId("fallback-hero")).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access -- <canvas> has no accessible role/text for a Testing-Library query
    expect(document.querySelector("canvas")).not.toBeInTheDocument();
    // The mobile tier still shows the film's product object, just as a
    // static final-frame <img>, not the scrubbed sequence.
    // eslint-disable-next-line testing-library/no-node-access -- asserting on the themed final-frame <img> has no role/text query equivalent
    expect(document.querySelector('img[data-heyloo-theme-img="light"]')).toBeInTheDocument();
  });

  it("Visual renders the static final-frame tier (not `fallback`) under prefers-reduced-motion, even on a device that would otherwise qualify", async () => {
    stubMatchMedia(true);
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );
    expect(screen.queryByTestId("fallback-hero")).not.toBeInTheDocument();
    expect(
      await waitFor(
        // eslint-disable-next-line testing-library/no-node-access -- asserting on the themed final-frame <img> has no role/text query equivalent
        () => document.querySelector('img[data-heyloo-theme-img="light"]'),
      ),
    ).toBeInTheDocument();
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

  // --- Pinned/qualifying tier regression coverage ---

  it("pins with a start offset that clears the sticky header, never the literal viewport top", async () => {
    stubQualifyingDevice();
    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );

    dispatchScroll();
    await waitFor(() => expect(scrollTriggerCreate).toHaveBeenCalledTimes(1));
    const config = scrollTriggerConfigs[0];
    // Regression test: this used to be the literal "top top", which pinned
    // the hero directly behind the sticky header (clipping the badge) —
    // see hero-scroll-scene.tsx's STICKY_HEADER_HEIGHT_PX comment.
    expect(config?.start).toBe("top top+=64");
    expect(config?.start).not.toBe("top top");
  });

  it("renders the CSS-only pin-space reservation unconditionally, with per-instance custom properties, regardless of qualifying tier (CLS regression coverage)", async () => {
    // Deliberately NOT `stubQualifyingDevice()` — the whole point of this
    // fix (see hero-scroll-scene.tsx's `forceCollapse` comment) is that
    // the reservation element and its stylesheet are present in EVERY
    // render, qualifying or not: a real page load paints server-rendered
    // HTML (computed non-qualifying, since SSR has no `window`) before
    // any client JS runs, so a JS-conditional reservation can never
    // avoid a shift once hydration later flips it — CSS media queries,
    // evaluated on that first paint, are what actually can.
    stubMatchMedia(false);
    const { container } = render(
      <HeroScrollScene pinVhDesktop={250} pinVhTablet={180}>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting a specific CSS class/custom-property on a decorative, non-interactive spacer div has no role/text to query by
    const reserve = container.querySelector<HTMLDivElement>(".hero-pin-reserve");
    expect(reserve).toBeInTheDocument();
    expect(reserve?.style.getPropertyValue("--hero-pin-vh-tablet")).toBe("180vh");
    expect(reserve?.style.getPropertyValue("--hero-pin-vh-desktop")).toBe("250vh");

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the raw contents of an injected <style> tag has no role/text query equivalent
    const styleTags = [...container.querySelectorAll("style")];
    const reserveStyleTag = styleTags.find((tag) => tag.textContent?.includes("hero-pin-reserve"));
    expect(reserveStyleTag?.textContent).toContain("hero-pin-reserve");
    expect(reserveStyleTag?.textContent).toContain("var(--hero-pin-vh-tablet)");
    expect(reserveStyleTag?.textContent).toContain("var(--hero-pin-vh-desktop)");
    expect(reserveStyleTag?.textContent).toContain("prefers-reduced-motion: no-preference");
  });

  it("still pins with pinSpacing: false on a qualifying device — GSAP never adds its own spacing on top of the CSS reservation", async () => {
    stubQualifyingDevice();
    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );

    dispatchScroll();
    await waitFor(() => expect(scrollTriggerCreate).toHaveBeenCalledTimes(1));
    expect(scrollTriggerConfigs[0]?.pinSpacing).toBe(false);
  });

  it("passes a sizing className to the film's visual box on a qualifying device", async () => {
    stubQualifyingDevice();
    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual className="hero-visual-box" fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );
    dispatchScroll();
    await waitFor(() => expect(scrollTriggerCreate).toHaveBeenCalledTimes(1));
    // eslint-disable-next-line testing-library/no-node-access -- asserting a specific CSS class was applied to the sizing box has no role/text query equivalent
    expect(document.querySelector(".hero-visual-box")).toBeInTheDocument();
  });

  it("does not create a ScrollTrigger (or load GSAP) on a qualifying device until the visitor engages — the JS-budget deferral", async () => {
    stubQualifyingDevice();
    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );

    // Give any (incorrect) immediate-creation behavior a chance to
    // appear before asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollTriggerCreate).not.toHaveBeenCalled();

    dispatchScroll();
    await waitFor(() => expect(scrollTriggerCreate).toHaveBeenCalledTimes(1));
  });

  // --- hero-story-overlay content coverage ---

  it("composites the real-content DOM overlay (transcript/tool-call badge) over the film canvas on a qualifying device, without waiting on any separate engagement signal", async () => {
    stubQualifyingDevice();
    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );

    // Mounted immediately — no `dispatchScroll()` here — this is the
    // regression coverage for "the pin rendered only an abstract line,
    // no transcript ever appeared."
    expect(screen.getAllByText(HERO_CALL_BUSINESS_NAME).length).toBeGreaterThan(0);
  });

  it("never renders the qualifying-tier overlay under the mobile fallback — only `fallback` itself, plus the static final-frame image", async () => {
    stubNarrowDevice();
    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );
    expect(await screen.findByTestId("fallback-hero")).toBeInTheDocument();
    expect(screen.queryByText(HERO_CALL_TOOL_CALL)).not.toBeInTheDocument();
  });

  it("never applies the sizing className to the mobile fallback itself", async () => {
    // `useReducedMotion`/`useDeviceCapability` only resolve once on
    // mount (they react to real OS-level `change` events afterward, not
    // to a stub changing mid-test) — a fresh mount, not a rerender of an
    // already-qualifying instance, is what actually exercises this
    // branch.
    stubNarrowDevice();
    render(
      <HeroScrollScene>
        <HeroScrollScene.Visual className="hero-visual-box" fallback={<FallbackHero />} />
      </HeroScrollScene>,
    );
    expect(await screen.findByTestId("fallback-hero")).toBeInTheDocument();
    expect(screen.getByTestId("fallback-hero")).not.toHaveClass("hero-visual-box");
    expect(scrollTriggerCreate).not.toHaveBeenCalled();
  });
});
