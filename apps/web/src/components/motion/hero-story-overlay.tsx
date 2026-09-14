"use client";

import { cn } from "@heyloo/ui";
import { Calendar, Check, Phone, Wrench } from "lucide-react";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import {
  HERO_CALL_BOOKING,
  HERO_CALL_BUSINESS_NAME,
  HERO_CALL_TOOL_CALL,
  HERO_CALL_TURNS,
} from "@/content/marketing/hero-call";
import {
  HERO_STAGE_RANGES,
  type HeroStage,
  type HeroStageRange,
  resolveHeroStage,
} from "./hero-story";

/**
 * SITE REPAIR blocker (2nd review, 2026-09-14): the pinned WebGL hero
 * rendered ONLY the abstract `THREE.Line` morph — no disclosure text, no
 * transcript, no tool-call badge, no booking card, no dashboard row ever
 * appeared inside the pin on a qualifying device, even though
 * `morph-geometry.ts`'s own comment always described a "DOM transcript
 * layer [that] does its own animation on top." This is that layer: the
 * real-content overlay composited over the WebGL canvas
 * (`hero-scroll-scene.tsx`'s `HeroScrollSceneVisual`), telling the same
 * "call rings → AI answers (disclosure) → caller books → card lands in
 * the dashboard" story the non-qualifying tier's `LiveCallHero` already
 * tells — same copy (`content/marketing/hero-call.ts`), same visual
 * language (transcript bubbles, font-mono tool-call badge, a booking
 * card, a dashboard row), just driven by scroll progress instead of a
 * timer.
 *
 * Four panels, one per `hero-story.ts` stage, stacked absolutely and
 * cross-faded at the exact stage boundaries `resolveHeroStage` already
 * defines — never a second, independently-authored set of boundaries.
 * Decorative throughout (`aria-hidden`, same as `LiveCallHero`): the
 * surrounding hero headline/subhead carry the real message for assistive
 * tech, matching WEBSITE_CREATIVE_BRIEF.md §3's "headline, subhead, CTAs
 * ... are DOM text throughout the pin" — this overlay is the visual, not
 * the content of record.
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

/** How much of `progress` (0-1, whole-timeline units) a crossfade spans, centered on each stage boundary. */
const CROSSFADE_WIDTH = 0.035;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Continuous 0-1 opacity for one stage's panel: 0 outside its range, 1
 * through its middle, ramped across `CROSSFADE_WIDTH` at each internal
 * edge — the scroll-linked cross-fade the SITE REPAIR finding asked for,
 * computed directly from raw progress so it scrubs correctly in both
 * directions. `isFirst`/`isLast` suppress the ramp at the very edge of
 * the whole timeline (progress 0/1): there is no preceding/following
 * panel to cross-fade with there, so the first panel starts at opacity 1
 * (not a half-faded 0.5) and the last panel ends at opacity 1 (not
 * faded toward a stage that doesn't exist).
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
  if (progress < start - fadeInWidth || progress > end + fadeOutWidth) return 0;
  if (fadeInWidth > 0 && progress < start + fadeInWidth) {
    return clamp01((progress - (start - fadeInWidth)) / (2 * fadeInWidth));
  }
  if (fadeOutWidth > 0 && progress > end - fadeOutWidth) {
    return clamp01((end + fadeOutWidth - progress) / (2 * fadeOutWidth));
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

    const intersectionObserver =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              const intersecting = entries[0]?.isIntersecting ?? true;
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
          )
        : undefined;
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

      {/* K1 "answer" — the AI answers (compiled-in disclosure in the 2nd turn), transcript turns build, the tool-call badge appears while it checks availability. TranscriptViewer-styled: speaker-colored bubbles, font-mono tool badge. */}
      <div
        ref={answerRef}
        data-hero-stage="answer"
        className="absolute inset-0 flex items-center justify-center opacity-0"
      >
        <div className="flex w-full max-w-sm flex-col rounded-2xl border border-border bg-card p-4 shadow-lg">
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

      {/* K2 "book" — the transcript folds into a booking card, its fields assembling one at a time (PriceCard/StatusBadge-styled: a card with a status pill). */}
      <div
        ref={bookRef}
        data-hero-stage="book"
        className="absolute inset-0 flex items-center justify-center opacity-0"
      >
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-lg">
          <p className="mb-3 border-b border-border pb-3 text-small font-medium">New booking</p>
          <div className="flex items-start justify-between gap-2">
            <div
              className={cn(
                "flex items-start gap-2 transition-opacity duration-300",
                frame.bookFieldsShown >= 1 ? "opacity-100" : "opacity-0",
              )}
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <Calendar className="size-3.5" />
              </span>
              <div>
                <p className="text-small font-medium">{HERO_CALL_BOOKING.vehicle}</p>
                <p className="text-micro text-muted-foreground">{HERO_CALL_BOOKING.service}</p>
              </div>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-micro font-medium text-success transition-opacity duration-300",
                frame.bookFieldsShown >= 2 ? "opacity-100" : "opacity-0",
              )}
            >
              <Check className="size-3" />
              Confirmed
            </span>
          </div>
          <p
            className={cn(
              "mt-2 font-mono text-micro text-muted-foreground transition-opacity duration-300",
              frame.bookFieldsShown >= 3 ? "opacity-100" : "opacity-0",
            )}
          >
            {HERO_CALL_BOOKING.time}
          </p>
        </div>
      </div>

      {/* K3 "land" — the same card, flattened into a dashboard row (CallFeedItem-styled): it has landed in the live dashboard. */}
      <div
        ref={landRef}
        data-hero-stage="land"
        className="absolute inset-0 flex items-center justify-center opacity-0"
      >
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-4 shadow-md">
          <p className="mb-3 border-b border-border pb-3 text-small font-medium">Today</p>
          <div className="flex items-center justify-between gap-3 rounded-md bg-card p-2 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-secondary">
                <Phone className="size-4" />
              </span>
              <div>
                <p className="text-small font-medium">{HERO_CALL_BUSINESS_NAME}</p>
                <p className="text-micro text-muted-foreground">{HERO_CALL_BOOKING.time}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-micro font-medium text-success">
              <Check className="size-3" />
              New booking
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
