"use client";

import { cn } from "@heyloo/ui";
import { Calendar, Check, Mic, Phone, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, useInView } from "@/lib/marketing/use-in-view";

interface Turn {
  speaker: "caller" | "ai";
  text: string;
}

const TURNS: Turn[] = [
  { speaker: "caller", text: "Hi — my check engine light just came on, can someone look at it?" },
  {
    speaker: "ai",
    text: "This is Riverside Auto's AI receptionist — this call is recorded. I can get that booked. What's the year, make, and model?",
  },
  { speaker: "caller", text: "2019 Honda Civic." },
  { speaker: "ai", text: "Got it — one moment while I check tomorrow's bay availability." },
  { speaker: "ai", text: "We have 10:30 tomorrow morning open. Want me to hold that for you?" },
  { speaker: "caller", text: "Yes, please — that works." },
];

// One index per visible frame of the story: how many transcript turns are
// shown, whether the tool-call badge is up, and whether the booking has
// landed in the mini dashboard — a hand-authored storyboard, not real call
// data (DESIGN BRIEF: "a hero component that shows a live-feeling call").
// This is the interim/fallback tier for the flagship hero set piece
// (DESIGN BRIEF §3): the full pinned WebGL waveform→handset→transcript→
// card→row morph is the ENGINE cluster's deliverable (three/r3f/drei/gsap
// — new deps out of this cluster's ownership); until it ships, this DOM/
// CSS storyboard IS the shown experience on every tier, already matching
// the brief's own described mobile/reduced-tier fallback content model —
// see docs/audit/SITE_REQUESTS.md for the swap-in contract.
const FRAMES: { turns: number; tool: boolean; booking: boolean }[] = [
  { turns: 1, tool: false, booking: false },
  { turns: 2, tool: false, booking: false },
  { turns: 3, tool: false, booking: false },
  { turns: 3, tool: true, booking: false },
  { turns: 4, tool: true, booking: false },
  { turns: 5, tool: true, booking: false },
  { turns: 6, tool: true, booking: true },
];

const FRAME_MS = 1500;

/**
 * The hero product visual (DESIGN BRIEF): a call transcript animating in
 * turn by turn, a tool-call badge while the agent checks availability, and
 * a booking card dropping into a mini dashboard panel — all storyboarded
 * client state + CSS transitions, no external asset, no real call. Purely
 * decorative/demonstrative: `aria-hidden` on the animated internals, the
 * surrounding hero copy (h1 + subhead) carries the real message for
 * assistive tech.
 *
 * Motion (DESIGN BRIEF §2, "Hero"): plays ONCE as the hero scrolls into
 * view, then holds on the final (booking-confirmed) frame — "a perpetual
 * background loop is exactly the kind of motion-for-its-own-sake the
 * standard forbids ... it should play its story once and rest." Reduced
 * motion renders the resolved final frame immediately, matching the
 * brief's hero-specific reduced-motion rule: "show the outcome, skip the
 * journey" — no interval ever starts.
 */
export function LiveCallHero() {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.3 });
  const [frame, setFrame] = useState(() => (prefersReducedMotion() ? FRAMES.length - 1 : 0));
  const startedRef = useRef(false);

  useEffect(() => {
    // Reduced motion already rendered the resolved final frame from the
    // lazy initial state above — nothing to start, and no `setFrame` call
    // belongs here for that case.
    if (!inView || startedRef.current || prefersReducedMotion()) return;
    startedRef.current = true;

    let index = 0;
    const id = setInterval(() => {
      index += 1;
      if (index >= FRAMES.length - 1) {
        setFrame(FRAMES.length - 1);
        clearInterval(id);
        return;
      }
      setFrame(index);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [inView]);

  const { turns, tool, booking } = FRAMES[Math.min(frame, FRAMES.length - 1)] as (typeof FRAMES)[number];
  const visibleTurns = TURNS.slice(0, turns);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 sm:items-stretch sm:gap-5"
    >
      {/* Scoped keyframe for the turn-by-turn reveal — arbitrary Tailwind
          `animate-[...]` values need the @keyframes rule to exist on the
          page; kept local to this component rather than the shared
          stylesheet (packages/ui/theme/globals.css is out of this
          cluster's ownership). */}
      <style>{`
        @keyframes heyloo-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Call panel */}
      <div className="flex min-h-[19rem] flex-col rounded-2xl border border-border bg-card p-4 shadow-lg sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
              <Phone className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-small font-medium">Riverside Auto Repair</p>
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

        <div className="flex-1 space-y-2.5 overflow-hidden py-3">
          {visibleTurns.map((turn, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, hand-authored storyboard (TURNS never reorders/filters), index is a stable identity here
              key={`turn-${i}`}
              className={cn(
                "flex animate-[heyloo-fade-up_0.35s_var(--ease-out)_backwards]",
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
          {tool && (
            <div className="flex animate-[heyloo-fade-up_0.35s_var(--ease-out)_backwards] justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-micro font-mono text-muted-foreground">
                <Wrench className="size-3" />
                check_availability()
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Mini dashboard panel */}
      <div className="flex min-h-[19rem] flex-col rounded-2xl border border-border bg-surface p-4 shadow-md sm:p-5">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <p className="text-small font-medium">Today</p>
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="size-1.5 rounded-full bg-border" />
            <span className="size-1.5 rounded-full bg-border" />
            <span className="size-1.5 rounded-full bg-border" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 py-4">
          <div>
            <p className="text-micro uppercase tracking-wide text-muted-foreground">
              Calls answered
            </p>
            <p className="font-mono text-h3 font-semibold tabular-nums">14</p>
          </div>
          <div>
            <p className="text-micro uppercase tracking-wide text-muted-foreground">
              Bookings today
            </p>
            <p className="font-mono text-h3 font-semibold tabular-nums">{booking ? 5 : 4}</p>
          </div>
        </div>

        <div className="flex-1 border-t border-border pt-3">
          <p className="mb-2 text-micro font-medium uppercase tracking-wide text-muted-foreground">
            Latest booking
          </p>
          {booking ? (
            <div className="animate-[heyloo-fade-up_0.4s_var(--ease-out)_backwards] rounded-lg border border-border bg-card p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                    <Calendar className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-small font-medium">2019 Honda Civic</p>
                    <p className="text-micro text-muted-foreground">Check engine diagnostic</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-micro font-medium text-success">
                  <Check className="size-3" />
                  Confirmed
                </span>
              </div>
              <p className="mt-2 font-mono text-micro text-muted-foreground">Tomorrow · 10:30 AM</p>
            </div>
          ) : (
            <div className="flex h-[4.75rem] items-center gap-2 rounded-lg border border-dashed border-border p-3 text-micro text-muted-foreground">
              <Mic className="size-3.5 shrink-0" />
              Waiting on the call to finish booking…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
