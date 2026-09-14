import { renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetGsapLoaderForTests } from "./gsap-loader";
import { useScrollProgress } from "./use-scroll-progress";

const registerPlugin = vi.fn();
const kill = vi.fn();
const create = vi.fn((config: { onUpdate?: (self: { progress: number }) => void }) => ({
  kill,
  progress: 0,
  config,
}));

vi.mock("gsap", () => ({ gsap: { registerPlugin } }));
vi.mock("gsap/ScrollTrigger", () => ({ default: { create } }));

afterEach(() => {
  vi.clearAllMocks();
  __resetGsapLoaderForTests();
});

describe("useScrollProgress", () => {
  it("does nothing when disabled — never loads gsap, never creates a ScrollTrigger", async () => {
    const target = createRef<HTMLDivElement>();
    target.current = document.createElement("div");
    renderHook(() => useScrollProgress({ target, disabled: true, onUpdate: vi.fn() }));
    // Give any accidental async work a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a pinned, scrubbed ScrollTrigger with the expected config when enabled", async () => {
    const target = createRef<HTMLDivElement>();
    target.current = document.createElement("div");
    const onUpdate = vi.fn();

    renderHook(() => useScrollProgress({ target, pin: true, end: "+=250%", scrub: 0.5, onUpdate }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(registerPlugin).toHaveBeenCalledTimes(1);

    const config = create.mock.calls[0]?.[0] as {
      trigger: unknown;
      pin: boolean;
      start: string;
      end: string;
      scrub: number;
      onUpdate: (self: { progress: number }) => void;
    };
    expect(config.trigger).toBe(target.current);
    expect(config.pin).toBe(true);
    expect(config.start).toBe("top top");
    expect(config.end).toBe("+=250%");
    expect(config.scrub).toBe(0.5);

    config.onUpdate({ progress: 0.42 });
    expect(onUpdate).toHaveBeenCalledWith(0.42);
  });

  it("passes pinSpacing through to ScrollTrigger.create() (undefined by default — GSAP's own default applies)", async () => {
    const target = createRef<HTMLDivElement>();
    target.current = document.createElement("div");

    renderHook(() =>
      useScrollProgress({ target, pin: true, pinSpacing: false, onUpdate: vi.fn() }),
    );

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const config = create.mock.calls[0]?.[0] as { pinSpacing?: boolean };
    expect(config.pinSpacing).toBe(false);
  });

  it("kills the ScrollTrigger on unmount", async () => {
    const target = createRef<HTMLDivElement>();
    target.current = document.createElement("div");

    const { unmount } = renderHook(() => useScrollProgress({ target, onUpdate: vi.fn() }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    unmount();
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("publishes the ScrollTrigger instance to window.__heylooScrollDebug in non-production, and clears it on unmount", async () => {
    const target = createRef<HTMLDivElement>();
    target.current = document.createElement("div");

    const { unmount } = renderHook(() =>
      useScrollProgress({ target, onUpdate: vi.fn(), debugKey: "hero" }),
    );

    await waitFor(() => {
      const debugGlobal = (window as unknown as { __heylooScrollDebug?: Record<string, unknown> })
        .__heylooScrollDebug;
      expect(debugGlobal?.["hero"]).toBeDefined();
    });

    unmount();
    const debugGlobal = (window as unknown as { __heylooScrollDebug?: Record<string, unknown> })
      .__heylooScrollDebug;
    expect(debugGlobal?.["hero"]).toBeUndefined();
  });
});
