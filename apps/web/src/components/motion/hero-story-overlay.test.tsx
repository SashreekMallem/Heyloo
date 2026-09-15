import { act, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HERO_CALL_BOOKING,
  HERO_CALL_TOOL_CALL,
  HERO_CALL_TURNS,
} from "@/content/marketing/hero-call";
import { HERO_FILM_CARD_RECT } from "./hero-film-frames";
import { HeroStoryOverlay } from "./hero-story-overlay";

/** Mirrors `hero-morph-canvas2d.test.tsx`'s own helper for the same `RefObject<number>` prop shape. */
function progressRefOf(value: number): RefObject<number> {
  return { current: value };
}

/** Mirrors `use-play-once-progress.test.ts`'s helper — captures the callback so a test can fire it manually. */
function stubIntersectionObserver() {
  class FakeIntersectionObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
}

function stubRaf() {
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    id += 1;
    callbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    callbacks.delete(handle);
  });
  return {
    /** Runs every callback queued as of this call, once — mirrors one animation frame. */
    tick() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const cb of pending) cb(performance.now());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HeroStoryOverlay", () => {
  it("renders every story panel's real content up front — the verbatim AI disclosure, the tool-call badge, the booking fields, and the dashboard row — never just an abstract shape", () => {
    stubIntersectionObserver();
    stubRaf();
    const progressRef = progressRefOf(1);

    render(<HeroStoryOverlay progressRef={progressRef} />);

    // The compiled-in AI + recording disclosure (CLAUDE.md Rule 2) —
    // verbatim, not paraphrased.
    expect(
      screen.getByText((HERO_CALL_TURNS[1] as (typeof HERO_CALL_TURNS)[number]).text),
    ).toBeInTheDocument();
    expect(screen.getByText(HERO_CALL_TOOL_CALL)).toBeInTheDocument();
    expect(screen.getByText(HERO_CALL_BOOKING.vehicle)).toBeInTheDocument();
    expect(screen.getByText(HERO_CALL_BOOKING.service)).toBeInTheDocument();
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("New booking").length).toBeGreaterThan(0);
    expect(screen.getByText("Incoming call…")).toBeInTheDocument();
  });

  it("is entirely decorative — aria-hidden, so assistive tech relies on the DOM headline/subhead siblings instead", () => {
    stubIntersectionObserver();
    stubRaf();
    const progressRef = progressRefOf(0);

    const { container } = render(<HeroStoryOverlay progressRef={progressRef} />);
    // eslint-disable-next-line testing-library/no-node-access -- the element under test is aria-hidden by design (the test's own point), so it's excluded from every role-based Testing-Library query
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("cross-fades panels in and out at hero-story.ts's exact stage boundaries as scroll progress advances, and reveals transcript/booking content progressively within a stage", () => {
    stubIntersectionObserver();
    const raf = stubRaf();
    const progressRef = progressRefOf(0);

    render(<HeroStoryOverlay progressRef={progressRef} />);
    // eslint-disable-next-line testing-library/no-node-access -- these panels are aria-hidden decorative elements distinguished only by a data-attribute, not by role/text
    const ring = document.querySelector<HTMLDivElement>('[data-hero-stage="ring"]');
    // eslint-disable-next-line testing-library/no-node-access -- these panels are aria-hidden decorative elements distinguished only by a data-attribute, not by role/text
    const answer = document.querySelector<HTMLDivElement>('[data-hero-stage="answer"]');
    // eslint-disable-next-line testing-library/no-node-access -- these panels are aria-hidden decorative elements distinguished only by a data-attribute, not by role/text
    const book = document.querySelector<HTMLDivElement>('[data-hero-stage="book"]');
    // eslint-disable-next-line testing-library/no-node-access -- these panels are aria-hidden decorative elements distinguished only by a data-attribute, not by role/text
    const land = document.querySelector<HTMLDivElement>('[data-hero-stage="land"]');
    expect(ring && answer && book && land).toBeTruthy();

    // Deep in the "ring" stage: only the ring panel is visible.
    act(() => raf.tick());
    expect(Number(ring?.style.opacity)).toBeCloseTo(1);
    expect(Number(answer?.style.opacity)).toBeCloseTo(0);

    // Mid "answer" stage (0.2-0.55): the transcript panel is fully
    // visible, the ring panel has faded out, and only the turns/tool
    // badge that stage progress has reached so far are shown.
    progressRef.current = 0.3;
    act(() => raf.tick());
    expect(Number(answer?.style.opacity)).toBeCloseTo(1);
    expect(Number(ring?.style.opacity)).toBeCloseTo(0);
    expect(
      screen.queryByText((HERO_CALL_TURNS.at(-1) as (typeof HERO_CALL_TURNS)[number]).text),
    ).not.toBeInTheDocument();

    // End of "answer": every turn and the tool badge are visible.
    progressRef.current = 0.54;
    act(() => raf.tick());
    expect(
      screen.getByText((HERO_CALL_TURNS.at(-1) as (typeof HERO_CALL_TURNS)[number]).text),
    ).toBeInTheDocument();

    // Mid "book" stage (0.55-0.8): the booking card panel is visible,
    // the transcript panel has faded out.
    progressRef.current = 0.68;
    act(() => raf.tick());
    expect(Number(book?.style.opacity)).toBeCloseTo(1);
    expect(Number(answer?.style.opacity)).toBeCloseTo(0);

    // Deep "land" stage (0.8-1): the dashboard-row panel is visible, the
    // booking-card panel has faded out.
    progressRef.current = 0.95;
    act(() => raf.tick());
    expect(Number(land?.style.opacity)).toBeCloseTo(1);
    expect(Number(book?.style.opacity)).toBeCloseTo(0);
  });

  it("SITE REPAIR regression (5th pass, 48/100 review): never puts two adjacent panels at simultaneous nonzero opacity across any of the 3 stage boundaries — the double-exposed-text bug a 1%-granularity scroll sweep caught", () => {
    stubIntersectionObserver();
    const raf = stubRaf();
    const progressRef = progressRefOf(0);

    render(<HeroStoryOverlay progressRef={progressRef} />);
    const panels = (["ring", "answer", "book", "land"] as const).map((stage) =>
      // eslint-disable-next-line testing-library/no-node-access -- these panels are aria-hidden decorative elements distinguished only by a data-attribute, not by role/text
      document.querySelector<HTMLDivElement>(`[data-hero-stage="${stage}"]`),
    );
    expect(panels.every(Boolean)).toBe(true);

    // Sweep every stage boundary (0.2, 0.55, 0.8) at 1% granularity, ±5%
    // either side — the same resolution the review's own repro used —
    // and assert at most one panel ever reads a nonzero opacity at once.
    const boundaries = [0.2, 0.55, 0.8];
    for (const boundary of boundaries) {
      for (let offset = -0.05; offset <= 0.05; offset += 0.01) {
        const progress = Math.min(1, Math.max(0, boundary + offset));
        progressRef.current = progress;
        act(() => raf.tick());
        const visibleCount = panels.filter((panel) => Number(panel?.style.opacity) > 0).length;
        expect(visibleCount, `progress=${progress.toFixed(3)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("positions the 'book' and 'land' panels at HERO_FILM_CARD_RECT (light theme, the default) — the exact rect the film's white card settles into — and identically to each other", () => {
    stubIntersectionObserver();
    stubRaf();
    const progressRef = progressRefOf(0.68);

    render(<HeroStoryOverlay progressRef={progressRef} />);
    // eslint-disable-next-line testing-library/no-node-access -- these panels are aria-hidden decorative elements distinguished only by a data-attribute, not by role/text
    const book = document.querySelector<HTMLDivElement>('[data-hero-stage="book"]');
    // eslint-disable-next-line testing-library/no-node-access -- these panels are aria-hidden decorative elements distinguished only by a data-attribute, not by role/text
    const land = document.querySelector<HTMLDivElement>('[data-hero-stage="land"]');

    const rect = HERO_FILM_CARD_RECT.light;
    expect(book?.style.left).toBe(`${rect.x0 * 100}%`);
    expect(book?.style.top).toBe(`${rect.y0 * 100}%`);
    expect(book?.style.width).toBe(`${(rect.x1 - rect.x0) * 100}%`);
    expect(book?.style.height).toBe(`${(rect.y1 - rect.y0) * 100}%`);
    // "book" and "land" share the identical rect — the film's card holds
    // still across both stages, so the DOM panel must too.
    expect(land?.style.left).toBe(book?.style.left);
    expect(land?.style.top).toBe(book?.style.top);
    expect(land?.style.width).toBe(book?.style.width);
    expect(land?.style.height).toBe(book?.style.height);
  });

  it("uses the dark theme's own (different) measured rect when data-theme is dark", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    stubIntersectionObserver();
    stubRaf();
    const progressRef = progressRefOf(0.68);

    render(<HeroStoryOverlay progressRef={progressRef} />);
    // eslint-disable-next-line testing-library/no-node-access -- decorative element, no role/text query equivalent
    const book = document.querySelector<HTMLDivElement>('[data-hero-stage="book"]');
    const rect = HERO_FILM_CARD_RECT.dark;
    expect(book?.style.left).toBe(`${rect.x0 * 100}%`);
    expect(book?.style.width).toBe(`${(rect.x1 - rect.x0) * 100}%`);

    document.documentElement.removeAttribute("data-theme");
  });

  it("floats the 'answer' panel near the top-right, not centred over the whole box", () => {
    stubIntersectionObserver();
    stubRaf();
    const progressRef = progressRefOf(0.3);

    render(<HeroStoryOverlay progressRef={progressRef} />);
    // eslint-disable-next-line testing-library/no-node-access -- decorative element, no role/text query equivalent
    const answer = document.querySelector<HTMLDivElement>('[data-hero-stage="answer"]');
    expect(answer?.className).not.toContain("inset-0");
    expect(answer?.className).toContain("top-");
    expect(answer?.className).toContain("right-");
  });

  it("never renders the debug rect outline unless window.__heylooScrollDebug is set", () => {
    stubIntersectionObserver();
    stubRaf();
    const progressRef = progressRefOf(0.5);

    const { rerender } = render(<HeroStoryOverlay progressRef={progressRef} />);
    // eslint-disable-next-line testing-library/no-node-access -- the debug rect is aria-hidden decorative markup, distinguished only by a data-attribute, with no role/text to query by
    expect(document.querySelector('[data-hero-debug="card-rect"]')).not.toBeInTheDocument();

    (window as unknown as { __heylooScrollDebug?: unknown }).__heylooScrollDebug = { hero: {} };
    rerender(<HeroStoryOverlay progressRef={progressRef} />);
    // eslint-disable-next-line testing-library/no-node-access -- the debug rect is aria-hidden decorative markup, distinguished only by a data-attribute, with no role/text to query by
    expect(document.querySelector('[data-hero-debug="card-rect"]')).toBeInTheDocument();

    (window as unknown as { __heylooScrollDebug?: unknown }).__heylooScrollDebug = undefined;
  });

  it("pauses its per-frame loop when the section scrolls out of view or the tab is hidden (GPU/CPU discipline, mirrors hero-morph-scene.tsx)", () => {
    let lastCallback: IntersectionObserverCallback | null = null;
    class FakeIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        lastCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      thresholds: number[] = [];
    }
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const raf = stubRaf();
    const progressRef = progressRefOf(0.3);

    render(<HeroStoryOverlay progressRef={progressRef} />);
    act(() => raf.tick()); // consume the initial frame queued on mount

    act(() => {
      lastCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        new FakeIntersectionObserver(() => {}) as unknown as IntersectionObserver,
      );
    });

    // eslint-disable-next-line testing-library/no-node-access -- these panels are aria-hidden decorative elements distinguished only by a data-attribute, not by role/text
    const answer = document.querySelector<HTMLDivElement>('[data-hero-stage="answer"]');
    const opacityBeforeChange = answer?.style.opacity;
    // Progress changes, but with the loop paused (offscreen), nothing
    // should re-render the panel's opacity on the next would-be frame.
    progressRef.current = 0.9;
    act(() => raf.tick());
    expect(answer?.style.opacity).toBe(opacityBeforeChange);
  });
});
