"use client";

import { cn, HERO_PIN_VH, SCROLL_SCRUB } from "@heyloo/ui";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { deferUntilInteraction } from "@/lib/perf/defer-non-critical";
import { HeroFilmScrubber } from "./hero-film-scrubber";
import { HeroFilmFinalImage, HeroFilmStatic } from "./hero-film-static";
import { HeroStoryOverlay } from "./hero-story-overlay";
import { MIN_QUALIFYING_WIDTH, useDeviceCapability } from "./use-device-capability";
import { useReducedMotion } from "./use-reduced-motion";
import { useScrollProgress } from "./use-scroll-progress";

const TABLET_MAX_WIDTH = 1024;

/**
 * SITE REPAIR finding (2nd review): initial JS was 440.7KB gz, 1.76x the
 * 250KB budget — `docs/audit/SITE_REQUESTS.md`'s own next-lever note
 * named this file's unconditional `useScrollProgress` call as the reason
 * `gsap`/`ScrollTrigger` (~46KB gz) loads within ~500ms of hydration on
 * every qualifying device, whether or not the visitor ever scrolls to
 * the hero — gate GSAP's dynamic import on first scroll/pointer/key
 * interaction, or a short fallback for a passive visitor who never
 * interacts (`deferUntilInteraction`).
 *
 * Deliberately safe for the CLS fix below: `forceCollapse`/
 * `HERO_PIN_RESERVE_CSS`'s space reservation is decided entirely by CSS
 * media queries evaluated on the very first parsed byte of SSR'd HTML —
 * it does not depend on `engaged`, GSAP, or any client JS timing at all,
 * so deferring *when* `ScrollTrigger.create()` itself runs cannot reopen
 * that regression (nothing here changes what's already reserved before
 * this effect ever fires). What it does change: before `engaged`, the
 * pinned section scrolls normally (no ScrollTrigger exists yet) inside
 * its already-reserved space; `deferUntilInteraction`'s listener is
 * `{ once: true, passive: true }` on `scroll` itself, so in the common
 * case (a visitor who scrolls) this resolves within the very first
 * scroll tick — before the visitor could plausibly have scrolled past
 * even the "ring" stage's own small range of the pin — so ScrollTrigger
 * picks up the section's live current scroll position the moment it
 * mounts, with no separate catch-up jump.
 */
const ENGAGE_FALLBACK_MS = 2500;

/**
 * `marketing-header.tsx`'s sticky nav (`h-16`) — the pinned hero's
 * `start: "top top"` used to mean the LITERAL viewport top, so while
 * pinned the hero's own top edge (and the badge inside it) sat directly
 * behind the sticky header rather than below it, clipped. `top top+=N`
 * shifts the pin's start point down by the header's height so the
 * pinned content clears it.
 */
const STICKY_HEADER_HEIGHT_PX = 64;

const HERO_PIN_RESERVE_CLASSNAME = "hero-pin-reserve";

/**
 * CSS-only mirror of `qualifiesForWebgl`'s width/`prefers-reduced-motion`
 * checks (`use-device-capability.ts`) — see `forceCollapse`'s comment in
 * `HeroScrollSceneImpl` for why this has to be CSS, not JS state, to
 * avoid a real, measured CLS regression. `height: 0` is the unqualified
 * default (mobile, or `prefers-reduced-motion: reduce` at any width);
 * the two media queries below are the only two conditions that add
 * height, matching `useDeviceCapability`'s own tablet/desktop split
 * (`TABLET_MAX_WIDTH`). Reads its actual vh amount from each instance's
 * own `--hero-pin-vh-{tablet,desktop}` custom properties (set inline,
 * from that instance's real `pinVhTablet`/`pinVhDesktop` props) rather
 * than a hardcoded number, so multiple instances or a prop override
 * still resolve correctly through this one shared stylesheet rule.
 */
const HERO_PIN_RESERVE_CSS = `
  .${HERO_PIN_RESERVE_CLASSNAME} { height: 0; }
  @media (min-width: ${MIN_QUALIFYING_WIDTH}px) and (max-width: ${TABLET_MAX_WIDTH - 0.02}px) and (prefers-reduced-motion: no-preference) {
    .${HERO_PIN_RESERVE_CLASSNAME} { height: var(--hero-pin-vh-tablet); }
  }
  @media (min-width: ${TABLET_MAX_WIDTH}px) and (prefers-reduced-motion: no-preference) {
    .${HERO_PIN_RESERVE_CLASSNAME} { height: var(--hero-pin-vh-desktop); }
  }
`;

interface HeroScrollContextValue {
  progressRef: RefObject<number>;
  /** Desktop/tablet, `prefers-reduced-motion: no-preference` — the pinned, scroll-scrubbed film tier. */
  qualifies: boolean;
  /** `prefers-reduced-motion: reduce` (any width) — `HeroScrollSceneVisual` picks the static `HeroFilmStatic` tier over the mobile `fallback` tier when this is true. */
  reducedMotion: boolean;
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
  const { qualifiesForFilm, ready } = useDeviceCapability();
  const qualifies = ready && !reducedMotion && qualifiesForFilm;

  const isTablet = typeof window !== "undefined" && window.innerWidth < TABLET_MAX_WIDTH;
  const pinVh = isTablet ? pinVhTablet : pinVhDesktop;

  /**
   * CLS fix (measured 0.230 against a 0.05 budget, traced to this pin).
   * Two earlier attempts at a JS/state-driven reservation both failed a
   * real Playwright re-measurement (one handing off to GSAP's own
   * pin-spacer via an `onPin` callback: WORSE, 0.471; one reserving space
   * ourselves via `qualifies` state with `pinSpacing: false`: unchanged,
   * still 0.471) — root cause confirmed via a live `layout-shift`
   * capture: on a real page load the BROWSER PAINTS THE SERVER-RENDERED
   * HTML (computed with `qualifies: false`, since SSR has no `window` to
   * probe) before ANY client JS runs, hydration included — so no client
   * effect, however early (`useLayoutEffect`/`useIsomorphicLayoutEffect`
   * included), can retroactively change what already painted first. Once
   * hydration finishes and `qualifies` resolves to `true` a couple
   * seconds later (`gsap`'s own dynamic-import network/parse delay,
   * under CPU throttling), the reservation appearing is ITSELF the
   * shift — unavoidable for any implementation that decides "should this
   * space exist" from post-hydration JS state.
   *
   * The fix: decide it from CSS media queries instead, which the browser
   * evaluates on the very first parsed byte of SSR'd HTML, with no JS
   * required at all. `HERO_PIN_RESERVE_CLASSNAME`'s rule below (scoped
   * per-instance via CSS custom properties, not hardcoded values, so
   * multiple instances/prop overrides stay correct) mirrors
   * `qualifiesForFilm`'s own width (`MIN_QUALIFYING_WIDTH`/
   * `TABLET_MAX_WIDTH`) and `prefers-reduced-motion` checks — the exact
   * two gates that decide qualification now that there's no GPU/API
   * probe left to also account for (`forceCollapse` below is mostly
   * belt-and-suspenders at this point, kept for the same reasoning as
   * before rather than assuming CSS and JS can never legitimately
   * disagree).
   */
  const forceCollapse = ready && !qualifies;

  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    // Only a device that already qualifies needs to engage — no reason
    // to arm scroll/interaction listeners (or start a timer) for a
    // visitor who was never going to get the pin anyway.
    if (!qualifies) return;
    return deferUntilInteraction(() => setEngaged(true), ENGAGE_FALLBACK_MS);
  }, [qualifies]);

  useScrollProgress({
    target: sectionRef,
    pin: true,
    pinSpacing: false,
    start: `top top+=${STICKY_HEADER_HEIGHT_PX}`,
    end: `+=${pinVh}%`,
    scrub: SCROLL_SCRUB,
    disabled: !qualifies || !engaged,
    onUpdate: (progress) => {
      progressRef.current = progress;
    },
    debugKey: qualifies && debugKey ? debugKey : undefined,
  });

  const reserveStyle: CSSProperties = {
    ["--hero-pin-vh-tablet" as string]: `${pinVhTablet}vh`,
    ["--hero-pin-vh-desktop" as string]: `${pinVhDesktop}vh`,
    ...(forceCollapse ? { height: 0 } : null),
  };

  return (
    <HeroScrollContext.Provider value={{ progressRef, qualifies, reducedMotion }}>
      <div ref={sectionRef} className={className}>
        {children}
      </div>
      {/* Always rendered (never conditional on JS/`qualifies` state) —
          see the comment above `forceCollapse`: the CSS rule below,
          present from the first byte of SSR'd HTML, is what actually
          reserves the pin distance without a client-driven shift. */}
      <div aria-hidden="true" className={HERO_PIN_RESERVE_CLASSNAME} style={reserveStyle} />
      <style>{HERO_PIN_RESERVE_CSS}</style>
    </HeroScrollContext.Provider>
  );
}

export interface HeroScrollVisualProps {
  /**
   * What renders alongside the mobile (<768px) tier's own product
   * visual — `<LiveCallHero />` (`components/marketing/live-call-hero.tsx`),
   * rendered completely unchanged, with the hero film's settled final
   * frame (`HeroFilmFinalImage`) placed above it so mobile still shows
   * the product object, just not the scrubbed sequence (no per-frame
   * downloads on mobile). NOT used on the `prefers-reduced-motion` tier
   * — that tier renders `HeroFilmStatic` (final frame + the "land"
   * overlay panel) instead, regardless of width, since it needs no
   * play-once timer `LiveCallHero` would otherwise still run.
   */
  fallback: ReactNode;
  className?: string;
}

/**
 * The one slot inside `<HeroScrollScene>` that actually changes across
 * the pin — three tiers, in priority order:
 *   1. `prefers-reduced-motion: reduce` (any qualifying width) →
 *      `HeroFilmStatic`: the settled final frame, no pin, no per-frame
 *      downloads, no `requestAnimationFrame` loop.
 *   2. Desktop/tablet ≥768px, motion allowed → the real set piece:
 *      `HeroFilmScrubber`'s scroll-scrubbed frame sequence, with
 *      `HeroStoryOverlay` composited on top.
 *   3. Everything else (mobile) → `fallback` (`<LiveCallHero />`) with
 *      the film's final frame placed above it.
 * Must be rendered inside a `<HeroScrollScene>` — throws otherwise (a
 * loud build-time-adjacent error beats a silently-broken hero in
 * production).
 */
function HeroScrollSceneVisual({ fallback, className }: HeroScrollVisualProps) {
  const context = useContext(HeroScrollContext);
  if (!context) {
    throw new Error("<HeroScrollScene.Visual> must be rendered inside <HeroScrollScene>.");
  }
  const { progressRef, qualifies, reducedMotion } = context;

  if (reducedMotion) {
    return <HeroFilmStatic className={className} />;
  }

  // Mobile tier: render `fallback` with NO imposed size — it's
  // `LiveCallHero`, which already sizes itself correctly by content
  // (`min-h-[19rem]` panels), and always has. `className` (the sizing
  // box, see `HERO_VISUAL_CLASSNAME` in `hero-scroll-section.tsx`) is
  // deliberately NOT applied to `fallback` itself — only to the small
  // final-frame image placed above it.
  //
  // CLS fix (measured 0.032-0.102 across otherwise-identical runs,
  // traced via Playwright's `layout-shift` `sources` to THIS branch):
  // `qualifies` starts `false` on every render — SSR has no `window`,
  // and even on the client it stays `false` until `useDeviceCapability`'s
  // layout effect resolves post-hydration (see that hook's own comment).
  // So a desktop/tablet visitor's FIRST paint is always this "mobile"
  // branch — final-frame image PLUS the full `fallback` (`LiveCallHero`,
  // ~330px of its own two-panel grid) stacked beneath it — before
  // hydration swaps to the single aspect-ratio box above. That swap
  // removes `fallback`'s ~330px, shifting every section below the hero.
  // `md:hidden` on the `fallback` wrapper hides it via a CSS media query
  // — evaluated identically on the very first parsed byte of SSR'd HTML
  // and after hydration, exactly like `HERO_PIN_RESERVE_CSS` above — so
  // a ≥768px viewport never paints `fallback` at all, and the swap to
  // the qualifying tier lands on an already-identically-sized box.
  // `md:mb-0` matches: the image box's `mb-4` only makes sense when
  // `fallback` is actually visible beneath it.
  if (!qualifies) {
    return (
      <>
        <div className={cn(className, "mb-4 overflow-hidden rounded-2xl md:mb-0")}>
          <HeroFilmFinalImage />
        </div>
        <div className="md:hidden">{fallback}</div>
      </>
    );
  }

  return (
    <div className={className} style={{ position: "relative" }}>
      <HeroFilmScrubber progressRef={progressRef} className="absolute inset-0" />
      {/* The real product content composited over the film canvas — see
          hero-story-overlay.tsx for why this exists (SITE REPAIR
          blocker: this pin must never render only an abstract shape).
          Mounted unconditionally alongside the film (not gated on any
          separate "engaged" signal) — `HeroFilmScrubber` shows its own
          theme-correct poster image the whole time frames are still
          loading, so there's no competing full-UI fallback for this
          overlay to ever stack on top of. */}
      <HeroStoryOverlay progressRef={progressRef} className="absolute inset-0" />
    </div>
  );
}

/**
 * The hero's drop-in scroll-scrubbed film set piece
 * (WEBSITE_CREATIVE_BRIEF.md §3). Pins its `children` — the whole hero
 * section — as one unit on a qualifying device (desktop/tablet, motion
 * allowed — `useDeviceCapability`); a no-op passthrough everywhere else.
 * Use `<HeroScrollScene.Visual fallback={...}>` for the one child slot
 * that actually animates:
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
