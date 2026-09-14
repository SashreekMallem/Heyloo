import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./reveal";
import { stubIntersectionObserver, stubMatchMedia } from "./test-support";

describe("Reveal (shared)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders content", () => {
    render(<Reveal>Hello there</Reveal>);
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("without IntersectionObserver support, renders visible immediately", () => {
    render(<Reveal>No IO here</Reveal>);
    expect(screen.getByText("No IO here")).toHaveStyle({ opacity: "1" });
  });

  it("with IntersectionObserver support, starts hidden and becomes visible on intersect", () => {
    const io = stubIntersectionObserver();
    render(<Reveal direction="left">Staged content</Reveal>);
    const node = screen.getByText("Staged content");
    expect(node).toHaveStyle({ opacity: "0" });

    act(() => {
      io.fire(true);
    });
    expect(node).toHaveStyle({ opacity: "1" });
  });

  it("prefers-reduced-motion: renders visible immediately, never observing at all", () => {
    stubIntersectionObserver();
    stubMatchMedia(true);
    render(<Reveal>Reduced motion content</Reveal>);
    expect(screen.getByText("Reduced motion content")).toHaveStyle({ opacity: "1" });
  });

  it("as='li' renders a real <li>, never a <div> nested inside a list", () => {
    render(
      <ul>
        <Reveal as="li">Item one</Reveal>
      </ul>,
    );
    expect(screen.getByText("Item one").tagName).toBe("LI");
  });
});
