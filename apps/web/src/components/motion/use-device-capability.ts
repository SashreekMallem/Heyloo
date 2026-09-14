"use client";

import { useState } from "react";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";

export type DeviceTier = "webgl" | "canvas2d";

export interface DeviceCapability {
  /** Which visual tier a set piece should render. */
  tier: DeviceTier;
  /**
   * `false` until the client-side probe has run once. Every set piece
   * must render `tier: "canvas2d"`'s composition (or better: the
   * reduced-motion static frame) as its synchronous default so there is
   * always something correct on screen before this flips — never gate
   * first paint on `ready`.
   */
  ready: boolean;
}

/** Exported so `hero-scroll-scene.tsx`'s CSS-only space reservation (see its own comment on why this gate can't be JS-driven) mirrors this exact breakpoint. */
export const MIN_QUALIFYING_WIDTH = 768;
const MIN_DEVICE_MEMORY_GB = 4;

interface NavigatorWithHeuristics extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

function probeWebglContext(): boolean {
  if (typeof document === "undefined") return false;
  try {
    // A throwaway canvas, discarded immediately — never the real hero
    // canvas, so a failed probe never leaves stray DOM
    // (WEBSITE_CREATIVE_BRIEF.md §6, load-strategy step 4).
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    return gl != null;
  } catch {
    return false;
  }
}

/**
 * The five-part device-qualification gate from
 * WEBSITE_CREATIVE_BRIEF.md §6, load-strategy step 4 — ALL must pass for
 * the WebGL tier; failing any one falls back to the `canvas2d` tier
 * silently (no error state). Each check is written to "pass open" where
 * the brief says an API is optional/Chromium-only
 * (`navigator.deviceMemory`), never "fail closed" on an absent API.
 */
function qualifiesForWebgl(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  if (window.innerWidth < MIN_QUALIFYING_WIDTH) return false;
  if (!probeWebglContext()) return false;

  const nav = navigator as NavigatorWithHeuristics;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < MIN_DEVICE_MEMORY_GB) return false;
  if (nav.connection?.saveData === true) return false;

  return true;
}

/**
 * Runs the device-qualification gate once on mount (client-only — SSR
 * has no `window`/`navigator`/canvas to probe) and reports which visual
 * tier a set piece should render. See `qualifiesForWebgl` for the exact
 * checks; see `hero-scroll-scene.tsx` for how `useReducedMotion` is checked
 * separately, first, ahead of this.
 *
 * Resolves via `useIsomorphicLayoutEffect` (before the browser's own next
 * paint) rather than a plain `useEffect` (after it) — cheap insurance
 * against an unnecessary extra re-render on a pure client-side mount.
 * That said, `hero-scroll-scene.tsx`'s CLS fix does NOT rely on this
 * timing: on a real SSR'd page load the browser paints the server-
 * rendered HTML (necessarily computed with `ready: false`, since SSR has
 * no `window`) before ANY client JS — including this hook's effect —
 * has run at all, so "resolve before the browser's next paint" cannot
 * retroactively change what already painted first. Confirmed empirically
 * (a real Playwright run measuring actual `layout-shift` entries): a
 * JS/state-driven reservation here still produces a large, real shift
 * once hydration completes and this resolves to `qualifies: true` a
 * couple seconds later, regardless of which effect hook is used — see
 * `hero-scroll-scene.tsx`'s own comment for the CSS-only fix that
 * actually closes this gap.
 */
export function useDeviceCapability(): DeviceCapability {
  const [capability, setCapability] = useState<DeviceCapability>({
    tier: "canvas2d",
    ready: false,
  });

  useIsomorphicLayoutEffect(() => {
    setCapability({ tier: qualifiesForWebgl() ? "webgl" : "canvas2d", ready: true });
  }, []);

  return capability;
}
