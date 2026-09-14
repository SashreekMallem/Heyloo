import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./reveal";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/** Captures the IntersectionObserver callback so a test can fire it manually. */
function stubIntersectionObserver() {
  let lastCallback: IntersectionObserverCallback | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();

  class FakeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      lastCallback = callback;
    }
    observe = observe;
    disconnect = disconnect;
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
  }

  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  return {
    fire: (isIntersecting: boolean) =>
      lastCallback?.(
        [{ isIntersecting } as IntersectionObserverEntry],
        new FakeIntersectionObserver(() => {}) as unknown as IntersectionObserver,
      ),
  };
}

describe("Reveal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("without IntersectionObserver support (this test env's default), renders content immediately visible — never stuck hidden", () => {
    render(<Reveal>Hello there</Reveal>);
    expect(screen.getByText("Hello there")).toHaveStyle({ opacity: "1" });
  });

  it("with IntersectionObserver support, starts hidden and becomes visible once the element intersects", () => {
    const io = stubIntersectionObserver();
    render(<Reveal>Staged content</Reveal>);
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
    const item = screen.getByText("Item one");
    expect(item.tagName).toBe("LI");
  });
});
