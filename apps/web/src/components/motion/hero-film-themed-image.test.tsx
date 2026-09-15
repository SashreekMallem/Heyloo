import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeroFilmThemedImage } from "./hero-film-themed-image";

describe("HeroFilmThemedImage", () => {
  it("renders both theme's <img> unconditionally — nothing here differs between a server and client render", () => {
    const { container } = render(
      <HeroFilmThemedImage
        light={{ src: "/site/hero-film/light/poster.webp" }}
        dark={{ src: "/site/hero-film/dark/poster.webp" }}
        alt="Hero film"
      />,
    );

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed <img> pair has no role/text query equivalent
    const light = container.querySelector('img[data-heyloo-theme-img="light"]');
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed <img> pair has no role/text query equivalent
    const dark = container.querySelector('img[data-heyloo-theme-img="dark"]');
    expect(light).toHaveAttribute("src", "/site/hero-film/light/poster.webp");
    expect(dark).toHaveAttribute("src", "/site/hero-film/dark/poster.webp");
  });

  it("ships the CSS rule that hides both images by default, shows light by default, and swaps on data-theme/prefers-color-scheme", () => {
    const { container } = render(
      <HeroFilmThemedImage
        light={{ src: "/light.webp" }}
        dark={{ src: "/dark.webp" }}
        alt="Hero film"
      />,
    );
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the injected <style> tag has no role/text query equivalent
    const style = container.querySelector("style");
    expect(style?.textContent).toContain('[data-heyloo-theme-img="light"] { display: block; }');
    expect(style?.textContent).toContain(':root[data-theme="dark"]');
    expect(style?.textContent).toContain("prefers-color-scheme: dark");
  });

  it("regression guard (GLUE+PERF finding): neither <img>'s own inline style sets `display` — an inline style always wins over the stylesheet rule above regardless of selector specificity, which is exactly how this broke before (both images stayed permanently visible, dark always painting on top) undetected by a plain CSS-text-content check", () => {
    const { container } = render(
      <HeroFilmThemedImage
        light={{ src: "/light.webp" }}
        dark={{ src: "/dark.webp" }}
        alt="Hero film"
      />,
    );
    for (const themeName of ["light", "dark"] as const) {
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed <img> pair has no role/text query equivalent
      const img = container.querySelector<HTMLImageElement>(
        `img[data-heyloo-theme-img="${themeName}"]`,
      );
      expect(img?.style.display).toBe("");
    }
  });

  it("marks the priority image eager/high fetch priority for LCP, and the non-priority image lazy", () => {
    const { container: priorityContainer } = render(
      <HeroFilmThemedImage
        light={{ src: "/light.webp" }}
        dark={{ src: "/dark.webp" }}
        alt="Hero film"
        priority
      />,
    );
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed <img> pair has no role/text query equivalent
    const priorityImg = priorityContainer.querySelector('img[data-heyloo-theme-img="light"]');
    expect(priorityImg).toHaveAttribute("loading", "eager");
    expect(priorityImg).toHaveAttribute("fetchpriority", "high");

    const { container: lazyContainer } = render(
      <HeroFilmThemedImage
        light={{ src: "/light.webp" }}
        dark={{ src: "/dark.webp" }}
        alt="Hero film"
      />,
    );
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed <img> pair has no role/text query equivalent
    const lazyImg = lazyContainer.querySelector('img[data-heyloo-theme-img="light"]');
    expect(lazyImg).toHaveAttribute("loading", "lazy");
    expect(lazyImg).not.toHaveAttribute("fetchpriority");
  });

  it("passes through an explicit srcSet (mobile/reduced-motion 720w + full 1440w candidates)", () => {
    const { container } = render(
      <HeroFilmThemedImage
        light={{ src: "/light.webp", srcSet: "/light-720.webp 720w, /light.webp 1440w" }}
        dark={{ src: "/dark.webp", srcSet: "/dark-720.webp 720w, /dark.webp 1440w" }}
        alt="Hero film"
      />,
    );
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed <img> pair has no role/text query equivalent
    const light = container.querySelector('img[data-heyloo-theme-img="light"]');
    expect(light).toHaveAttribute("srcset", "/light-720.webp 720w, /light.webp 1440w");
  });

  it("sets explicit width/height (CLS-safe) defaulting to the film's authored 1440x810", () => {
    const { container } = render(
      <HeroFilmThemedImage
        light={{ src: "/light.webp" }}
        dark={{ src: "/dark.webp" }}
        alt="Hero film"
      />,
    );
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed <img> pair has no role/text query equivalent
    const light = container.querySelector('img[data-heyloo-theme-img="light"]');
    expect(light).toHaveAttribute("width", "1440");
    expect(light).toHaveAttribute("height", "810");
  });
});
