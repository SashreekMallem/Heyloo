# Heyloo Design System

Owned by cluster **DS**. Tokens live in `packages/ui/src/theme/globals.css`
(Tailwind v4 `@theme` — no `tailwind.config.js`). This doc is short and
opinionated: what each token is *for*, and the one rule that keeps the
product looking premium instead of like a shadcn demo.

The governing brief: **premium restraint** — near-monochrome neutrals, ONE
signature accent used sparingly, generous whitespace, hairline borders,
soft deliberate shadows, no gradients-for-decoration, no emoji as icons.

## Color

Two ramps plus semantic tokens — never reach for a raw hex or an
out-of-system Tailwind color (`blue-500`, `red-600`, …) in product code.

- **`--neutral-50…950`** — the near-monochrome base. Backgrounds, borders,
  text, disabled states, dividers. This is ~95% of the UI's color.
- **`--accent-50…900`** ("ember" — a warm coral-amber, hue ≈ 35-45°,
  chosen specifically to *not* be stock SaaS blue/violet) — the ONE
  signature color. Reserve it for: the primary action (`Button`'s
  `default` variant), the focus ring, live/active/recording indicators,
  and rare hero moments. If you're reaching for `accent` more than once
  per screen, that's a signal to make something else neutral instead.
- **Semantic**: `--success` / `--warning` / `--destructive` / `--info` —
  status only (badges, callouts, form validation). Never used for
  emphasis or branding.
- **Surface tokens**: `--background` (page), `--surface`/`--card` (raised
  panels), `--popover` (floating layers). `--border`/`--input` are
  hairline-weight everywhere — no component should draw its own 2px+
  border.

All of it is expressed in OKLCH so lightness stays perceptually consistent
across the ramp and across the light/dark flip (a `50` step is always "the
lightest name-visible step", a `900` step "the darkest", in both themes —
dark mode is not simply an inverted light palette; see below).

### Tenant branding

`.heyloo-tenant-branded` (wrapped once around the `(tenant)` root layout by
`BrandingProvider`) overrides `--primary`/`--accent` from a tenant's own
brand color, via `--tenant-primary`/`--tenant-accent`. Marketing, admin,
and partner surfaces never wrap this class — their accent is always the
platform's own "ember".

## Typography

Pairing: **Fraunces** (display serif, optical-sized, characterful) for
headlines + **Inter** (highly legible UI/body face, real tabular figures)
for body/data + **IBM Plex Mono** for phone numbers, ids, and code. Loaded
via `next/font/google` in `apps/web/src/app/[locale]/layout.tsx`
(self-hosted at build time, zero runtime request, `display: "swap"`).

Consume via the CSS variables, never the raw font names:

| Token | Use |
|---|---|
| `font-display` | Fraunces — hero/marketing headlines, `PageHeader` title, `h1`/`h2` |
| `font-sans` | Inter — everything else (default `body` font) |
| `font-mono` | IBM Plex Mono — phone numbers, ids, call transcripts, `<code>` |

**Fallback**: each token's `var()` chain ends in a curated system stack
(`ui-serif, Georgia…` / `ui-sans-serif, system-ui…` / `ui-monospace,
Menlo…`) — if the `next/font` variables are ever unset for any reason, the
app still renders in a solid system stack rather than the browser
default. `docs/VERIFY.md` has the one open item on this (build-time
network dependency on fonts.googleapis.com).

### Type scale

`text-display` / `text-h1`…`text-h4` / `text-body` / `text-small` /
`text-micro` — each is a **fluid** `clamp()` between the 390px and 1920px
breakpoints (no jump at a breakpoint edge) and carries its own paired
line-height + letter-spacing (Tailwind v4's `--text-*--line-height` /
`--text-*--letter-spacing` theme keys) — using the utility class alone is
correct; never set `leading-*`/`tracking-*` alongside it. Headings are
tight (1.0–1.2), body is comfortable (1.55).

Money and minutes: always `tabular-nums` (or `font-mono`, which also
carries it) so columns of numbers align — see `MetricCard`, `DataList`'s
`mono` prop.

## Spacing

The 8pt grid is a **usage rule**, not a redefined scale — Tailwind's
default spacing unit is 4px, so build every gap/padding/margin from
**even** multiples (`gap-2` = 8px, `p-4` = 16px, `gap-6` = 24px). Odd
multiples (`p-3`, `gap-5`, …) are for hairline-adjacent fine adjustments
only (e.g. a 12px icon inset), not the default.

## Radius

`rounded-xs` (4px) → `rounded-2xl` (28px) → `rounded-full`. Cards/panels
use `lg`, buttons/inputs `md`, badges/pills `sm`/`full`. Bigger surface =
bigger radius.

## Shadow

`shadow-xs` → `shadow-xl` — soft, low-opacity, neutral (never colored,
never hard-edged). Each step layers a tight contact shadow with a wider
ambient one. In dark mode, elevation reads mostly through the
`--surface`/`--card` lightness step and a hairline border, not shadow —
shadows barely show on a dark ground, so don't rely on them there.

## Motion

150–250ms, `ease-out` (`--duration-fast/base/slow`, `--ease-out`). Applied
via Tailwind v4's parenthesis-var shorthand: `duration-(--duration-fast)
ease-(--ease-out)`. Everything respects `prefers-reduced-motion` globally
(see the blanket rule at the bottom of `theme/globals.css` — collapses all
animation/transition durations to ~0 — no per-component opt-in needed).

## Breakpoints

`xs` 390 / `md` 768 / `lg` 1024 / `xl` 1440 / `2xl` 1920 — `xl`/`2xl` were
moved off Tailwind's stock 1280/1536 to match the brief's real desktop
targets. Every page must read correctly unprefixed (390px, no horizontal
scroll, ≥44px touch targets, sticky bottom primary action on mobile where
one exists) and use the extra width at `xl`+ rather than centering a
narrow column in a sea of background — see `Container`'s `size="full"`.

## Dark mode

Fully tokenized, first-class in both directions: system preference via
`prefers-color-scheme` (default — no toggle needed) and an explicit
`data-theme="dark"`/`"light"` override written by `<ThemeToggle>`
(`@heyloo/ui`) to `localStorage["heyloo-theme"]`. The app root layout
carries a small inline, dependency-free bootstrap `<script>` that applies
a stored preference before first paint (no flash) — see
`apps/web/src/app/[locale]/layout.tsx`; there is deliberately no
`next-themes` dependency (out of this task's package-ownership).

## Z-index

Named layers, not per-component guesses: `--z-dropdown` (30) <
`--z-sticky` (35) < `--z-banner` (38) < `--z-overlay` (40) < `--z-drawer`
(45) < `--z-modal` (50) < `--z-popover` (55) < `--z-toast` (60) <
`--z-tooltip` (65). Existing overlay/dialog/sheet/popover components
already sit at Tailwind's stock `z-50`/`z-40`, which numerically match
`--z-modal`/`--z-banner` — new components should reach for the named
token (`z-(--z-modal)`) rather than a bare number.

## Icons

`lucide-react` only — **never emoji as an icon**, anywhere in the product.
`@heyloo/ui`'s `icons/` module is the one place icon choices are made:

- `VerticalIcon` + `VERTICAL_ICONS` — the 8 business types
  (`@heyloo/canonical-types`'s `Vertical`) → one lucide glyph each. Every
  place a vertical needs a glyph (signup, templates cockpit, marketing
  per-vertical pages) renders `<VerticalIcon vertical={...} />` instead of
  an emoji or an ad-hoc import.
- `NAV_ICONS` — the curated set used across the tenant/admin/partner nav
  (`AppSidebarNav`, `MobileTabBar`).
- `STATUS_ICONS` — success/warning/danger/info, for `Callout`/`EmptyState`
  call sites that want an icon beyond the default.

## Components

Existing shared components (`packages/ui/src/primitives`, `custom`,
`layout`, `forms`) already consume these tokens via semantic Tailwind
classes (`bg-primary`, `border-border`, `text-muted-foreground`, …) — the
token rewrite above re-themes them with no markup changes required in
most cases. New this pass:

- **`Container`** (`size`: `content` | `wide` | `full`) — the one place
  page gutters/max-width are set.
- **`Section`** (`spacing`: `compact` | `default` | `spacious`) — vertical
  rhythm blocks.
- **`PageHeader`** — title/description/eyebrow + a right-aligned,
  wrap-safe action cluster.
- **`Callout`** (`tone`: `neutral`/`info`/`success`/`warning`/`danger`) —
  a persistent inline notice (consent/compliance text, policy reminders) —
  distinct from `Toaster`, which is transient.
- **`DataList`** — label/value key-facts list (`layout`: `inline` |
  `stacked`, `mono` per item) for detail panels (booking, call, customer).
- **`ThemeToggle`** — the three-way system/light/dark control.
- **`Button`** gained a `loading` prop (spinner + `disabled` +
  `aria-busy`; not supported together with `asChild`, which renders
  Radix's `Slot` and requires exactly one child element).

No existing component prop/API was renamed — this was a re-theme + a few
additive components, not a rewrite.

### Touch targets (`Button`'s `default`/`lg` sizes)

`Button`'s `default` size is `h-11` (44px) below the `lg` breakpoint
(1024px) and `lg:h-9` (36px) at desktop/mouse widths — a responsive class
on the size itself, not a `(pointer: coarse)` media query, because it's
the simplest thing that's actually true here: every mobile/tablet
viewport this app ships (390–1023px) is a touch surface, and `lg`+ is
where a mouse-driven desktop layout starts, so the two coincide and a
breakpoint is one fewer moving part than a pointer query for the same
result. `size="lg"` is `h-11` unconditionally (already meets 44px at every
width, so it doesn't need the responsive split); `size="sm"` (`h-8`) and
`size="icon"` (`size-9`) are deliberately-compact affordances for dense
inline contexts (a table-row action, an input-adjacent icon button) and
are exempt — never use `size="sm"`/`size="icon"` for a page's primary CTA
or a sticky bottom mobile action bar. Every page must read correctly
unprefixed at 390px with ≥44px touch targets (see Breakpoints above) —
`Button`'s `default`/`lg` sizes are how that guarantee is met without
also bloating the reviewed 36px desktop density.

## Performance budget

The marketing site's binding perf budget (`docs/design/WEBSITE_CREATIVE_BRIEF.md`
STANDARD): LCP < 2.5s on a mid-range laptop, CLS < 0.05, initial JS for the
home route < 250KB gz. `scripts/site-perf/measure.ts` checks the real
production build against these (`.github/workflows/ci.yml`'s
`site-perf-budget` job) — run it locally with
`node --experimental-strip-types scripts/site-perf/measure.ts` (needs
`pnpm --filter web exec playwright install chromium` once first) before
adding anything heavy to a marketing route, not just at review time.

**Current measured status** (docs/BUILD_NOTES.md's `SITE-2` integrator
entry has the full trace): LCP, CLS, and initial JS all **PASS** —
LCP 492ms, CLS 0.000, initial JS 224.1KB gz, under the 250KB budget with
margin. This was a real architectural fix, not a budget change: the
prior 396.1KB (`SITE-1`) / 379.2KB (`SITE-2`, pre-fix) figures were a
`@heyloo/ui` barrel-optimizer regression (one `export const` in
`packages/ui/src/index.ts` defeated Next's barrel optimizer for the
whole package, so any Server Component importing from the barrel pulled
every reachable `"use client"` primitive — Radix, `react-hook-form`,
`@tanstack/table-core`, `zod`, `recharts`, … — into the route), not an
unavoidable framework floor. Fixed by making the package index a pure
re-export barrel plus deep-importing every Server Component to its
export's real defining module (`@heyloo/ui/primitives/button`, not
`@heyloo/ui`) — see `docs/BUILD_NOTES.md`'s `SITE-2` entry for the full
before/after trace. **Keep it fixed**: `scripts/check-server-barrel-
imports.ts` (`pnpm run check:server-barrels`, wired into CI's `lint`
job) fails the build if any non-`"use client"` file under `apps/web/src`
imports the bare `@heyloo/ui`/`@heyloo/ui/primitives`/`@heyloo/ui/custom`
barrel — always deep-import in a Server Component, never in a
Client Component (their imports tree-shake correctly either way, so the
barrel is fine there).

### Adding a section without breaking it

Reach for these in order — each one costs more than the last, so stop as
soon as the section reads right:

1. **CSS-only reveal/hover.** `Button`/`Card`/`Badge`'s `interactive`
   micro-interaction props (hover lift, press scale — `transform`/
   `box-shadow` only, main-thread-cheap) and `NavItem`'s underline-grow
   (all `packages/ui/src/primitives`) cost nothing extra — no JS, no
   client-component boundary forced on the call site, correct under
   `prefers-reduced-motion` automatically via the blanket rule at the
   bottom of `theme/globals.css`. Reach for these first.
2. **`apps/web/src/components/marketing/shared`'s scroll primitives** —
   `Reveal` (entrance fade/slide, `IntersectionObserver`-driven),
   `Parallax` (subtle scroll-linked drift, ≤~12px default), `Sticky` (a
   CSS `position: sticky` pin with an optional scroll-progress render
   prop) — each is `requestAnimationFrame`-driven and gated by
   `IntersectionObserver` so it costs nothing off screen, and each
   collapses to a correct static composition (no transform, no pin, no
   scroll listening at all) under `prefers-reduced-motion`. This is the
   right tier for nearly every section — reach for it before adding a
   new dependency.
3. **`MediaLoop`** (`components/marketing/shared/media-loop.tsx`) for a
   short muted/looping background clip: mounts the `<video>` lazily
   (`IntersectionObserver`, `rootMargin: "200px"`) unless `priority` is
   set, pauses it off screen, and — under `prefers-reduced-motion` —
   never mounts a `<video>` element at all, only its AVIF/WebP poster.
   Keep the source loop itself under 2MB (docs/design/ASSETS.md has the
   encoding recipe) and always pass real `width`/`height` (CLS budget).
4. **`components/motion/`'s GSAP `ScrollTrigger` pin / canvas frame-
   sequence film** — the flagship hero/dashboard-reveal machinery
   (SITE-2 replaced the earlier react-three-fiber WebGL line-morph
   scene, `components/three/*`, now removed, with a `<canvas>` 2D
   scroll-scrubbed pre-rendered frame sequence — `hero-film-scrubber.tsx`
   + `hero-film-frames.ts`'s pure frame-mapping math, see
   `docs/BUILD_NOTES.md`'s `SITE-2` entry). GSAP loads lazily
   (`gsap-loader.ts`'s dynamic import) and the film's own frames load in
   a priority/idle-deferred order (see `hero-film-frames.ts`'s
   `computeHeroFilmLoadOrder`), so mounting this tier doesn't cost every
   OTHER route anything — but a second section reaching for this tier on
   the SAME route directly competes with the home route's 250KB budget.
   Only pull this in for a genuine multi-beat scrubbed set piece (the
   brief calls for 3-4 total, not per-section) — `Sticky` (tier 2) covers
   a simple single-stage pin.

**Design tokens and the film tier**: the WebGL tier's dynamic
`THREE.Color`/canvas token read (`components/three/read-css-color.ts`) is
gone along with `components/three/*` — the frame-sequence film is a set
of pre-rendered WebP images (`docs/design/ASSETS.md`'s "Item 6"), so its
colors are baked in at generation time, once per theme (a light-theme
take and a dark-theme take, not a single take recolored), rather than
read live from a CSS custom property at runtime. Any FUTURE canvas
element that DOES need to read a live design token at runtime (rather
than draw a pre-rendered asset) still needs the same care the removed
helper documented: `packages/ui/src/theme/globals.css`'s tokens are
`oklch()`, which current Chromium's CSSOM serializes computed `color`
values back as (rather than always normalizing to `rgb()`), and neither
`THREE.Color`'s nor a 2D canvas context's own CSS-string parser accepts
`oklch()` directly — resolve the token via a real DOM element's
`getComputedStyle(...).color`, then rasterize it through a 1×1 `<canvas>`
and read the pixel back as a plain `rgb()`/`rgba()` string, rather than
hand-rolling a parse of the raw custom-property string.

### Images and video

`next.config.ts`'s `images.formats` is `["image/avif", "image/webp"]`
(Next's own default is WebP only — AVIF is opt-in) — every `next/image`
usage gets the smaller AVIF encode automatically for a supporting
browser, WebP fallback next, original format last. Mark the actual LCP
element `priority` (skips lazy-loading and preloads it); every other
image lazy-loads by default — don't override that. A background loop's
poster still (already AVIF/WebP, pre-optimized — see `MediaLoop` above)
intentionally bypasses `next/image` — it's already a right-sized static
file, so the optimizer would only add request overhead.

For a below-the-fold section heavy enough that even its LAYOUT cost
matters before it's ever scrolled to, wrap it in `.defer-offscreen`
(`apps/web/src/app/globals.css`) — `content-visibility: auto` skips
layout/paint work for that subtree until it's near the viewport. Pass
the section its own `contain-intrinsic-size` inline if it's
significantly shorter/taller than the class's ~640px default estimate —
an under-estimate there causes a layout shift the moment the browser
finally measures the real content, which is exactly the CLS regression
this exists to avoid.

## UI Preview Mode

`process.env.UI_PREVIEW_MODE === "1" && process.env.NODE_ENV !== "production"`
(checked at runtime, not just build time) gates an entire route group,
`apps/web/src/app/[locale]/(preview)/`, that renders every real
tenant/admin/partner page **component** — not a fork of it — against fixture
data, with no real auth and no real network calls. See
`apps/web/src/lib/preview/README.md` for exactly how the guard, the
fixtures, and the fetch interception work, and its documented fidelity
limits (some tables/endpoints fall back to synthesized-but-plausible data
rather than hand-authored fixtures).

- `/preview` (and `/preview/index`) — every preview route, grouped by
  area, with theme + a note on how fresh the mirrored page list is.
- `/preview/system` — every shared component/variant/state, rendered in
  both light and dark side by side, for reviewer screenshots.
- `/preview/dashboard/**`, `/preview/cockpit/**`, `/preview/portal/**` —
  1:1 mirrors of every real page under `(tenant)/dashboard`,
  `(admin)/cockpit`, `(partner)/portal`, generated mechanically (each file
  re-exports the real page's `default` export — see the mirror files
  themselves for the one-line pattern).

This mode is a dedicated dev-server mode, not something to run alongside
real usage — see the README for why (it patches `globalThis.fetch`
process-wide for the life of that server process).
