import { vi } from "vitest";

/**
 * Shared test doubles for `components/marketing/shared/**` — every
 * primitive here is `IntersectionObserver`/`matchMedia`-driven, so the
 * fakes below (same shape as `components/marketing/reveal.test.tsx`'s
 * inline versions, centralized here so a fourth/fifth primitive doesn't
 * re-copy them) are what each `*.test.tsx` imports. Not a component
 * itself — never re-exported from `./index.ts`.
 */

export function stubMatchMedia(matches: boolean) {
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

/** Captures the most recent IntersectionObserver callback so a test can fire it manually. */
export function stubIntersectionObserver() {
  let lastCallback: IntersectionObserverCallback | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const unobserve = vi.fn();

  class FakeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      lastCallback = callback;
    }
    observe = observe;
    disconnect = disconnect;
    unobserve = unobserve;
    takeRecords = () => [];
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
  }

  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  return {
    observe,
    disconnect,
    fire: (isIntersecting: boolean, boundingClientRect?: Partial<DOMRect>) =>
      lastCallback?.(
        [
          {
            isIntersecting,
            boundingClientRect: { top: 0, bottom: 0, height: 0, ...boundingClientRect },
          } as IntersectionObserverEntry,
        ],
        new FakeIntersectionObserver(() => {}) as unknown as IntersectionObserver,
      ),
  };
}

/**
 * Stubs `requestAnimationFrame`/`cancelAnimationFrame` for the
 * `Sticky`/`Parallax` scroll-progress loops, which each re-arm
 * themselves (`if (active) rafId = requestAnimationFrame(tick)`) for as
 * long as the section stays in view — a naive "always invoke
 * synchronously" stub would recurse forever inside that first call. This
 * runs the very first queued callback synchronously (enough for a test
 * to observe one real progress computation) and lets every callback
 * queued FROM WITHIN that first run — the loop re-arming itself — sit
 * unfired, exactly like a real paused/single-frame browser would look
 * from the test's perspective.
 */
export function stubSingleShotRaf() {
  let firedOnce = false;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    if (!firedOnce) {
      firedOnce = true;
      cb(0);
    }
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}
