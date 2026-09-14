import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaLoop } from "./media-loop";
import { stubMatchMedia } from "./test-support";

const SOURCES = [
  { src: "/site/hero-loop.webm", type: "video/webm" as const },
  { src: "/site/hero-loop.mp4", type: "video/mp4" as const },
];
const POSTER = {
  avif: "/site/hero-loop-poster.avif",
  webp: "/site/hero-loop-poster.webp",
  alt: "A thin line straightening into a rounded card outline",
};

describe("MediaLoop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always renders the poster image with real alt text", () => {
    stubMatchMedia(false);
    render(<MediaLoop sources={SOURCES} poster={POSTER} width={320} height={180} />);
    const img = screen.getByAltText(POSTER.alt);
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe("IMG");
  });

  it("mounts the <video> once IntersectionObserver is unavailable (fail-open, this test env's default) even without `priority`", () => {
    stubMatchMedia(false);
    render(<MediaLoop sources={SOURCES} poster={POSTER} width={320} height={180} />);
    expect(screen.getByTestId("media-loop-video")).toBeInTheDocument();
  });

  it("`priority` mounts the <video> immediately", () => {
    stubMatchMedia(false);
    render(<MediaLoop sources={SOURCES} poster={POSTER} width={320} height={180} priority />);
    expect(screen.getByTestId("media-loop-video")).toBeInTheDocument();
  });

  it("prefers-reduced-motion: never mounts a <video>, poster stays the permanent rendering", () => {
    stubMatchMedia(true);
    render(<MediaLoop sources={SOURCES} poster={POSTER} width={320} height={180} priority />);
    expect(screen.queryByTestId("media-loop-video")).not.toBeInTheDocument();
    expect(screen.getByAltText(POSTER.alt)).toHaveStyle({ opacity: "1" });
  });
});
