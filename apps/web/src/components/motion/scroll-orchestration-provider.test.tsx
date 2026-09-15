import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetGsapLoaderForTests } from "./gsap-loader";
import { ScrollOrchestrationProvider } from "./scroll-orchestration-provider";

const registerPlugin = vi.fn();
vi.mock("gsap", () => ({ gsap: { registerPlugin } }));
vi.mock("gsap/ScrollTrigger", () => ({ default: { name: "ScrollTrigger" } }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  __resetGsapLoaderForTests();
});

describe("ScrollOrchestrationProvider", () => {
  it("renders children unchanged", () => {
    render(
      <ScrollOrchestrationProvider>
        <div data-testid="child">hello</div>
      </ScrollOrchestrationProvider>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("hello");
  });

  it("SITE REPAIR regression guard: does NOT prefetch gsap on a passive page load (no interaction) — the old unconditional idle-prefetch pulled GSAP into every route's measured initial JS regardless of whether the visitor ever interacted", async () => {
    // jsdom has no requestIdleCallback — the component's setTimeout(200ms) fallback covers that; use fake timers to fast-forward well past it.
    vi.useFakeTimers();
    render(<ScrollOrchestrationProvider />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();

    expect(registerPlugin).not.toHaveBeenCalled();
  });

  it("prefetches gsap on idle once the visitor engages (first scroll/pointer/key)", async () => {
    vi.useFakeTimers();
    render(<ScrollOrchestrationProvider />);

    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      // the interaction gate resolves synchronously; the idle callback's
      // own 200ms jsdom fallback still needs advancing.
      vi.advanceTimersByTime(250);
    });
    vi.useRealTimers();

    await waitFor(() => expect(registerPlugin).toHaveBeenCalledTimes(1));
  });

  it("still eventually prefetches gsap for a passive visitor who never interacts, via deferUntilInteraction's own fallback timer", async () => {
    vi.useFakeTimers();
    render(<ScrollOrchestrationProvider />);

    await act(async () => {
      // deferUntilInteraction's DEFAULT_FALLBACK_DELAY_MS (4000ms) plus
      // the idle callback's own 200ms jsdom fallback.
      vi.advanceTimersByTime(4300);
    });
    vi.useRealTimers();

    await waitFor(() => expect(registerPlugin).toHaveBeenCalledTimes(1));
  });
});
