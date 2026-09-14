"use client";

import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { getMorphPoints } from "./morph-geometry";
import { readCssColor } from "./read-css-color";

export interface HeroMorphCanvas2dProps {
  /**
   * 0-1 scroll/play progress, read every animation frame via a ref
   * (never React state — WEBSITE_CREATIVE_BRIEF.md §3) — the caller
   * drives this with `usePlayOnceProgress` (mobile/non-qualifying tier)
   * or `useScrollProgress` (any other tier that still wants the
   * Canvas2D renderer instead of WebGL).
   */
  progressRef: RefObject<number>;
  className?: string;
  /** Design-token CSS custom property for the line's stroke color (`read-css-color.ts`). */
  strokeColorVar?: string;
}

const AUTHORED_WIDTH = 2.4; // the morph geometry's authored space spans roughly x:[-1.1, 1.1]
const AUTHORED_HEIGHT = 1.0;
const MAX_DPR = 2;

/**
 * The Canvas2D `path`-drawing procedural fallback for the hero's
 * flagship morph object (WEBSITE_CREATIVE_BRIEF.md §3/§5 asset #1:
 * "Procedural fallback: same authored data, rendered via Canvas 2D path
 * drawing instead of three.js, for mobile/non-qualifying tiers"). Reads
 * the exact same `getMorphPoints` data `hero-morph-scene.tsx` (the WebGL
 * tier) renders, so both tiers tell the identical story, just at
 * different fidelity.
 *
 * Pauses its own draw loop whenever the canvas leaves the viewport
 * (`IntersectionObserver`) — the same GPU/battery discipline
 * `hero-morph-scene.tsx` applies to the WebGL tier (§6 step 8), scaled
 * down to what a 2D canvas actually needs.
 */
export function HeroMorphCanvas2d({
  progressRef,
  className,
  strokeColorVar = "--accent-500",
}: HeroMorphCanvas2dProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const strokeStyle = readCssColor(strokeColorVar);
    let rafId: number | undefined;
    let visible = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
    resizeObserver?.observe(canvas);

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const { width, height } = rect;
      ctx.clearRect(0, 0, width, height);

      const scaleX = width / AUTHORED_WIDTH;
      const scaleY = Math.min(height / AUTHORED_HEIGHT, scaleX);
      const cx = width / 2;
      const cy = height / 2;

      const points = getMorphPoints(progressRef.current);

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = strokeStyle;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        const px = cx + x * scaleX;
        const py = cy - y * scaleY;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      rafId = visible ? requestAnimationFrame(draw) : undefined;
    };

    const intersectionObserver =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              visible = entries[0]?.isIntersecting ?? true;
              if (visible && rafId === undefined) rafId = requestAnimationFrame(draw);
            },
            { threshold: 0 },
          )
        : undefined;
    intersectionObserver?.observe(canvas);

    rafId = requestAnimationFrame(draw);

    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
    };
  }, [progressRef, strokeColorVar]);

  return (
    <div className={className} aria-hidden="true">
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
