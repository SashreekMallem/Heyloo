import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const destroy = vi.fn();
const startHomeRuntime = vi.fn();
vi.mock("./runtime/start", () => ({ startHomeRuntime }));

const { HomeMotion } = await import("./home-motion");

function stubTier(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? reduced : true,
        media: query,
      }) as MediaQueryList,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  startHomeRuntime.mockReset();
  destroy.mockReset();
  startHomeRuntime.mockResolvedValue({ destroy });
  stubTier(false);
  Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.className = "";
});

describe("HomeMotion", () => {
  it("sets the tier classes on <html> and removes them again on unmount", () => {
    const { unmount } = render(<HomeMotion />);
    expect(document.documentElement).toHaveClass("fx", "stage");
    unmount();
    expect(document.documentElement).not.toHaveClass("fx");
    expect(document.documentElement).not.toHaveClass("stage");
  });

  it("does not touch the runtime during load", async () => {
    render(<HomeMotion />);
    await act(async () => {
      vi.advanceTimersByTime(2400);
    });
    await flush();
    expect(startHomeRuntime).not.toHaveBeenCalled();
  });

  it("starts the runtime 2.5 s after load for a visitor who only looks", async () => {
    render(<HomeMotion />);
    await act(async () => {
      vi.advanceTimersByTime(2600);
    });
    await flush();
    expect(startHomeRuntime).toHaveBeenCalledTimes(1);
  });

  it.each(["pointermove", "pointerdown", "wheel", "touchstart", "keydown", "focusin", "scroll"])(
    "starts the runtime at the first %s, once",
    async (type) => {
      render(<HomeMotion />);
      await act(async () => {
        window.dispatchEvent(new Event(type));
        window.dispatchEvent(new Event(type));
      });
      await flush();
      expect(startHomeRuntime).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(startHomeRuntime).toHaveBeenCalledTimes(1);
    },
  );

  it("destroys the runtime when the page unmounts", async () => {
    const { unmount } = render(<HomeMotion />);
    await act(async () => {
      window.dispatchEvent(new Event("pointermove"));
    });
    await flush();
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys a runtime that finishes starting after the page has already unmounted", async () => {
    let finish: (h: { destroy: () => void }) => void = () => {};
    startHomeRuntime.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { unmount } = render(<HomeMotion />);
    await act(async () => {
      window.dispatchEvent(new Event("wheel"));
    });
    await flush();
    unmount();
    await act(async () => {
      finish({ destroy });
    });
    await flush();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the static layout when the runtime fails to start", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    startHomeRuntime.mockRejectedValue(new Error("chunk failed"));
    render(<HomeMotion />);
    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await flush();
    expect(document.documentElement).toHaveClass("rm", "gl-off");
    expect(document.documentElement).not.toHaveClass("fx");
    error.mockRestore();
  });

  it("gives reduced-motion visitors the static tier from the first frame", () => {
    stubTier(true);
    render(<HomeMotion />);
    expect(document.documentElement).toHaveClass("rm");
    expect(document.documentElement).not.toHaveClass("fx");
  });
});
