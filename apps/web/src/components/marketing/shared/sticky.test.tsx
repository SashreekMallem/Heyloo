import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sticky } from "./sticky";
import { stubIntersectionObserver, stubMatchMedia, stubSingleShotRaf } from "./test-support";

describe("Sticky", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders plain children", () => {
    stubMatchMedia(false);
    render(<Sticky>Pinned content</Sticky>);
    expect(screen.getByText("Pinned content")).toBeInTheDocument();
  });

  it("renders a spacer sized by rangeVh and a sticky inner element", () => {
    stubMatchMedia(false);
    render(<Sticky rangeVh={200}>Content</Sticky>);
    // Plain-text `children` renders directly inside the sticky inner
    // `<div>` (no extra wrapper element around it), so the element RTL
    // matches on its text IS that inner div.
    const stickyEl = screen.getByText("Content");
    expect(stickyEl).toHaveStyle({ position: "sticky" });
    // `.style.height` (the raw inline value), not `toHaveStyle` — jsdom's
    // `getComputedStyle` (what `toHaveStyle` reads) resolves "200vh" to
    // an absolute px value against the test window's size, so it would
    // never match the "200vh" string this component actually sets.
    expect(stickyEl.parentElement?.style.height).toBe("200vh");
  });

  it("with a render-prop child, reports scroll progress once intersecting", () => {
    stubMatchMedia(false);
    stubSingleShotRaf();
    const io = stubIntersectionObserver();

    render(<Sticky>{(progress: number) => <span>progress:{progress.toFixed(2)}</span>}</Sticky>);
    expect(screen.getByText(/progress:0\.00/)).toBeInTheDocument();

    act(() => {
      io.fire(true);
    });
    // rAF is stubbed to run synchronously once — progress was recomputed
    // from the (jsdom-default, all-zero) bounding rect, so it stays a
    // valid clamped number rather than throwing.
    expect(screen.getByText(/progress:\d\.\d\d/)).toBeInTheDocument();
  });

  it("prefers-reduced-motion: renders children in normal flow with progress locked at 1, no sticky positioning", () => {
    stubMatchMedia(true);
    render(<Sticky>{(progress: number) => <span>progress:{progress}</span>}</Sticky>);
    const node = screen.getByText("progress:1");
    expect(node).toBeInTheDocument();
    // No sticky wrapper markup at all under reduced motion.
    expect(node.parentElement?.style.position).not.toBe("sticky");
  });
});
