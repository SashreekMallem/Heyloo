import { render, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroFilmScrubber } from "./hero-film-scrubber";

function progressRefOf(value: number): RefObject<number> {
  return { current: value };
}

function stubObservers() {
  class FakeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }
  vi.stubGlobal("ResizeObserver", FakeObserver);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
}

function stubRaf() {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    return window.setTimeout(() => cb(performance.now()), 0);
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
}

/**
 * A fetch that resolves every request with an empty-but-ok response, so
 * `createImageBitmap` gets called for every requested frame URL. Returns
 * a hand-shaped object (just `.ok`/`.status`/`.blob()`) rather than a
 * real `Response` — jsdom's `Blob` doesn't implement `.stream()`, which
 * Node's real `Response` constructor needs, so building an actual
 * `Response` under this test environment throws.
 */
function stubFetch(): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return { ok: true, status: 200, blob: async () => new Blob() };
    }),
  );
  return { calls };
}

function stubCreateImageBitmap(width = 1440, height = 810) {
  const bitmap = { width, height, close: vi.fn() };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  return bitmap;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HeroFilmScrubber", () => {
  it("renders both theme's poster <img> and a <canvas>, hidden (opacity 0) until a frame is ready", () => {
    stubObservers();
    stubRaf();
    // fetch left unstubbed/rejecting: frames never resolve in this test.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    const { container } = render(<HeroFilmScrubber progressRef={progressRefOf(0)} />);

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed poster <img> pair has no role/text query equivalent
    expect(container.querySelector('img[data-heyloo-theme-img="light"]')).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting on the themed poster <img> pair has no role/text query equivalent
    expect(container.querySelector('img[data-heyloo-theme-img="dark"]')).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- <canvas> has no accessible role/text for a Testing-Library query
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
    expect((canvas as HTMLCanvasElement).style.opacity).toBe("0");
  });

  it("fetches the eager frame window immediately on mount, including both endpoints", async () => {
    stubObservers();
    stubRaf();
    const { calls } = stubFetch();
    stubCreateImageBitmap();

    render(<HeroFilmScrubber progressRef={progressRefOf(0)} />);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((url) => url.includes("f001.webp"))).toBe(true);
    expect(calls.some((url) => url.includes("f097.webp"))).toBe(true);
  });

  it("reveals the canvas (opacity 1) once the first frame has decoded", async () => {
    stubObservers();
    stubRaf();
    stubFetch();
    stubCreateImageBitmap();

    const { container } = render(<HeroFilmScrubber progressRef={progressRefOf(0)} />);
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- <canvas> has no accessible role/text for a Testing-Library query
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    await waitFor(() => expect(canvas.style.opacity).toBe("1"));
  });

  it("only fetches from the resolved theme's directory (light, the jsdom default)", async () => {
    stubObservers();
    stubRaf();
    const { calls } = stubFetch();
    stubCreateImageBitmap();

    render(<HeroFilmScrubber progressRef={progressRefOf(0)} />);

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    for (const url of calls) {
      expect(url).toContain("/site/hero-film/light/");
    }
  });

  it("aborts every in-flight frame fetch on unmount", async () => {
    stubObservers();
    stubRaf();
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    // Never resolves — every request stays "in flight" until unmount.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    const { unmount } = render(<HeroFilmScrubber progressRef={progressRefOf(0)} />);
    unmount();

    expect(abortSpy).toHaveBeenCalled();
  });
});
