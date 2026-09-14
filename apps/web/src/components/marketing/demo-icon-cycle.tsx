"use client";

import type { Vertical } from "@heyloo/canonical-types";
import { cn, VerticalIcon } from "@heyloo/ui";
import { useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/lib/marketing/use-in-view";

const CYCLE: Vertical[] = ["auto", "vet", "dental"];
const CYCLE_MS = 600;

/**
 * The demo-CTA `VerticalIcon` (DESIGN BRIEF §2, "Demo CTA"): "a single,
 * slow (600ms) icon-swap crossfade cycling through 2–3 of the eight
 * vertical glyphs on a timer *while off-screen only* ... implies 'built
 * for many kinds of business' without adding a second grid. On enter, it
 * settles on `generic` (current behavior) and stops cycling."
 *
 * `settled` is a plain `useInView` with its default `once: true` — the
 * FIRST time this element ever intersects the viewport, it flips
 * permanently true, exactly matching "settles ... and stops cycling":
 * the cycle never resumes even if scrolled away from again. Before that
 * first entry, the interval only runs while genuinely off-screen (nothing
 * to pause — it hasn't started until then) and is paused (not just
 * ignored) the instant `settled` flips, so it never burns a frame budget
 * unseen.
 */
export function DemoIconCycle({ className }: { className?: string }) {
  const [ref, settled] = useInView<HTMLSpanElement>({ threshold: 0.01 });
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (settled || prefersReducedMotion()) return;

    const id = setInterval(() => {
      setIndex((i) => (i + 1) % CYCLE.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [settled]);

  const vertical: Vertical = settled ? "generic" : (CYCLE[index] ?? "generic");

  return (
    <span
      ref={ref}
      data-testid="demo-icon-cycle"
      className={cn("inline-flex transition-opacity duration-(--duration-fast)", className)}
    >
      <VerticalIcon vertical={vertical} className="size-8 text-primary" />
    </span>
  );
}
