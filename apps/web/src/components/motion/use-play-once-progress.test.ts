import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayOnceProgress } from "./use-play-once-progress";

/** Mirrors the pattern in `components/marketing/reveal.test.tsx` — captures the callback so a test can fire it manually. */
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
    disconnect,
  };
}

function stubRaf() {
  let now = 0;
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("performance", { ...performance, now: () => now });
  return {
    tick(ms: number) {
      now += ms;
      const pending = callbacks.splice(0, callbacks.length);
      for (const cb of pending) cb(now);
    },
  };
}

describe("usePlayOnceProgress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing until the target intersects", () => {
    stubIntersectionObserver();
    const raf = stubRaf();
    const onUpdate = vi.fn();
    const target = createRef<HTMLDivElement>();
    target.current = document.createElement("div");

    renderHook(() => usePlayOnceProgress({ target, onUpdate, durationMs: 1000 }));
    raf.tick(16);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("plays 0 to 1 exactly once after the target first intersects, then holds at 1", () => {
    const io = stubIntersectionObserver();
    const raf = stubRaf();
    const onUpdate = vi.fn();
    const target = createRef<HTMLDivElement>();
    target.current = document.createElement("div");

    renderHook(() => usePlayOnceProgress({ target, onUpdate, durationMs: 1000 }));

    act(() => {
      io.fire(true);
    });
    act(() => {
      raf.tick(500);
    });
    const midCallCount = onUpdate.mock.calls.length;
    expect(midCallCount).toBeGreaterThan(0);
    const midProgress = onUpdate.mock.calls.at(-1)?.[0] as number;
    expect(midProgress).toBeGreaterThan(0);
    expect(midProgress).toBeLessThan(1);

    act(() => {
      raf.tick(600); // now well past durationMs
    });
    expect(onUpdate.mock.calls.at(-1)?.[0]).toBeCloseTo(1);

    // Firing intersection again must not restart the play.
    const callCountAtCompletion = onUpdate.mock.calls.length;
    act(() => {
      io.fire(true);
      raf.tick(16);
    });
    expect(onUpdate.mock.calls.length).toBe(callCountAtCompletion);
  });

  it("disabled: never observes or updates", () => {
    const io = stubIntersectionObserver();
    stubRaf();
    const onUpdate = vi.fn();
    const target = createRef<HTMLDivElement>();
    target.current = document.createElement("div");

    renderHook(() => usePlayOnceProgress({ target, onUpdate, disabled: true }));
    act(() => {
      io.fire(true);
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
