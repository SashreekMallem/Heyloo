"use client";

import type { RefObject } from "react";
import { useEffect, useRef } from "react";

export interface UsePlayOnceProgressOptions {
  /** Element to watch for its first entry into the viewport. */
  target: RefObject<HTMLElement | null>;
  /** How long the once-only play runs, in ms. Default 2500. */
  durationMs?: number;
  /** Skip entirely — e.g. the WebGL/pinned-scrub tier owns progress instead. */
  disabled?: boolean;
  /** Called every animation frame while playing, and once more at completion, with 0-1 eased progress. */
  onUpdate?: (progress: number) => void;
  /** `IntersectionObserver` threshold that starts the play-once run. Default 0.3. */
  threshold?: number;
}

const DEFAULT_DURATION_MS = 2500;
const DEFAULT_THRESHOLD = 0.3;

/** Ease-out cubic — visually close to `MOTION_EASES.out` without pulling GSAP into this tier's bundle. */
function easeOutCubic(t: number): number {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

/**
 * Drives `onUpdate(progress)` from 0 to 1 exactly once, starting the
 * moment `target` first crosses `threshold` into view, then holds at 1
 * — the mobile/non-qualifying-device tier's story mechanism
 * (WEBSITE_CREATIVE_BRIEF.md §3: "no pin... plays once as the section
 * scrolls into view, holds on the final frame" — the one deliberate
 * exception §7's checklist carves out from "every set piece's motion is
 * scroll-linked, never scroll-triggered-then-autoplaying").
 *
 * Intentionally has no GSAP dependency (a plain `requestAnimationFrame`
 * loop with a hand-rolled ease) — this is the code path most mobile
 * visitors run, so it stays payload-free even if the desktop/tablet tier
 * never finishes loading `gsap`.
 */
export function usePlayOnceProgress({
  target,
  durationMs = DEFAULT_DURATION_MS,
  disabled = false,
  onUpdate,
  threshold = DEFAULT_THRESHOLD,
}: UsePlayOnceProgressOptions): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (disabled) return;
    const element = target.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    let rafId: number | undefined;
    let played = false;

    const play = () => {
      if (played) return;
      played = true;
      const startedAt = performance.now();

      const tick = (now: number) => {
        const raw = Math.min(1, (now - startedAt) / durationMs);
        onUpdateRef.current?.(easeOutCubic(raw));
        if (raw < 1) {
          rafId = requestAnimationFrame(tick);
        }
      };
      rafId = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) play();
        }
      },
      { threshold },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [target, durationMs, disabled, threshold]);
}
