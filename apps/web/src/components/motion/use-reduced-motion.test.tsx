import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "./use-reduced-motion";

type Listener = (event: MediaQueryListEvent) => void;

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  let listener: Listener | undefined;

  const mql = {
    get matches() {
      return matches;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn((_event: string, cb: Listener) => {
      listener = cb;
    }),
    removeEventListener: vi.fn(),
  };

  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));

  return {
    change(next: boolean) {
      matches = next;
      listener?.({ matches: next } as MediaQueryListEvent);
    },
  };
}

describe("useReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the initial prefers-reduced-motion state after mount", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("defaults to false when the media query doesn't match", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("updates reactively when the OS-level preference changes", () => {
    const mql = mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      mql.change(true);
    });
    expect(result.current).toBe(true);
  });
});
