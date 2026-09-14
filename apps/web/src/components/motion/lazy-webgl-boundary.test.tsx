import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyWebglBoundary } from "./lazy-webgl-boundary";

function StubScene({ label }: { label: string }) {
  return <div data-testid="scene">{label}</div>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

    await waitFor(() => expect(screen.getByTestId("fallback")).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByTestId("fallback")).toBeInTheDocument());
    expect(screen.queryByTestId("scene")).not.toBeInTheDocument();
  });

  it("renders Scene once both the device qualifies and reduced-motion is off", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
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
        sceneProps={{ label: "real scene" }}
        fallback={<div data-testid="fallback">fallback</div>}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("scene")).toHaveTextContent("real scene"));
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });
});
