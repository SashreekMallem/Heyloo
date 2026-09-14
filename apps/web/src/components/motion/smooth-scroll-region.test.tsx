import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmoothScrollRegion } from "./smooth-scroll-region";

const destroy = vi.fn();
const LenisConstructor = vi.fn(function FakeLenis(_options: {
  wrapper: HTMLElement;
  content: HTMLElement;
}) {
  return { destroy };
});
vi.mock("lenis", () => ({ default: LenisConstructor }));

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({ matches, media: query })),
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("SmoothScrollRegion", () => {
  it("renders its children inside the wrapper/content element pair", () => {
    stubMatchMedia(false);
    render(
      <SmoothScrollRegion>
        <p>Region content</p>
      </SmoothScrollRegion>,
    );
    expect(screen.getByText("Region content")).toBeInTheDocument();
  });

  it("constructs Lenis scoped to its own wrapper/content elements when reduced-motion is off", async () => {
    stubMatchMedia(false);
    render(
      <SmoothScrollRegion>
        <p>Content</p>
      </SmoothScrollRegion>,
    );

    await waitFor(() => expect(LenisConstructor).toHaveBeenCalledTimes(1));
    const options = LenisConstructor.mock.calls[0]?.[0];
    if (!options) throw new Error("Lenis constructor was not called with any options");
    expect(options.wrapper).not.toBe(window);
    expect(options.wrapper.contains(options.content)).toBe(true);
  });

  it("never constructs Lenis under prefers-reduced-motion", async () => {
    stubMatchMedia(true);
    render(
      <SmoothScrollRegion>
        <p>Content</p>
      </SmoothScrollRegion>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(LenisConstructor).not.toHaveBeenCalled();
  });

  it("destroys the Lenis instance on unmount", async () => {
    stubMatchMedia(false);
    const { unmount } = render(
      <SmoothScrollRegion>
        <p>Content</p>
      </SmoothScrollRegion>,
    );
    await waitFor(() => expect(LenisConstructor).toHaveBeenCalledTimes(1));
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
