"use client";

import { cn } from "@heyloo/ui";
import { Calendar, Check, Phone, Wrench } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import {
  HERO_CALL_BOOKING,
  HERO_CALL_BUSINESS_NAME,
  HERO_CALL_TOOL_CALL,
  HERO_CALL_TURNS,
} from "@/content/marketing/hero-call";
import { HERO_FILM_CARD_RECT } from "./hero-film-frames";
import {
  HERO_STAGE_RANGES,
  type HeroStage,
  type HeroStageRange,
  resolveHeroStage,
} from "./hero-story";
import { useResolvedTheme } from "./use-resolved-theme";

/**
 * SITE REPAIR blocker (2nd review, 2026-09-14; carried forward into the
 * WAVE 2 frame-sequence-film rebuild): the pinned hero visual must never
 * be just an abstract shape — no disclosure text, transcript, tool-call
 * badge, booking card, or dashboard row. This is that layer: the
 * real-content overlay composited over `hero-film-scrubber.tsx`'s canvas
 * (`hero-scroll-scene.tsx`'s `HeroScrollSceneVisual`), telling the same
 * "call rings → AI answers (disclosure) → caller books → card lands in
 * the dashboard" story the non-qualifying tiers already tell — same copy
 * (`content/marketing/hero-call.ts`), same visual language (transcript
 * bubbles, font-mono tool-call badge, a booking card, a dashboard row),
 * just driven by scroll progress instead of a timer.
 *
 * Four panels, one per `hero-story.ts` stage, cross-faded at the exact
 * stage boundaries `resolveHeroStage` already defines — never a second,
 * independently-authored set of boundaries. The "book"/"land" panels are
 * positioned at `HERO_FILM_CARD_RECT` (`hero-film-frames.ts`, per the
 * viewer's resolved theme) — the exact screen rect the film's own white
 * card settles into — so the real DOM card visually lands ON the film's
 * card, the hand-off set piece WEBSITE_CREATIVE_BRIEF.md §3 describes.
 * The "answer" panel instead floats near the phone (top-right) rather
 * than on that rect, since the film hasn't formed the card yet at that
 * stage. Decorative throughout (`aria-hidden`, same as `LiveCallHero`):
 * the surrounding hero headline/subhead carry the real message for
 * assistive tech, matching WEBSITE_CREATIVE_BRIEF.md §3's "headline,
 * subhead, CTAs ... are DOM text throughout the pin" — this overlay is
 * the visual, not the content of record.
 */

export interface HeroStoryOverlayProps {
  /** Same ref `hero-scroll-scene.tsx` feeds `HeroMorphScene` — read every animation frame, never React state, for the continuous cross-fade (WEBSITE_CREATIVE_BRIEF.md §3's "read from ScrollTrigger's own progress value... to avoid re-render cost"). */
  progressRef: RefObject<number>;
  className?: string;
}

/** Looks up one stage's range by name (never by array index, so `HERO_STAGE_RANGES`'s own order can't silently desync this file) — throws if `hero-story.ts` is ever missing a stage, rather than letting every consumer below carry an "possibly undefined" type. */
function requireStageRange(stage: HeroStage): HeroStageRange {
  const range = HERO_STAGE_RANGES.find((candidate) => candidate.stage === stage);
  if (!range) {
    throw new Error(`hero-story.ts's HERO_STAGE_RANGES is missing the "${stage}" stage.`);
  }
  return range;
}

const RING_RANGE = requireStageRange("ring");
const ANSWER_RANGE = requireStageRange("answer");
const BOOK_RANGE = requireStageRange("book");
const LAND_RANGE = requireStageRange("land");

/** Converts a `HERO_FILM_CARD_RECT` entry (0-1 fractions of the 16:9 box) into an absolutely-positioned inline style spanning exactly that rect. */
function rectToStyle(rect: { x0: number; x1: number; y0: number; y1: number }): CSSProperties {
  return {
    left: `${rect.x0 * 100}%`,
    top: `${rect.y0 * 100}%`,
    width: `${(rect.x1 - rect.x0) * 100}%`,
    height: `${(rect.y1 - rect.y0) * 100}%`,
  };
}

interface DebugWindow {
  __heylooScrollDebug?: unknown;
}

/** Dev/test only (mirrors `use-scroll-progress.ts`'s own `debugKey` gate) — lets a Playwright verification script confirm the DOM card panel lands exactly on `HERO_FILM_CARD_RECT`, by drawing that rect's own outline. */
function isScrollDebugActive(): boolean {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return false;
  return Boolean((window as unknown as DebugWindow).__heylooScrollDebug);
}

/** How much of `progress` (0-1, whole-timeline units) a panel's own opacity ramps at each internal edge, entirely WITHIN that panel's own stage range — see `panelOpacity` below. */
const CROSSFADE_WIDTH = 0.035;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * SITE REPAIR blocker (5th pass, 48/100 review): the previous version of
 * this function ramped a panel's fade-OUT and the next panel's fade-IN
 * across the SAME `[boundary - width, boundary + width]` window, so for
 * that whole band BOTH panels sat at simultaneous partial opacity — two
 * differently-labeled text panels double-exposed and illegible, at every
 * one of the three stage boundaries (confirmed by the review's 1%-step
 * scroll sweep). Fixed per the review's own accepted remedy (a): each
 * panel now ramps ENTIRELY INSIDE its own `[start, end]` stage range
 * (fade-in over `[start, start + width]`, fade-out over
 * `[end - width, end]`) instead of straddling the boundary — so the
 * outgoing panel reaches exactly 0 at the same progress value the
 * incoming panel starts from exactly 0. There is no progress value at
 * which two adjacent panels are both > 0 opacity: a hard cut at the
 * boundary itself (both momentarily invisible there), softened by a
 * short, NON-overlapping taper on either side, rather than a shared
 * cross-fade window. `isFirst`/`isLast` suppress the ramp at the very
 * edge of the whole timeline (progress 0/1): there is no preceding/
 * following panel there, so the first panel starts at opacity 1 (not
 * ramping up from 0) and the last panel ends at opacity 1 (not ramping
 * down toward a stage that doesn't exist).
 */
function panelOpacity(
  progress: number,
  start: number,
  end: number,
  isFirst: boolean,
  isLast: boolean,
): number {
  const fadeInWidth = isFirst ? 0 : CROSSFADE_WIDTH;
  const fadeOutWidth = isLast ? 0 : CROSSFADE_WIDTH;
  if (progress < start || progress > end) return 0;
  if (fadeInWidth > 0 && progress < start + fadeInWidth) {
    return clamp01((progress - start) / fadeInWidth);
  }
  if (fadeOutWidth > 0 && progress > end - fadeOutWidth) {
    return clamp01((end - progress) / fadeOutWidth);
  }
  return 1;
}

/** Cumulative transcript-turn count + tool-call-badge visibility, one entry per discrete reveal step within the "answer" stage — same storyboard shape `live-call-hero.tsx`'s `FRAMES` already established. */
const ANSWER_FRAMES: { turns: number; tool: boolean }[] = [
  { turns: 1, tool: false },
  { turns: 2, tool: false },
  { turns: 3, tool: false },
  { turns: 3, tool: true },
  { turns: 4, tool: true },
  { turns: 5, tool: true },
  { turns: HERO_CALL_TURNS.length, tool: true },
];

/** Booking-card fields reveal in 3 discrete steps across the "book" stage: vehicle/service, then the confirmed badge, then the date/time — the card assembling as the finding asked for. */
const BOOK_FIELD_COUNT = 3;

interface OverlayFrame {
  answerStep: number;
  bookFieldsShown: number;
}

function computeFrame(progress: number): OverlayFrame {
  const { stage, stageProgress } = resolveHeroStage(progress);

  const answerStep =
    stage === "ring"
      ? 0
      : stage === "answer"
        ? Math.min(ANSWER_FRAMES.length - 1, Math.floor(stageProgress * ANSWER_FRAMES.length))
        : ANSWER_FRAMES.length - 1;

  const bookFieldsShown =
    stage === "book"
      ? Math.min(BOOK_FIELD_COUNT, Math.round(stageProgress * BOOK_FIELD_COUNT))
      : stage === "land"
        ? BOOK_FIELD_COUNT
        : 0;

  return { answerStep, bookFieldsShown };
}

function framesEqual(a: OverlayFrame, b: OverlayFrame): boolean {
  return a.answerStep === b.answerStep && a.bookFieldsShown === b.bookFieldsShown;
}

export function HeroStoryOverlay({ progressRef, className }: HeroStoryOverlayProps) {
  const theme = useResolvedTheme();
  const cardRect = HERO_FILM_CARD_RECT[theme];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<HTMLDivElement | null>(null);
  const landRef = useRef<HTMLDivElement | null>(null);

  // eslint-disable-next-line react-hooks/refs -- deliberate: seeds initial state from the hero's already-live scroll progress ref so this overlay (mounted after `engaged`) starts on the correct frame instead of always snapping in from frame 0
  const [frame, setFrame] = useState<OverlayFrame>(() => computeFrame(progressRef.current ?? 0));
  const frameRef = useRef(frame);
  // eslint-disable-next-line react-hooks/refs -- deliberate "latest value ref" sync so the rAF loop below can read the current stage frame every tick without re-subscribing on every render
  frameRef.current = frame;

  // Continuous cross-fade, written straight to each panel's own style —
  // deliberately NOT React state (see `HeroMorphLine` in
  // `hero-morph-scene.tsx` for the same "mutate in place every frame"
  // rationale): this runs on every animation frame the section is
  // visible, and a `setState` at that rate would re-render four panels'
  // worth of DOM for no visual benefit over a direct style write.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let rafId: number | undefined;
    let running = true;

    const tick = () => {
      if (!running) return;
      const progress = progressRef.current ?? 0;

      const ring = ringRef.current;
      const answer = answerRef.current;
      const book = bookRef.current;
      const land = landRef.current;
      if (ring) {
        ring.style.opacity = String(
          panelOpacity(progress, RING_RANGE.start, RING_RANGE.end, true, false),
        );
      }
      if (answer) {
        answer.style.opacity = String(
          panelOpacity(progress, ANSWER_RANGE.start, ANSWER_RANGE.end, false, false),
        );
      }
      if (book) {
        book.style.opacity = String(
          panelOpacity(progress, BOOK_RANGE.start, BOOK_RANGE.end, false, false),
        );
      }
      if (land) {
        land.style.opacity = String(
          panelOpacity(progress, LAND_RANGE.start, LAND_RANGE.end, false, true),
        );
      }

      const next = computeFrame(progress);
      if (!framesEqual(next, frameRef.current)) {
        frameRef.current = next;
        setFrame(next);
      }

      rafId = requestAnimationFrame(tick);
    };

    const updateFromVisibility = () => {
      if (document.hidden) {
        running = false;
        if (rafId !== undefined) cancelAnimationFrame(rafId);
      } else if (!running) {
        running = true;
        rafId = requestAnimationFrame(tick);
      }
    };

    let intersectionObserver: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          /**
           * SITE REPAIR blocker (production-build repro, 2026-09-15): GSAP's
           * pin setup (`use-scroll-progress.ts`'s `ScrollTrigger.create({
           * pin: true })`) reparents the pinned element into a spacer
           * wrapper EVEN with `pinSpacing: false` — this container is a
           * descendant of that pinned element, so the reparent briefly
           * detaches it from the document. Per spec (developer.mozilla.org/
           * en-US/docs/Web/API/IntersectionObserverEntry/rootBounds — "If a
           * target element is detached from the document, the
           * IntersectionObserver will still fire callbacks for that
           * target"), a detached target still delivers a callback: a
           * zero-area `boundingClientRect`, `isIntersecting: false`, AND
           * `rootBounds: null`. Confirmed via a live production-build probe
           * (console-logged entries): this fired exactly once, right as
           * `ScrollTrigger.create()` ran, and NOTHING afterward ever
           * restarted the loop — the browser doesn't keep delivering fresh
           * readings for a target it saw detach, even after it's back in
           * the document and genuinely on-screen (confirmed separately: the
           * pin's own `position: fixed` box was correctly on-screen the
           * whole time). Treating that single stale reading as "left the
           * viewport" permanently froze this rAF loop — the reported hero
           * story freeze. `rootBounds: null` while the element is ACTUALLY
           * still `document.contains`-connected (as opposed to a genuine
           * unmount, where the cleanup below already tears this observer
           * down) is exactly that detach-artifact, never a real viewport
           * exit — re-observe instead of trusting it, so the next real
           * reading isn't lost either.
           */
          if (entry && entry.rootBounds === null && document.contains(element)) {
            intersectionObserver?.unobserve(element);
            intersectionObserver?.observe(element);
            return;
          }
          const intersecting = entry?.isIntersecting ?? true;
          if (intersecting && !document.hidden) {
            if (!running) {
              running = true;
              rafId = requestAnimationFrame(tick);
            }
          } else {
            running = false;
            if (rafId !== undefined) cancelAnimationFrame(rafId);
          }
        },
        { threshold: 0 },
      );
    }
    intersectionObserver?.observe(element);
    document.addEventListener("visibilitychange", updateFromVisibility);

    rafId = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", updateFromVisibility);
    };
  }, [progressRef]);

  const visibleTurns = HERO_CALL_TURNS.slice(
    0,
    ANSWER_FRAMES[frame.answerStep]?.turns ?? HERO_CALL_TURNS.length,
  );
  const toolCallVisible = ANSWER_FRAMES[frame.answerStep]?.tool ?? true;

  return (
    <div ref={containerRef} aria-hidden="true" className={cn("pointer-events-none", className)}>
      <style>{`
        @keyframes heyloo-hero-overlay-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* K0 "ring" — the call is coming in, before the AI has answered. Minimal by design: the WebGL waveform-as-handset line is the beat's own visual, this is just a caller-side anchor for it. */}
      <div
        ref={ringRef}
        data-hero-stage="ring"
        className="absolute inset-0 flex items-center justify-center opacity-0"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-small font-medium text-muted-foreground shadow-sm">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-accent-500" />
          </span>
          Incoming call…
        </span>
      </div>

      {/* K1 "answer" — the AI answers (compiled-in disclosure in the 2nd turn), transcript turns build, the tool-call badge appears while it checks availability. Floats top-right of the lifted phone (which stays roughly centred in frame through this stage) rather than centred over it — TranscriptViewer-styled: speaker-colored bubbles, font-mono tool badge. */}
      <div
        ref={answerRef}
        data-hero-stage="answer"
        className="absolute right-[3%] top-[5%] flex w-[85%] max-w-xs justify-end opacity-0 sm:max-w-sm"
      >
        <div className="flex w-full flex-col rounded-2xl border border-border bg-card p-4 shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                <Phone className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-small font-medium">{HERO_CALL_BUSINESS_NAME}</p>
                <p className="text-micro text-muted-foreground">Answered by your AI</p>
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent-100 px-2.5 py-1 text-micro font-medium text-accent-800">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-500 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-accent-500" />
              </span>
              Recording
            </span>
          </div>
          <div className="space-y-2.5 py-3">
            {visibleTurns.map((turn, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed, hand-authored storyboard (HERO_CALL_TURNS never reorders/filters)
                key={`overlay-turn-${i}`}
                className={cn(
                  "flex animate-[heyloo-hero-overlay-fade-up_0.35s_var(--ease-out)_backwards]",
                  turn.speaker === "caller" ? "justify-start" : "justify-end",
                )}
              >
                <p
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-small leading-snug",
                    turn.speaker === "caller"
                      ? "bg-muted text-foreground"
                      : "bg-primary/10 text-foreground",
                  )}
                >
                  {turn.text}
                </p>
              </div>
            ))}
            {toolCallVisible && (
              <div className="flex animate-[heyloo-hero-overlay-fade-up_0.35s_var(--ease-out)_backwards] justify-end">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-micro font-mono text-muted-foreground">
                  <Wrench className="size-3" />
                  {HERO_CALL_TOOL_CALL}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/*
       * K2 "book" — the transcript folds into a booking card, its fields
       * assembling one at a time. Positioned at `HERO_FILM_CARD_RECT`
       * (this viewer's resolved theme) — the exact screen rect the
       * film's own white card occupies — and shaped as a single flat row
       * (not a tall stacked card) to actually fit that rect's real
       * aspect ratio, so the DOM content reads as sitting ON the film's
       * card rather than floating independently over it.
       */}
      <div
        ref={bookRef}
        data-hero-stage="book"
        className="absolute opacity-0"
        style={rectToStyle(cardRect)}
      >
        <div className="flex size-full items-center justify-between gap-2 overflow-hidden rounded-[8%/20%] border border-border bg-card px-3 shadow-lg sm:px-4">
          {/*
           * Each field below is CONDITIONALLY MOUNTED (not just
           * opacity-faded) on its own `bookFieldsShown` threshold — a
           * real defect found by Playwright screenshotting every 10% of
           * scroll progress (`docs/BUILD_NOTES.md`'s GLUE+PERF entry):
           * with all three fields always present in the flex row (only
           * `opacity-0`, still taking up layout width), the not-yet-
           * revealed date/time text + "Confirmed" badge on the right
           * (both `shrink-0`) permanently claimed most of this narrow
           * `HERO_FILM_CARD_RECT` box's width, leaving the vehicle/
           * service label (the one *visible* field) squeezed down to a
           * couple of pixels — it rendered as a single truncated
           * character ("2.", "C.") for the entire book stage, not a
           * `van`-line reveal. Conditional mounting means an unrevealed
           * field claims zero width, so the visible field(s) get the
           * card's full available width, exactly like the "answer"
           * panel's own `visibleTurns.map(...)` above already does for
           * transcript turns — this brings the "book" panel in line with
           * that established pattern instead of diverging from it.
           */}
          {frame.bookFieldsShown >= 1 && (
            <div className="flex min-w-0 animate-[heyloo-hero-overlay-fade-up_0.3s_var(--ease-out)_backwards] items-center gap-1.5 sm:gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success sm:size-6">
                <Calendar className="size-3 sm:size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-micro font-medium sm:text-small">
                  {HERO_CALL_BOOKING.vehicle}
                </p>
                <p className="truncate text-micro text-muted-foreground">
                  {HERO_CALL_BOOKING.service}
                </p>
              </div>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {frame.bookFieldsShown >= 3 && (
              <span className="hidden animate-[heyloo-hero-overlay-fade-up_0.3s_var(--ease-out)_backwards] font-mono text-micro text-muted-foreground sm:inline">
                {HERO_CALL_BOOKING.time}
              </span>
            )}
            {frame.bookFieldsShown >= 2 && (
              <span className="inline-flex animate-[heyloo-hero-overlay-fade-up_0.3s_var(--ease-out)_backwards] items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-micro font-medium text-success sm:px-2">
                <Check className="size-3" />
                Confirmed
              </span>
            )}
          </div>
        </div>
      </div>

      {/*
       * K3 "land" — the same card, flattened into a dashboard row: it
       * has landed in the live dashboard. Sits on the EXACT SAME rect as
       * "book" (the film's card holds still through this whole stage),
       * so this cross-fades in place with no perceptible jump.
       */}
      <div
        ref={landRef}
        data-hero-stage="land"
        className="absolute opacity-0"
        style={rectToStyle(cardRect)}
      >
        <div className="flex size-full items-center justify-between gap-2 overflow-hidden rounded-[8%/20%] border border-border bg-surface px-3 shadow-md sm:px-4">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary sm:size-6">
              <Phone className="size-3 sm:size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-micro font-medium sm:text-small">
                {HERO_CALL_BUSINESS_NAME}
              </p>
              <p className="truncate text-micro text-muted-foreground">{HERO_CALL_BOOKING.time}</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-micro font-medium text-success sm:px-2">
            <Check className="size-3" />
            New booking
          </span>
        </div>
      </div>

      {isScrollDebugActive() && (
        <div
          data-hero-debug="card-rect"
          className="absolute border-2 border-dashed border-red-500"
          style={rectToStyle(cardRect)}
        />
      )}
    </div>
  );
}
