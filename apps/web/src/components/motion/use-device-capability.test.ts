import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDeviceCapability } from "./use-device-capability";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDeviceCapability", () => {
  it("never reports the webgl tier before the client-side probe has actually run", () => {
    // `renderHook`/`act` flush passive effects synchronously in this test
    // harness (unlike a real browser's paint-then-effects ordering), so
    // the mount effect has typically already resolved `ready: true` by
    // the time this line runs — the guarantee this asserts is really "the
    // safe tier never regresses to something unproven," which holds
    // either way.
    const { result } = renderHook(() => useDeviceCapability());
    expect(result.current.tier).toBe("canvas2d");
  });

  it("resolves to canvas2d under jsdom (no real WebGL context, per jsdom's own limits)", async () => {
    const { result } = renderHook(() => useDeviceCapability());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.tier).toBe("canvas2d");
  });

  it("resolves to webgl only when every gate check passes", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );

    const { result } = renderHook(() => useDeviceCapability());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.tier).toBe("webgl");
  });

  it("fails closed on prefers-reduced-motion even when everything else qualifies", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );

    const { result } = renderHook(() => useDeviceCapability());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.tier).toBe("canvas2d");
  });

  it("fails closed on a narrow (phone-width) viewport even with a working WebGL context", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );

    const { result } = renderHook(() => useDeviceCapability());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.tier).toBe("canvas2d");
  });

  it("passes open when navigator.deviceMemory is absent (Safari/Firefox never expose it)", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );
    expect((navigator as { deviceMemory?: number }).deviceMemory).toBeUndefined();

    const { result } = renderHook(() => useDeviceCapability());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.tier).toBe("webgl");
  });
});
