import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Parallax } from "./parallax";
import { stubIntersectionObserver, stubMatchMedia, stubSingleShotRaf } from "./test-support";

describe("Parallax", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders children", () => {
    stubMatchMedia(false);
    render(<Parallax>Drifting content</Parallax>);
    expect(screen.getByText("Drifting content")).toBeInTheDocument();
  });

  it("applies a translate3d transform once intersecting, offset by scroll position", () => {
    stubMatchMedia(false);
    stubSingleShotRaf();
    const io = stubIntersectionObserver();

    render(<Parallax strength={12}>Drifting content</Parallax>);
    const node = screen.getByText("Drifting content");
    // Identity transform before the loop has ever computed a real offset.
    expect(node.style.transform).toBe("translate3d(0, 0px, 0)");

    act(() => {
      io.fire(true);
    });
    // jsdom's default (all-zero) bounding rect places the element's
    // midpoint above the viewport midpoint, clamping `normalized` to -1
    // — i.e. the full `-strength` offset.
    expect(node.style.transform).toBe("translate3d(0, -12px, 0)");
  });

  it("prefers-reduced-motion: never applies a transform, never observes", () => {
    stubMatchMedia(true);
    const io = stubIntersectionObserver();
    render(<Parallax>Static content</Parallax>);
    expect(screen.getByText("Static content").style.transform).toBe("");
    expect(io.observe).not.toHaveBeenCalled();
  });
});
