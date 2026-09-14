import { afterEach, describe, expect, it, vi } from "vitest";
import { deferUntilInteraction } from "./defer-non-critical";

describe("deferUntilInteraction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not run immediately", () => {
    const run = vi.fn();
    deferUntilInteraction(run);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs once a real interaction event fires, before the fallback timer", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    deferUntilInteraction(run, 4000);

    window.dispatchEvent(new Event("pointerdown"));
    expect(run).toHaveBeenCalledTimes(1);

    // A later interaction, or the fallback timer, must not re-fire it.
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs after the fallback delay when the visitor never interacts", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    deferUntilInteraction(run, 4000);

    vi.advanceTimersByTime(3999);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("the returned cleanup cancels the fallback timer and event listeners, so `run` never fires", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const cleanup = deferUntilInteraction(run, 1000);

    cleanup();
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event("scroll"));

    expect(run).not.toHaveBeenCalled();
  });

  it("SSR-safe: returns a no-op cleanup and never throws when `window` is unavailable", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — deliberately simulating an SSR environment for this one assertion
    delete globalThis.window;

    let cleanup: (() => void) | undefined;
    expect(() => {
      cleanup = deferUntilInteraction(vi.fn());
    }).not.toThrow();
    expect(() => cleanup?.()).not.toThrow();

    globalThis.window = originalWindow;
  });
});
