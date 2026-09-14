"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/marketing/use-in-view";

export interface MediaLoopSource {
  src: string;
  type: "video/webm" | "video/mp4";
}

export interface MediaLoopPoster {
  /** AVIF still — listed first so a supporting browser picks it (smaller than WebP). */
  avif: string;
  webp: string;
  /** Plain description of what the (decorative, looping) clip shows, for a screen reader on the poster `<img>` — the `<video>` itself is `aria-hidden`, never narrated, since it carries no information a sighted user gets that isn't already in the surrounding DOM copy per WEBSITE_CREATIVE_BRIEF.md's accessibility rule. */
  alt: string;
}

export interface MediaLoopProps {
  /** `.webm` before `.mp4` — the `<source>` order the brief's own asset log (docs/design/ASSETS.md) ships, smaller-first. */
  sources: MediaLoopSource[];
  poster: MediaLoopPoster;
  className?: string;
  width: number;
  height: number;
  /**
   * Above-the-fold hero usage: skip the lazy `IntersectionObserver` gate
   * and mount + play immediately (still muted/`playsInline`, still a
   * <2MB loop per the brief's asset budget) — matches `next/image`'s own
   * `priority` naming for "this IS the LCP-critical asset, don't defer
   * it." Default false (defer until near-viewport, the correct default
   * for anything below the first fold).
   */
  priority?: boolean;
}

/**
 * The brief's "short MP4/WebM loop (<2MB each, muted, playsinline,
 * poster)" pattern as a single reusable primitive — see
 * docs/design/ASSETS.md's hero-loop for the asset shape this was built
 * against, and docs/DESIGN_SYSTEM.md's "add a section without breaking
 * the budget" note for when to reach for it.
 *
 * Loading strategy:
 * - The poster stays a plain `<picture>` (AVIF → WebP → none) — these
 *   are already-optimized static files in `public/site/`, so routing
 *   them through `next/image`'s optimizer would only add request
 *   overhead for zero benefit; `priority` usage should still pass its
 *   own `<link rel=preload as=image>` at the call site if it's
 *   genuinely the page's LCP element (this component doesn't inject
 *   head tags itself — that decision belongs to the page, which knows
 *   whether this is actually the LCP candidate).
 * - The `<video>` element itself is only mounted once the placeholder is
 *   near-viewport (`IntersectionObserver`, `rootMargin: "200px"` —
 *   mounts slightly ahead of arrival so playback has already started by
 *   the time it's visible, without paying the fetch cost for a loop the
 *   viewer may never scroll to) — `priority` skips this gate entirely.
 *   It also pauses (but stays mounted, so replay doesn't need a new
 *   fetch) whenever it scrolls back out of view, so an idle loop never
 *   burns battery/CPU off screen.
 * - `prefers-reduced-motion`: never mounts a `<video>` at all — the
 *   poster `<picture>` is the complete, permanent, correct rendering
 *   (WEBSITE_CREATIVE_BRIEF.md's "static composition with crossfades
 *   only" rule), and zero video bytes are ever requested. `reduced` is
 *   real React state, never a value computed by calling
 *   `prefersReducedMotion()` directly in the render body — that reads
 *   `window.matchMedia`, always `false` during SSR but possibly already
 *   `true` on the client's very first render (before hydration
 *   completes) under a real reduced-motion preference, which would make
 *   the `<video>`'s presence and the poster `<img>`'s style disagree
 *   between the server tree and the client's first paint (the same
 *   mismatch `use-in-view.ts` documents and `LiveCallHero`/`Sticky`/
 *   `Parallax` are fixed for). Both start non-reduced; the real check
 *   runs post-mount in an effect.
 */
export function MediaLoop({
  sources,
  poster,
  className,
  width,
  height,
  priority = false,
}: MediaLoopProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only reduced-motion check (window.matchMedia); must run post-mount to avoid an SSR/hydration mismatch
    if (prefersReducedMotion()) setReduced(true);
  }, []);
  // `priority`, or no `IntersectionObserver` support (SSR, some test
  // environments) — resolved synchronously in the initial state itself
  // (same "skip observing" pattern `lib/marketing/use-in-view.ts` uses),
  // not via a `setState` call inside the effect below: fail OPEN (mount
  // immediately) rather than a loop that never shows without IO support.
  const [mounted, setMounted] = useState(
    () => priority || typeof window === "undefined" || typeof IntersectionObserver === "undefined",
  );

  // Mount gate — lazy `IntersectionObserver`, skipped entirely for `priority` (or already resolved true above).
  // A fresh `prefersReducedMotion()` check here (not the `reduced` state
  // above) — `reduced` is set by a separate effect and, within the same
  // commit, this effect can run before that state update is applied,
  // which would create-then-immediately-tear-down an observer for a
  // reduced-motion visitor instead of never creating one at all; a
  // synchronous re-check (always safe post-mount) closes that gap.
  useEffect(() => {
    if (prefersReducedMotion() || mounted) return;
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  // Play/pause gate — once mounted, stop spending CPU/battery once it scrolls off screen.
  // Same fresh-check reasoning as the mount gate above, not the `reduced` state.
  useEffect(() => {
    if (prefersReducedMotion() || !mounted) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const node = containerRef.current;
    const video = videoRef.current;
    if (!node || !video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void video.play().catch(() => {
            /* autoplay can be rejected by the browser (e.g. data-saver) — the poster frame stays a correct, complete fallback. */
          });
        } else {
          video.pause();
        }
      },
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  return (
    <div ref={containerRef} className={className} style={{ width, height, position: "relative" }}>
      <picture>
        <source srcSet={poster.avif} type="image/avif" />
        <source srcSet={poster.webp} type="image/webp" />
        {/* Plain <img> inside <picture>, not next/image — see docstring above. `@next/next/no-img-element` doesn't flag an <img> nested in <picture> (that IS the platform-native responsive-image pattern), so no lint escape hatch is needed here. */}
        <img
          src={poster.webp}
          alt={poster.alt}
          width={width}
          height={height}
          decoding="async"
          style={{
            position: reduced ? "static" : "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: !reduced && mounted ? 0 : 1,
            transition: "opacity 300ms var(--ease-out)",
          }}
        />
      </picture>
      {!reduced && mounted && (
        <video
          ref={videoRef}
          data-testid="media-loop-video"
          muted
          loop
          playsInline
          preload={priority ? "auto" : "metadata"}
          aria-hidden="true"
          // No `controls`, so nothing on this element is normally
          // reachable by Tab — `tabIndex={-1}` makes that explicit
          // rather than incidental, which is what satisfies
          // `aria-hidden` co-existing with a (theoretically) focusable
          // media element per WCAG's own guidance the a11y linter is
          // checking (a11y/noAriaHiddenOnFocusable).
          tabIndex={-1}
          width={width}
          height={height}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        >
          {sources.map((source) => (
            <source key={source.src} src={source.src} type={source.type} />
          ))}
        </video>
      )}
    </div>
  );
}
