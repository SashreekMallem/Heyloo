import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyWebglBoundary } from "./lazy-webgl-boundary";

function StubScene({ label }: { label: string }) {
  return <div data-testid="scene">{label}</div>;
}

/** Matches `use-device-capability.ts`'s `qualifiesForWebgl` gate for every test below that wants a qualifying device. */
function stubQualifyingDevice() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as WebGLRenderingContext);
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("LazyWebglBoundary", () => {
  it("renders the fallback under jsdom, which has no real WebGL context to qualify with", async () => {
    render(
      <LazyWebglBoundary
        Scene={StubScene}
        sceneProps={{ label: "scene" }}
        fallback={<div data-testid="fallback">fallback</div>}
      />,
    );

    expect(await screen.findByTestId("fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
  });

  it("renders the fallback under prefers-reduced-motion even when the device would otherwise qualify", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as WebGLRenderingContext,
    );
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

    render(
      <LazyWebglBoundary
        Scene={StubScene}
        sceneProps={{ label: "scene" }}
        fallback={<div data-testid="fallback">fallback</div>}
      />,
    );

    expect(await screen.findByTestId("fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
  });

  it("keeps rendering the fallback on a qualifying device until the visitor engages (SITE REPAIR: Scene must not fetch on mount)", async () => {
    stubQualifyingDevice();

    render(
      <LazyWebglBoundary
        Scene={StubScene}
        sceneProps={{ label: "real scene" }}
        fallback={<div data-testid="fallback">fallback</div>}
      />,
    );

    // Give any (incorrect) immediate-mount behavior a chance to appear
    // before asserting its absence — a bare synchronous assertion right
    // after `render` wouldn't catch a bug that surfaces on the next tick.
    expect(await screen.findByTestId("fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
  });

  it("renders Scene once the visitor scrolls/interacts, on a qualifying device", async () => {
    stubQualifyingDevice();

    render(
      <LazyWebglBoundary
        Scene={StubScene}
        sceneProps={{ label: "real scene" }}
        fallback={<div data-testid="fallback">fallback</div>}
      />,
    );

    expect(await screen.findByTestId("fallback")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(await screen.findByTestId("scene")).toHaveTextContent("real scene");
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });

  it("renders Scene after the fallback delay, for a qualifying device that never scrolls/interacts", () => {
    vi.useFakeTimers();
    stubQualifyingDevice();

    render(
      <LazyWebglBoundary
        Scene={StubScene}
        sceneProps={{ label: "real scene" }}
        fallback={<div data-testid="fallback">fallback</div>}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("scene")).toHaveTextContent("real scene");
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });
});
