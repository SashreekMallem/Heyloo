"use client";

import type { ReactNode } from "react";
import { HeroScrollScene } from "@/components/motion/hero-scroll-scene";

export interface HeroScrollSectionProps {
  className?: string;
  /**
   * The headline/subhead/CTA column — plain DOM content, unchanged on
   * every tier (WEBSITE_CREATIVE_BRIEF.md §3: "Headline, subhead, CTAs
   * ... are DOM text throughout" the pin).
   */
  children: ReactNode;
  /** Forwarded to `<HeroScrollScene.Visual fallback={...}>` — what renders in the visual slot on every non-qualifying tier, e.g. `<LiveCallHero />`. */
  visualFallback: ReactNode;
}

/**
 * PAGES-side wrapper around ENGINE's `<HeroScrollScene>` /
 * `<HeroScrollScene.Visual>` compound-component contract
 * (docs/audit/SITE_REQUESTS.md). Exists because the home page
 * (`app/[locale]/(marketing)/page.tsx`) is a Server Component, and React
 * Server Components cannot "dot into" a static sub-property of a
 * "use client" module's export — only a module's own top-level named
 * exports may cross the server/client boundary; property access on one
 * of those exports (`HeroScrollScene.Visual`) has to happen inside an
 * actual client module (this file's build errored with "Element type is
 * invalid ... got: undefined" until this wrapper existed, because the
 * RSC flight runtime resolves `HeroScrollScene.Visual` to `undefined`
 * rather than throwing, on the webpack build). This component owns that
 * one dotted reference so `page.tsx` only ever imports and renders
 * `<HeroScrollSection>` by name, never `HeroScrollScene` itself.
 */
/**
 * Sizing for the visual slot (`<HeroScrollScene.Visual>`'s wrapper div,
 * `hero-scroll-scene.tsx` L119, is `position: relative` only — it takes
 * its size from this className, same as every other sized box in this
 * grid). Without an explicit size here the wrapper collapses to zero
 * (its only child is `position: absolute`, out of flow) and the WebGL
 * `<canvas>` falls back to the raw HTML default of 300x150px — this is
 * the fix for that. `aspect-[4/3]` + a capped width keeps the box in the
 * ~450-650px range the morph geometry/camera (`hero-morph-scene.tsx`) is
 * tuned to fill at every qualifying viewport (tablet single-column,
 * desktop half-column up to `Container`'s max width) without the line
 * ever approaching the frustum edge.
 */
const HERO_VISUAL_CLASSNAME = "relative mx-auto aspect-[4/3] w-full max-w-xl lg:mx-0 lg:max-w-none";

export function HeroScrollSection({ className, children, visualFallback }: HeroScrollSectionProps) {
  return (
    <HeroScrollScene className={className}>
      {children}
      <HeroScrollScene.Visual className={HERO_VISUAL_CLASSNAME} fallback={visualFallback} />
    </HeroScrollScene>
  );
}
