import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetGsapLoaderForTests } from "@/components/motion/gsap-loader";
import { HOME_CONTENT } from "@/content/marketing/home";
import { OwnerPhoneReveal } from "./owner-phone-reveal";

const registerPlugin = vi.fn();
const gsapSet = vi.fn();
const timelineKill = vi.fn();
const timeline = {
  to: vi.fn(() => timeline), // chainable, like the real GSAP timeline
  kill: timelineKill,
};
const gsapTimeline = vi.fn(() => timeline);
const scrollTriggerKill = vi.fn();
const scrollTriggerRefresh = vi.fn();
let lastScrollTriggerConfig: { trigger?: unknown; once?: boolean; onEnter?: () => void } = {};
const scrollTriggerCreate = vi.fn((config: typeof lastScrollTriggerConfig) => {
  lastScrollTriggerConfig = config;
  return { kill: scrollTriggerKill };
});

vi.mock("gsap", () => ({
  gsap: { registerPlugin, set: gsapSet, timeline: gsapTimeline },
}));
vi.mock("gsap/ScrollTrigger", () => ({
  default: { create: scrollTriggerCreate, refresh: scrollTriggerRefresh },
}));

/** `deferUntilInteraction`'s engagement gate — every test that needs the GSAP timeline actually built has to fire this first. */
function dispatchScroll() {
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

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

describe("OwnerPhoneReveal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    __resetGsapLoaderForTests();
  });

  it("renders beat 6's real content — the same booking the dashboard preview shows, from the shared content module", () => {
    stubMatchMedia(false);
    render(<OwnerPhoneReveal />);

    expect(screen.getByText("You find out the moment it happens.")).toBeInTheDocument();
    expect(
      screen.getByText("Delivered by SMS and email — the moment it happens."),
    ).toBeInTheDocument();

    const { booking } = HOME_CONTENT;
    const notificationBody = `${booking.customer} · ${booking.service} · ${booking.day} ${booking.time}`;
    expect(screen.getByText(notificationBody)).toBeInTheDocument();
    expect(screen.getByText("New booking")).toBeInTheDocument();
  });

  it("SITE REPAIR regression guard: does NOT load gsap on mount before any interaction — this component renders unconditionally on the home route, so an unconditional load put GSAP in every passive visitor's initial JS", async () => {
    stubMatchMedia(false);
    render(<OwnerPhoneReveal />);

    // Give any accidental async GSAP load a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollTriggerCreate).not.toHaveBeenCalled();
    expect(gsapTimeline).not.toHaveBeenCalled();
  });

  it("builds a once-only GSAP ScrollTrigger timeline, and refreshes it, once the visitor engages", async () => {
    stubMatchMedia(false);
    render(<OwnerPhoneReveal />);
    dispatchScroll();

    await waitFor(() => expect(scrollTriggerCreate).toHaveBeenCalledTimes(1));
    expect(lastScrollTriggerConfig.once).toBe(true);
    expect(gsapSet).toHaveBeenCalled();
    expect(gsapTimeline).toHaveBeenCalledTimes(1);
    expect(scrollTriggerRefresh).toHaveBeenCalledWith(true);
  });

  it("prefers-reduced-motion: never loads/builds a GSAP timeline — the DOM's default state IS the final composed state", async () => {
    stubMatchMedia(true);
    render(<OwnerPhoneReveal />);

    // Give any accidental async GSAP load a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollTriggerCreate).not.toHaveBeenCalled();
    expect(gsapTimeline).not.toHaveBeenCalled();

    // The content is still fully present and correct — a complete static page.
    expect(screen.getByText("You find out the moment it happens.")).toBeInTheDocument();
    expect(
      screen.getByText("Delivered by SMS and email — the moment it happens."),
    ).toBeInTheDocument();
  });

  it("the phone graphic is decorative — aria-hidden, since the headline/subhead carry the real message", () => {
    stubMatchMedia(false);
    const { container } = render(<OwnerPhoneReveal />);
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the element under test is aria-hidden by design (the test's own point), so it's excluded from every role-based Testing-Library query
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden).toBeInTheDocument();
    expect(hidden).toHaveTextContent("New booking");
  });
});
