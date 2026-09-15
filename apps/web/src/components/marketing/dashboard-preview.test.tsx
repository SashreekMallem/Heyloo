import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOME_CONTENT } from "@/content/marketing/home";
import { DashboardPreview } from "./dashboard-preview";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("DashboardPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders real @heyloo/ui components with real fixture data — metrics, recent calls, latest booking", () => {
    render(<DashboardPreview />);
    expect(screen.getByText("Calls today")).toBeInTheDocument();
    expect(screen.getByText("Bookings today")).toBeInTheDocument();
    expect(screen.getByText("Recent calls")).toBeInTheDocument();
    expect(screen.getByText("Latest booking")).toBeInTheDocument();
    expect(screen.getByText("2019 Honda Civic")).toBeInTheDocument();
  });

  it("prefers-reduced-motion: metric values land on their real final number immediately, never a mid-count frame", () => {
    stubMatchMedia(true);
    render(<DashboardPreview />);
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("182")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });

  it("fixture determinism (round-4 review): metrics and the booking are fixed constants from the content module, identical across renders — never Math.random/Date.now-derived", () => {
    stubMatchMedia(true);

    const view = render(<DashboardPreview />);
    expect(screen.getByText(String(HOME_CONTENT.dashboardMetrics.callsToday))).toBeInTheDocument();
    expect(
      screen.getByText(String(HOME_CONTENT.dashboardMetrics.bookingsToday)),
    ).toBeInTheDocument();
    expect(screen.getByText(String(HOME_CONTENT.dashboardMetrics.minutesUsed))).toBeInTheDocument();
    expect(
      screen.getByText(`${HOME_CONTENT.dashboardMetrics.answerRatePercent}.0%`),
    ).toBeInTheDocument();
    expect(screen.getByText(HOME_CONTENT.booking.customer)).toBeInTheDocument();
    expect(screen.getByText(HOME_CONTENT.booking.vehicle)).toBeInTheDocument();
    view.unmount();

    // Re-render (a second "page load") lands on the exact same numbers —
    // there is no non-deterministic source (`Math.random`, `Date.now`) to
    // drift between them.
    render(<DashboardPreview />);
    expect(screen.getByText(String(HOME_CONTENT.dashboardMetrics.callsToday))).toBeInTheDocument();
    expect(
      screen.getByText(`${HOME_CONTENT.dashboardMetrics.answerRatePercent}.0%`),
    ).toBeInTheDocument();
  });
});
