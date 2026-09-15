import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResolvedTheme } from "./use-resolved-theme";

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_event: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_event: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    fire(next: boolean) {
      mql.matches = next;
      for (const cb of listeners) cb({ matches: next } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("useResolvedTheme", () => {
  it("resolves to the explicit data-theme attribute when present, regardless of system preference", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    stubMatchMedia(false);

    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("dark");
  });

  it("falls back to prefers-color-scheme when no data-theme attribute is set", () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("dark");
  });

  it("defaults to light when neither an explicit attribute nor a dark system preference applies", () => {
    stubMatchMedia(false);

    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");
  });

  it("reacts to a live data-theme attribute change (the ThemeToggle case)", async () => {
    stubMatchMedia(false);

    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");

    await act(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
      // MutationObserver callbacks fire as a microtask.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toBe("dark");
  });

  it("reacts to a live system-preference change when following system", async () => {
    const media = stubMatchMedia(false);

    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("light");

    act(() => {
      media.fire(true);
    });

    expect(result.current).toBe("dark");
  });
});
