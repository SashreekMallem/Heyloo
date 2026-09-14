import { render } from "@testing-library/react";
import type { RefObject } from "react";
import { describe, expect, it } from "vitest";
import { HeroMorphCanvas2d } from "./hero-morph-canvas2d";

function progressRefOf(value: number): RefObject<number> {
  return { current: value };
}

describe("HeroMorphCanvas2d", () => {
  it("renders a canvas inside an aria-hidden wrapper, and never throws even though jsdom has no real 2D context", () => {
    const progressRef = progressRefOf(0.5);

    const { container } = render(
      <HeroMorphCanvas2d progressRef={progressRef} className="hero-canvas" />,
    );

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- <canvas> has no accessible role/text for a Testing-Library query
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
    // aria-hidden lives on the wrapper, never on the canvas itself — a
    // focusable element with aria-hidden confuses screen readers even
    // when nothing inside is meant to be focusable in practice.
    // eslint-disable-next-line testing-library/no-node-access -- the wrapper is aria-hidden by design (the test's own point), so it's excluded from every role-based Testing-Library query
    expect(canvas?.parentElement).toHaveAttribute("aria-hidden", "true");
    // eslint-disable-next-line testing-library/no-node-access -- same aria-hidden wrapper as above, asserting its class has no role/text query equivalent
    expect(canvas?.parentElement).toHaveClass("hero-canvas");
  });

  it("unmounts cleanly (no leaked observers/rAF loop throwing after teardown)", () => {
    const progressRef = progressRefOf(0);
    const { unmount } = render(<HeroMorphCanvas2d progressRef={progressRef} />);
    expect(() => unmount()).not.toThrow();
  });
});
