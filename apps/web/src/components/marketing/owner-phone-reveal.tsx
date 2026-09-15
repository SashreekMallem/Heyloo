"use client";

import type ScrollTriggerType from "gsap/ScrollTrigger";
import { PhoneCall } from "lucide-react";
import { useRef } from "react";
import { useReducedMotion } from "@/components/motion";
import { loadGsap } from "@/components/motion/gsap-loader";
import { useIsomorphicLayoutEffect } from "@/components/motion/use-isomorphic-layout-effect";
import { HOME_CONTENT } from "@/content/marketing/home";
import { deferUntilInteraction } from "@/lib/perf/defer-non-critical";

const { booking: BOOKING } = HOME_CONTENT;

const NOTIFICATION_BODY = `${BOOKING.customer} · ${BOOKING.service} · ${BOOKING.day} ${BOOKING.time}`;

/**
 * Closing beat #6, "Reach the owner" (WEBSITE_CREATIVE_BRIEF.md §1: "the
 * dashboard row triggers a phone notification — the owner's own phone,
 * buzzing, lock-screen preview — closing the loop"). Placed directly
 * after `DashboardPreview` (round-4 review, docs/BUILD_NOTES.md SITE-1):
 * the story that opened in the hero (a call rings, the AI answers, a
 * booking lands in the dashboard) resolves here — the SAME booking
 * (`HOME_CONTENT.booking`, shared with `DashboardPreview`) reaches the
 * owner's own phone.
 *
 * A CSS-only phone — no raster image, matching the flat-token discipline
 * the rest of this cluster's set pieces use. The chassis/screen color is
 * a deliberate fixed near-black (not a `--neutral-*` token, which
 * inverts per theme) — the same "matte-black handset" object the hero
 * film itself renders identically in both the light and dark theme
 * (WEBSITE_CREATIVE_BRIEF.md's hero asset spec), so this phone reads as
 * the same physical object recurring, not a themed illustration.
 *
 * Motion: a GSAP timeline (`loadGsap`, the shared engine loader — see
 * `components/motion/gsap-loader.ts`) gated behind a `ScrollTrigger`
 * with `once: true` (an entrance, not a scroll-scrubbed set piece — this
 * beat has no "middle state" worth linking to scroll position, same
 * reasoning `how-it-works.tsx` gives for its own once-per-view pulse).
 * Sequence: the phone rises/tilts in from below and settles → the
 * notification card slides down from the top of the screen → a 120ms,
 * ±1px "haptic" micro-shake of the whole phone plays alongside a soft
 * ember glow pulse (one physical event — a buzz — not two stacked
 * effects, WEBSITE_CREATIVE_BRIEF.md §7's "no more than one visual
 * effect firing at once") → the closing line fades in last.
 *
 * Reduced motion: every element's DOM/CSS default IS the settled final
 * state (opacity 1, no transform) — the GSAP setup effect below never
 * runs at all when `useReducedMotion()` is true, so there is nothing to
 * hide-then-reveal; the static composition renders correctly with zero
 * JS, matching every other set piece in this cluster.
 *
 * SITE REPAIR finding (blocker): `loadGsap()` used to fire unconditionally
 * from this effect on every mount — this component renders directly on
 * the home route (`page.tsx`, right after `<DashboardPreview />`), so
 * every motion-allowed visitor pulled the ~46KB gz `gsap`/`ScrollTrigger`
 * chunk into their initial JS the instant the page hydrated, regardless
 * of whether they ever scrolled far enough to see this beat, or
 * interacted at all — a live per-chunk network capture against a
 * production build confirmed those exact chunks present on a completely
 * passive page load. `deferUntilInteraction` gates the load behind the
 * same first-scroll/pointer/key signal (or its passive-visitor fallback
 * delay) every other GSAP consumer in this cluster already uses
 * (`hero-scroll-scene.tsx`, `scroll-orchestration-provider.tsx`) — by the
 * time a real visitor scrolls this far down the page they've already
 * interacted at least once, so the `ScrollTrigger`'s own `once: true`
 * "onEnter" behavior is unaffected; only a visitor who reads the page
 * with zero scrolling/pointer/key input (impossible for anyone reaching
 * this section) would ever skip loading it. `ScrollTrigger.refresh(true)`
 * after `.create()` matches `use-scroll-progress.ts`'s own fix for the
 * same class of bug — a trigger created lazily, sometimes after the
 * visitor has already scrolled, needs to re-sync against the DOM/scroll
 * state as it actually is now rather than as it was cached at creation.
 */
export function OwnerPhoneReveal() {
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);

  useIsomorphicLayoutEffect(() => {
    if (reducedMotion) return;
    const section = sectionRef.current;
    const phone = phoneRef.current;
    const shake = shakeRef.current;
    const notification = notificationRef.current;
    const glow = glowRef.current;
    const line = lineRef.current;
    if (!section || !phone || !shake || !notification || !glow || !line) return;

    let cancelled = false;
    let scrollTrigger: ScrollTriggerType | undefined;
    // `GSAPTimeline` is an ambient global alias for `gsap.core.Timeline`
    // (gsap's own `types/index.d.ts`) — no import needed, same as how
    // `ScrollTriggerType`'s own default-export type is imported above.
    let timeline: GSAPTimeline | undefined;

    const cancelEngageGate = deferUntilInteraction(() => {
      void loadGsap().then(({ gsap, ScrollTrigger }) => {
        if (cancelled) return;

        // Hidden starting state, set only once GSAP is ready to animate it
        // — the SSR/first-paint DOM stays the fully visible final state
        // until this runs, so there's no flash-of-hidden-content window.
        gsap.set(phone, { opacity: 0, y: 36, rotate: -4, transformOrigin: "50% 100%" });
        gsap.set(notification, { opacity: 0, y: -28 });
        gsap.set(glow, { opacity: 0 });
        gsap.set(line, { opacity: 0, y: 6 });

        const tl = gsap.timeline({ paused: true });
        timeline = tl;

        tl.to(phone, { opacity: 1, y: 0, rotate: 0, duration: 0.7, ease: "power3.out" })
          .to(notification, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, "-=0.15")
          .to(shake, { x: -1, duration: 0.04, ease: "power1.inOut" })
          .to(shake, { x: 1, duration: 0.04, ease: "power1.inOut" })
          .to(shake, { x: 0, duration: 0.04, ease: "power1.inOut" })
          .to(glow, { opacity: 1, duration: 0.2, ease: "power1.out" }, "<")
          .to(glow, { opacity: 0, duration: 0.45, ease: "power1.inOut" })
          .to(line, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }, "+=0.05");

        // Plain `ScrollTrigger.create` + `onEnter`, not a `scrollTrigger:`
        // vars object on the timeline — matches this cluster's established
        // pattern (`use-scroll-progress.ts`) rather than relying on the
        // plugin's own timeline-linking typings.
        scrollTrigger = ScrollTrigger.create({
          trigger: section,
          start: "top 75%",
          once: true,
          onEnter: () => tl.play(),
        });
        // Created lazily, post-interaction — re-sync against the DOM/
        // scroll state as it is now rather than as cached at creation
        // (see this effect's own docstring, and `use-scroll-progress.ts`).
        ScrollTrigger.refresh(true);
      });
    });

    return () => {
      cancelled = true;
      cancelEngageGate();
      timeline?.kill();
      scrollTrigger?.kill();
    };
  }, [reducedMotion]);

  return (
    <div ref={sectionRef} className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className="space-y-4 text-center lg:text-left">
        <h2 className="font-display text-h1 font-semibold text-balance">
          You find out the moment it happens.
        </h2>
        <p className="mx-auto max-w-md text-body text-pretty text-muted-foreground lg:mx-0">
          No portal to check, no inbox to dig through — the same booking that just landed in your
          dashboard reaches your phone before the caller has hung up.
        </p>
        <p ref={lineRef} className="text-small font-medium text-foreground lg:text-left">
          Delivered by SMS and email — the moment it happens.
        </p>
      </div>

      <div className="mx-auto w-[280px] lg:w-[340px]" aria-hidden="true">
        <div ref={phoneRef}>
          <div ref={shakeRef} className="relative aspect-[9/19.5] w-full">
            {/* Chassis: hairline bezel + rounded-44px body, deliberately
                fixed matte-black in both themes — see the component
                docstring. */}
            <div className="absolute inset-0 rounded-[44px] bg-[#161618] p-[3px] shadow-2xl ring-1 ring-white/10">
              <div className="relative h-full w-full overflow-hidden rounded-[41px] bg-[#0b0b0d]">
                {/* Dynamic island */}
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-2.5 mx-auto h-[18px] w-[86px] rounded-full bg-black"
                />

                {/* Lock screen */}
                <div className="flex h-full flex-col items-center pt-16">
                  <p className="font-display text-[52px] font-medium leading-none text-white">
                    9:41
                  </p>
                  <p className="mt-2 text-micro text-white/60">Tomorrow · September 15</p>
                </div>

                {/* Notification */}
                <div
                  ref={notificationRef}
                  className="absolute inset-x-3 top-[92px] overflow-hidden rounded-2xl border border-white/10 bg-card/95 shadow-lg backdrop-blur"
                >
                  <div className="relative flex items-start gap-2.5 p-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
                      <PhoneCall className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                          Heyloo
                        </p>
                        <p className="shrink-0 text-micro text-muted-foreground">now</p>
                      </div>
                      <p className="text-small font-semibold text-card-foreground">New booking</p>
                      <p className="truncate text-small text-muted-foreground">
                        {NOTIFICATION_BODY}
                      </p>
                    </div>
                    {/* Ember "buzz" glow — a ring pulse, the one moment this
                        card uses the accent color, tied to the haptic
                        shake as a single physical event. */}
                    <div
                      ref={glowRef}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-primary/60"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
