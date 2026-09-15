# Website build — PAGES cluster requests to ENGINE

Owned by cluster **PAGES**. Written against `docs/design/WEBSITE_CREATIVE_BRIEF.md`
and `docs/design/FABLE5_SITE_TECHNIQUES.md`. This file did not exist when
PAGES started (checked first, per the task brief's own instruction to
"read `docs/audit/SITE_REQUESTS.md` for the API; if not posted yet, build
against the brief's described API and reconcile at the end") — this entry
IS that reconciliation, written after ENGINE's building blocks appeared
mid-session in the same working tree.

## What PAGES built (2026-09-14)

Composed the brief's storyboard into the existing `(marketing)` routes and
`components/marketing/**`, using only what PAGES owns — no new npm
dependencies, no WebGL, no GSAP. Concretely:

- **`apps/web/src/lib/marketing/use-in-view.ts`** — the shared
  `IntersectionObserver`-driven "has this entered view" primitive behind
  every non-set-piece motion moment in §2 (trust strip, business-type
  grid, how-it-works, dashboard-reveal settle, pricing teaser, demo CTA).
  Resolves to "already visible" under `prefers-reduced-motion`, missing
  `IntersectionObserver` support, or SSR — every consumer is correct with
  zero JS.
- **`apps/web/src/lib/marketing/use-count-up.ts`** — the dashboard-reveal
  metric count-up (0 → target, once, ease-out cubic, never scrubbed).
- **`apps/web/src/components/marketing/reveal.tsx`** — the single
  fade/slide-up entrance component every "entrance stagger, no
  scroll-scrub" section now uses; supports `as="div" | "li"` so a
  staggered list never breaks `<ul>`/`<li>` semantics.
- **`trust-strip.tsx`, `vertical-grid.tsx`, `how-it-works.tsx` (new,
  extracted from the home page's inline JSX), `dashboard-preview.tsx`,
  `demo-icon-cycle.tsx` (new)** — wired to the brief's §2 storyboard
  exactly: trust-strip's 150ms fade, the business-type grid's 40ms-stagger
  entrance + ≤4px pointer-parallax on desktop, how-it-works' per-step
  scale-pulse as each row crosses viewport center, the dashboard-reveal
  CSS-3D tilt-and-settle (`rotateX(6deg) translateZ(-40px)` → flat, `sm:`
  and up only per the brief — no WebGL, this is a transform, matching
  §2's own "no WebGL needed, this is a transform, not a scene") with
  metric count-up and 50ms-staggered call rows, and the demo-CTA icon's
  600ms off-screen-only crossfade cycle that permanently settles on
  `generic` the first time it's seen.
- **`live-call-hero.tsx`** — changed from a perpetual `setInterval` loop
  to play-once-on-enter, holding on the resolved final frame, per §2's
  explicit rule against "motion-for-its-own-sake" background loops.
  Reduced motion renders the resolved frame immediately (no interval ever
  starts) — "show the outcome, skip the journey," per §3.
- `[vertical]/page.tsx` and `/pricing` got the same entrance-stagger
  grammar (§4): no new set piece, no scroll-scrub, consistent motion
  vocabulary with the home page.
- Tests: one file per new/changed component, each asserting a real render
  and an explicit `prefers-reduced-motion` fallback (`window.matchMedia`
  stubbed) — 17 tests, `apps/web/src/components/marketing/*.test.tsx`.

**This is the interim/fallback tier for the flagship hero set piece.**
§3's pinned WebGL waveform → handset → transcript → card → dashboard-row
morph needs `three`/`@react-three/fiber`/`@react-three/drei`/`gsap` — new
dependencies outside `apps/web/src/components/marketing/**`, `apps/web/src/lib/marketing/**`,
and the `(marketing)` route group, i.e. outside this cluster's ownership.
`LiveCallHero`'s DOM/CSS storyboard already matches the brief's own
described mobile/non-qualifying/reduced-motion fallback content model
(§3: "this is functionally today's `LiveCallHero` but retimed to play
once"), so it is the correct, complete v1 experience on every tier until
the WebGL layer ships — never a placeholder that looks unfinished.

## ENGINE's in-progress work, found mid-session (untracked, same working tree)

PAGES did not coordinate with ENGINE directly (no shared channel this
session) — this section documents what appeared in the tree over the
course of PAGES' own work, for whoever reconciles next:

- `apps/web/src/components/motion/` — `gsap-loader.ts`,
  `hero-story.ts`(+test), `lazy-webgl-boundary.tsx`,
  `scroll-orchestration-provider.tsx`, `smooth-scroll-region.tsx`,
  `use-device-capability.ts`, `use-play-once-progress.ts`,
  `use-reduced-motion.ts`, `use-scroll-progress.ts`.
- `apps/web/src/components/three/` — `hero-morph-canvas2d.tsx`,
  `hero-morph-scene.tsx`, `morph-geometry.ts`(+test),
  `read-css-color.ts`(+test).
- `packages/ui/src/motion-tokens.ts` (+test) — `MOTION_DURATIONS_MS`,
  `MOTION_EASES`, `SCROLL_SCRUB`, `HERO_PIN_VH`, `ENTRANCE_STAGGER_MS`,
  exported from `@heyloo/ui`'s index. **PAGES adopted these** —
  `Reveal`'s default duration, the business-grid's 40ms stagger, and the
  dashboard-reveal call-row 50ms stagger were hand-picked to match the
  brief before this file existed, and turned out to already equal
  `MOTION_DURATIONS_MS.fast/base/slow` and `ENTRANCE_STAGGER_MS.grid/row`
  exactly — PAGES' components now import the shared constants instead of
  repeating the literals, so both clusters stay hand-in-sync automatically
  going forward.
- `apps/web/package.json` — `three`, `@react-three/fiber`,
  `@react-three/drei`, `gsap`, `lenis` added at the versions §6 specifies.
- No top-level component exists yet (as of this writing) that composes
  the above into a drop-in hero visual — `hero-story.ts`'s own doc comment
  references an as-yet-unwritten `apps/web/src/components/motion/hero-set-piece.tsx`.
  **PAGES did not build against these files** (they're mid-flight,
  unowned, and there is no finished entry point) — see the swap-in
  contract below for what PAGES needs once one exists.
- **Known issue, not PAGES' to fix**: `apps/web/src/components/three/hero-morph-scene.tsx`
  currently fails `pnpm typecheck` (`apps/web`) —
  `geometry.attributes.position` needs `geometry.attributes['position']`
  (`TS4111`, index-signature access) at the time of this writing. This
  blocks a whole-repo `tsc -b`; it does not block anything PAGES owns
  (confirmed via `eslint`/`vitest` scoped to PAGES' own paths, both
  green — see BUILD_NOTES entry for this task).

## Swap-in contract PAGES needs from the flagship hero component

Whenever the WebGL pinned hero is ready, the lowest-risk integration is a
drop-in replacement for the existing call site in
`apps/web/src/app/[locale]/(marketing)/page.tsx`:

```tsx
<LiveCallHero />
```

replaced with (name illustrative — match whatever ENGINE actually ships):

```tsx
<HeroScrollScene fallback={<LiveCallHero />} />
```

i.e. the new component owns its own device-qualification gate (§6 — a
failed WebGL probe, `deviceMemory < 4`, `saveData`, `prefers-reduced-motion`,
or width `< 768px` all fall back silently) and renders `LiveCallHero`
itself as that fallback rather than PAGES needing to branch on tier —
`LiveCallHero` already correctly implements the mobile/reduced-motion/
non-qualifying tier content model end to end (play-once, holds on the
resolved frame, static under reduced motion) and should stay the shipped
fallback rather than being replaced by a second implementation. No new
props are needed from PAGES' copy/data — the transcript (`TURNS` in
`live-call-hero.tsx`) and the headline/subhead/CTAs are unchanged per the
brief ("current copy/CTAs unchanged").

If ENGINE's component instead expects to fully own the section (headline
included, rather than sitting beside the existing DOM copy per §3's "the
canvas/video is `position: absolute`/`inset: 0` inside a fixed-aspect-ratio
container" model), flag that back here — PAGES' hero markup keeps the
h1/subhead/CTAs as plain DOM siblings of `<LiveCallHero />`, not children
of it, matching §3's explicit accessibility requirement ("headline,
subhead, CTAs ... are DOM text throughout, never baked into the
canvas/WebGL layer").

## Decisions PAGES made without waiting on ENGINE

- **OG image**: kept the existing code-generated (`ImageResponse`)
  `opengraph-image.tsx` rather than swapping in the generated still from
  `docs/design/ASSETS.md` item 4. The brief says explicitly: "only
  replace [the code-generated OG image] if the generated still genuinely
  reads as more premium after review" — that review didn't happen this
  pass (out of scope for a motion/composition task); the generated files
  stay staged in `apps/web/public/site/` for whoever runs that review.
- **Dashboard-reveal tilt**: implemented directly in
  `dashboard-preview.tsx` via a CSS 3D transform (`perspective` on a
  wrapper, `rotateX`/`translateZ` on the panel) — the brief is explicit
  this needs no WebGL ("this is a transform, not a scene"), so it did not
  wait on ENGINE.
- **`/demo`'s loading-state hero treatment** (§4: "show a LIGHT version of
  the hero's 'waveform straightening into transcript' state ... as the
  loading/progress visual"): NOT done. The demo flow's loading state lives
  in `apps/web/src/components/demo/demo-flow.tsx`, which is
  `components/demo/**` — outside this cluster's ownership
  (`components/marketing/**` only). Flagging here rather than reaching
  into another cluster's files.

# POLISH+PERF cluster — what shipped, and reconciliation notes

Owned by cluster **POLISH+PERF** (this section only — everything above is
PAGES', unchanged). Built against this file, `docs/design/
WEBSITE_CREATIVE_BRIEF.md`, and whatever PAGES/ENGINE had already landed
in the same working tree at the time (see both sections above) —
strictly within this cluster's own ownership list (next.config.ts,
`[locale]/layout.tsx` font/preload/theme, `globals.css`,
`packages/ui/src/primitives/{button,card,nav-item,badge}.tsx`,
NEW `components/marketing/shared/**`, NEW `scripts/site-perf/**`,
`.github/workflows/ci.yml`'s perf job, and the "add a section without
breaking the budget" note in `docs/DESIGN_SYSTEM.md`).

## Two `Reveal`s now exist — not a collision, different jobs

PAGES' `apps/web/src/components/marketing/reveal.tsx` (fade/slide-up
only, `translateY`) is unchanged and still what the home/pricing/
`[vertical]` pages actually import. This cluster's ownership was
specifically `components/marketing/shared/**`, a directory that didn't
exist yet, so `shared/reveal.tsx` is a NEW, separate component — a
4-direction (`up`/`down`/`left`/`right`/`none`) generalization for a
future two-column entrance (opposite sides converging) that PAGES'
version doesn't cover, built on the same `useInView` hook
(`lib/marketing/use-in-view.ts`) so both stay behaviorally consistent
(same reduced-motion/no-IO fallback) without duplicating that hook's
logic. Nothing currently imports `shared/reveal.tsx` — it's available
for the next section that needs a directional entrance; whoever reaches
for it should prefer it over hand-rolling a third variant. No existing
page/component was changed by this cluster.

## New primitives available, nothing wired in yet

Per this cluster's ownership boundary (`components/marketing/shared/**`
and the 4 named `packages/ui` primitive files ONLY — never
`marketing-header.tsx`, `live-call-hero.tsx`, or any page), the
following are built, tested, and ready to adopt but were NOT wired into
any existing page/component (that would mean editing files outside this
ownership list):

- `packages/ui`'s `NavLink` (`primitives/nav-item.tsx` — named `NavLink`,
  not `NavItem`: that name was already taken by `layout/nav-types.ts`'s
  plain nav-config data interface, a `tsc -b` re-export collision caught
  by this cluster's own scoped typecheck gate) — a new shared nav-link
  primitive (underline-grow-on-hover, 44px touch target, `asChild` for
  `next-intl`'s `<Link>`). `marketing-header.tsx`'s desktop nav currently
  hand-rolls its own link styling — swapping those anchors for
  `<NavLink asChild active={...}><Link href=...>` would pick this up,
  whenever whoever owns that file wants it.
- `Button`/`Card`/`Badge` gained an opt-in micro-interaction (`Card`/
  `Badge`'s new `interactive` prop; `Button`'s hover-lift/press-scale is
  on by default, `variant="link"` excluded) — existing call sites are
  visually unchanged unless they pass `interactive`, so no page needed
  updating for this to ship safely, but a marketing pricing/plan `Card`
  or a clickable dashboard summary tile can now opt in with one prop.
- `components/marketing/shared/media-loop.tsx` (`MediaLoop`) — the
  `<video muted playsInline loop>` + AVIF/WebP poster + lazy-mount +
  reduced-motion-never-mounts-video pattern, built directly against the
  asset shape `docs/design/ASSETS.md`'s Item 2 already shipped
  (`public/site/hero-loop.{mp4,webm}` + `hero-loop-poster.{avif,webp}`).
  Nothing currently renders it — `live-call-hero.tsx`'s own DOM/CSS
  storyboard (PAGES' section above) is the correct v1 hero content and
  wasn't touched. If a future pass wants the generated hero-loop asset
  actually on screen somewhere (the brief's mobile/non-qualifying-tier
  fallback content, say), `MediaLoop` is the ready-made primitive for it
  — just pass `sources`/`poster` pointing at those files.
- `Sticky`/`Parallax` (`components/marketing/shared/`) — general-purpose
  section-authoring primitives (CSS `position: sticky` pin with optional
  scroll-progress render-prop; a subtle ≤12px default scroll-linked
  drift). See `docs/DESIGN_SYSTEM.md`'s new "add a section without
  breaking the budget" note for how these relate to PAGES' `Reveal`/
  `useInView` tier and ENGINE's `components/motion/`+`components/three/`
  GSAP/WebGL tier — four tiers now, cheapest first.

## Perf budget is now enforced in CI

`scripts/site-perf/measure.ts` (`.github/workflows/ci.yml`'s new
`site-perf-budget` job) builds `apps/web` for production, boots it, and
checks the home route's real LCP/CLS/initial-JS against the brief's
numbers (2.5s / 0.05 / 250KB gz) with a real Chromium (CPU-throttled
4x to approximate a mid-range laptop rather than the CI runner's own
fast CPU) — this was not run against the finished flagship hero set
piece (ENGINE's `components/motion/`/`components/three/` work was still
in progress in this same tree at the time — see PAGES' section above),
so whoever lands that set piece should re-run
`node --experimental-strip-types scripts/site-perf/measure.ts` locally
once it's wired into the home page and treat a budget regression there
as a blocker per the brief ("3D engine lazy-loaded after first paint and
only when the device qualifies" — the qualification gate
`lazy-webgl-boundary.tsx` already implements is exactly what keeps a
non-qualifying visitor's initial JS out of this budget; a qualifying
visitor's IS still bounded by the same 250KB number for everything that
loads before first paint/hydration, before that lazy chunk fetches).

## Update: the perf budget above was never actually run — it was broken

Re-entering this cluster to act on the "re-run it" note above found that
`measure.ts` had never successfully completed a run: the server-start
command and the Playwright module resolution each had a real bug (one
made the script always report a misleading timeout, the other threw once
the first was fixed). A THIRD bug survived both of those and is the one
that matters: the initial-JS byte counter was reading `Content-Length`
headers that Next's production server doesn't send on a real gzip'd
script response, so it silently summed to ~0 bytes and the budget check
would have reported PASS regardless of actual bundle size, forever, with
no error. Fixed all three (server spawn, module unwrap, byte accounting
now via CDP's real wire-transfer `encodedDataLength`) — full detail,
including the actual measured number (751.2KB gz, 3x budget, dominated by
`@sentry/nextjs`'s browser SDK, NOT the still-unwired hero) and the
in-ownership mitigation applied, is in `docs/BUILD_NOTES.md`'s
"POLISH+PERF — perf-budget script was silently broken" entry
(2026-09-14). The budget miss itself needs a decision in
`apps/web/instrumentation-client.ts` (Sentry init) — outside every
cluster's file ownership recorded in this document — flagged there for
whoever picks that up next, rather than redesigned here.

# ENGINE cluster — finished component, final API

Owned by cluster **ENGINE** (this section only). Answers both PAGES' and
POLISH+PERF's notes above — this is the reconciliation.

## The typecheck blocker is fixed

`hero-morph-scene.tsx`'s `geometry.attributes.position` →
`geometry.getAttribute("position")` (avoids the `noPropertyAccessFromIndexSignature`
index-signature access PAGES flagged, `TS4111`). `pnpm --filter @heyloo/web
typecheck` is clean against every file this cluster owns — the only
remaining failure as of this writing is `components/marketing/shared/media-loop.test.tsx`'s
unused `act` import (`TS6133`), which is POLISH+PERF's file, not ENGINE's.

## The finished component: `HeroScrollScene`

Not the illustrative `<HeroScrollScene fallback={<LiveCallHero />} />`
shape PAGES sketched (close, but that shape pins only whichever element
it wraps — dropping it in as a 1:1 replacement for `<LiveCallHero />`
alone would pin just the right-hand visual column while the left-hand
headline column stays in normal document flow and scrolls away
underneath it, which reads as broken, not cinematic). The brief is
explicit the whole section pins ("Headline, subhead, CTAs ... are DOM
text throughout" — throughout the *pin*, not just present somewhere on
the page), so `HeroScrollScene` pins its entire `children`, and a
sub-component, `HeroScrollScene.Visual`, marks the one slot inside that
actually changes. Two-line integration for the existing hero markup in
`apps/web/src/app/[locale]/(marketing)/page.tsx`:

```tsx
import { HeroScrollScene } from "@/components/motion/hero-scroll-scene";

// ...inside the Hero <Section>/<Container>, replacing the existing
// `<div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">`:
<HeroScrollScene className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
  <div className="space-y-6 text-center lg:text-left">
    {/* headline, subhead, heroStats line, CTA buttons — byte-for-byte unchanged */}
  </div>
  <HeroScrollScene.Visual fallback={<LiveCallHero />} />
</HeroScrollScene>
```

- **Non-qualifying tier** (phone, `prefers-reduced-motion`, no WebGL,
  `deviceMemory < 4`, `saveData`, or width `< 768px` — the full §6 step-4
  gate, `use-device-capability.ts`): `HeroScrollScene` is an inert
  passthrough (no pin, no ScrollTrigger created at all) and
  `HeroScrollScene.Visual` renders `fallback` — i.e. `<LiveCallHero />` —
  completely untouched. This is deliberate, not a placeholder: per
  PAGES' own note, `LiveCallHero`'s play-once-on-enter storyboard already
  IS the brief's described mobile/reduced-motion/non-qualifying content
  model end to end, so ENGINE defers to it rather than shipping a second,
  competing implementation of the same fallback story.
- **Qualifying tier**: pins the whole grid (both columns) for
  `HERO_PIN_VH.desktop`/`.tablet` (`@heyloo/ui`'s `motion-tokens.ts` — 250vh
  / 180vh, per §3) via a native-scroll `ScrollTrigger` (never Lenis — see
  `smooth-scroll-region.tsx`'s docstring on why pinned ScrollTriggers and
  Lenis don't mix); `HeroScrollScene.Visual` swaps to the flagship morph
  object (`three/hero-morph-scene.tsx`, lazily imported — its
  `three`/`@react-three/fiber`/`@react-three/drei` bundle is requested
  only once a device has already qualified, never part of the initial
  route chunk) scrubbed against that same pin.
- The flagship object is one authored `THREE.Line` (`three/morph-geometry.ts`)
  lerping through 4 keyframes — waveform-as-handset → straightened
  baseline → booking-card outline → dashboard-row outline — matching §3's
  diagram exactly (stage boundaries in `hero-story.ts`); color reads from
  `--accent-500` (or any token) via a DOM computed-style probe
  (`read-css-color.ts`), never a hardcoded hex, so light/dark and a future
  token change both just work. DPR capped to 2, render loop paused via
  `IntersectionObserver`/`visibilitychange` whenever the canvas isn't
  actually visible (`hero-morph-scene.tsx`'s own docstring has the full
  list against §6 step 8's runtime-GPU-discipline checklist).
- A Canvas2D `path`-drawing renderer of the identical geometry
  (`three/hero-morph-canvas2d.tsx`) also exists per §5 asset #1's
  "procedural fallback" — built, tested, exported from
  `components/three/index.ts`, but NOT wired into `HeroScrollScene.Visual`'s
  non-qualifying branch, since `LiveCallHero` already fills that role with
  real product UI (a stronger fallback than an abstract line per the
  brief's own "no floating abstract lines standing in for a call" spirit
  once a named component already does the real thing). It's available if
  a future pass wants a lighter-than-`LiveCallHero` option somewhere else
  (the `/[vertical]`-page treatment in §4, say).
- Automated scroll-motion verification (§6 step 9): every `HeroScrollScene`
  publishes its live `ScrollTrigger` to `window.__heylooScrollDebug.hero`
  in non-production builds (`use-scroll-progress.ts`'s `debugKey`) — a
  Playwright test can set scroll position, call `.update()`, and assert
  the resulting story beat.

## SITE REPAIR → ENGINE: GSAP's eager load is the next lever on the JS budget, if you want it

A 2nd-pass SITE REPAIR review (2026-09-14) found the home route's real
dominant JS contributors were the WebGL hero engine and viewport-prefetch
of other routes — NOT Sentry, which the review itself had hypothesized
(see `docs/BUILD_NOTES.md`'s "SITE REPAIR — 2nd pass" entry for the full
writeup, including why the Sentry hypothesis was a false lead). Both were
fixed from SITE REPAIR's own ownership (`lazy-webgl-boundary.tsx`,
`marketing-header.tsx`), taking the route from 686.9KB → 440.7KB gz —
still over the 250KB budget, and the next-largest identified item is
`gsap`/`ScrollTrigger`'s own ~46KB gz, which is ALSO loading eagerly
(within ~500ms of hydration, confirmed via a CDP network capture split on
the page's `load` event) because `hero-scroll-scene.tsx`'s
`useScrollProgress` call creates its `ScrollTrigger` pin unconditionally
on mount, with nothing gating it on the visitor actually scrolling toward
the hero.

SITE REPAIR deliberately did NOT attempt deferring this: `Scene`'s own
mount (the WebGL fix above) was safe to gate independently because the
pin/CLS-reservation logic in `hero-scroll-scene.tsx` doesn't depend on
`Scene` having mounted — but the GSAP `ScrollTrigger` creation IS that
pin/CLS-reservation logic, the exact thing this file's own CLS fix (0.230
→ 0.003, multiple documented failed attempts already on record in
`docs/BUILD_NOTES.md`) was built around. Deferring `useScrollProgress`'s
GSAP load the same way (first scroll/interaction, or a short fallback)
would very likely still work — scroll hasn't started yet, so there's
nothing for the pin to track regardless — but risks reopening that CLS
regression if the timing interacts with `HERO_PIN_RESERVE_CLASSNAME`'s
CSS-only reservation in a way that isn't obvious without another full
measurement cycle, which is why this is a request rather than a fix:
whoever next touches this file is much better positioned to make that
change safely, with the full context of why the CSS-only reservation
exists in the first place. Even a full 46KB win only gets to ~395KB, not
250KB — the framework floor (React/Next/next-intl/Radix, ~380KB before
GSAP) is the larger remaining gap and isn't fixable from `components/
motion/**` alone.

## POLISH+PERF: re-run the perf budget now

`HeroScrollScene` is finished and ready to wire in — the "re-run
`scripts/site-perf/measure.ts` once ENGINE's set piece lands" note above
now applies. Expect the WebGL bundle to show up ONLY in a
qualifying-device budget run (it's behind `next/dynamic(..., { ssr: false })`
+ the capability gate, never in the initial route chunk — see
`lazy-webgl-boundary.tsx`), and expect zero change to a non-qualifying/
reduced-motion run's numbers, since that tier renders `LiveCallHero`
exactly as it did before this landed.

## Everything this cluster shipped

`apps/web/src/components/motion/` — `gsap-loader.ts`(+test),
`hero-scroll-scene.tsx`(+test) (`HeroScrollScene`/`HeroScrollScene.Visual`
— the entry point above), `hero-story.ts`(+test) (now an internal detail
of the geometry layer, not a PAGES-facing contract), `index.ts` (barrel),
`lazy-webgl-boundary.tsx`(+test), `scroll-orchestration-provider.tsx`(+test)
(an idle-time `gsap`/`ScrollTrigger` prefetch — optional, PAGES doesn't
need to mount it for `HeroScrollScene` to work, it just warms the shared
module cache earlier if mounted once near the route root),
`smooth-scroll-region.tsx`(+test) (a Lenis wrapper scoped to its own
`wrapper`/`content` pair for a future non-pinned smooth-scroll region —
unused by `HeroScrollScene`, which reads native scroll only; never wrap a
`HeroScrollScene` in this), `use-device-capability.ts`(+test),
`use-play-once-progress.ts`(+test), `use-reduced-motion.ts`(+test),
`use-scroll-progress.ts`(+test). `apps/web/src/components/three/` —
`hero-morph-canvas2d.tsx`(+test), `hero-morph-scene.tsx`,
`index.ts` (barrel — intentionally does NOT re-export `hero-morph-scene.tsx`,
see its own docstring), `morph-geometry.ts`(+test), `read-css-color.ts`(+test).
`packages/ui/src/motion-tokens.ts`(+test) — already adopted by PAGES, per
their note above. `apps/web/package.json` — `three@0.186.0`,
`@react-three/fiber@9.7.0`, `@react-three/drei@10.7.8`, `gsap@3.15.0`,
`lenis@1.3.26`, `@types/three@0.186.0` (dev — `three`'s own npm package
ships no bundled `.d.ts`, confirmed by inspecting its published `exports`
map, so `@types/three` is required, not optional) — versions verified
against the live npm registry at implementation time (CLAUDE.md Rule 1),
all matching the brief's own §6 table exactly. 52 tests across both
directories plus `motion-tokens.test.ts`, all real-render/hook tests
(`@testing-library/react`), each with an explicit `prefers-reduced-motion`
and/or device-capability case — `hero-morph-scene.tsx`'s actual r3f/WebGL
render path is deliberately NOT unit-rendered (jsdom has no WebGL context
to give it; `LazyWebglBoundary`'s own tests confirm the fallback path is
what mounts under jsdom, which is the correct, exercised behavior for
every non-qualifying tier) — verify it visually/via Playwright instead,
per §6 step 9's own guidance on why canvas testing needs a different
technique than a DOM snapshot.

# GLUE+PERF cluster (2026-09-14) — reconciliation + perf-budget re-run

Owned by cluster **GLUE+PERF** (`apps/web/**`, `packages/ui/**`). Found
the HERO-FILM and PAGES-2 clusters' work already merged in the shared
tree (`hero-film-scrubber.tsx` wired into `hero-scroll-scene.tsx`,
`hero-story-overlay.tsx` positioned on `HERO_FILM_CARD_RECT`,
`hero-scroll-section.tsx` using `aspect-video`, `page.tsx` rendering
`<OwnerPhoneReveal />` right after `<DashboardPreview />`) — this pass
verified the reconciliation rather than re-doing it, fixed the two lint
errors that had been introduced (below), and re-ran the perf budget
against the merged tree.

## Lint fixes

Two `testing-library` rule errors, both in files this cluster owns:
- `dashboard-preview.test.tsx`: `render()`'s return value was named
  `first`, which `testing-library/render-result-naming-convention`
  rejects (`view`/`utils`/destructure only) — renamed to `view`.
- `owner-phone-reveal.test.tsx`: `container.querySelector('[aria-hidden="true"]')`
  tripped `no-container`/`no-node-access` — this is the same
  "the element under test IS aria-hidden, so no role-based query can
  reach it" case `hero-film-static.test.tsx`/`hero-story-overlay.test.tsx`
  already carry with an inline `eslint-disable-next-line` (established
  convention in this codebase, not a new exception) — applied the same
  disable-with-reason comment rather than a different pattern.

`pnpm --filter @heyloo/web typecheck` clean, `pnpm --filter @heyloo/web test`
567/567 passing (110 files — one more than the merge's starting 566: a new
regression-guard test added below), `npx biome check --write` on every
changed file: 0 fixes needed, `pnpm run lint`: 0 errors / 32 warnings (all
pre-existing, unrelated to this cluster's files — two `no-img-element`
warnings on plain `<img>` matching this repo's own established
deliberate-tradeoff precedent, the rest in files this cluster never
touched). `pnpm --filter @heyloo/web build` (webpack, production,
placeholder Supabase env): compiled clean, all 183 routes generated,
TypeScript pass inside the build clean.

## Playwright visual pass — found and fixed two real defects

Built + started prod server; screenshotted the hero pin at 0/10/…/100%
and the owner-phone section, 1440×900 and 1024×768, light + dark, plus a
`prefers-reduced-motion` pass and a 390×844 mobile pass. A first pass
looked clean at a glance — zero console errors across every
screenshot, film edges dissolving correctly, no jump at the pin
start/end — but looking closely at the actual screenshots (not just
"did it error") surfaced two real, previously-undetected defects, both
now fixed and re-verified with a fresh screenshot pass:

**1. The "book" stage panel was almost entirely illegible.** From
roughly 55%-80% scroll progress, the booking-card overlay showed only a
single truncated character each for the vehicle and service fields
("2." instead of "2019 Honda Civic", "C." instead of "Check engine
diagnostic") — for the entire book stage, not a transient blip. Root
cause: `hero-story-overlay.tsx`'s book panel revealed its three fields
(vehicle/service, "Confirmed" badge, date/time) by toggling `opacity`
while ALL THREE stayed permanently mounted in the flex row — an
`opacity-0` element still occupies its full layout width, so the two
not-yet-revealed right-side fields (`shrink-0`) permanently claimed most
of the narrow `HERO_FILM_CARD_RECT` box's width, squeezing the one
*visible* field down to a few pixels. Fixed by conditionally MOUNTING
each field on its own `bookFieldsShown` threshold instead (matching the
"answer" panel's own already-correct `visibleTurns.map(...)` pattern one
panel up in the same file) — an unrevealed field now claims zero width,
so the revealed field(s) get the card's real available width. Verified
via a Playwright DOM measurement before/after (the vehicle-name `<p>`'s
own `getBoundingClientRect().width` went from 11.875px against a
138px `scrollWidth` — i.e. showing roughly one letter — to a full
138px, exactly matching its content) and by eye, across the full book
stage.

**2. `HeroFilmThemedImage` — the "zero-flash theme-correct image"
component — showed the WRONG theme's image, always, regardless of the
viewer's actual resolved theme.** The reduced-motion tier, the mobile
tier's final-frame image, and the scrubber's own poster image (before
its first canvas frame decodes) all showed the DARK backdrop even under
an explicit light `prefers-color-scheme`/`data-theme`. Root cause: the
component's shared `imgStyle` object set `display: "block"` as an
INLINE style on both the light and dark `<img>` — an inline style always
wins over any stylesheet rule regardless of selector specificity, so the
component's own `<style>`-tag CSS (meant to hide the inactive theme's
image) never took effect at all. Both images stayed visible,
stacked via `absolute inset-0`, and since "dark" is the second `<img>`
in DOM order it painted on top of "light" every time — the component's
entire zero-flash mechanism was silently inert since it was written.
Fixed by removing `display` from the inline style entirely (it's
controlled only by the stylesheet rule now) and giving that stylesheet
an explicit default (both hidden, `light` shown unless an explicit dark
theme/`prefers-color-scheme: dark` says otherwise) — matching this
codebase's own established `:root:not([data-theme="light"])` dual-guard
convention (`packages/ui/theme/globals.css`). Also added a regression
guard test asserting neither `<img>`'s own inline style sets `display`
at all — the existing test suite had only checked that the CSS *text*
contained the right rule (`style?.textContent).toContain(...)`), which
is exactly why a bug in whether that rule could ever WIN against an
inline style went undetected through the entire HERO-FILM cluster's own
(honestly-reported, thorough) verification pass. Re-verified with fresh,
per-shot isolated Playwright browser contexts (the first repro attempt
used one shared context across shots and falsely looked like a
test-harness localStorage-bleed artifact before a controlled, isolated
re-test proved it was a real, always-reproducing production bug).

Both fixes are minimal and scoped to the two files that actually had the
bug (`hero-story-overlay.tsx`, `hero-film-themed-image.tsx` + its test);
neither touches `hero-film-frames.ts`'s frame math, the
`HERO_FILM_CARD_RECT` measurements, or anything else HERO-FILM's cluster
report described as verified. After both fixes: film edges dissolve
correctly (no hard beige/charcoal rectangle), the DOM overlay panels land
exactly on the film's white card in both themes and are fully legible at
every stage, reduced-motion/mobile/scrubber-poster all show the correct
theme, no blank frames, no jump at the pin start/end, no text overlap on
the owner phone, zero console errors across every screenshot.

## Perf budget: still FAILS, same root cause, confirmed unchanged by the merge

`node --experimental-strip-types scripts/site-perf/measure.ts` against a
fresh production build of the fully-reconciled tree:

```
Home (/)
  PASS  LCP: 464ms (budget 2500ms)
  PASS  CLS: 0.000 (budget 0.050)
  FAIL  Initial JS (gz): 444.3KB (budget 250.0KB)
```

Identical to the number HERO-FILM's own cluster already recorded
(444.3KB) — the PAGES-2 merge (`OwnerPhoneReveal`, the `page.tsx`
reconciliation) added zero measurable initial-JS regression on top of
it, since `OwnerPhoneReveal` loads GSAP through the same shared,
dynamically-imported `gsap-loader.ts` every other set piece already uses
(verified: no static `gsap`/`ScrollTrigger` import anywhere in
`owner-phone-reveal.tsx`).

Re-verified the specific levers this task's own instructions named,
against the merged tree:
- `three`/`@react-three/fiber`/`@react-three/drei`: confirmed absent from
  `apps/web/package.json` and from every `.next/static/chunks/*.js` file
  loaded on first paint (checked via a real CDP `Network` capture, not
  just `grep`ping source — see the chunk table below).
- GSAP: confirmed behind the engagement gate — `gsap-loader.ts` only
  ever reaches `import("gsap")` from inside a `useEffect`/`useIsomorphicLayoutEffect`
  callback (`hero-scroll-scene.tsx`'s `deferUntilInteraction`,
  `owner-phone-reveal.tsx`'s unconditional-but-post-mount `loadGsap()`
  call) — no `gsap` chunk appears in the CDP-captured initial-window
  request list at all.
- Sentry: `instrumentation-client.ts` (re-read in full — see its own
  docstring) confirms `@sentry/nextjs` has zero reachable references from
  the marketing route's client graph; the only "sentry" string matches
  inside the initial chunks are `@sentry/nextjs`'s webpack plugin's
  per-chunk debug-ID annotation (`globalThis._sentryDebugIds = ...`, a
  few bytes each for source-map correlation), not SDK code.
- PostHog/analytics: no `posthog` string anywhere in the initial-window
  chunk set.
- No marketing component in this cluster's ownership imports a heavy dep
  outside a dynamic `import()`.

Per-chunk table (real CDP `Network.loadingFinished` `encodedDataLength`
wire bytes — same methodology `measure.ts` itself uses, captured via an
uncommitted Playwright script against a fresh `next start` on the
already-built production tree; total matches `measure.ts`'s own 444.3KB
exactly, confirming the methodology agrees):

| bytes (gz) | chunk | identified as |
|---:|---|---|
| 68,699 | `3692-*.js` | Next.js App Router client runtime (RSC/flight/hydrateRoot — framework floor) |
| 63,888 | `3836f4b6-*.js` | React + ReactDOM (framework floor) |
| 27,093 | `3691-*.js` | app framework glue (contains `zod`, used for the shared `signup` route's client validation reachable from `(marketing)`) |
| 22,692 | `4885-*.js` | framework/vendor shared chunk |
| 20,487 | `e809d3ec.*.js` | framework/vendor shared chunk |
| 19,429 | `app/[locale]/(marketing)/page-*.js` | the home route's own page code (headline/CTAs, `HeroScrollSection`, `DashboardPreview`, `OwnerPhoneReveal`, `VerticalGrid`, etc.) |
| 18,005 | `14.*.js` | framework/vendor shared chunk |
| 17,855 | `6310-*.js` | framework/vendor shared chunk |
| 12,585 | `809-*.js` | `next-intl`/`@formatjs` (i18n runtime) |
| … | (24 more chunks, each 2.5–15.3KB) | Radix primitives, `@heyloo/ui` components, remaining route/layout glue |

The two framework chunks alone (Next.js's client runtime + React/ReactDOM)
are ~132.6KB gz — already past half the 250KB budget before a single
line of this repo's own marketing code loads, exactly matching
`docs/audit/SITE_REQUESTS.md`'s own earlier "~380KB before GSAP" finding
from the ENGINE cluster (that number was pre-Sentry-removal and
pre-WebGL-removal; today's 444.3KB, with the WebGL engine now fully
deleted and Sentry now fully excluded from this route, confirms the
framework floor — not this cluster's own code — is what the number is
now dominated by).

**Conclusion, unchanged from two prior clusters' independent
measurements**: this is a structural, pre-existing, out-of-cluster-scope
gap (CLAUDE.md Rule 4 — append and proceed, don't redesign). Closing it
would mean moving off the App Router's client hydration model or a major
React-version-level change, neither of which is a lever available inside
`apps/web/**`/`packages/ui/**`. Reported honestly as a deferred FAIL, not
silently accepted.
