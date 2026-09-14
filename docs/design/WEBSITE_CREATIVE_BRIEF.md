# Heyloo Website Creative Brief

Owner standard (binding, verbatim intent): *"very fancy, modern, premium,
high-quality morphs, full 3D animations as you scroll, world-class product
website, NOT AI slop."* This document is the creative direction for the
`(marketing)` route group in `apps/web`. It does not change any route path,
form, analytics event, or the signup flow's logic — it specifies motion,
composition, and asset direction layered onto the existing structure
(`docs/DESIGN_SYSTEM.md` tokens, `packages/ui` components, the current
`apps/web/src/app/[locale]/(marketing)/**` pages).

**One story, told by scrolling:** a call rings → the AI answers (with
disclosure) → the caller books → a booking card materializes → it lands in
the live dashboard → the owner's phone buzzes. Every 3D/motion moment in
this brief exists to advance that one story — nothing decorative-only
survives review.

> **Companion doc — read this too**: `docs/design/FABLE5_SITE_TECHNIQUES.md`
> is a parallel research pass cataloging the Aug–Sep 2026 wave of cinematic
> "world-class" sites built with Claude Fable 5 / Claude Code — concrete
> examples (most unverified clickbait, a few independently confirmed —
> see its §1), a technique catalog (scroll-linked morphs, sticky-scroll
> storytelling, Three.js material/lighting, performance tricks — §2), a
> cross-referenced anti-slop tells list (§3), prompt patterns (§4), and
> versioned library recommendations (§5). Its findings are folded into
> this brief inline, cited as **[FABLE5]** or by section reference,
> wherever they sharpened or corrected something here — most notably: the
> Lenis + pinned-`ScrollTrigger` incompatibility (§3, §6), GPU/DPR/
> offscreen-pause runtime discipline (§6), the automated scroll-state
> verification pattern (§6), `SplitText`/`MorphSVG` now shipping free with
> GSAP (§6), and several additional anti-slop tells (§7). **ENGINE, PAGES,
> POLISH, and REVIEW agents should still read the companion doc directly**
> before starting their task — this brief cites its most load-bearing
> points but is not a substitute for its full technique catalog and
> sources index. The REVIEWER grades against both this brief's §7 and the
> companion doc's own §3 tells.

---

## 0. References studied

Eight sites, fetched and read as they render today (Sept 2026). For each:
hero composition, first-scroll behavior, where 3D/motion is used and
deliberately isn't, type scale, section rhythm, how the product itself is
shown, and load-strategy signals.

### linear.app
- **Hero**: centered, stacked, massive type — no hero illustration at all.
  The product's own UI (issue lists, workspace panes) *is* the hero visual.
- **First scroll**: straight into named-customer testimonials (OpenAI,
  Ramp, Opendoor) — credibility before features.
- **Motion**: restrained. Timeline/Gantt visualization in the planning
  section implies animated state, but code diffs and most UI are static
  frames — motion is reserved for the one section where state genuinely
  changes over time.
- **Type**: aggressive scale jump from display headline to body; feature
  labels in small caps/medium weight.
- **Rhythm**: hero → proof → feature sections by workflow phase → proof
  again → CTA. Alternating subtle background tints mark section boundaries
  instead of hard dividers.
- **Product display**: live/interactive UI excerpts embedded directly
  (an actual issue card, an actual code review diff) — never a "marketing
  screenshot" with drop shadow and browser chrome.
- **Load**: Cloudflare Image Delivery with `f=auto`/`fit=scale-down`
  responsive params; code blocks are static `<pre>`, not animated syntax
  highlighting — motion budget spent on the one thing that earns it.
- **Lesson for Heyloo**: the real product IS the hero image. Don't invent a
  metaphor when the dashboard itself is more convincing.

### vercel.com
- **Hero**: text-first, parallel value props for three audiences (agents /
  apps / automation), two CTAs, no illustrated hero at all.
- **First scroll**: a named case study (Notion) before feature clusters —
  proof precedes pitch, same as Linear.
- **Motion**: none is showcased in the hero; whatever exists is deferred
  to feature-section product embeds, not the fold.
- **Rhythm**: problem → case study → feature matrix → recent releases →
  CTA. Very little metaphor; almost entirely product-literal.
- **Lesson for Heyloo**: a confident premium product site can have an
  almost bare hero if the copy and the first proof point are strong enough
  — restraint is itself a signal of confidence, not a compromise.

### stripe.com
- **Hero**: centered text ("Financial infrastructure to grow your
  revenue") over a **wave-pattern static image**, not an animated
  gradient — motion is implied by the artwork, not spent on an animation
  loop. Two CTAs below.
- **First scroll**: auto-rotating customer-logo carousel, then "Flexible
  solutions for every business model" — proof, then taxonomy.
- **Motion**: deliberately restrained; a logo carousel is the only
  continuous motion on the page. No WebGL, no elaborate gradient loops.
- **Product display**: bento-grid cards with illustrative photography
  (real-world contexts echoing the Stripe mark), actual product UI
  screenshots are minimal and used sparingly, only where precision matters
  (checkout, dashboard stat).
- **Load**: responsive image params (`w=`, `q=90`), heavy reliance on
  static imagery over interactive elements — a performance-first posture
  even for a company that could afford anything.
- **Lesson for Heyloo**: a single well-composed static/looping visual can
  read as "premium motion" without costing a WebGL budget — reserve WebGL
  for the one or two moments that need real 3D, not the whole page.

### raycast.com
- **Hero**: centered value prop ("Your shortcut to everything") anchored
  by an **interactive keyboard visualization** that doubles as product
  demo and visual identity — the hero IS the input surface of the product.
- **First scroll**: keyboard recedes, copy pivots to an emotional register
  ("It's not about saving time...") before functional detail — brand
  philosophy bridges hero to feature list.
- **Motion**: present in the keyboard and in an extension carousel; fully
  absent in the manifesto-style copy blocks and testimonials, which stay
  static and legible.
- **Product display**: actual interface mockups per extension card
  (Linear, Spotify, Slack), isolated components rather than full-screen
  captures; an AI-agent section shows simulated live status text
  ("Fetching assigned tasks…").
- **Load**: Next.js `_next/image` with quality tiers by placement (hero at
  q=90, small cards at q=70) — asset weight is rationed by visual
  importance, not uniform.
- **Lesson for Heyloo**: our hero's "input surface" is a phone call — the
  waveform/transcript morph is the Heyloo equivalent of Raycast's keyboard.

### resend.com
- Design-system research (oh-my-design.kr, Fudge design teardown) rather
  than a full render — the live fetch returned mostly text/doc-hub
  content, so this entry leans on published teardowns, flagged here per
  Rule 1 (note in `docs/VERIFY.md`-style caveat: confirm against the live
  site visually before final asset lock).
- **Hero**: anti-decorative — one large serif headline (~96px, "Domaine")
  next to a single 3D object (a black cube), no gradient wash, no
  marketing illustration.
- **Type**: a deliberate three-family system — display serif for the hero
  moment, a grotesque sans for section-level display copy, Inter for
  product/UI chrome. (Heyloo's own Fraunces/Inter/Plex Mono pairing is
  already this same shape.)
- **Motion**: minimal — a handful of Lottie icon accents, otherwise
  content-first, dark-mode-first, code-block-heavy (it's a developer API
  product).
- **Lesson for Heyloo**: one restrained 3D object can carry an entire hero
  if the typography is doing the rest of the work — 3D doesn't have to
  mean "animated on every scroll frame."

### cursor.com
- **Hero**: bold headline, three-button CTA row, a large interactive
  product demo (Desktop + CLI) directly below the fold against a subtle
  branded background.
- **First scroll**: a research timeline (2022 → 2026) before feature
  claims — chronology as credibility.
- **Motion**: "spring-based layout animations and shared element
  transitions" specifically in the Mission Control preview — i.e., motion
  is spent on the one interactive product surface, not spread thin.
- **Product display**: real interface screenshots throughout (task lists,
  editor panes, Slack integration) — realistic workflows, not generic
  illustration.
- **Lesson for Heyloo**: "shared element transition" is exactly the
  vocabulary for our card → dashboard-row morph — same technique, applied
  to a phone call instead of a coding session.

### elevenlabs.io
- **Hero**: minimal, text-forward ("Bringing technology to life"), two
  CTAs — notably **no waveform imagery in the hero itself**, despite being
  an audio company. The product pillars (Creative / Agents / Voice) are
  introduced as text, not visualized yet.
- **First scroll**: a use-case carousel (Narration, Advertisement,
  Conversational…) segments the product before showing UI.
- **Motion**: reserved for *inside* product mockups (playable audio
  samples with real waveform players, live dashboard metrics like
  "Resolution Rate 83.4%") rather than marketing chrome.
- **Lesson for Heyloo (important counter-signal)**: the category leader in
  voice AI deliberately does NOT open with a generic waveform hero — it
  opens with confident, plain type and saves the waveform for where it's
  functionally real (an actual playable sample). Heyloo's hero waveform
  must behave the same way: not decorative audio-viz, but the visual
  shape of an actual transcript turning into actual text.

### apple.com/iphone
- **Hero**: carousel of two featured products, alternating text/image
  sides, full-bleed product renders, "Learn more / Pre-order / View
  pricing" CTAs per card.
- **First scroll**: a migration/onboarding section, then a **tabbed**
  feature explainer (Getting Started, Cameras, Apple Intelligence…) — each
  tab reveals its own photography set.
- **Motion**: scroll-linked section transitions drive the tab reveals;
  product renders shift angle/lighting as sections change (implied
  WebGL/transform-driven, not just crossfade). Reduced-motion fallback is
  explicitly documented in footnotes.
- **Product display**: multiple camera angles per product, environmental
  context shots (device in hand), screen-content close-ups — never an
  abstract render standing in for the object.
- **Load**: descriptive, cacheable image filenames; below-fold content and
  accessory sections are deferred; reduced-motion is a first-class,
  footnoted fallback, not an afterthought.
- **Lesson for Heyloo**: reduced-motion isn't a compliance checkbox to
  Apple, it's a named, designed alternate composition — treat our
  crossfade fallback with the same seriousness as the primary scroll.

**Cross-site pattern that sets Heyloo's posture**: every single one of
these eight sites shows *the real product* — real UI, real data shapes,
real interface chrome — and NONE of them opens with an abstract 3D
metaphor, a gradient blob, or an "AI" visual cliché. The premium signal is
restraint plus product truth, not the amount of animation. Heyloo's hero
concept (§3) is built to the same rule: every visual element is a real or
realistic artifact of an actual Heyloo call (a transcript, a tool call, a
booking card, a dashboard row), never an abstraction of "AI."

---

## 1. Narrative arc — 6 beats

The whole home page is one continuous sentence, paced by scroll position,
not by autoplay:

1. **Ring** — a call arrives. A business's phone starts ringing; we see
   only the fact of an incoming call (caller ID, ringing state) — no
   answer yet. Sets the stakes: *this call would otherwise go to
   voicemail.*
2. **Answer, with disclosure** — the AI receptionist picks up. The first
   words it says are, verbatim, its compliance disclosure (this call is
   recorded, this is an AI). This is non-negotiable, on-brand, and *is the
   trust beat* — Heyloo leads with the thing competitors bury in fine
   print.
3. **Understand & book** — the caller states what they need; the agent
   asks one clarifying question, then visibly checks availability (a
   real tool-call affordance, e.g. `check_availability()`), and offers a
   real time.
4. **Confirm** — the caller accepts. A booking card assembles in real
   time from the transcript's own facts (no new information appears from
   nowhere — everything on the card was just said).
5. **Land** — the booking card doesn't just "appear" in a dashboard, it
   *becomes* a row in one — same rounded corners, same shadow depth,
   easing from card-scale to row-scale (a genuine shared-element morph,
   not a cut).
6. **Reach the owner** — the dashboard row triggers a phone notification
   (the owner's own phone, buzzing, lock-screen preview) closing the loop:
   the business owner finds out about a booking they didn't have to be on
   the phone for. This is the emotional payoff and it hands off directly
   into the trust strip / business-types / pricing sections, which do the
   work of "does this apply to me and what does it cost."

Beats 2–5 are the literal content of the hero's scroll-linked animation
(§3). Beat 1 is the hero's resting/entry state. Beat 6 is the bridge into
the dashboard-reveal section further down the page — the SAME visual
language recurs there (see §2), so the story doesn't reset, it continues.

---

## 2. Storyboard, section by section (home)

Section order matches the current `page.tsx` exactly — this brief adds
motion, not new sections, new copy, or reordering. Every range below is
expressed as **scroll progress within that section's own scroll distance**
(`0` = section entering the viewport bottom edge, `1` = section fully
scrolled past), driven by GSAP ScrollTrigger `scrub` (a value near `0.5`,
never `true`/`1:1`, so motion has a hair of inertia rather than feeling
glued to the wheel) or, for the hero, a dedicated pinned timeline (§3).

### Hero (`<Section spacing="spacious">`, current copy/CTAs unchanged)
- **Desktop/tablet (qualifies for WebGL, see §6)**: the section pins for
  ~250vh of scroll. See §3 for the full pinned timeline — this is the
  flagship set piece.
- **Mobile / non-qualifying devices**: no pin. A single Canvas 2D or short
  MP4/WebM loop (≤2MB, muted, `playsinline`, poster frame = the disclosure
  moment) plays once on enter, then holds on the final frame (booking
  card). The existing `LiveCallHero` component's interval-based storyboard
  *is* this fallback's content model already — this asset formalizes it
  as a designed, scroll-triggered-once loop instead of a perpetual
  `setInterval` (a perpetual background loop is exactly the kind of
  motion-for-its-own-sake the standard forbids once the visitor has
  scrolled past it — it should play its story once and rest).
- **Reduced motion**: static composition = the *last* frame only (booking
  card confirmed, in the mini dashboard), no crossfade sequence — matches
  the rule "static composition with crossfades only," and here the most
  informative single frame is the resolved one.
- Headline, subhead, CTAs (`Try a live demo` → `/demo`, `Get started` →
  `/signup`) are DOM text throughout, never baked into the canvas/WebGL
  layer — they must stay selectable, indexable, and accessible regardless
  of which visual tier renders.

### Trust strip (`border-y`, compact, existing `<TrustStrip>` copy)
- No 3D. This is reassurance copy ("Every call discloses it's an AI"),
  and per the owner's own restraint principle it should read like a
  compliance footnote, not a marketing claim — it gets zero scroll-linked
  motion beyond a single, fast (150ms) fade/slide-up on first enter
  (`IntersectionObserver`-driven, not scroll-scrubbed — this is an
  entrance, not a scroll story).

### Business types (`VerticalGrid`, 4-up card grid)
- Cards fade/slide up in a staggered entrance (~40ms stagger, 200ms each,
  `ease-out`) the first time the section enters view — entrance-triggered,
  not scroll-scrubbed (a grid doesn't have a "middle state" worth linking
  to scroll position).
- Subtle pointer-parallax on desktop only: each card's icon shifts ≤4px
  opposite the cursor within the card bounds (a hover-region transform,
  not a page-wide parallax) — reinforces "premium, considered," costs
  nothing on mobile where it's simply absent (no pointer).
- The existing hover state (`-translate-y-0.5`, border/shadow shift) is
  unchanged — this section is intentionally the calmest one on the page,
  a rest beat between the hero set piece and "How it works."

### How it works (3-step numbered list)
- Scroll-linked but modest: as the section crosses the viewport center,
  each numbered circle (`1`/`2`/`3`) fills from its current `bg-primary`
  flat state to a very slight scale pulse (1 → 1.06 → 1, ~300ms,
  triggered once per step as its row crosses center) — a metronome
  read, not a spectacle. This is deliberately the site's quietest
  section: three sentences, three numbers, generous whitespace, per the
  "3–4 set pieces with quiet between them" rule — this section is a
  quiet beat, not one of the 3–4.

### Dashboard reveal (`DashboardPreview`, real `@heyloo/ui` components)
- **This is set piece #2.** The panel enters as a slightly receded,
  tilted card (subtle `rotateX(6deg) translateZ(-40px)` in a CSS 3D
  context — no WebGL needed, this is a transform, not a scene) and
  settles flat as it reaches ~35% into the viewport, scroll-scrubbed
  over that short range only (it should feel like the panel is being
  "set down" in front of the visitor, once).
- Once flat, the four `MetricCard`s count up from 0 to their real
  display values (`14`, `5`, `182`, `100%`) using `tabular-nums`,
  scroll-triggered once on enter (not scrubbed — a counter that reverses
  when you scroll up reads as a bug, not a feature).
- The "Recent calls" `CallFeedItem` rows stagger in beneath the metrics,
  50ms apart — and the TOP row is styled to visually rhyme with the hero's
  final booking-card frame (same accent-tinted `success` badge shape) so
  a visitor who scrolled straight down recognizes it as "the same
  booking, now living here" even without replaying the hero.
- Desktop/tablet only for the tilt-and-settle entrance; mobile gets the
  flat panel with the metric count-up and row stagger only (still real
  motion, just no 3D transform, per the "phones get 2D/Canvas instead of
  WebGL" rule).

### Pricing teaser (single card, "$299/mo")
- Static card, one fast fade/slide-up entrance only. No scroll-scrub —
  this is a pause-and-decide moment; motion here would undercut it.

### Demo CTA (`VerticalIcon`, "Hear it for yourself")
- The `VerticalIcon` gets a single, slow (600ms) icon-swap crossfade
  cycling through 2–3 of the eight vertical glyphs on a timer *while
  off-screen only* (paused via `IntersectionObserver` the instant it's
  out of view, so it never burns a frame budget unseen) — implies "built
  for many kinds of business" without adding a second grid. On enter, it
  settles on `generic` (current behavior) and stops cycling.

### Footer
- No motion. Footers are navigation, not narrative.

---

## 3. The hero concept, in detail

### Concept
**A phone call, told as one continuous shape.** A thin-line waveform
(literally: the audio waveform of a ringing/talking call, rendered as a
handset silhouette built from the same line weight) straightens into
transcript text as the AI answers; the transcript's own words fold into a
booking card (the card's fields are drawn FROM the transcript lines that
just animated — a `TranscriptViewer`-styled turn literally becomes a
`PriceCard`/booking-summary-styled card, not a new unrelated graphic);
the booking card then shrinks and slides into a dashboard row (a
`CallFeedItem`-styled row), which is the same visual object the "Dashboard
reveal" section shows fully assembled further down the page. One
continuous morph chain, four states, matching narrative beats 1→5:

```
[ring: waveform-as-handset]
        │  scroll 0 → 0.2 (straighten)
        ▼
[answer: disclosure line appears as text, caller lines follow]
        │  scroll 0.2 → 0.55 (transcript turns, tool-call badge)
        ▼
[book: booking card assembles from the transcript's own facts]
        │  scroll 0.55 → 0.8 (card scales in, fields populate)
        ▼
[land: card shrinks + slides into a dashboard-row shape]
        scroll 0.8 → 1.0 (shared-element morph, settles)
```

### Exact components involved
- **Geometry/rendering layer** (WebGL, qualifying devices only): a
  `react-three-fiber` `<Canvas>` containing ONE `THREE.Line`/
  `THREE.TubeGeometry` object whose control points are driven by a
  `useFrame`-read scroll progress (read from `ScrollTrigger`'s own
  progress value on native scroll, not from React state — see the
  Lenis correction below — to avoid re-render cost) — this is the
  "waveform straightening into a handset silhouette, then into
  text-baseline strokes" object.
  `@react-three/drei`'s `Line` + a custom vertex-shader-free geometry
  morph (lerp between two point-sets) is sufficient; no external glTF
  model needed for this object — it's authored as data, not imported
  geometry, which also keeps the asset weight near zero.
- **DOM/HTML layer** (draws over/under the canvas via a shared stacking
  context, never fighting it for the same pixels): the transcript turns
  render as *real* `TranscriptViewer`-styled markup (same type scale,
  same speaker-color convention as the product's own call-detail page),
  the tool-call badge as the same `font-mono` pill used in
  `LiveCallHero` today, the booking card as a `PriceCard`/`StatusBadge`-
  styled composite (booking fields + a `success` `StatusBadge`), and the
  final dashboard row as an actual `CallFeedItem`.
- **Orchestration**: GSAP `ScrollTrigger` with `pin: true` on the hero
  section for the 250vh scroll distance, driving a single GSAP timeline
  whose labels correspond to the four states above, reading **native
  browser scroll directly** — **do not wrap the pinned hero in Lenis.**
  `docs/design/FABLE5_SITE_TECHNIQUES.md` §5.1 (citing `dappasol.com`'s
  build-path writeup) states plainly that Lenis "breaks stacked and
  pinned ScrollTriggers"; the same doc's §6.1 build checklist calls the
  single pinned 0→1 timeline the single highest-leverage technique in
  the whole survey, so it's not worth risking on an incompatible smooth-
  scroll layer. If Lenis is used anywhere on the marketing site (optional
  — see §6's package table), it is scoped to pages/sections with **no**
  pinned `ScrollTrigger`, never the hero or the dashboard-reveal section.
  Verify current GSAP `ScrollTrigger` pin behavior against gsap.com's own
  docs at build time per Rule 1 regardless.
- **Reveal choreography**: opacity/transform only cross the WebGL/DOM
  boundary — e.g. the transcript text fades in over the canvas rather
  than the canvas itself drawing text, so accessibility tooling always
  sees real text nodes, never canvas pixels, for anything a screen reader
  should announce (moot in practice since the whole block is
  `aria-hidden`, matching `LiveCallHero` today, but keeps the DOM
  inspectable/testable).

### Desktop vs tablet vs mobile vs reduced-motion
- **Desktop (≥1024px) + qualifies for WebGL** (see §6 device gate): full
  pinned 4-state morph as above, ~250vh scroll distance.
- **Tablet (768–1023px) + qualifies**: same morph, shorter pin (~180vh),
  canvas object simplified (fewer line segments) to hold 60fps on
  integrated GPUs.
- **Mobile or non-qualifying device**: no WebGL, no pin. A single ≤2MB
  MP4/WebM loop (or, as a lighter procedural fallback, a Canvas 2D
  redraw of the same four states driven by `scroll` + `requestAnimationFrame`
  rather than `<Canvas>`/three.js) plays once as the section scrolls into
  view, holds on the final (dashboard-row) frame — this is functionally
  today's `LiveCallHero` but retimed to play once on entry instead of
  looping forever on an interval.
- **`prefers-reduced-motion`**: static composition, single frame = the
  resolved booking-card-in-dashboard state, with the headline/subhead/CTAs
  as normal DOM — no crossfade sequence in the hero specifically (crossfade
  is reserved for sections that otherwise scroll-scrub a transform; the
  hero's reduced-motion state is a hard cut straight to its resting frame,
  which IS the correct reduced-motion treatment: show the outcome, skip
  the journey).

---

## 4. Per-business-type page pattern & pricing/demo treatment

### `/[vertical]` pages (`(marketing)/[vertical]/page.tsx`, unchanged route)
Reuses the SAME morph language as the home hero, but scoped and lighter:
- Hero here is NOT a second pinned WebGL set piece — that would blunt the
  home page's set piece by repeating it. Instead: a static (or short,
  ≤2MB looping-once) version of ONLY the "book" and "land" states (beats
  3–5), pre-filled with that business type's own fixture transcript
  (already the `VERTICAL_CONTENT` model — e.g. Riverside Auto's "check
  engine light" line becomes, on `/salons`, a booking-relevant line for
  that vertical) — same components (`TranscriptViewer`/`CallFeedItem`
  styling), different words, no new visual system.
- Below the fold: the vertical's own FAQ/outcome content (existing copy
  model, untouched) gets the same "entrance stagger, no scroll-scrub"
  treatment as the home page's business-types grid — consistent motion
  grammar across the whole site, not a special case per page.
- Copy rule (binding): nowhere on a `/[vertical]` page does the word
  "vertical" appear in visitor-facing text — it's "your business," the
  business type's own name ("auto repair shops," "salons"), or the
  specific outcome. "Vertical" is an internal/engineering word only (this
  brief uses it because it's describing the codebase's own route/type
  name); the CMS/content layer already encodes this correctly via
  `displayName` in `VERTICAL_CONTENT` — the motion layer must not
  reintroduce it via, e.g., a debug label or aria text.

### `/pricing`
- No 3D, no scroll-scrub. This is a decision page — the single
  `PriceCard`-family component(s) get a fast, once, on-enter fade/slide,
  matching the home page's pricing-teaser treatment. Any plan-comparison
  table is static. Premium here means clarity and legibility, not motion.

### `/demo`
- The existing flow (business name + URL → scrape → personalized agent →
  web-call island + demo phone number, per `docs/FRONTEND_STACK.md`) is
  unchanged logic. Creative treatment: while the agent is being built
  (the scrape → personalize step), show a LIGHT version of the hero's
  "waveform straightening into transcript" state (beats 1–2 only, no
  booking/dashboard) as the loading/progress visual — it's honest (the
  visitor's own agent really is being assembled) rather than a generic
  spinner, and it re-uses an asset that already exists for the hero
  rather than commissioning a new one. Once the demo agent is ready, this
  animation resolves to a static "ready" state and hands off to the real
  `retell-client-js-sdk` web-call UI — no competing motion once the
  visitor is actually interacting with a live call.

---

## 5. Asset list — Higgsfield generation prompts + procedural fallback

Every asset below follows the anti-slop checklist (§7): no stock robots,
no purple/neon gradient blobs, no glowing orbs, no AI-sparkle iconography,
no floating abstract cubes, no particle clouds. Where a generated asset is
requested, the procedural fallback is the shipped default — generated
assets are an *enhancement* layer swapped in only after visual review
against §7, never a hard dependency of the build.

1. **Hero waveform/handset/transcript/card/dashboard-row object**
   (WebGL geometry, desktop/tablet)
   - *Not generated* — authored as data (control points) directly in
     code per §3. No Higgsfield asset needed; this keeps the flagship
     object at near-zero KB and pixel-perfect to the real UI it morphs
     into.
   - Procedural fallback: same authored data, rendered via Canvas 2D
     `path` drawing instead of three.js, for mobile/non-qualifying tiers.

2. **Hero mobile/reduced-tier loop** (short MP4/WebM, ≤2MB, muted,
   `playsinline`, poster = final frame)
   - Higgsfield prompt (video, abstract-material style, NOT literal UI —
     UI itself is composited on top in a follow-up editing pass, not
     generated): *"Extreme macro, a single continuous thin warm-neutral
     line (charcoal on off-white, no color gradient) smoothly
     straightening from a soft wave shape into a straight horizontal
     line, then folding once into a rounded rectangle outline, studio
     lighting, minimal, no text, no logo, no glow, no particles, clean
     premium product-photography aesthetic, 3 second seamless loop,
     4K, shallow depth of field."*
   - Procedural fallback (shipped default): the existing
     `LiveCallHero`-style CSS/DOM storyboard, retimed to play once
     (§3) — zero asset weight, already implemented.

3. **Section background material** (Dashboard-reveal section, subtle
   large-scale texture behind the tilted panel — desktop only, optional)
   - Higgsfield prompt (still image, seamless/tileable):
     *"Extremely subtle warm off-white paper-grain texture, almost flat,
     barely-there fine grain, no pattern, no gradient, no color beyond a
     1-2% warm neutral tint, print-quality material study, studio
     lighting, seamless tile, no objects, no text."*
   - Procedural fallback (shipped default): a CSS `background-image`
     SVG noise filter (`feTurbulence` at very low opacity, ~2%) already
     achievable inline with zero network request — visually
     indistinguishable from the generated version at the opacity used,
     so the generated asset is a nice-to-have, not a blocker.

4. **OG/social image** (`opengraph-image.tsx` already exists — this is a
   content refresh, not a new route)
   - Higgsfield prompt (still image): *"Clean product photography still
     life: a smartphone lying flat on a warm off-white surface, screen
     showing a simple booking-confirmation card UI (rounded rectangle,
     one checkmark, one line of text — abstracted, not literal pixel
     UI), soft directional studio light, one small warm coral-amber
     accent shape, generous negative space, no logo, no extra text, no
     gradient background, premium minimal aesthetic."*
   - Procedural fallback: the current `opengraph-image.tsx`'s
     code-generated (Satori/`ImageResponse`) composition, restyled with
     the same restraint rules, no photography needed at all — this is
     the lower-risk, zero-asset default; only replace it if the
     generated still genuinely reads as more premium after review.

5. **Vertical/business-type icons**
   - **Not generated, no request** — `VerticalIcon`/`VERTICAL_ICONS`
     (`packages/ui`) already maps each business type to a `lucide-react`
     glyph per `docs/DESIGN_SYSTEM.md`'s icon rule. This is intentionally
     the one place this brief says "do nothing new."

**Asset budget discipline**: at most ONE generated video loop and at most
ONE generated still are in scope for v1 (items 2 and 4); item 3 ships
procedural-only unless a reviewer explicitly asks for the generated
texture after seeing both side by side. This keeps total new binary asset
weight for the whole home route under ~2.5MB even before compression,
comfortably inside the LCP/JS budgets in §6.

---

## 6. Performance budget & lazy-load plan

### Hard budgets (binding, from the standard)
- LCP < 2.5s on a mid-range laptop.
- CLS < 0.05.
- Initial JS for the home route < 250KB gz.
- Loop assets ≤ 2MB each, AVIF/WebP stills, muted/`playsinline` video with
  a poster frame.
- Fonts already self-hosted via `next/font` (no change needed).

### Package versions to install (pnpm, exact — verify against npm/GitHub
release notes at implementation time per CLAUDE.md Rule 1, these were
confirmed current as of this research pass, Sept 2026):

| Package | Version | Why this version |
|---|---|---|
| `three` | `0.186.0` | Current stable; paired with r3f 9 below. |
| `@react-three/fiber` | `9.7.0` | r3f 9.x is the React-19-only line (repo is on React `19.2.8`); confirmed compatible with React 19.0–19.2. |
| `@react-three/drei` | `10.7.8` | drei 10.x is the companion line for r3f 9 / React 19 (peer range `^19`). |
| `gsap` | `3.15.0` | Includes `ScrollTrigger`, and — confirmed by `docs/design/FABLE5_SITE_TECHNIQUES.md` §5.1 — `SplitText`, `MorphSVG`, `DrawSVG`, and `ScrollSmoother` ship free with core GSAP now (all former Club plugins freed ~Apr 2025 after Webflow's GreenSock acquisition); use `SplitText` for the hero's per-character disclosure-text reveal (§3) instead of hand-rolling span-splitting. |
| `lenis` | `1.3.26` | Package was renamed from `@studio-freight/lenis` — install `lenis`, not the old scoped name. **Scope it to non-pinned sections only** (see §3's hero-orchestration note): `docs/design/FABLE5_SITE_TECHNIQUES.md` §5.1, citing `dappasol.com`, states Lenis "breaks stacked and pinned ScrollTriggers." If nothing on the marketing site needs smooth-scroll outside the hero/dashboard-reveal pins, it's fine to drop this dependency entirely and rely on native scroll + `ScrollTrigger` everywhere. |

Do **not** add `framer-motion`/`motion` as a second animation runtime —
GSAP covers scroll orchestration (pinning, timelines, text/SVG morphs) end
to end per the standard's own stack line ("GSAP ScrollTrigger ... for
scroll orchestration") and per `docs/design/FABLE5_SITE_TECHNIQUES.md`
§5.1's own read that Motion (the renamed Framer Motion) is "a good fit for
component-level micro-interactions... not a replacement for GSAP's
scroll-timeline/pin muscle" — i.e. not a reason to run two tween engines
on one page. Small DOM entrance fades (trust strip, business-type cards,
pricing teaser) should prefer plain CSS — `animation-timeline: scroll()`
where the reveal is a simple entry fade/translate (native, ~84% global
support per the companion doc's §2.2, zero JS cost) or a `@starting-style`
transition, with GSAP reserved for the two sections that actually need
pinning/camera-path-grade choreography (per the companion doc's own
closing recommendation, §6.7: "keep JS payload proportional to what's
earning its keep").

### Load strategy
1. **First paint**: server-rendered marketing HTML (unchanged — the home
   route stays an RSC page per `docs/FRONTEND_STACK.md`, "~zero client
   JS"), fonts already inlined via `next/font`, hero renders its
   reduced-motion-safe static/DOM fallback frame immediately so there is
   always something correct on screen with zero JS.
2. **After first paint, on idle** (`requestIdleCallback` or a Next.js
   dynamic `import()` with no SSR): run the device-qualification check
   (below). Only if it passes does the code lazily import the
   three.js/r3f/drei bundle and swap the hero's WebGL layer in — this is
   the mechanism that keeps initial JS under budget: the ~150-250KB(gz)
   r3f+three+drei bundle is NEVER part of the initial route chunk.
3. **GSAP core + ScrollTrigger** (small, ~25-30KB gz; add `lenis` only if
   §6's package-table condition for keeping it is actually true) can load
   slightly earlier than the WebGL bundle (they drive the DOM-layer
   entrance animations too, which run on every tier including mobile),
   but still via dynamic import so a visitor with JS disabled or a slow
   connection gets the static page with no broken half-loaded animation
   state.
4. **Device qualification gate** (all must pass to load WebGL; failing
   any one falls back to the Canvas2D/video tier from §3, silently, no
   error state):
   - `!window.matchMedia('(prefers-reduced-motion: reduce)').matches`
   - viewport width ≥ 768px (tablet+; phones never attempt WebGL per the
     standard's own device rule)
   - a successful, cheap WebGL context probe (`canvas.getContext('webgl2')
     ?? canvas.getContext('webgl')` succeeds — wrapped in try/catch, and
     the probe canvas is discarded immediately, never the real hero
     canvas, so a failed probe never leaves stray DOM)
   - `navigator.deviceMemory === undefined || navigator.deviceMemory >= 4`
     (the API is Chromium-only and optional — absence must pass open, not
     fail closed, since Safari/Firefox never expose it)
   - `navigator.connection?.saveData !== true` (respect explicit
     data-saver opt-in where the API exists)
5. **Video/loop assets**: `loading="lazy"` is not applicable to `<video>`,
   so use an `IntersectionObserver` to defer `src` assignment (or
   `preload="none"` + play-on-visible) for any loop below the fold (asset
   #3 in §5, if shipped); the hero's own loop (asset #2) is above the
   fold so it's allowed to start loading immediately but still only after
   the qualification gate decides that tier is the one being shown.
6. **CLS discipline**: the hero's DOM layer (headline/subhead/CTAs) is
   always present and correctly sized before any canvas/video mounts —
   the canvas/video is `position: absolute`/`inset: 0` inside a
   fixed-aspect-ratio container reserved by CSS from first paint, so its
   later mount never shifts layout.
7. **Monitoring**: reuse the existing `@sentry/nextjs` project
   (`docs/FRONTEND_STACK.md`) to capture WebGL-context-creation failures
   and Core Web Vitals regressions on the home route specifically, given
   this is the highest-risk-for-regression page in the whole app.
8. **Runtime GPU discipline** (per `docs/design/FABLE5_SITE_TECHNIQUES.md`
   §2.7, cross-referenced as "the single highest-leverage GPU-memory fix"
   and the named, concrete cause of "looks amazing on the recording, janky
   in your hand" failures) — all three apply to the hero's WebGL layer:
   - **Cap `renderer.setPixelRatio`** to ~1.5–2 rather than the raw
     `devicePixelRatio`, especially on high-DPI mobile/tablet.
   - **Pause the render loop** (`renderer.setAnimationLoop(null)`
     equivalent) whenever the hero canvas leaves the viewport
     (`IntersectionObserver`) or the tab is hidden (`visibilitychange`) —
     never animate an unseen canvas.
   - **Dynamic quality scaling as a tiered response**, not all-or-nothing:
     on a detected frame-rate drop, first reduce DPR, then disable any
     postprocessing, then simplify the line geometry's segment count —
     in that order.
   - Test on a real mid-range phone, not only desktop Chrome — the
     companion doc calls this out explicitly as a failure desktop testing
     does not catch.
9. **Automated scroll-motion verification** (per
   `docs/design/FABLE5_SITE_TECHNIQUES.md` §2.7/§4.5/§6.6): a canvas
   mid-animation reads back as black to a naive screenshot, so expose the
   hero's `ScrollTrigger` instance and a small debug object on `window`
   (dev/test builds only) so a Playwright test can programmatically set
   scroll position, call `.update()`, and assert each story beat (ring /
   answer / book / land) reaches its target transform/opacity/text state
   — wire this into the existing Playwright smoke-test plan
   (`docs/FRONTEND_STACK.md`) as a real regression test of the scroll
   story, not only a manual screenshot check during authoring. This is
   also how the "render + reduced-motion fallback" component tests this
   task requires should verify the hero/dashboard-reveal set pieces
   specifically, alongside a simple render test for everything else.

---

## 7. Anti-slop checklist (binding — grade every set piece against this)

The task brief's own forbidden list is below, extended with the concrete,
cross-referenced tells from `docs/design/FABLE5_SITE_TECHNIQUES.md` §3
(four independent write-ups converged on nearly the same list) — items
marked **[FABLE5]** are additions or sharpenings sourced from that doc; the
REVIEWER grades against this full combined list, not just the task
brief's original wording.

- [ ] No stock/generic robot imagery, anywhere, in any asset.
- [ ] No purple/neon gradient blobs or gradient meshes used as
      background decoration. **[FABLE5]** Purple-to-blue/indigo gradient
      specifically is called out as *the single most common* "this was
      AI-generated" tell across every source in the companion doc's
      survey — treat any purple or indigo anywhere on the hero as an
      automatic fail, not just "decorative gradients" generally.
- [ ] No glowing orbs, no particle clouds used for their own sake (a
      particle IS allowed only if it's a literal, labeled data point —
      e.g. never here).
- [ ] No "AI sparkle" iconography (✨-style glyphs, sparkle badges).
- [ ] No floating abstract cubes/geometric primitives standing in for
      "technology" or "AI" with no connection to the real product.
- [ ] No emoji anywhere in shipped copy or UI (matches
      `docs/DESIGN_SYSTEM.md`'s icon rule — `lucide-react` only).
- [ ] **[FABLE5]** No system sans (Inter, Roboto, Arial) used as a
      *display*/headline face — this is moot for Heyloo already (Fraunces
      is the display face per `docs/DESIGN_SYSTEM.md`, Inter is body-only
      by design), but any new component must not quietly reach for
      `font-sans` on an `h1`/hero headline out of convenience.
- [ ] **[FABLE5]** No row of 3+ visually-identical cards (same
      border-radius, one icon + heading + two lines, no hierarchy between
      them) — the business-types grid (`VerticalGrid`) already avoids this
      via its hover-reveal "See what it handles" affordance and per-card
      `heroStat` copy; any new card row must keep genuine per-item
      distinction, not just swap the icon.
- [ ] **[FABLE5]** No uniformly-applied, single-opacity shadow across
      every elevated surface — `docs/DESIGN_SYSTEM.md`'s `shadow-xs`→
      `shadow-xl` stepped system already avoids this; don't flatten it to
      one ad-hoc `box-shadow` value in new set-piece markup.
- [ ] **[FABLE5]** No vague, could-apply-to-any-SaaS headline copy — every
      headline on the page names the actual thing that happens (a call
      answered, a booking captured), matching the existing home H1
      ("Every call answered. Every booking captured.") as the bar; any new
      headline is graded against that same specificity.
- [ ] **[FABLE5]** No more than one visual effect firing at once in any
      single moment (no glow + gradient + parallax + particles stacked
      together) — each set piece's beat gets exactly the technique that
      beat needs (a morph, a count-up, a shared-element slide), never a
      combination "for richness."
- [ ] No lorem/placeholder copy in anything that ships — every line of
      transcript/booking/dashboard content in a set piece is either real
      fixture data already in the codebase (`VERTICAL_CONTENT`,
      `MOCK_CALLS`, `LiveCallHero`'s `TURNS`) or written with the same
      care as that existing fixture data.
- [ ] None of the words "tenant," "vertical," "adapter," "upsell,"
      "Primary/Secondary" appear in any visitor-facing string, alt text,
      or on-screen label (internal component/route names in code are
      exempt — this rule is about what a visitor reads or an assistive
      technology announces).
- [ ] Every set piece's motion is scroll-**linked** (scrubbed to scroll
      position) for its primary narrative moment, never
      scroll-**triggered-then-autoplaying** on its own timer while still
      in view (the one narrow exception: the mobile/reduced-tier loop,
      which is deliberately a play-once-on-enter fallback, not a scroll
      link, and is allowed to autoplay exactly once per §3).
- [ ] Every morph target is a REAL or realistically-styled product
      artifact (an actual `TranscriptViewer`/`CallFeedItem`/`StatusBadge`-
      styled element) — never a generic icon standing in for "a call" or
      "a booking."
- [ ] Only 3–4 true set pieces exist on the home page (this brief
      specifies exactly 2: the hero, and the dashboard-reveal
      tilt-and-settle) with genuinely quiet sections between them — if a
      future edit adds a third or fourth scroll-linked moment, an
      existing one must be reconsidered for removal to hold the count.
- [ ] `prefers-reduced-motion` renders a complete, correct, static page —
      reviewed with motion OFF as its own pass, not just verified not to
      crash.
- [ ] Every animation is `transform`/`opacity` only on the main thread;
      the one WebGL object lives in its own compositor layer and never
      triggers layout on the surrounding DOM.
- [ ] Mobile has zero horizontal scroll and every tap target ≥44px,
      exactly as the rest of the product already guarantees
      (`docs/DESIGN_SYSTEM.md`'s touch-target rule) — the marketing site
      does not get an exception.
- [ ] Light and dark mode are both reviewed for every set piece — the
      WebGL line object's color reads from the same `--accent`/`--neutral`
      tokens as the rest of the app (via a small JS-side token read at
      mount, not a hardcoded hex, so a token change never desyncs canvas
      color from DOM color).
- [ ] Nothing in this brief required a new provider SDK, a new external
      API call, or any change to `packages/adapters/*` — this is a pure
      presentation-layer brief; if implementation later finds it needs a
      new `packages/ui` primitive (e.g., a `ScrollScene` wrapper) to
      execute this cleanly, that is a request to the DS/frontend cluster,
      not something this brief authorizes building here.
