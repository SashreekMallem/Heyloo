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
