// @vitest-environment jsdom
import { posthog } from "posthog-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { identifyUser, initAnalytics, trackEvent } from "./index.js";

vi.mock("posthog-js", () => ({
  posthog: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
  },
}));

describe("analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not capture events before initAnalytics has run", () => {
    trackEvent("demo_started");
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("initializes posthog once with the given key/host", () => {
    initAnalytics("phc_test_key", "https://app.posthog.com");
    initAnalytics("phc_other_key", "https://app.posthog.com");
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({ api_host: "https://app.posthog.com" }),
    );
  });

  it("forwards trackEvent to posthog.capture once initialized", () => {
    trackEvent("booking_rescheduled", { booking_id: "b1" });
    expect(posthog.capture).toHaveBeenCalledWith("booking_rescheduled", { booking_id: "b1" });
  });

  it("forwards identifyUser to posthog.identify once initialized", () => {
    identifyUser("user-1", { plan: "starter" });
    expect(posthog.identify).toHaveBeenCalledWith("user-1", { plan: "starter" });
  });
});
