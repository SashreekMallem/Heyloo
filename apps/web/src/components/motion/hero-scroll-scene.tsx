"use client";

import { HERO_PIN_VH, SCROLL_SCRUB } from "@heyloo/ui";
import dynamic from "next/dynamic";
import type { ReactNode, RefObject } from "react";
import { createContext, useContext, useRef } from "react";
import { LazyWebglBoundary } from "./lazy-webgl-boundary";
import { useDeviceCapability } from "./use-device-capability";
import { useReducedMotion } from "./use-reduced-motion";
import { useScrollProgress } from "./use-scroll-progress";

const HeroMorphScene = dynamic(() => import("@/components/three/hero-morph-scene"), { ssr: false });

const TABLET_MAX_WIDTH = 1024;

interface HeroScrollContextValue {
  progressRef: RefObject<number>;
  qualifies: boolean;
}

const HeroScrollContext = createContext<HeroScrollContextValue | null>(null);

export interface HeroScrollSceneProps {
  /**
   * The WHOLE hero section's content — headline, subhead, CTAs, AND the
   * one visual slot (`<HeroScrollScene.Visual>`) that actually animates.
   * Rendered completely unchanged on every tier that doesn't pin; pinned
   * as one unit on a qualifying device, exactly as authored
   * (WEBSITE_CREATIVE_BRIEF.md §3: "the section pins for ~250vh of
   * scroll... Headline, subhead, CTAs... are DOM text throughout").
   */
  children: ReactNode;
  className?: string;
  /** Pin distance overrides, in vh — default `HERO_PIN_VH` (`@heyloo/ui`). */
  pinVhDesktop?: number;
  pinVhTablet?: number;
  /** Dev/test only — see `use-scroll-progress.ts`'s `debugKey`. Pass `null` to disable. Defaults to `"hero"`. */
  debugKey?: string | null;
}

function HeroScrollSceneImpl({
  children,
  className,
  pinVhDesktop = HERO_PIN_VH.desktop,
  pinVhTablet = HERO_PIN_VH.tablet,
  debugKey = "hero",
}: HeroScrollSceneProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);

  const reducedMotion = useReducedMotion();
  const { tier, ready } = useDeviceCapability();
  const qualifies = ready && !reducedMotion && tier === "webgl";

  const isTablet = typeof window !== "undefined" && window.innerWidth < TABLET_MAX_WIDTH;
  const pinVh = isTablet ? pinVhTablet : pinVhDesktop;

  useScrollProgress({
    target: sectionRef,
    pin: true,
    start: "top top",
    end: `+=${pinVh}%`,
    scrub: SCROLL_SCRUB,
    disabled: !qualifies,
    onUpdate: (progress) => {
      progressRef.current = progress;
    },
    debugKey: qualifies && debugKey ? debugKey : undefined,
  });

  return (
    <HeroScrollContext.Provider value={{ progressRef, qualifies }}>
      <div ref={sectionRef} className={className}>
        {children}
      </div>
    </HeroScrollContext.Provider>
  );
}

export interface HeroScrollVisualProps {
  /**
   * What renders in this slot on every tier that does NOT qualify for
   * the pinned WebGL set piece — `prefers-reduced-motion`, a phone, or
   * any device that fails `useDeviceCapability`'s gate. Rendered
   * completely unchanged: drop in an already-correct existing hero
   * visual as-is, e.g. `<LiveCallHero />`
   * (`components/marketing/live-call-hero.tsx`), which already
   * implements the brief's mobile/reduced-motion/non-qualifying content
   * model end to end (play-once-on-enter, holds on the resolved frame,
   * static under reduced motion) — this slot defers to it entirely on
   * those tiers rather than shipping a second, competing implementation
   * of the same fallback story.
   */
  fallback: ReactNode;
  className?: string;
}

/**
 * The one slot inside `<HeroScrollScene>` that actually changes across
 * the pin: the flagship morph object
 * (`three/hero-morph-scene.tsx`, lazily imported so its bundle never
 * loads for a visitor who won't see it) on a qualifying device,
 * `fallback` everywhere else. Must be rendered inside a
 * `<HeroScrollScene>` — throws otherwise (a loud build-time-adjacent
 * error beats a silently-broken hero in production).
 */
function HeroScrollSceneVisual({ fallback, className }: HeroScrollVisualProps) {
  const context = useContext(HeroScrollContext);
  if (!context) {
    throw new Error("<HeroScrollScene.Visual> must be rendered inside <HeroScrollScene>.");
  }
  const { progressRef, qualifies } = context;

  if (!qualifies) {
    return <div className={className}>{fallback}</div>;
  }

  return (
    <div className={className} style={{ position: "relative" }}>
      <LazyWebglBoundary
        className="absolute inset-0"
        Scene={HeroMorphScene}
        sceneProps={{ progressRef, className: "size-full" }}
        fallback={fallback}
      />
    </div>
  );
}

/**
 * The hero's drop-in WebGL set piece (WEBSITE_CREATIVE_BRIEF.md §3).
 * Pins its `children` — the whole hero section — as one unit on a
 * qualifying device (desktop/tablet, WebGL available, reduced-motion off
 * — `useDeviceCapability`); a no-op passthrough everywhere else. Use
 * `<HeroScrollScene.Visual fallback={...}>` for the one child slot that
 * actually animates:
 *
 * ```tsx
 * <HeroScrollScene className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
 *   <div className="space-y-6 text-center lg:text-left">
 *     <h1>Every call answered. Every booking captured.</h1>
 *     ...subhead, CTAs — unchanged...
 *   </div>
 *   <HeroScrollScene.Visual fallback={<LiveCallHero />} />
 * </HeroScrollScene>
 * ```
 *
 * See `docs/audit/SITE_REQUESTS.md` for the full worked integration
 * example and the reasoning behind this shape.
 */
export const HeroScrollScene = Object.assign(HeroScrollSceneImpl, {
  Visual: HeroScrollSceneVisual,
});
