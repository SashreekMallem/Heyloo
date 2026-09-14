import { render, screen, waitFor } from "@testing-library/react";
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

  it("prefetches gsap on idle without blocking first paint", async () => {
    // jsdom has no requestIdleCallback — the component's setTimeout(200ms) fallback covers that; use fake timers to fast-forward it.
    vi.useFakeTimers();
    render(<ScrollOrchestrationProvider />);
    vi.advanceTimersByTime(250);
    vi.useRealTimers();

    await waitFor(() => expect(registerPlugin).toHaveBeenCalledTimes(1));
  });
});
