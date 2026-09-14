"use client";

import { ENTRANCE_STAGGER_MS, MOTION_DURATIONS_MS, VerticalIcon } from "@heyloo/ui";
import { ArrowRight } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { Reveal } from "@/components/marketing/reveal";
import { VERTICAL_CONTENT, type VerticalContent } from "@/content/marketing/verticals";
import { Link } from "@/i18n/navigation";

/** Icon shifts at most this many px opposite the cursor within a card (DESIGN BRIEF §2: "≤4px"). */
const PARALLAX_PX = 4;

/**
 * Business-type grid (DESIGN BRIEF: "business-type grid with VerticalIcon
 * and one outcome line each"). `generic` ("Any Service Business") is kept
 * last as the catch-all rather than dropped — it's a real signup path.
 *
 * Motion (DESIGN BRIEF §2, "Business types"): a staggered fade/slide-up
 * entrance the first time the grid enters view (~40ms stagger, 200ms
 * each), plus a subtle desktop-only pointer-parallax on each card's icon
 * (≤4px, opposite the cursor, scoped to the card's own bounds — never a
 * page-wide parallax). Both are no-ops under `prefers-reduced-motion` or
 * on touch devices (no `pointer: fine`, so no `mousemove`).
 */
export function VerticalGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {VERTICAL_CONTENT.map((vertical, index) => (
        <VerticalCard key={vertical.slug} vertical={vertical} index={index} />
      ))}
    </div>
  );
}

function VerticalCard({ vertical, index }: { vertical: VerticalContent; index: number }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  function handleMouseMove(event: MouseEvent<HTMLAnchorElement>) {
    if (typeof window === "undefined") return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const relX = (event.clientX - bounds.left) / bounds.width - 0.5;
    const relY = (event.clientY - bounds.top) / bounds.height - 0.5;
    setOffset({ x: -relX * PARALLAX_PX * 2, y: -relY * PARALLAX_PX * 2 });
  }

  function resetOffset() {
    setOffset({ x: 0, y: 0 });
  }

  return (
    <Reveal
      delayMs={index * ENTRANCE_STAGGER_MS.grid}
      durationMs={MOTION_DURATIONS_MS.base}
      translateY={8}
      threshold={0.1}
    >
      <Link
        href={`/${vertical.slug}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={resetOffset}
        className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left shadow-xs transition-[border-color,box-shadow,transform] duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span
          className="flex size-10 items-center justify-center rounded-lg bg-secondary text-foreground transition-transform duration-150 ease-(--ease-out)"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          <VerticalIcon vertical={vertical.vertical} className="size-5" />
        </span>
        <div className="space-y-1">
          <p className="text-small font-semibold">{vertical.displayName}</p>
          <p className="text-small text-pretty text-muted-foreground line-clamp-2">
            {vertical.heroStat}
          </p>
        </div>
        <span
          // text-accent-text, not text-primary: normal-weight text at the
          // base accent-500 falls below WCAG AA's 4.5:1 (DESIGN-4).
          className="mt-auto inline-flex items-center gap-1 text-small font-medium text-accent-text opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          See what it handles
          <ArrowRight className="size-3.5" />
        </span>
      </Link>
    </Reveal>
  );
}
