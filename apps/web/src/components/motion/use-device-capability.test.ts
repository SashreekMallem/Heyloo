import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDeviceCapability } from "./use-device-capability";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDeviceCapability", () => {
  it("qualifies on a desktop-width viewport with no reduced-motion preference", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

    const { result } = renderHook(() => useDeviceCapability());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.qualifiesForFilm).toBe(true);
  });

  it("fails closed on prefers-reduced-motion even at a qualifying width", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

    const { result } = renderHook(() => useDeviceCapability());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.qualifiesForFilm).toBe(false);
  });

  it("fails closed on a narrow (phone-width) viewport even with no reduced-motion preference", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });

    const { result } = renderHook(() => useDeviceCapability());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.qualifiesForFilm).toBe(false);
  });

  it("qualifies right at the documented minimum width", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    Object.defineProperty(window, "innerWidth", { value: 768, configurable: true });

    const { result } = renderHook(() => useDeviceCapability());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.qualifiesForFilm).toBe(true);
  });
});
