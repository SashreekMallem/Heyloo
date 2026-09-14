"use client";

import { useEffect, useState } from "react";

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

const MIN_QUALIFYING_WIDTH = 768;
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
 */
export function useDeviceCapability(): DeviceCapability {
  const [capability, setCapability] = useState<DeviceCapability>({
    tier: "canvas2d",
    ready: false,
  });

  useEffect(() => {
    setCapability({ tier: qualifiesForWebgl() ? "webgl" : "canvas2d", ready: true });
  }, []);

  return capability;
}
