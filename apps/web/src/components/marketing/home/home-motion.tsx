"use client";

import { useEffect, useLayoutEffect } from "react";
import { applyTierClasses, clearHomeClasses, HOME_CLASSES } from "./runtime/html-classes";

/**
 * The home page's motion boot (SITE-3). Renders nothing. It is the only part
 * of the motion system in the route's initial JS, and it is tiny: it keeps the
 * tier classes on `<html>` (the inline bootstrap already set them for the first
 * paint; this re-asserts them after a client-side navigation, where inline
 * scripts do not run) and waits for a reason to load the runtime.
 *
 * The runtime (gsap, ScrollTrigger, SplitText, Lenis, then three.js for the
 * scene) is a set of lazy chunks that load only after first paint:
 *
 * - on the first sign of a real visitor (pointer, wheel, touch, key, focus,
 *   scroll), or
 * - `IDLE_START_MS` after the window `load` event, for a visitor who only
 *   looks,
 *
 * whichever comes first. Nothing is fetched during load, so LCP, CLS and the
 * initial-JS budget are measured on the text-first page. If the runtime fails
 * to load or to start, the page stays in (or returns to) its static layout.
 */
const IDLE_START_MS = 2500;
const INTENT_EVENTS = [
  "pointermove",
  "pointerdown",
  "wheel",
  "touchstart",
  "keydown",
  "focusin",
  "scroll",
] as const;

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The static layout: what reduced-motion visitors get, and where a failed start lands. */
function fallBackToStatic(root: HTMLElement) {
  root.classList.remove(HOME_CLASSES.fx, HOME_CLASSES.introPre, HOME_CLASSES.glOn);
  root.classList.add(HOME_CLASSES.rm, HOME_CLASSES.glOff);
}

export function HomeMotion() {
  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    applyTierClasses(root);
    return () => clearHomeClasses(root);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let started = false;
    let handle: { destroy(): void } | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const stopWaiting = () => {
      for (const type of INTENT_EVENTS) window.removeEventListener(type, start);
      window.removeEventListener("load", armIdleTimer);
      clearTimeout(idleTimer);
    };

    function start() {
      if (started || cancelled) return;
      started = true;
      stopWaiting();
      import("./runtime/start")
        .then((mod) => mod.startHomeRuntime())
        .then((h) => {
          if (cancelled) h.destroy();
          else handle = h;
        })
        .catch((error: unknown) => {
          console.error("home runtime failed, keeping the static layout", error);
          if (!cancelled) fallBackToStatic(document.documentElement);
        });
    }

    function armIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(start, IDLE_START_MS);
    }

    for (const type of INTENT_EVENTS) window.addEventListener(type, start, { passive: true });
    if (document.readyState === "complete") armIdleTimer();
    else window.addEventListener("load", armIdleTimer, { once: true });

    return () => {
      cancelled = true;
      stopWaiting();
      handle?.destroy();
      handle = null;
    };
  }, []);

  return null;
}
