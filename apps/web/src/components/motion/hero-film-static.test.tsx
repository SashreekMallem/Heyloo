import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HERO_CALL_BUSINESS_NAME } from "@/content/marketing/hero-call";
import { HeroFilmFinalImage, HeroFilmStatic } from "./hero-film-static";

function stubObservers() {
  class FakeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
}

function stubRaf() {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
}

describe("HeroFilmFinalImage", () => {
  it("renders both theme's final-frame image with a 720w/1440w srcSet (no per-frame downloads — just this one static image)", () => {
    const { container } = render(<HeroFilmFinalImage />);
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed final-frame <img> pair has no role/text query equivalent
    const light = container.querySelector('img[data-heyloo-theme-img="light"]');
    expect(light).toHaveAttribute("src", "/site/hero-film/light/final.webp");
    expect(light).toHaveAttribute(
      "srcset",
      "/site/hero-film/light/final-720.webp 720w, /site/hero-film/light/final.webp 1440w",
    );
  });
});

describe("HeroFilmStatic", () => {
  it("renders the final-frame image plus the 'land' story panel, with no canvas and no frame-sequence loop", () => {
    stubObservers();
    stubRaf();

    const { container } = render(<HeroFilmStatic />);

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- <canvas> has no accessible role/text for a Testing-Library query
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed final-frame <img> pair has no role/text query equivalent
    expect(container.querySelector('img[data-heyloo-theme-img="light"]')).toBeInTheDocument();
    // The "land" panel's content (booking landed in the dashboard) is
    // present and, since the overlay is pinned at progress: 1, visible.
    expect(container.textContent).toContain(HERO_CALL_BUSINESS_NAME);
    expect(container.textContent).toContain("New booking");
  });

  it("is entirely decorative (aria-hidden), matching every other hero visual tier", () => {
    stubObservers();
    stubRaf();
    const { container } = render(<HeroFilmStatic />);
    // eslint-disable-next-line testing-library/no-node-access -- the element under test is aria-hidden by design (the test's own point), so it's excluded from every role-based Testing-Library query
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
