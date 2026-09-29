# Heyloo marketing site v2: build spec

**Direction:** "Spoken Type", the winning *editorial* direction, carrying the
after-hours story spine from *cinematic* and the scene engine from
*interactive*.
**Status:** build-ready. Nothing here needs the owner to answer before work
starts. The owner gates in §9.2 have to be answered before **WP-11 Integration**
merges; every gate ships with a default so building can go ahead.
**Critic pass (2026-09-29):** the spec was checked against the repo (templates,
terms, pricing page, `@heyloo/ui` APIs, `measure.ts`, messaging docs). Fixes
made in that pass carry the marker **(CP)** so reviewers can find them. Where
a (CP) note disagrees with older text elsewhere, the (CP) note wins.
**Supersedes, once the owner approves (logged by WP-0, §9.1):**
- `docs/design/WEBSITE_CREATIVE_BRIEF.md` §2 (no new sections, copy or order),
  §7 (set-piece cap and "no autoplay"), and the parts of §6 that cover Lenis;
- the 150–250 ms-only motion rule and the display-size cap in
  `docs/DESIGN_SYSTEM.md`, **for marketing routes only**.

**Unchanged and binding:** CLAUDE.md Rules 1–4, the perf gate
(`scripts/site-perf/budgets.ts`, never loosened), every route and CTA target, the
signup and demo logic, the legal MDX text, the pricing anti-leak rule, and the
disclosure rule.

Conventions used below:
- `svh` = small viewport height.
- "p" = scene progress, 0 to 1.
- A path starting `v2/` means `apps/web/src/components/marketing/v2/`.
- A path starting `motion/` means `apps/web/src/components/motion/`.
- A path starting `content/` means `apps/web/src/content/marketing/`.
- **(CP)** "Desktop", "≥1024" and "scroll tier" in section layouts all mean the
  scroll-tier query `SCROLL_TIER_QUERY = "(min-width: 64rem) and (min-height: 36rem)"`
  (§3.1). "Mobile", "below 1024" and "play tier" mean its complement. Short
  landscape windows (for example 1280×540) therefore get the play tier.
- **(CP)** Section layouts give pixel positions for 1440×900 as a reference
  only. The binding rule for scroll-tier stages is the proportional grid in
  §4.3. Every scroll-tier composition must also work at 1280×720 and 1366×657,
  the inner size of a common laptop.

---

## 0. Decisions at a glance

| Decision | Choice |
|---|---|
| Base direction | Editorial: the typography is the motion system, pages alternate paper and ink chapters, the only imagery is real product artifacts, and all tiers are decided in CSS. |
| Story spine (graft) | One after-hours call at **11:48 PM** to Riverside Auto Repair. A single **booking object** is followed from the call, to the booking card, to a dashboard row, to the owner's phone. The payoff is **"11:49 PM. Booked. You slept through it."** and the dawn line is **"You open at 8. Your 10:30 is already booked."** |
| Continuity | The call, where it lands, and reaching the owner form **one continuous film**: a single sticky stage with two scene modules composed on one progress value. This replaces editorial's three separate set pieces. |
| Scene engine (graft) | Each scene is a pure `createScene(root, ctx) → { measure, render(p), destroy }` and is **GSAP-free**. Four drivers can run it: ScrollTrigger scrub on desktop, native scroll if GSAP is slow, play-once on mobile and tablet, and static. |
| Mobile | It gets motion (a play-once call card with Pause/Replay, a CSS dawn, the rail, the stack, the finale) and **downloads 0 KB of GSAP or Lenis**. |
| Horizontal "day of calls" | **Cut.** The **24-hour rail switcher** replaces it: a tablist with every panel in one grid cell, plus a rolling clock and a playhead. There is no scroll hijack and there are never two clocks. |
| Stats | The four-numeral wall is **cut**. **(CP)** `docs/VERTICAL_RESEARCH.md` names **no** publisher, study or URL for any figure, so by default `SOURCES` ships empty and **no industry figure appears anywhere**. The ring beat uses a figure-free pain block. A figure (for example ~38%) returns only when G-4 supplies a confirmed, named source. It then drops into slots already reserved for it: the ring beat, the rail panels, the business pages and the footer `#sources` list (§3.4.5). |
| First screen | The H1 is text and is the LCP element. The ink film stage **peeks about 160 px above the fold**: 64 px of ink edge, the slate row (caller ID) and the "Scroll to answer ↓" cue (§4.3, CP). Mobile shows about 170 px of the call card at 390×844. |
| Colour | Paper chapters follow the visitor's theme. **Ink** marks the film chapter. The **ember** chapter (finale) is the only full-accent surface. Ember works "as a baton": one ember role per viewport. |
| Imagery | Zero raster images on home. The Higgsfield hero film and hero loop retire (−2.9 MB). |
| Runtime | Initial JS goes **from 224.1 to about 217 KB**. After interaction, desktop loads about 70 KB (GSAP, ScrollTrigger, Lenis, the lazy `boot.ts`, scenes), mobile about 17 KB (boot and scenes only), and reduced motion 0 KB (CP: recounted after the MotionBoot split, §6.2). |

### 0.1 Grafted ideas (source → where it lands)

1. **cinematic:** after-hours spine, one booking object, the payoff and dawn lines, and "Scroll to answer". See §4.3–§4.5.
2. **cinematic:** a deterministic **call envelope**. Word timing, the call-line shape and tool-chip positions all come from one pure function over the transcript. See §3.4, `call-envelope.ts`.
3. **cinematic:** **caller-phrase flights** that change into canonical card fields as they land ("Maria Alvarez" becomes "M. Alvarez"), with "Every field on this card was said on the call". See §4.3.
4. **cinematic:** the **24-hour rail switcher**, with all 8 sample calls rendered on the server and stacked in one grid cell, and a single `call-scripts.ts` source shared with the business-type pages. See §4.6.
5. **cinematic:** the CSS-only **sticky stack** of real mini-UIs. See §4.7.
6. **cinematic:** film chapter ticks that are real anchor links (they work with zero JS), plus "Skip the film". See §4.3.
7. **cinematic:** a mobile sticky CTA bar, and `trackEvent` with a `location` on every CTA. See §4.1.
8. **interactive:** the pure `render(p)` scene contract with three drivers, and the **render-resolved fallback when an import fails or is slow**. See §3.4 and §3.7.
9. **interactive:** a fixed-height mobile call card whose transcript **translates inside a clipped viewport** instead of growing. See §4.3.
10. **interactive:** "ember as baton", with one full-bleed ember closing chapter. See §2.3 and §4.9.
11. **interactive:** the **ROI calculator** "Do the math with your own numbers", with a default output rendered on the server. See §4.8.
12. **interactive:** "After-hours calls" replaces the machine-looking 100% answer rate. See §4.4.
13. **editorial (kept from the winner):** weight contrast on the variable `wght` axis; the disclosure set as display type with ember underlines; the "doors close" finale; the cropped masthead; a CI guard against static motion imports; Playwright beat capture using the `scrollY` formula; the Motion Off toggle; the kicker cycler; the price in the hero microline.
14. **editorial + cinematic:** the rolling-clock and playhead treatment, used on the dawn transition and on the rail.

### 0.2 Judge weaknesses and how this spec resolves them

| # | Weakness named by judges | Resolution in this spec |
|---|---|---|
| W1 | Editorial is "least motion-graphic"; most of the page is text rising into place. | The film adds a call line drawn from the transcript's own envelope, karaoke word lighting, phrase-to-field flights, odometers, a 3D camera move as the card lands, and the phone reach. There is also a CSS dawn clock roll, the rail playhead and clock, and a sticky stack. **(CP) Mask-rise text is limited to 3 moments**: the cover H1 settle, the film payoff and the "$299" chars. The disclosure is karaoke (opacity only, words never move), and the finale uses doors. A motion vocabulary budget (§3.8) caps any one signature primitive at 3 uses. |
| W2 | Mobile has no set piece and feels flat. | Play-once film cards: the call runs about 11 s with Pause/Replay; the landing card and phone run about 4.8 s. Mobile also gets the CSS dawn, the rail playhead, the stack's per-card micro-beats and the finale doors, while still loading **0 KB of GSAP**. |
| W3 | The arc is weaker; set pieces feel like separate chapters; there is no payoff line. | One continuous film (a single sticky stage, call → lands → reach) and the same booking object from start to end. The payoff and dawn lines are grafted in. |
| W4 | The horizontal track runs two clocks and can desync; the 430vw layer is too big; `contain` semantics are unclear; Firefox drops to a timetable; it hijacks scroll. | The horizontal track is **removed**. The rail switcher replaces it: CSS transitions triggered by class changes, one clock per scene by construction, and no scroll hijack. |
| W5 | Directional stats at 190 px raise the stakes; a stats wall before the product feels like pressure. | The stats chapter is cut. **(CP)** By default no figure ships, because none has a named source (G-4). If G-4 confirms a source for ~38%, it appears at chapter size (about 92 px, not mega) inside the ring beat, with a footnote. Other sourced figures sit at body size in rail panels. |
| W6 | The dashboard keeps "Answered 100%". | Replaced by **After-hours calls 6**. The 100% field is removed from `home.ts` in WP-11. |
| W7 | The first screen is type only and shows no product. | The ink film stage peeks about 160 px on desktop: an ink edge, the slate row with the live caller-ID chip, and "Scroll to answer ↓" (CP: the pain block starts below the fold). Mobile shows about 170 px of the call card. The microline carries the price. The kicker cycler gives a sense of fit. |
| W8 | The page is too long (about 18 screens). | **(CP, recomputed from the §1.2 heights)** About 14.5 desktop screens at 1440×900 (the film is about 32%) and about 15 on mobile, which has no sticky reserves but taller stacked sections. WP-11 measures both and reports them (§7). If desktop exceeds 15 screens, apply the shorter `FILM_TRAVEL_SVH` in §9.5. Scene lengths are tokens, so they can be shortened without re-authoring. |
| W9 | It reads as agency polish rather than a tool for the owner's shop. | Real `@heyloo/ui` specimens take most of the film. There are 8 trade-specific sample calls, a calculator that uses the visitor's own numbers, and plain-language copy. |
| W10 | Masks split every heading; clipping at leading 0.86. | Split budget of **400 spans or fewer per page**. Display type uses line-level masks, never per-character except "$299". Leading is at least 0.9 on mega/hero. Mask padding is a shared token. The full text is exposed through an `sr-only` copy (not `aria-label` on a span). Every breakpoint gets QA. |
| W11 | The clip-path entry repaints a full viewport. | Removed. Ink chapters begin with a hard edge plus the header tone change. **No clip-path animation anywhere.** |
| W12 | The kicker cycler autoplays. | It runs one pass of 3.5 s (CP: 7 × (280 + 220) ms), starting after the H1 settles. It is `aria-hidden` with a static `sr-only` line, never runs under reduced motion, and is logged in Brief v2 as the first-paint exception. The cover has **no** ring pulses. |
| W13 | Set-piece count needs a Brief v2. | Brief v2 counts **3 set pieces**: (1) the film plus its CSS dawn epilogue, (2) the sticky stack, (3) the finale doors. Quiet chapters sit between them (trust and rail; price). |
| W14 | (cinematic) First-scroll race; no fallback if an import fails or is slow. | The pre-boot state is the complete ring composition. The runtime warm-loads on `pointermove`, `touchstart`, `focusin` and `wheel`, with a 6000 ms fallback. If GSAP has not arrived 1500 ms after the scene module, the **native scroll driver** takes over. If the scene module fails, the page falls back to the storyboard (when below the viewport) or to the film's final frame, keeping the reserve (when on screen or above it). See §3.7 (CP). |
| W15 | (cinematic) The hero is forced dark for light-theme visitors. | The cover follows the theme. Ink appears only as a chapter surface, as on Apple's product pages. |
| W16 | (cinematic) The dawn change is invisible in dark theme. | Dark ink goes deeper, to 0.105, and a horizon hairline plus the clock carry the dawn. In dark theme it is **deliberately typographic**, and that decision is reviewed. |
| W17 | (cinematic) A CSS phone at 58° looks cheap. | The device is upright with 4° of tilt at most. 3D is limited to the dashboard's `rotateX` of 8° on landing. |
| W18 | (cinematic) The ember waveform is a voice-AI cliché. | It becomes a hairline **call line** drawn from the transcript envelope, in neutral colour. Ember is used only for the live playhead dot. It appears only inside the film. |
| W19 | (cinematic) `@media (…), :root[data-motion]` is invalid CSS. | The static composition is the **unguarded default**. Motion tiers require `@media (prefers-reduced-motion: no-preference)` **and** `:root[data-js]:not([data-motion="reduced"])`. See §3.1. |
| W20 | (cinematic) The dashboard is described as RSC, but `CallFeedItem` is `"use client"`. | The dashboard specimen uses the server-safe `MetricCard`, `StatusBadge` and `DataList` (deep imports). Call rows are RSC markup styled like `CallFeedItem` with preformatted strings. A visual parity check covers them. |
| W21 | (cinematic) `apps/web` does not depend on `@heyloo/templates`. | A mirrored constant plus a **parity test** that reads `packages/templates/src/shared/disclosure.ts` from disk. No new dependency. |
| W22 | (interactive) "$65,000 a year" reads as salesy. | Defaults are 3 calls a week × $200. The copy says "Your numbers, your math — not a Heyloo result." No claim is made about what Heyloo recovers. |
| W23 | (interactive) The 4000 ms fallback sits close to the measurement window. | The motion gate fallback is **6000 ms**. |
| W24 | (interactive, editorial) SplitText re-wraps after load. | There is **no runtime SplitText**. All splitting happens during SSR. |
| W25 | One-day scope is not realistic. | Static-first order: WP-0 plus the RSC markup for every section ships a correct, gate-passing page with zero motion. A cut list is in §9.4. |

### 0.3 Audit findings and how this spec resolves them

| Audit finding | Fix |
|---|---|
| The hero is a stock-looking landline still; the pin feels stuck. | There is no hero image. A text H1 is the LCP element, and the product appears in the film peek. Every beat changes both columns, and no element stays pixel-identical for more than about 8vh of scroll. |
| Type is small (h1 71, h2 44, body 15). | h1 about 140, chapter about 92, statement about 53, lede 22, body 17 (§2.1). |
| Flat colour; every section looks the same. | Paper, ink and ember surfaces. Each chapter has its own composition (§1.2). No row of identical cards. |
| No proof. | Product truth instead: the disclosure-first transcript, fields proven by the caller's own words, real UI specimens, 8 sample calls and footnoted sources. **No fabricated testimonials, logos or counters.** |
| Mobile: text-only first screen, a blank slab, transcript CLS, 8 stacked cards. | The call card peeks with the transcript clipped. The rail uses a chip row. There is a sticky CTA bar. |
| Dashboard hole, typewriter mono, 100.0%. | Columns are balanced (a mini calendar fills the gap). Times use Inter tabular figures. After-hours replaces 100%. |
| Owner phone clock overlap, "HE YLOO". | The notification sits below the clock, and the sender label uses letter-spacing, not spaces. |
| `/pricing` has no prices on its plans; the business-type page is generic. | §5: pricing is editorial but still anti-leak. Each business-type page gets its **own** call film from `call-scripts.ts`. |
| Footer shows 5 of 8 types; footer Links prefetch. | All 8 types. `prefetch={false}` everywhere. |
| No skip link; dropdown has no `aria-expanded`/Escape. | Fixed in WP-1. |

---

## 1. Concept, narrative arc, signature moments

### 1.1 Concept

The home page reads like **an editorial feature about one phone call**. The
words spoken on the call are the imagery, and type is the motion system. Every
large visual is either:
- a **real product artifact**: the disclosure sentence, the transcript, the
  `check_availability()` tool call, the booking card, a dashboard row, the text
  message on the owner's phone; or
- a **real product fact**: $299 starting price, 8 business types, the 6-step
  signup, and industry figures **only** where a confirmed, named source exists
  (none by default, CP; §3.4.5).

The story runs from 11:48 PM to 6:58 AM:
1. Riverside Auto Repair closed at six, and the business line rings at 11:48 PM.
2. **Scrolling answers it.**
3. Heyloo's first words are the verbatim AI and recording disclosure, set as
   display type with two ember underlines.
4. It hears the problem, the car, a name and a time.
5. It checks real availability.
6. The four phrases the caller actually said fly into the booking card.
7. The card shrinks into the owner's dashboard as the counters tick.
8. The dashboard recedes, the owner's phone lights with a text message, and the
   page says **"11:49 PM. Booked. You slept through it."**
9. Scrolling on, the night lifts as a clock rolls to 6:58 AM: **"You open at 8.
   Your 10:30 is already booked."**

In daylight the page then answers three questions:
- Can I trust it? The fine print, said out loud.
- Does it fit my business? Eight sample calls on a 24-hour rail.
- What does it cost? $299, and your own numbers in the calculator.

It closes on the one full-ember chapter: **"Hear it for yourself."**

### 1.2 Narrative arc and chapter map (home)

| # | id | Chapter | Surface | Job | Desktop height | Mobile |
|---|---|---|---|---|---|---|
| 0 | `chrome` | Header, skip link, CTA bar, footer | follows chapter | navigate, convert, control motion | — | — |
| 1 | `cover` | Cover | paper (theme) | the promise, fit, price, peek of the film | `100svh − 64px − 160px` (min) | auto |
| 2 | `film` | The call → where it lands → your phone | **ink** | beats 1–6 of the brief, pain woven in, payoff | **460svh** (100 stage + 220 + 140) | call card + lands card |
| 3 | `morning` | Dawn + "the fine print, said out loud" | ink → paper | close the time loop; trust as a feature | 160svh dawn + about 90svh trust | auto |
| 4 | `every-business` | 24-hour rail of 8 sample calls | paper | "Does it fit my business?" and round-the-clock coverage, shown by example | about 110svh (tallest panel) | auto |
| 5 | `every-call` | Sticky stack of 4 real mini-UIs | muted paper | depth; message-first promise | 4 × 60svh + intro | list |
| 6 | `price` | $299, calculator, how you start | paper | "What does it cost?" | about 120svh | auto |
| 7 | `try` | Finale "Hear it for yourself." | **ember** | primary conversion | 100svh | auto |
| 8 | `footer` | Sitemap, sources, motion toggle, masthead | paper | honesty, navigation | about 60svh | auto |

Totals **(CP, recomputed)**: at 1440×900, cover 0.75 + film 4.6 + morning 2.5
+ rail 1.1 + stack 2.8 + price 1.2 + finale 1.0 + footer 0.6 comes to about 14.5
screens, with about 32% inside the film. Mobile is about 15 screens: there are
no sticky reserves, but the stacked sections are taller. These are estimates;
WP-11 measures `document.documentElement.scrollHeight / innerHeight` at
1440×900 and 390×844 and records the numbers.

Colour rhythm: paper → **ink** → (dawn) paper → paper → muted → paper → **ember** → paper.

Emotional line:
1. Worry: the call comes in after closing.
2. Relief: it answered honestly.
3. Delight: it booked from the caller's own words.
4. Payoff: you slept through it.
5. Then trust, fit, price, action.

### 1.3 Signature moments

1. **Scroll to answer / first words.** The ink stage peeks under the cover.
   - The first scroll brings in three "Ring." lines as hard cuts, one per ring
     (CP: an opacity cut, not a mask-rise; §3.8). The caller-ID chip flips to
     "Answered by Heyloo", and a hairline call line draws across the stage.
   - The AI's first sentence then assembles word by word, in time with the call
     line: *"Thanks for calling Riverside Auto Repair. This is Riley, their AI
     assistant — this call may be recorded."*
   - Two ember strokes draw under "their AI assistant" and "this call may be
     recorded".
   - A margin note slides in: "Disclosed: AI + recording. First words, every
     call."
2. **Every field was said on the call.**
   - The phrases "check engine light", "2019 Honda Civic", "Maria Alvarez" and
     "10:30 tomorrow morning" lift out of the transcript.
   - They fly into the booking card and change into its canonical fields as they
     land.
   - `create_booking()` and `send_sms_confirmation()` dock onto the card, and
     the product's real **"Confirmed"** status badge appears (CP:
     `StatusBadge` has no Held/Booked values, and `create_booking` writes
     `confirmed` for a booking without a deposit).
3. **The card becomes a row.**
   - The camera pulls back, and the dashboard settles from an 8° tilt.
   - The card shrinks into "Latest booking", a new call row slides in with
     Recording and Transcript chips, and the odometers tick: 13→14 calls, 4→5
     bookings, 5→6 after-hours.
4. **"11:49 PM. Booked. You slept through it."** The dashboard recedes, the
   owner's phone rises, the screen wakes to Heyloo's text, and it buzzes once.
   Scrolling on, the ink lifts while a large clock rolls from 11:49 PM to
   6:58 AM: "You open at 8. Your 10:30 is already booked."
5. **Twenty-four hours on one rail.** Eight sample calls sit on a day line (vet
   at 2:10 AM, dental at 7:02 AM, lunch-rush pickup at 12:40 PM, motel at
   9:52 PM, and so on). Choosing one slides the playhead, rolls the clock, and
   swaps in that call's disclosure-first transcript, tool calls and outcome.
   Night calls sit on ink cards and day calls on paper.
6. *(Bookend.)* **The doors close.** On the ember chapter, "Hear it for" and
   "yourself." slide in from opposite edges and lock into place. A stroke draws
   under "yourself." above a magnetic "Try a live demo".

---

## 2. Visual system

### 2.1 Type scale (marketing-only tokens)

These tokens are added to the `@theme` block in `packages/ui/src/theme/globals.css`
by WP-0 and generate utilities such as `text-hero`. Product tokens (`--text-display`,
`--text-h1…micro`) are **untouched**.
- Leading and tracking are paired with each size (`--text-x--line-height` and
  `--text-x--letter-spacing`). Never add `leading-*` or `tracking-*` on top.
- Fraunces uses `font-optical-sizing: auto` (the default), so opsz reaches 144 at
  display sizes.

| Token | clamp() | At 390 / 1440 / 1920 | Leading / tracking | Face and weight | Used for |
|---|---|---|---|---|---|
| `--text-mega` | `clamp(4rem, 0.9rem + 12.4vw, 13rem)` | 64 / 193 / 208 px | 0.9 / −0.04em | Fraunces 300–720 | dawn clock, "$299", finale lines, masthead (×1.4) |
| `--text-hero` | `clamp(3.25rem, 1.2rem + 8.4vw, 9.5rem)` | 52 / 140 / 152 px | 0.92 / −0.035em | Fraunces 330 / 720 | H1 only |
| `--text-chapter` | `clamp(2.5rem, 1.1rem + 5.2vw, 6.5rem)` | 40 / 92 / 104 px | 0.96 / −0.025em | Fraunces 320–700 | H2s, trust statements, payoff, the ring pain head ("Closed since six.", or ~38% if sourced) |
| `--text-statement` | `clamp(1.75rem, 0.95rem + 2.6vw, 3.5rem)` | 28 / 53 / 56 px | 1.05 / −0.015em | Fraunces 380 / 620 | disclosure pull-quote, film captions, stack statements |
| `--text-transcript` | `clamp(1.25rem, 0.95rem + 1.1vw, 2rem)` | 20 / 31 / 32 px | 1.3 / −0.005em | Fraunces 380 (AI) / 620 (caller) | film teleprompter turns |
| `--text-lede` | `clamp(1.125rem, 1rem + 0.45vw, 1.375rem)` | 18 / 22 / 22 px | 1.45 / 0 | Inter 400 | ledes, max 38ch |
| `--text-body-lg` | `1.0625rem` | 17 px | 1.6 / 0 | Inter 400 | marketing body copy |
| `--text-kicker` | `0.75rem` | 12 px | 1.3 / 0.12em, uppercase | IBM Plex Mono 500 | kickers, slates, timestamps, tool pills, "Sample data" |

**Weight contrast.** This is the editorial signature, and it costs zero font
bytes. `layout.tsx` loads Fraunces with `axes: ["opsz"]` and no fixed weight, so
the variable `wght` axis already ships; WP-0 confirms the 100–900 range in the
built `@font-face` and logs it as V-8.
- Setup words are 320–350 and payoff words 700–720: "Every call" light,
  **"answered."** heavy.
- In transcripts, AI turns are 380 and caller turns are 620. Speakers are told
  apart by **weight plus a mono label, never by colour**.
- Numerals use `tabular-nums` inside fixed-`ch` boxes.
- No italics (they would cost font bytes).
- Inter is never used as display type.

**Split budget.** SSR splitting uses `SplitWords`, `SplitLines` and `SplitChars`
(§3.4).
- It is allowed only in:
  - the H1 (lines),
  - the film transcript (words, for karaoke),
  - the payoff (lines),
  - the finale (lines),
  - "$299" (chars).
- Chapter H2s are **not** split; they use a block rise.
- Keep the page total under 400 split spans.
- Mask padding tokens: `--mask-pad-block: 0.1em 0.18em`, with matching negative
  margins, so Fraunces ascenders and descenders are never clipped at leading 0.9.
- **(CP) Line structure.** Each `SplitLines` line is
  `span.v2-line` (`display: block; position: relative`), which contains
  `span.v2-mask` (block, `overflow: clip`) and then `span.v2-mask__i`.
  - A line may wrap inside its mask on narrow screens. It is never
    `white-space: nowrap`.
  - Decorations such as the cover and finale underline SVGs are siblings of
    `.v2-mask` inside `.v2-line`. They are positioned absolutely at the
    baseline and are **never inside the mask**, where the 0.1em padding would
    clip a 4px stroke.

**(CP) Narrow phones (320–359 px).** `--text-mega`'s 64px floor overflows a
288px content box. For example, "Hear it for" is about 350px wide, and the dawn
clock's `9ch` box is about 317px. So:
- every mega-size element uses `font-size: min(var(--text-mega), 17vw)`;
- the H1 uses `min(var(--text-hero), 14.5vw)`.

This affects only widths below 360px. The overflow checks in §8.3 include 320
and 360.

### 2.2 Grid and spacing rhythm

- 12 columns. `Container size="wide"` gives 1376 px of content at 1440, with 24 px
  gutters from `lg` up, 16 px gutters and side margins below `md`, and an 8 px
  baseline.
- New CSS tokens, defined in WP-0's `v2/marketing-v2.css` on `.marketing-root`:
  - `--space-chapter: clamp(6rem, 3rem + 8vw, 12rem)`: vertical padding for
    quiet chapters (96 px at 390, 155 px at 1440).
  - `--space-block: clamp(2.5rem, 1.5rem + 3vw, 4rem)`: gap between a heading
    and its content.
  - `--space-tight: 1.5rem`.
  - `--header-h: 4rem`. This is the only source of the header height; it
    replaces the duplicated `STICKY_HEADER_HEIGHT_PX`.
  - `--film-peek: 160px` from `lg` up (0 below).
- Editorial asymmetry: headings and statements alternate left and right; body
  text never runs wider than 38ch at lede size; hairline rules (1px `--border`,
  or `--ink-edge` on ink) separate rows, as in a broadsheet.

### 2.3 Colour: surfaces, tokens, the baton rule

The existing tokens in `packages/ui/src/theme/globals.css` do nearly all the work.
Only two new tokens are added.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--ink` (new) | `oklch(0.17 0.008 260)` | `oklch(0.105 0.006 260)` | Ink chapter background. Dark goes deeper than dark `--background` (0.155) so chapter changes still read (W16). Added to `:root`, the `prefers-color-scheme: dark` block and `[data-theme="dark"]`. |
| `--ink-edge` (new) | `oklch(1 0 0 / 0.10)` | `oklch(1 0 0 / 0.08)` | Hairlines and chapter edges on ink. |
| paper | `--background` (neutral-50) | `--background` (0.155) | Default surface; follows the theme. |
| muted paper | `--muted` | `--muted` | `every-call` chapter only. |
| ember | `--primary` (accent-500) with `--primary-foreground` text | same | `try` chapter only. |

**Ink surface mechanics.**
- An ink chapter renders `class="heyloo-theme-dark surface-ink" data-surface="ink"`.
- `.heyloo-theme-dark` already exists in `globals.css`. It remaps every semantic
  token to the tuned dark ramp, so `MetricCard`, `StatusBadge` and the specimens
  restyle themselves.
- `.surface-ink` (in `marketing-v2.css`) sets
  `--background: var(--ink); background-color: var(--ink)` and adds
  `border-block: 1px solid var(--ink-edge)`.
- WP-0 updates the `.heyloo-theme-dark` doc comment so marketing ink chapters
  are a sanctioned use.

**Ember surface.** `data-surface="ember"`. Text is `--primary-foreground`. The
inverse CTA uses `--primary-foreground` as its background with near-white text
`oklch(0.985 0.002 260)`. Hairlines are `--primary-foreground` at 20%. Never
lower the text opacity here.

**The baton rule.** At most **one ember role per viewport**, not counting the
primary CTA. Ember is reserved for live states, the primary action and the ember
chapter. **(CP)** In the film, the playhead dot and the two disclosure
underlines are **one role**: "the live call". The "new" dot appears only after
the call layer has cleared (lands p ≥ 0.40), so the two never share a viewport.

| Chapter | Ember role |
|---|---|
| Cover | Underline under "answered." |
| Film | The live playhead dot, plus the two disclosure underlines during the Answer beat; the "new" dot on the new dashboard row during Land |
| Rail | Playhead dot |
| Price | "Get started" CTA |
| Finale | The surface itself |

Everywhere else: none. Ring indicators and highlights are neutral: highlight
pills are `--foreground` at 10% fill with a 1px border at 30%.

**Semantic colours** appear only inside product specimens (success for
Confirmed and New booking, warning for Urgent and After-hours message).

**(CP) Focus ring on ember.** `--ring` is `--accent-500`, which is ember, so it
would be invisible on the ember chapter. `.surface-ember` (WP-0,
`marketing-v2.css`) therefore sets:
- `--ring: var(--primary-foreground)`;
- `--ring-shadow-color: oklch(0.16 0.02 35 / 0.45)`.

The contrast test adds `--primary-foreground` against `--primary` at 3:1 as a
non-text pair.

**(CP) Elevation in dark theme and on ink.** Shadows vanish on dark surfaces.
Wherever this spec gives a card a `shadow-*`, it also gets
`border: 1px solid var(--border)` in dark theme. This covers the calculator
card, the stack cards and the booking card. A card that uses
`Surface tone="ink"` inside a paper chapter (the rail's night panels) always
gets `border: 1px solid var(--ink-edge)` on all four sides. `.surface-ink`'s
`border-block` applies only to chapter sections.

**Forbidden:** gradients of any kind (including dawn masks: the dawn is a
**solid** ink layer changing opacity), glows, grain, blobs, purple or indigo.

**Contrast pairs added by WP-0** to `packages/ui/src/theme/contrast.test.ts`, in
both themes:
- `--primary-foreground` on `--primary` (normal text, 4.5:1)
- near-white on `--primary-foreground` (the inverse CTA)
- dark-ramp `--foreground`, `--muted-foreground` and `--accent-text` on `--ink`
- dark-ramp `--success` text on `--ink`
- `--muted-foreground` on `--muted`

The helper in `contrast.ts` resolves OKLCH; add `--ink` to its token table.

### 2.4 Depth and texture

- Depth comes mainly from value contrast between chapters.
- CSS 3D appears in exactly two places, both in the film:
  - the dashboard settle (`perspective: 1600px`, `rotateX(8deg) → 0`);
  - the phone device (upright, tilt of 4° or less, `translateZ` layers: screen
    2px, notification 24px).
  - Never more than 5 3D layers at once.
- Shadows use the existing stepped `--shadow-xs…xl`, never flattened. The booking
  card steps from `md` to `lg` by **cross-fading two pre-set shadow layers**
  (opacity only), never by tweening `box-shadow`. On ink, elevation comes from
  surface lightness plus a border (the dark-mode rule).
- The only texture is hairline rules. There is no film grain, noise or dot field.

### 2.5 Iconography

- `lucide-react` only, at 16–20 px, with default stroke.
- Business types go through `VerticalIcon` from `@heyloo/ui/icons` (Dental stays
  `Smile`).
- Kickers use icons sparingly: `ShieldCheck` for disclosure, `Mic` for recording,
  `PhoneForwarded` for "your number stays yours".
- No emoji, no sparkle glyphs, no icon chips in a row of identical cards.

### 2.6 Imagery rules and assets

- Home ships **zero raster images**. Every visual is DOM (`@heyloo/ui` specimens,
  typography), inline SVG (the call line, strokes, checks), or CSS (the device
  chassis).
- No canvas, no WebGL, no video, no audio.
- Retired by WP-11: `apps/web/public/site/hero-film/**` (2.6 MB),
  `hero-loop.mp4/.webm` and `hero-loop-poster.*`. Tag the last commit that
  contains them (`site-v1-final`) so they can be recovered.
- Kept: `og-still*` for Open Graph. Wiring it into metadata is optional and out
  of scope.
- New assets: none. Any future generated plate has to meet `ASSETS.md` budgets and
  provide both theme takes.

### 2.7 Brand mark and chrome details

- **Wordmark:** "Heyloo" in Fraunces, weight 680, opsz auto, set as text. This
  replaces the lucide `Phone` glyph in an ember square in the header and footer.
  It is a type-only change that can be reversed in one line (owner gate G-9).
- **Footer masthead:** the same wordmark at `calc(var(--text-mega) * 1.4)`,
  cropped about 40% by the page's bottom edge with `overflow: clip`, and
  `aria-hidden`. **(CP)** Colour: `var(--foreground)` in both themes, at full
  strength and never at reduced opacity. Below 360px it uses
  `min(calc(var(--text-mega) * 1.4), 24vw)`.

---

## 3. Motion system

### 3.1 Tiers and how CSS decides them (never JS state)

| Tier | Condition (CSS) | Behaviour |
|---|---|---|
| **static** | the default, unguarded CSS | The final composed state. Film = storyboard; no reserves, no sticky, no hidden states. This is what reduced-motion, Motion Off and no-JS visitors see, and what browsers without the needed features fall back to. |
| **play** | `motion-ok` and **not** `SCROLL_TIER_QUERY`, i.e. `(max-width: 63.999rem)` **or** `(max-height: 35.999rem)` | Mobile, tablet, and short landscape windows (CP). Scenes play once when 40% visible. There are no tall reserves. |
| **scroll** | `motion-ok` and `SCROLL_TIER_QUERY` = `(min-width: 64rem) and (min-height: 36rem)` | Desktop. CSS reserves the section heights and the stages are `position: sticky`. Scenes are scrubbed by scroll. **(CP)** The height floor exists because the sticky stage cannot fit its slate, teleprompter, call line and card below 576px of viewport. |

`motion-ok` means
`@media (prefers-reduced-motion: no-preference)` **and** the element is inside
`:root[data-js]:not([data-motion="reduced"])`.

**Bootstrap (WP-0).** Extend `THEME_BOOTSTRAP_SCRIPT` in
`apps/web/src/app/[locale]/layout.tsx`. It runs before paint and `<html>` already
has `suppressHydrationWarning`:

```js
(function(){var d=document.documentElement;d.setAttribute("data-js","");
try{var t=localStorage.getItem("heyloo-theme");if(t==="light"||t==="dark")d.setAttribute("data-theme",t);
var m=localStorage.getItem("heyloo-motion");if(m==="reduced")d.setAttribute("data-motion","reduced");}catch(e){}})();
```

No-JS visitors never get `data-js`, so they see the static tier by construction.
A `<noscript>` block is not needed.

**Tailwind custom variants** go in `apps/web/src/app/globals.css` (WP-0; verify
the block syntax, V-1):

```css
@custom-variant motion-ok {
  @media (prefers-reduced-motion: no-preference) {
    &:where(:root[data-js]:not([data-motion="reduced"]) *) { @slot; }
  }
}
@custom-variant scroll-tier {
  @media (min-width: 64rem) and (min-height: 36rem) and (prefers-reduced-motion: no-preference) {
    &:where(:root[data-js]:not([data-motion="reduced"]) *) { @slot; }
  }
}
@custom-variant play-tier {
  @media (max-width: 63.999rem) and (prefers-reduced-motion: no-preference),
         (max-height: 35.999rem) and (prefers-reduced-motion: no-preference) {
    &:where(:root[data-js]:not([data-motion="reduced"]) *) { @slot; }
  }
}
@custom-variant sda { @supports (animation-timeline: view()) { @slot; } }
```

Plain `.css` files use the equivalent nesting:
`@media (min-width:64rem) and (min-height:36rem) and (prefers-reduced-motion:no-preference) { :root[data-js]:not([data-motion="reduced"]) .film { … } }`.
**(CP)** The play-tier query is a comma list (OR) rather than `not (…)`, so it
parses in every supported browser. The query strings live once, as
`SCROLL_TIER_QUERY` and `PLAY_TIER_QUERY` in `motion-preference.ts`. A unit
test reads `apps/web/src/app/globals.css` and asserts that the variant blocks
contain those exact strings.

**Global blanket (WP-0).**
- Next to the existing `@media (prefers-reduced-motion: reduce)` rule, add the
  same declarations under `:root[data-motion="reduced"] *, …::before, …::after`.
- Add the Next.js guide's reduced-motion block for
  `::view-transition-old/new/group(*)`, both under the media query and under
  `[data-motion="reduced"]`. The `*` selector does not match these
  pseudo-elements.

**JS mirror.** `resolveTier()` in `motion/runtime/motion-preference.ts` returns
`"static"`, `"scroll"` or `"play"` and must match the CSS exactly, because the
reserves exist only when CSS says so. It re-evaluates on the `change` events of
`matchMedia(SCROLL_TIER_QUERY)` and `matchMedia('(prefers-reduced-motion: reduce)')`,
and on the `heyloo:motion-change` window event. When it changes, it kills and
recreates the scenes.

### 3.2 Loading model

```
HTML + CSS ─► FCP = LCP (H1 text, fallback font)   ─► fonts swap (adjustFontFallback, no CLS)
          ─► hydration: framework + layout chunk (MotionBoot, header tone, toggles, track bridge)
                         + page chunk (rail switcher, calculator, CTA bar)
          ─► MotionBoot (initial, ≤ 0.8 KB): isMotionAllowed()? no → stop (0 KB motion, ever)
          ─► intent gate: first pointermove | pointerdown | wheel | touchstart | keydown | focusin | scroll,
                          or 6000 ms after mount  ────────────── (measure window ends at load+1.5 s)
          ─► import("./boot") (lazy, ≤ 3 KB): scan, observers, fallback matrix, Lenis/magnetic triggers
          ─► for each [data-scene] within IntersectionObserver rootMargin "150% 0px":
                import scene-runtime (drivers, ≈3 KB) + scene module (≈5 KB each)
                tier "scroll": also loadGsap() (46.1 KB) → ScrollTrigger driver
                tier "play":   no GSAP → play-once driver
          ─► first wheel (pointer:fine, scroll tier, SMOOTH_SCROLL_ENABLED) → Lenis (≈6 KB)
          ─► [data-magnetic] present and (hover:hover) and (pointer:fine) and ≥1024 → magnetic (uses GSAP quickTo)
```

Rules:
- No `requestIdleCallback`, no import at hydration time, and no `next/dynamic`
  without the gate.
- Warm-load triggers include `pointermove` and `focusin`, so the runtime usually
  arrives before the first scroll. The measurement harness never moves the pointer
  or scrolls, so these are safe.

### 3.3 Motion tokens

WP-0 adds these to `packages/ui/src/motion-tokens.ts` and mirrors them in CSS in
`globals.css` `@theme`, then rebuilds `@heyloo/ui` `dist`. The UI tokens
150/200/250 stay the same.

| Token | JS name | Value | Use |
|---|---|---|---|
| `--duration-digit` | `MOTION_EXPRESSIVE_MS.digit` | 450 ms | clock and odometer rolls on click or class changes |
| `--duration-reveal` | `MOTION_EXPRESSIVE_MS.reveal` | 700 ms | rail line draw, one-shot reveals |
| `--duration-statement` | `MOTION_EXPRESSIVE_MS.statement` | 900 ms | H1 settle |
| `--ease-editorial` | `MOTION_EASES.editorial` | `cubic-bezier(0.22, 1, 0.36, 1)` | reveals, settles (quint-out) |
| `--ease-camera` | `MOTION_EASES.camera` | `cubic-bezier(0.65, 0, 0.35, 1)` | camera moves (= existing in-out) |
| — | `FILM_TRAVEL_SVH` | `{ call: 220, lands: 140 }` | home film reserve beyond the 100svh stage |
| — | `BUSINESS_FILM_TRAVEL_SVH` | `160` | business-type page film |
| — | `FILM_SCRUB` | `{ native: 0.6, lenis: 0.25 }` | ScrollTrigger `scrub` (never `true`) |
| — | `NATIVE_DRIVER_TAU_S` | `0.2` | native-driver smoothing time constant |
| — | `PLAY_ONCE_MS` | `{ call: 11000, lands: 4800, businessCall: 9000 }` | play tier |
| — | `INTENT_FALLBACK_MS` | `6000` | gate fallback |
| — | `GSAP_GRACE_MS` | `1500` | wait for GSAP before switching to the native driver |
| — | `SCENE_ROOT_MARGIN` | `"150% 0px"` | scene proximity |
| — | `STACK_CARD_SVH` | `60` | sticky stack step |
| — | `MAGNET` | `{ strength: 0.3, maxPx: 10, labelFactor: 0.6 }` | magnetic CTA |

`motion-tokens.test.ts` asserts that the CSS and JS copies match. Also extend the
existing test so it parses `globals.css` for the new variables.

### 3.4 Primitives to build once (WP-0)

#### 3.4.1 Runtime (client, `motion/runtime/`)

**`motion-preference.ts`**
```ts
export const MOTION_STORAGE_KEY = "heyloo-motion";           // "reduced" | "full"
export const MOTION_CHANGE_EVENT = "heyloo:motion-change";
export function isMotionAllowed(): boolean;   // !prefers-reduced-motion && html[data-motion] !== "reduced"; false on server
export type SceneTier = "scroll" | "play" | "static";
export function resolveTier(): SceneTier;     // mirrors §3.1 exactly
export function setMotionPreference(p: "reduced" | "full"): void; // writes storage + attr, dispatches event
```

**`intent-gate.ts`** wraps `deferUntilInteraction`. WP-0 extends
`apps/web/src/lib/perf/defer-non-critical.ts` with an optional third argument,
`{ events?: readonly string[] }`, leaving its **default events and the 4000 ms
default unchanged**, because PostHog depends on them.
```ts
export const INTENT_EVENTS = ["pointermove","pointerdown","wheel","touchstart","keydown","focusin","scroll"] as const;
export function onIntent(run: () => void, fallbackMs = INTENT_FALLBACK_MS): () => void;
```

**`motion-boot.tsx`** (`"use client"`, **0.8 KB gz or less**, CP). It is
mounted once in `(marketing)/layout.tsx` and renders `null`. **(CP) Why the
split:** all of the logic below would not fit the original 1.5 KB budget,
which sits inside the chunk-guard-gated layout chunk (≤ 8.5 KB). So the
initial file only gates, and everything else lives in the lazy
**`runtime/boot.ts`** (≤ 3 KB gz, loaded by `import("./boot")` after the
intent gate).
- `motion-boot.tsx` (initial) does these things only:
  - does nothing unless `isMotionAllowed()` is true, apart from subscribing to
    preference changes;
  - calls `onIntent(() => import("./boot").then(b => b.start()))`;
  - forwards `usePathname()` changes and `MOTION_CHANGE_EVENT` to
    `boot.restart()` or `boot.stop()` once `boot.ts` has loaded.
- `boot.ts` (lazy) `start()`:
  - scans `[data-scene]`;
  - watches each with an `IntersectionObserver`, using `SCENE_ROOT_MARGIN` and the
    `rootBounds === null` re-observe guard;
  - when a scene is near, runs `importScene(id)` from `scene-registry.ts`,
    `import("../scene/drivers")` and, for the scroll tier, `loadGsap()`;
  - builds the scene and attaches a driver;
  - sets `data-scene-state="live"` on the scene root.
- It rescans after `usePathname()` changes (client navigation between marketing
  routes), killing old drivers first.
- It kills and reboots on `MOTION_CHANGE_EVENT` and on media-query changes.
- `boot.ts` owns the fallback matrix (§3.7) and the Lenis and magnetic boot.
- With `?motion-debug` in the URL, `boot.ts` runs `import("./debug")`. The hook
  works in production builds.
- **(CP)** The chunk ledger (§6.1 and §6.2) counts `motion-boot.tsx` in the
  layout chunk and `boot.ts` as a post-interaction chunk.

**`scene-registry.ts`** is a **static** import map (webpack emits one chunk per
entry):
```ts
export const SCENES = { film: () => import("../scenes/film-scene") } as const;
export type SceneId = keyof typeof SCENES;
```

**`lenis-boot.ts`** runs only when `SMOOTH_SCROLL_ENABLED` (a const in this file,
default `true`) and the scroll tier with `(pointer: fine)` apply. It loads on the
first `wheel`:
```ts
export async function bootLenis(g: GsapModules): Promise<() => void>;
// new Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false, anchors: false, autoRaf: false })
// lenis.on("scroll", ScrollTrigger.update); gsap.ticker.add(t => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0)
```
- **(CP) `anchors: false`.** If Lenis intercepted in-page anchor clicks, it
  would `preventDefault` the native jump. The browser would then never move
  focus or the sequential-navigation start point, so "Skip to content",
  "Skip the film" and the chapter ticks would break for keyboard and
  screen-reader users. With `anchors: false`, native hash jumps happen and
  Lenis resyncs from the native `scroll` event. V-4 must confirm that resync.
- Window mode only.
- Copy the few `lenis.css` rules into `marketing-v2.css`; do not inject CSS
  lazily.
- Use `data-lenis-prevent` on any nested scroller.
- The drivers read `FILM_SCRUB.lenis` while Lenis is active.
- Ship with Lenis on only if the Lenis beat-position test passes (§8.3); otherwise
  flip the constant to `false`.
- The old wrapper-mode `SmoothScrollRegion` is deleted.

**`magnetic.ts`**
```ts
export function attachMagnetic(root: ParentNode, g: GsapModules): () => void;
// [data-magnetic] wrapper (a non-focusable inline-block span around the Button) follows the pointer within
// its rect + 24px via gsap.quickTo(x|y, { duration: 0.6, ease: "power3.out" }), strength MAGNET.strength,
// clamped ±MAGNET.maxPx; [data-magnetic-label] gets extra ×(MAGNET.labelFactor−1) parallax; on leave
// gsap.to(..., { x:0, y:0, duration: 0.8, ease: "elastic.out(1, 0.35)" }). Passive listeners, attached only
// while the element is intersecting. Never on keyboard focus, touch, or below 1024px.
```

**`debug.ts`** exposes
`window.__heylooScenes = { list(): string[]; progress(id): number; seek(id: string, p: number): void }`.
`seek` calls `render(p)` directly.

#### 3.4.2 Scene core (lazy, `motion/scene/`, ≈3 KB total)

**`types.ts`**
```ts
export interface SceneContext { tier: "scroll" | "play"; }
export interface Scene {
  readonly id: string;
  /** Layout reads ONLY here (FLIP rects, track widths). Temporarily clears the scene's own transforms,
   *  reads rects in one pass, restores by re-rendering the current progress. Called on create, resize,
   *  document.fonts.ready and ScrollTrigger refresh. */
  measure(): void;
  /** Writes ONLY transform, opacity, textContent, classes and data-attributes. Idempotent; never reads layout. */
  render(p: number): void;
  /** Removes every inline style/class/attribute it wrote, restoring the SSR DOM exactly. */
  destroy(): void;
}
export type SceneFactory = (root: HTMLElement, ctx: SceneContext) => Scene;
export interface Driver { refresh(): void; kill(): void; }
```

**`tween-math.ts`**
- `clamp01(x)`
- `span(p, from, to)`: local progress in 0..1
- `lerp(a, b, t)`
- `cubicBezier(x1, y1, x2, y2)`: returns a function `(t) => number`, built from the token control points
- `ease`: `{ linear, outCubic, outQuint /* editorial */, inOutCubic /* camera */, outExpo, outBack(s = 1.4) }`
- `steps(n)`

**`dom.ts`** is a write-only style writer with a per-element cache, so identical
values are never written twice:
```ts
export function setTransform(el: Element, t: { x?: number | string; y?: number | string; z?: number; scale?: number;
  sx?: number; sy?: number; rotate?: number; rotateX?: number; rotateY?: number }): void; // translate3d(...)
export function setOpacity(el: Element, o: number): void;
export function setText(el: Element, s: string): void;
export function setFlag(el: Element, name: string, on: boolean): void; // data-* flags for CSS
export function clearWrites(root: Element): void; // used by destroy()
```

**`flip.ts`**
```ts
export interface Delta { dx: number; dy: number; sx: number; sy: number; }
export function measureDelta(from: Element, to: Element): Delta; // both rects read in the same frame, identity transforms
```

**`drivers.ts`**
```ts
export function scrollTriggerDriver(scene: Scene, section: HTMLElement, g: GsapModules, o?: { scrub?: number }): Driver;
//  const proxy = { p: 0 };
//  gsap.to(proxy, { p: 1, ease: "none", onUpdate: () => scene.render(proxy.p),
//    scrollTrigger: { trigger: section, start: "top top", end: "bottom bottom", scrub: o.scrub ?? FILM_SCRUB.native,
//      invalidateOnRefresh: true, onRefresh: () => { scene.measure(); scene.render(proxy.p); } } });
//  ScrollTrigger.config({ ignoreMobileResize: true }); ScrollTrigger.refresh(true);   // after lazy create
//  document.fonts.ready.then(() => ScrollTrigger.refresh());
//  (CP) ResizeObserver on document.body (debounced 200 ms) → ScrollTrigger.refresh(): content ABOVE the film
//  (cover re-wrap after the font swap, a header menu, a toast) changes the film's start, and ScrollTrigger only
//  auto-refreshes on window resize.
export function nativeScrollDriver(scene: Scene, section: HTMLElement): Driver;
//  passive scroll listener sets target = clamp01((scrollY − top) / (height − innerHeight)); rAF lerps current→target
//  with factor 1 − exp(−dt / NATIVE_DRIVER_TAU_S); rAF stops when |Δ| < 1e-4; ResizeObserver + fonts.ready → measure.
export function playOnceDriver(scene: Scene, target: HTMLElement, o: { durationMs: number; threshold?: number /* 0.4 */;
  control?: HTMLButtonElement | null }): Driver & { pause(): void; resume(): void; replay(): void };
//  Linear clock (easing lives in the scene's beat table). IntersectionObserver threshold 0.4, once; holds at 1.
//  Pauses when the tab is hidden. Wires the optional [data-scene-control] button: "Pause" / "Replay", aria-pressed.
export function staticDriver(scene: Scene): Driver; // render(1) once (fallback only)
```
`motion/use-play-once-progress.ts` (a React hook with no consumers) is deleted by
WP-11. `playOnceDriver` is its imperative successor.

**`compose.ts`**
```ts
export function composeScenes(id: string, parts: Array<{ scene: Scene; from: number; to: number }>): Scene;
```
- `render(p)` calls the active part's `render(span(p, from, to))`.
- When p crosses a boundary, it renders the part it left at exactly 0 or 1 first,
  so shared elements hand off without a gap.
- **Handoff contract:** for any element touched by two parts, the earlier part's
  `render(1)` must leave it exactly as the later part's `render(0)` expects it. A
  unit test checks this (§8.1).

#### 3.4.3 Server-rendered primitives (`v2/primitives/`, RSC, 0 KB client)

| Component | API | Notes |
|---|---|---|
| `split-text.tsx` | `<SplitLines lines={string[]} as="h1" className />`, `<SplitWords text words?={WordTiming[]} />`, `<SplitChars text />` | Renders `<span class="sr-only">full text</span>` plus an `aria-hidden` copy made of `.v2-mask > .v2-mask__i` spans. `SplitWords` can stamp `data-t0` and `data-t1` from the envelope. |
| `call-line.tsx` | `<CallLine envelope pxPerSecond={64} height={96} variant="track" \| "flat" />` | Two SVG `<path>`s (AI channel above the axis, caller below), built from bars. `variant="flat"` is a 1px axis. `aria-hidden`. |
| `odometer.tsx` | `<Odometer value={14} from={13} digits={2} />` | One digit strip (0–9 stacked) per place inside fixed `1ch` masks. **(CP)** SSR sets each strip's final digit as a custom property (`style="--d:4"`), and CSS applies `transform: translateY(calc(var(--d) * -1em))`. The scene writes `transform` directly; `destroy()` removes only that write, so the SSR `--d` survives. Never write the SSR value as an inline `transform`, because `clearWrites` would erase it. `data-odometer`, `data-from`, `data-to`. `tabular-nums`. Strips are `aria-hidden`; an `sr-only` sibling holds the final value. |
| `footnote.tsx` | `<FootnoteRef sourceId="auto-missed" interactive?={true} />` | A superscript number from the order in `SOURCES`. `interactive` renders a link to `#source-<id>` with `prefetch={false}`. Inside the film it renders **non-interactive** text plus an `sr-only` "(source N, listed in the footer)". |
| `surface.tsx` | `<Surface tone="paper" \| "ink" \| "muted" \| "ember" as="section" id chapter?>` | Applies the classes and `data-surface` from §2.3. **(CP)** Only `chapter` surfaces (the film, the finale, and the business film when it is ink) emit `data-header-tone="ink"`, which is what the header tone observer watches. The rail's ink night cards are `Surface tone="ink"` **without** `chapter`, so they never flip the header. |
| `kicker.tsx` | `<Kicker icon? >text</Kicker>` | Plex Mono kicker style. |
| `outcome-card.tsx` | `<OutcomeCard outcome={Outcome} size="film" \| "panel" \| "mini" {...dataAttrs} />` | Booking, order ticket, message, referral and reservation-hold variants, built from `StatusBadge`, `DataList` and `Badge` (deep imports). Each field can show a "heard as '…'" mono note. Shared by the film, the rail and the business-type pages. **(CP) Hook contract**, because WP-3 cannot edit this file: <ul><li>the root spreads any `data-*` props (for example `data-film="booking-card"`);</li><li>each field value element carries `data-field="<field>"`;</li><li>each heard-as note carries `data-heard-as`;</li><li>the status sits in a `data-outcome-badge` slot;</li><li>the footer line sits in `data-outcome-footer`.</li></ul> Status uses real product values: `StatusBadge variant="booking"` `confirmed` ("Confirmed") for bookings, and `scheduled` ("Scheduled") for a deposit hold. |
| `tool-pill.tsx` | `<ToolPill name="check_availability" result? live? scramble? />` | `name()` in Plex Mono. The live dot is ember only when `live`. **(CP)** With `scramble`, the pill also renders an `aria-hidden` `[data-tool-scramble]` layer in the same grid cell as the real name text, sized to the name's `ch` width. The scene writes the scramble glyphs there and never overwrites the real name. |

#### 3.4.4 CSS primitives (`v2/marketing-v2.css`, imported by `(marketing)/layout.tsx`)

- `.marketing-root` scope: spacing tokens, `--header-h`, and
  `:root:has(.marketing-root) { scroll-padding-top: calc(var(--header-h) + 1rem) }`.
- `.surface-ink`, `.surface-ember` (§2.3), including the ember focus-ring
  override (CP).
- `.v2-mask` / `.v2-mask__i`: overflow clip plus mask padding tokens.
- `.v2-rise`: a `view()` entrance, 24px to 0, opacity 0.001 to 1, range
  `entry 10% cover 30%`. It lives only under `motion-ok` **and** `@supports`.
- `.v2-rule`: a hairline `scaleX(0 → 1)` from the left, range `entry 20% cover 35%`.
- `.v2-stroke`: SVG `pathLength="1"` with `stroke-dasharray: 1`; dashoffset goes
  1 → 0. Supports a `view()` variant and a first-paint keyframe variant.
- `@keyframes v2-settle { from { translate: 0 0.16em } }`: the H1 settle. It
  animates `translate` only; opacity is never animated on the LCP element.
- The reduced-motion `::view-transition-*` block (§3.1).
- Lenis base rules.

**Rule:** every hidden initial state (opacity 0, off-mask, dashoffset 1) exists
**only** inside the `motion-ok` guard (plus `@supports` for scroll-driven
animations). Outside those guards, content is always visible.

**(CP) Fill mode.** Every `animation-timeline: view()` or named-timeline
animation declares `animation-fill-mode: both`. Without it, an element shows
its un-animated, visible style before its range starts, then pops to hidden
when the range begins. That is a visible flash, and on a fast scroll it can
look like a layout jump. This goes in the shared `.v2-rise`, `.v2-rule` and
`.v2-stroke` rules and in every section's own timeline rules.

**(CP) Forced colors.** Under `@media (forced-colors: active)`:
- SVG strokes and call-line bars use `CanvasText`;
- the call-line "future" overlay and the stack dim overlay are
  `display: none`;
- ember-only indicators (the playhead dot, the "new" dot and the active rail
  marker) also get a 2px `CanvasText` outline, so state never depends on
  colour alone.

#### 3.4.5 Content and lib (single sources, WP-0)

**`content/disclosure.ts`**
```ts
export const DISCLOSURE_TEMPLATE =
  "Thanks for calling {{business_name}}. This is {{assistant_name}}, their AI assistant — this call may be recorded.";
export function renderDisclosure(businessName: string, assistantName: string): string;
```
`disclosure.parity.test.ts` reads `packages/templates/src/shared/disclosure.ts`
with `node:fs` and asserts that its `DISCLOSURE_LINE` literal is identical to
`DISCLOSURE_TEMPLATE`. If the owner changes the product wording, this fails CI
until the site follows.

**`content/call-scripts.ts`** holds the 8 fixture calls (§4.11). Types:
```ts
export type ToolName = "check_availability" | "create_booking" | "send_sms_confirmation" | "take_message"
  | "create_order" | "transfer_call" | "send_payment_link";   // every name exists in packages/templates
export type FactField = "customer" | "vehicle" | "service" | "time" | "item" | "party" | "matter" | "callback";
export interface CallTurn { speaker: "ai" | "caller"; text: string; facts?: Array<{ phrase: string; field: FactField }>; }
export interface ToolStep { name: ToolName; afterTurn: number; result?: string; flatSeconds?: number; }
export type Outcome =
  | { kind: "booking"; fields: Array<{ field: FactField | "phone"; label: string; value: string; heardAs?: string }>; status: "Booked" }
  | { kind: "order"; lines: string[]; pickup: string; readBack: true }
  | { kind: "message"; title: string; lines: string[]; delivered: string }
  | { kind: "referral"; title: string; lines: string[] }
  | { kind: "hold"; title: string; lines: string[]; status: string };
export interface SampleCall {
  slug: string; displayName: string; businessName: string; assistantName: string;
  receivedAt: { minutes: number; label: string }; // minutes since midnight; "11:48 PM"
  surface: "ink" | "paper";                        // derived: 8 PM–6 AM → ink
  callerNumber: string;                            // (555) 01x-xxxx fictional range
  turns: CallTurn[];                               // turns[0] = AI: renderDisclosure(...) + " How can I help?"
  tools: ToolStep[]; outcome: Outcome;
}
export const SAMPLE_CALLS: readonly SampleCall[];
export const HERO_CALL: SampleCall;               // SAMPLE_CALLS entry "auto-repair"
export function getSampleCall(slug: string): SampleCall | undefined;
```
**(CP) Facts rule.**
- A `fact` is always a phrase **the caller said**. It appears verbatim in a
  `speaker: "caller"` turn and maps to a `booking` outcome field whose
  `heardAs` equals the phrase.
- Phrase flights (§4.3) run only when a script has at least 2 facts and a
  `booking` outcome. Otherwise the flight sub-beat becomes a hold, and the
  card's fields are simply present when the card materialises.
- Scripts other than `auto-repair` may define 0–4 facts under this rule.

**`content/sources.ts`**
```ts
export interface Source { id: string; figure: string; claim: string; source: string; url: string; checkedOn: string; directional: true; }
export const SOURCES: readonly Source[];          // (CP) ships EMPTY by default
export function getSource(id: string): Source | undefined;
```
- **(CP) Correction.** Earlier drafts said "`source` and `url` are copied from
  `docs/VERTICAL_RESEARCH.md`". That is impossible: the file names **no**
  publisher, study or URL for any figure. It holds matrix summaries, some
  compiled from search snippets (CLAUDE.md Rule 1). So `SOURCES` ships **empty**.
- An entry may be added only when WP-0 (by WebSearch/WebFetch, Rule 1) or the
  owner (G-4) has opened the page and confirmed that it states the figure. The
  entry needs a named publisher and a working `url`, and it is logged in
  `docs/VERIFY.md` with `checkedOn`. `url` is required.
- A figure is rendered only if `getSource(id)` returns an entry. Every
  figure-bearing slot has a **figure-free default** that is the shipped
  default:

| Slot | With a source | Default (no source) |
|---|---|---|
| Film ring pain block (§4.3) | "~38%" block with `FootnoteRef` | Figure-free block (§4.3) |
| Rail panel stat row (§4.6) | `heroStat` at body size with `FootnoteRef` | Row omitted |
| Business cover lede (§5.2) | `heroStat` with footnote | Non-numeric `lede` from `content/v2/business-pages.ts` |
| Business pain list (§5.2) | Sourced numeric items with footnotes | Only items with no number and no measurement or competitor claim; the section is omitted if fewer than 2 remain |
| Footer `#sources` (§4.10) | `<ol id="sources">` | Not rendered |

- Footnote numbers come from the order in `SOURCES`.
- "Numeric" means the string contains a digit. The WP-9 and WP-6 render tests
  set `SOURCES = []`. They then assert two things:
  - no `heroStat` and no digit-bearing `painStats` string from `VERTICAL_CONTENT`
    appears in the rendered HTML of the rail or any business page;
  - the home render contains neither "38%" nor "917".

**`content/film-beats.ts`** is pure data and can be imported by both RSC and
scenes:
```ts
export const FILM_CHAPTERS = [
  { id: "ring",       label: "Ring",       part: "call",  from: 0.00, to: 0.10 },
  { id: "answer",     label: "Answer",     part: "call",  from: 0.10, to: 0.36 },
  { id: "understand", label: "Understand", part: "call",  from: 0.36, to: 0.74 },
  { id: "book",       label: "Book",       part: "call",  from: 0.74, to: 1.00 },
  { id: "land",       label: "Land",       part: "lands", from: 0.00, to: 0.50 },
  { id: "reach",      label: "Reach",      part: "lands", from: 0.50, to: 1.00 },
] as const; // from/to are PART-LOCAL; global = part offset via FILM_TRAVEL_SVH split
export function filmSplit(travel = FILM_TRAVEL_SVH): number; // call / (call + lands) = 0.611
export function chapterGlobalStart(id: string, hasLands: boolean): number;
```

**`home.ts`** changes in WP-0 are **additive only**:
- `dashboardMetrics.afterHoursCalls: 6`, plus a `from` value for each metric
  (13, 4, 181, 5);
- `booking` re-derived from `HERO_CALL`, with an equality test;
- "917-minute **median** response time" fixed.

`answerRatePercent` is removed in WP-11, once `DashboardPreview` has been deleted.
**(CP)** `home.ts` is a sanctioned **sequential** handoff, like the scene stubs:
WP-0 makes the additive changes and WP-11 makes the removals. No other package
touches it.

**(CP) `content/marketing/verticals.ts` factual corrections (WP-0 owns them).**
These strings are reused verbatim by the rail and the business pages, and some
contradict `packages/templates`:
- **Legal `intakeSummary[2]`** says "Consultation scheduling with disclosure of
  what the AI can and can't advise on". The legal template has **no**
  `check_availability` or `create_booking`; its tools are
  `lookup_customer`, `take_message` and `transfer_call`. It records the intake
  and an attorney follows up. Change the line to "What the AI can and can't
  advise on, said up front — then the intake goes to an attorney".
- **Real estate `competitorAnchor`** ends "in under two rings", which is an
  unmeasured performance claim. Drop the clause.
- No other `verticals.ts` edits are allowed. The `heroStat` and `painStats`
  strings stay as data, and their rendering is governed by the sources table
  above.

**`apps/web/src/lib/marketing/call-envelope.ts`** is pure, deterministic and
unit-tested, with no `Math.random` and no `Date`:
```ts
export interface WordTiming { turn: number; index: number; text: string; t0: number; t1: number; }
export interface CallEnvelope { durationS: number; sps: 20; ai: number[]; caller: number[];
  words: WordTiming[]; tools: Array<{ name: ToolName; t0: number; t1: number }>; turnStarts: number[]; }
export function buildCallEnvelope(call: SampleCall, o?: { wpm?: 165; gapMs?: 300; commaMs?: 120; stopMs?: 220; toolFlatS?: 2.4 }): CallEnvelope;
export function envelopeToBars(samples: number[], o: { pxPerSecond: number; height: number; sps: number }): string; // SVG path d
export function formatCallDuration(s: number): string; // "0:47"
export function fnv1a32(s: string): number;
```
- Each word contributes a bump sized by its syllable count (vowel-group
  heuristic), with jitter `0.7 + 0.3 × (fnv1a32(word + index) % 1000) / 1000`.
- Tool calls and turn gaps are flat.
- The call's displayed duration (in the film slate "Call ended · 0:47" and in the
  dashboard row) always comes from `formatCallDuration(envelope.durationS)`.
  Never hard-code it.

**`apps/web/src/lib/analytics/marketing-track.ts`** plus
**`apps/web/src/components/analytics/track-bridge.tsx`** (`"use client"`, 0.5 KB or
less, mounted in the marketing layout):
- The bridge adds one delegated `click` listener for `[data-track]`. Props come
  from `data-track-location` and `data-track-vertical`.
- On each pathname it fires page events from `[data-page-event]` elements
  (`home_viewed`, `pricing_viewed`, `vertical_landing_viewed{vertical}`).
- Events queue (capped at 50) until `providers.tsx` calls
  `connectMarketingAnalytics(trackEvent)` inside its existing deferred
  `import("@heyloo/analytics")`.
- **`posthog-js` is never imported statically.**
- Event names are exactly the FRONTEND_SPEC §3 names.

### 3.5 Scene authoring rules (binding for WP-3 and WP-4)

1. `render(p)` is pure over DOM writes and reads no layout. Measurements happen in
   `measure()` only.
2. Only transform, opacity, SVG `stroke-dashoffset` (small SVGs only),
   textContent, classes and data attributes may change. **Never** width, height,
   top, left, font-size, font-variation, `box-shadow`, filter, backdrop-filter or
   clip-path.
3. Every element is laid out at its **final** position and size by SSR. Motion
   works from offsets on top of that. **(CP)** SSR DOM with no inline styles is
   the **static-tier composition**, and `destroy()` restores exactly that.
   - **Text that changes during a scene is never swapped with `textContent`.**
     This covers the caller chip (incoming → answered), the slate status
     (live → "Call ended · 0:47") and the ring counter.
   - Instead, every variant is SSR'd as a sibling in one grid cell
     (`display: grid; > * { grid-area: 1 / 1 }`), so the widest variant
     reserves the size. The scene sets `data-state="<variant>"` on the
     container, and CSS shows the matching child (opacity).
   - Pre-boot CSS shows the first variant; the static tier shows the variant
     named in §4.3.
   - `setText` is allowed **only** on `aria-hidden`, fixed-width
     (`ch` + `tabular-nums`) readouts: the play-tier time readout and the tool
     scramble layer.
   - This rule is what lets pre-boot CSS equal `render(0)` (rule 6) at all,
     since CSS cannot change text.
4. Each beat gets **one effect**. A beat's secondary tweaks (for example a
   caption swap) happen only on **hold plateaus** (at least 0.02 p with nothing
   moving).
5. At most 6 moving composited layers at once. `will-change: transform` is set
   through a `data-active-beat` class toggled by the scene, never left on
   permanently.
6. `render(0)` must equal the pre-boot CSS state exactly (§4.3), so boot never
   causes a visible jump. **(CP) How this is tested:** jsdom does not apply
   stylesheets, so the pre-boot state lives as data in
   `content/film-beats.ts`:
   `FILM_PREBOOT: ReadonlyArray<{ selector: string; opacity?: number; transform?: string; state?: string }>`.
   - `film.css` implements each row by hand.
   - vitest asserts that `render(0)` writes exactly these values.
   - WP-10's `marketing-v2.spec.ts` asserts that the browser's computed styles
     equal the same table right after load, before the intent gate (no
     pointer, under 6000 ms).
7. **(CP)** Never set opacity or transform on a `[data-film-part]` layer
   itself. Fade its children. The handoff element (the booking card) lives
   inside the call part and must stay visible while its siblings fade.
8. Word karaoke changes opacity only (0.3 ahead of the playhead, 1 behind).
   Words never move once the karaoke starts.
9. Decorative duplicates (flight chips, ring words, the call line, highlight
   pills) are `aria-hidden`. Real text stays in DOM order and stays in the
   accessibility tree, hidden with **opacity** only (never `visibility` or
   `display`).
10. The film contains no focusable elements except: "Skip the film", the chapter
   ticks (scroll tier), and the Pause/Replay control (play tier). None of these
   is ever at opacity 0 while focusable. **(CP)** Specimen chips
   ("Recording", "Transcript"), dashboard rows, the phone and every stack
   mini-UI are non-interactive `span`/`div` markup: no `button`, no `a`, no
   `tabindex`.

### 3.6 Reduced-motion contract

1. The **default CSS is the final composition.** Reduced motion, Motion Off and
   no-JS visitors all get the static tier: storyboard film, no reserves, no
   sticky scenes, no hidden states.
2. `isMotionAllowed()` is checked **before** creating any IntersectionObserver,
   ScrollTrigger, rAF loop, listener or `import()`. Under reduced motion the
   motion runtime downloads **0 KB** and creates nothing. There is no
   create-then-teardown.
3. Turning on Motion Off (the footer switch or the mobile menu) triggers
   `MOTION_CHANGE_EVENT`. That kills every driver, calls `scene.destroy()`
   (restoring the SSR DOM) and destroys Lenis. The CSS reserves collapse. That is
   a user-initiated layout change and does not count toward CLS.
   **(CP) Keep the user's place.** Collapsing roughly 4 screens of reserve
   above the footer would throw the reader somewhere else, and Safari has no
   scroll anchoring. So `setMotionPreference()`:
   - reads the invoking control's `getBoundingClientRect().top` before it
     dispatches;
   - after two `requestAnimationFrame`s, calls
     `window.scrollBy(0, newTop − oldTop)` (instant), so the switch stays
     under the pointer or finger.
   Turning motion back on uses the same mechanism.
4. **(CP) The OS setting wins.** When `prefers-reduced-motion: reduce` matches,
   the Motion switch renders checked ("On") with `aria-disabled="true"` and the
   helper text "Set by your device". CSS guards make it impossible to turn
   motion on from the site in that case, and the control must not pretend
   otherwise. The "On"/"Off" state text sits in a `min-width: 3ch` box, so its
   post-hydration resolution never shifts layout.
5. Opacity cross-fades of 200 ms or less are allowed only where state changes on
   user input (rail panel swap). The blanket rule makes them instant anyway.
6. Nothing autoplays for more than 5 s without a pause control. The play-tier
   call card has Pause/Replay. The kicker cycler lasts 3.5 s (CP: the old
   timing, 7 × (220 + 300) ms, came to 3.64 s and broke its own 3.6 s cap).
   The lands card lasts 4.8 s.
7. Hydration safety: never call `matchMedia` in render or in a `useState`
   initializer. State starts SSR-equal and resolves in an effect.
8. Every new component test file includes a **reduced-motion test**: the static
   composition is present, and no IntersectionObserver or `import()` was created.
   This is the repo rule.

### 3.7 Failure and fallback matrix

| Situation | Behaviour | CLS |
|---|---|---|
| No JS | The static storyboard (no `data-js`). | 0 |
| JS on, before the intent gate | The scroll and play tiers show the **ring** composition: CSS applies `FILM_PREBOOT` (§3.5 rule 6). Every `[data-beat]` except `ring` is hidden. This is a complete, meaningful frame: slate, incoming caller-ID chip, the pain block (figure-free by default), "Scroll to answer". | 0 |
| Scene module ready, GSAP not ready within `GSAP_GRACE_MS` (1500 ms) | Attach `nativeScrollDriver`. It is never swapped out later. | 0 |
| GSAP import rejects | `nativeScrollDriver`. | 0 |
| Scene module import rejects, or has not resolved 2000 ms after the first scroll while the section is within 1 viewport | If the section's top is **below** the viewport: `data-scene-state="storyboard"`, which makes the section's CSS drop the tier layout. Only off-screen content moves, so this is layout-neutral. **(CP)** If the section is **on screen or entirely above the viewport**: keep the reserve and set `data-scene-state="static"`, which shows **only the final frame of the last part**, never every beat at once, because the beats overlap in the stage grid. <ul><li>Home: the reach frame, which is the payoff lines, the lede and the phone with its notification.</li><li>Business page: the book frame, which is the book caption, the outcome card at identity and the "Call ended" slate.</li><li>All other beats stay at opacity 0.</li><li>In the play tier, where the parts are separate cards, each card shows its own final frame (call card: book frame; lands card: reach frame), and Pause/Replay is hidden.</li><li>The "Skip the film ↓" chip is emphasised.</li></ul> CSS alone produces this, so it is safe when no scene JS ran. | 0 |
| Play tier, card leaves the viewport mid-play | Pauses; resumes when the card re-enters. | 0 |
| Tab hidden | All drivers pause their rAF loops. | — |
| Runtime error inside `render` | Caught once per scene, then `staticDriver` (`render(1)`, which equals the same final frame as `data-scene-state="static"`) and `console.error`. Browser Sentry is intentionally absent on marketing. | 0 |

### 3.8 Motion vocabulary budget (one effect per beat, no primitive in more than 3 places)

**(CP)** The previous table listed the disclosure as a mask-rise, although
§3.5 rule 8 makes it opacity-only karaoke. It also left the ring lines, the
"$299" chars, three extra stroke draws (the badge check, the stack delivery
checks and the funnel line) and five hairline draws unaccounted for. The table
below is now the **complete** list for home.
- The cap of 3 applies to **signature** primitives.
- **Utility** entrances (`.v2-rise` block rise, `.v2-rule` hairline `scaleX`,
  and opacity steps) are uncapped, but two never run in the same viewport at
  once.

| Primitive | Kind | Where on home |
|---|---|---|
| Line or char mask-rise | signature (3) | Cover H1 (settle only), film payoff lines, "$299" chars. The finale uses doors; the ring lines are opacity cuts. |
| Word karaoke (opacity) | signature (1) | Film transcript |
| SVG stroke draw | signature (3) | Cover underline, disclosure underlines, finale underline. The badge check, stack delivery checks and funnel line are **not** strokes. |
| Digit roll (odometer or clock) | signature (3) | Film counters, dawn clock, rail clock |
| FLIP flight | signature (2) | Film phrase-to-field flights, film card-to-row |
| Sticky stacking | signature (1) | Every-call stack |
| Magnetic | signature (2) | Cover and finale primary CTAs only |
| View transition | signature (1) | Rail outcome morph (plus the stretch morph, §9.4) |
| Block rise `.v2-rise` | utility | Trust statements, morning H2, stack micro-beat 2, price statements and plan rows, finale CTAs |
| Hairline `scaleX` `.v2-rule` | utility | Morning horizon, trust rules, rail day line, price funnel line |
| Opacity step | utility | Ring lines, stack delivery checks, funnel nodes, status badges |

---

## 4. Home page, section by section

### 4.0 Page composition (WP-11 writes this `page.tsx`)

```tsx
// apps/web/src/app/[locale]/(marketing)/page.tsx — RSC; setRequestLocale first; deep @heyloo/ui imports only
<>
  <Suspense fallback={null}><RoleGuardToast /></Suspense>
  <span hidden data-page-event="home_viewed" />
  <Cover />                                                        {/* v2/cover/cover.tsx */}
  <FilmSection id="film" script={HERO_CALL} surface="ink"
     travel={FILM_TRAVEL_SVH} lands={<FilmLands />}                {/* v2/film/film-lands.tsx (includes reach) */}
     skipTo="#morning" />                                           {/* v2/film/film-section.tsx */}
  <Morning />                                                      {/* v2/morning/morning.tsx */}
  <RailSection />                                                  {/* v2/rail/rail-section.tsx */}
  <StackSection />                                                 {/* v2/stack/stack-section.tsx */}
  <PriceSection location="home" />                                 {/* v2/price/price-section.tsx */}
  <Finale location="home" />                                       {/* v2/finale/finale.tsx */}
  <MobileCtaBar location="sticky" />                               {/* v2/chrome/mobile-cta-bar.tsx */}
</>
```
The layout (WP-0) wraps `<main id="main" tabIndex={-1} className="marketing-root flex-1">`
and mounts `<MotionBoot/>` and `<TrackBridge/>`. The footer comes from the layout.

**Ownership rule for section CSS.** Each section owns a `.css` file next to its
component and imports it from that component (global CSS imports are allowed in
the App Router). Class names are prefixed per section: `.cover__*`, `.film__*`,
`.lands__*` (CP: WP-4's part of the film), `.morning__*`, `.rail__*`,
`.stack__*`, `.price__*`, `.finale__*`, `.chrome__*`. Sections never style each
other's classes. The only shared selectors are the `data-*` hooks in §4.3,
and only WP-3's `film.css` writes rules against `[data-beat]` and
`[data-film-part]`.

---

### 4.1 `chrome`: header, skip link, mobile CTA bar, motion toggle

**Files (WP-1):**
- `apps/web/src/components/marketing/marketing-header.tsx`
- `apps/web/src/components/marketing/marketing-footer.tsx`
- `v2/chrome/skip-link.tsx`
- `v2/chrome/use-header-tone.ts`
- `v2/chrome/motion-toggle.tsx` (`"use client"`)
- `v2/chrome/mobile-cta-bar.tsx` (`"use client"`)
- `v2/chrome/sources-list.tsx`
- `v2/chrome/masthead.tsx`
- `v2/chrome/chrome.css`
- `apps/web/messages/en.json` (new Nav and Footer keys)

**Content.**

The header keeps every current item and route:
- the wordmark "Heyloo" (§2.7) → `/`;
- "Business types" (VerticalIcon plus displayName for the 7 non-generic types);
- Pricing;
- "Try a live demo";
- ThemeToggle;
- "Log in";
- "Get started".

Every `<Link>` keeps `prefetch={false}`. Analytics: header demo and signup links
carry `data-track="demo_cta_clicked" data-track-location="header"` and
`data-track="signup_cta_clicked" data-track-location="header"`.

New elements:
- A "Skip to content" link, the first focusable element, targeting `#main`.
- The Business-types menu becomes a real disclosure: a button with
  `aria-expanded` and `aria-controls`, Escape closes it and returns focus, and it
  closes on outside click. It still opens on hover from `lg` up.
- `aria-hidden` on the Menu and X icons.
- A "Motion" switch in the mobile menu.

Motion toggle: `role="switch"`, `aria-checked`, label "Reduce motion", and the
state text "On" or "Off". It is rendered in the footer and in the mobile menu.
**(CP)** When the OS reduces motion, the switch is checked and
`aria-disabled="true"`, with "Set by your device" (§3.6 rule 4). It keeps its
own viewport position across the reserve collapse (§3.6 rule 3).

Mobile CTA bar: "Try a live demo" (primary, 48px) and "Get started" (outline,
48px). The optional `vertical` prop prefills `?vertical=` on both. Tracking
location is `sticky`.

**Layout.**

| Element | Desktop (≥1024) | Mobile |
|---|---|---|
| Header | `h-16`. Over paper: current look. Over ink or ember chapters (`data-tone="ink"`): gets `heyloo-theme-dark`, background `--ink` at 72% (static, no blur on ink), hairline `--ink-edge`. | `h-16`, 44px hamburger. |
| Mobile CTA bar | Hidden (`display: none` from 64rem up). | **(CP)** Shown below **64rem**, including tablets. Earlier text reserved padding only below 767px, so the bar covered content from 768 to 1023. `position: fixed; bottom: 0`, 72px plus `env(safe-area-inset-bottom)`, two buttons side by side. Background `var(--background)` (it follows the page theme, including over the ink film) with a 1px `--border` top hairline. **(CP) No body padding and no spacer.** The global `body { padding-bottom }` would have added 72px of blank space to every marketing page without a bar (blog, legal, demo, signup). Instead the bar is never shown once the finale has been reached (visibility rule below), so it can never permanently cover page-bottom content. `chrome.css` sets `:root:has(.chrome__cta-bar) { scroll-padding-bottom: calc(72px + env(safe-area-inset-bottom) + 8px) }` below 64rem, so a focused element is never hidden behind the bar (WCAG 2.4.11). |

**Choreography.**
- Header tone: `use-header-tone.ts` sets up an IntersectionObserver on
  **`[data-header-tone="ink"]`** (CP; chapter surfaces and the morning tone
  sentinel only, never the rail's ink night cards) with
  `rootMargin: "-32px 0px -95% 0px"` and sets `data-tone` on `<header>`. Only
  colour and background change, over 200 ms `--ease-out`.
- CTA bar: an IntersectionObserver on `[data-cta-anchor]` (the cover CTA row) and
  `[data-cta-hide]` (the finale). **(CP) It shows only when both hold:**
  - the anchor is not intersecting;
  - the finale's top is still **below** the viewport bottom (`boundingClientRect.top > rootBounds.bottom`).

  Once the finale has been reached, the bar stays hidden, including over the
  footer, and reappears only when the user scrolls back above the finale. The
  transition runs from `translateY(110%)` to 0 over 250 ms `--ease-out`, with
  `inert` and `aria-hidden` while hidden. If the anchor starts below the fold
  (small phones), the bar shows immediately. A page with no `[data-cta-anchor]`
  (`/pricing`) shows the bar from hydration.

**Reduced motion.** Tone and bar changes happen instantly, with no transitions.

**Reserved sizes / CLS.** Header height is constant. The bar is fixed and
never reserves space: it is hidden wherever it could cover final content. The
tone change is paint-only.

**Primitives.** None beyond Surface tokens.

**Budget.** The header adds 0.5 KB or less (IntersectionObserver and menu a11y).
MotionToggle is 0.4 KB or less; MobileCtaBar 0.4 KB or less.

**Footer (WP-1, §4.10).**

---

### 4.2 `cover`: the promise

**Files (WP-2):**
- `v2/cover/cover.tsx` (RSC)
- `v2/cover/kicker-cycler.tsx` (RSC)
- `v2/cover/cover.css`
- `content/v2/cover.ts`

**Content (real DOM text).**
- Kicker (Plex Mono): **"AI RECEPTIONIST FOR"** plus the cycler. The stops, which
  are short marketing labels, not displayName, are: auto repair shops → vet
  clinics → law firms → dental practices → real estate teams → motels →
  restaurants → **your business** (resting state). A static
  `<span class="sr-only">AI receptionist for local service businesses</span>`
  replaces the `aria-hidden` cycler for assistive technology.
- **H1** (approved copy, Fraunces): "Every call / answered. / Every booking /
  captured." Lines 1 and 3 are weight 330; "answered." and "captured." are 720.
- The ember underline is inline SVG under "answered." (`pathLength="1"`, 4px
  stroke, `aria-hidden`). **(CP)** It is a sibling of that line's `.v2-mask`,
  not inside it (§2.1).
- Lede: "Heyloo picks up your business line, books real appointments into your
  calendar, takes orders and messages, and sends you the details by text or
  email. It always opens by saying it's an AI and that the call may be
  recorded." **(CP)** The old wording was "texts you the details". Per
  `docs/design/MESSAGING_PROVIDERS.md`, owner alerts go out **by email today**;
  SMS follows only once the tenant's texting sender is carrier-approved (G-6).
- CTAs, in `data-cta-anchor`:
  - "Try a live demo" → `/demo`: primary, `size="lg"`, wrapped in
    `<span data-magnetic>`, `data-track="demo_cta_clicked" data-track-location="hero"`;
  - "Get started" → `/signup`: outline, `data-track="signup_cta_clicked" data-track-location="hero"`.
- Microline: "Starting at $299/mo · No per-call penalty".

**Desktop (1440×900).**
- Section `min-height: calc(100svh - var(--header-h) - var(--film-peek))`.
- Content is bottom-weighted with 48px bottom padding.
- Kicker row at the top of the content (top padding 56px).
- H1 at `--text-hero` (about 140px) spans columns 1–12 on 4 lines (about 515px
  tall). The layout uses the short lines:
  - the lede (`--text-lede`, max 34ch) sits in columns 8–12, top-aligned with line 1;
  - the CTA stack and microline sit in columns 9–12, bottom-aligned to the
    baseline of "captured.".
- From 1024 to 1279: the H1 is about 110px, and the lede and CTAs stack under it
  in columns 1–8.
- **The ink film stage peeks about 160px below.** **(CP)** Exact contents, from
  §4.3's stage grid:
  - 64px of ink under the header line;
  - the slate row (32px);
  - the "Scroll to answer ↓" cue row.

  Nothing else from the film is above the fold at 1440×900. The pain block
  starts lower. This is acceptance-tested (§7, WP-2).
- **(CP)** At 1280×720 and 1366×657 the cover's content is taller than
  `100svh − 224px`. The section grows (`min-height` only), and the peek may
  shrink to 0. That is accepted: the H1, lede and CTAs must remain fully
  above the fold at 1366×657.

**Mobile (390×844).**
- Kicker on 2 lines, then the H1 at 52px on 4 lines (about 191px).
- Lede at 18px, then CTAs stacked full-width at 48px, then the microline.
- Content ends around y 670, and the ink call card peeks about 170px (slate,
  caller chip, cue).
- `overflow-x: clip` on the section.

**Choreography (first paint, CSS only, no JS).** Effects run in sequence, never
two at once:
1. **0–1.1 s:** the H1 line spans run `v2-settle` over 900 ms `--ease-editorial`,
   staggered 70 ms by `--i`. Only `translate` is animated; **opacity is never
   animated** (the H1 is the LCP element).
2. **0.45–1.55 s:** the underline stroke draws (dashoffset 1 → 0, 1100 ms,
   `--ease-editorial`).
3. **1.6–5.1 s (CP):** the kicker cycler runs one pass. It is a vertical strip
   inside a fixed `22ch` mask. The sequence is 7 steps, each a 280 ms hold on the
   current label followed by a 220 ms move with `--ease-editorial`, so
   7 × 500 = 3500 ms in total. It ends on "your business". It is one
   `@keyframes` with `animation-delay: 1.6s` and `animation-fill-mode: both`.
   `both` rather than `forwards` makes the first label show during the delay,
   with no jump at 1.6 s. The strip's **un-animated** transform shows "your
   business", which is what the static and reduced tiers see.

After the gate, from 1024 up with `(pointer: fine)`, the primary CTA becomes
magnetic.

**Reduced motion.** Static final state: the underline is drawn, the kicker reads
"your business", there is no magnet. These are the default styles; every
animation sits under `motion-ok`.

**Reserved sizes / CLS.** The kicker slot is a fixed `22ch`. Transforms only. No
images. The H1 is never at opacity 0. **(CP) Font-swap CLS.** Fraunces loads with
`display: swap`. The fallback's `adjustFontFallback` metrics are tuned to one
weight, so the 720-weight lines can be wider in one face than the other, and a
line that wraps in one face but not the other would shift on swap (field CLS on
phones). At 320, 360, 390, 768, 1024 and 1440, every H1 line must fit its box in
**both** faces with ≥ 6% spare width. This is tested (§8.3) by loading once with
the Fraunces request aborted and once normally, then comparing the H1's height.
If a width fails, change the line breaks or the `min()` clamp; never the copy.

**Primitives.** `SplitLines`, `.v2-stroke`, magnetic.

**Budget.** 0 KB JS.

---

### 4.3 `film` (part 1): the call

**Files (WP-3):**
- `v2/film/film-section.tsx`
- `v2/film/film-slate.tsx`
- `v2/film/film-chapter-rail.tsx`
- `v2/film/film-call.tsx`
- `v2/film/teleprompter.tsx`
- `v2/film/film.css`
- `content/v2/film.ts` (captions)
- `motion/scenes/film-scene.ts` (compose)
- `motion/scenes/call-scene.ts`
- tests

**`FilmSection` API** (RSC, flat named export):
```ts
export interface FilmSectionProps {
  id: string; script: SampleCall; surface: "ink" | "paper";
  travel: { call: number; lands?: number };   // svh beyond the stage (FILM_TRAVEL_SVH or BUSINESS_FILM_TRAVEL_SVH)
  lands?: React.ReactNode;                     // slot for WP-4's <FilmLands/> (home only)
  skipTo: string; headingSr?: string; trackVertical?: string;
}
```
The section sets:
- `data-scene="film"`;
- `data-film-split` (computed from `travel`);
- CSS custom properties `--film-travel-call` and `--film-travel-lands`;
- the surface classes.

**DOM hook contract.** WP-3 and WP-4 must follow it exactly:

| Hook | Owner | Meaning |
|---|---|---|
| `[data-film-part="call"]`, `[data-film-part="lands"]` | WP-3 / WP-4 | part layers |
| `[data-beat="ring\|answer\|understand\|book\|land\|reach"]` | both | beat groups (pre-boot CSS hides all but `ring`) |
| `[data-film="booking-card"]` | WP-3 | the **handoff element** |
| `[data-film-slot="latest-booking"]` | WP-4 | the card's landing rect in the dashboard |
| `[data-film-tick="<chapter>"]` | WP-3 | chapter rail links |
| `[data-scene-control]` | WP-3 | Pause/Replay button (play tier) |
| `[data-word][data-t0][data-t1]` | WP-3 | karaoke words |
| `[data-fact="<field>"]`, `[data-field="<field>"]`, `[data-flight="<field>"]` | WP-3 | highlight, card field, flying chip |
| `[data-call-track]`, `[data-call-playhead]` | WP-3 | call line track and playhead |
| `[data-odometer]` | WP-4 | counters |

**Content (from `HERO_CALL` and `content/v2/film.ts`).**

Slate (Plex Mono), all `aria-hidden` except the `sr-only` film heading:
- left: "01 — The call · 11:48 PM";
- centre: a caller chip with **(CP) three SSR'd variants in one grid cell**
  (§3.5 rule 3), switched by `data-state`:
  - `incoming`: "Incoming · (555) 014-2290 → Riverside Auto Repair · Ring 1/2/3".
    The ring count is itself three stacked variants.
  - `answered`: "Answered by Heyloo · 00:01".
  - `ended`: "Call ended · {formatCallDuration}".

  Pre-boot and render(0) show `incoming` with Ring 1. The static tier shows
  `incoming` (storyboard panel 1 is the incoming call).
- right: "Sample call · illustrative".
- **(CP)** The cue row sits directly under the slate (§4.3 stage grid):
  "Scroll to answer ↓" in the scroll tier, nothing in the play tier, and
  "Here's how that call went ↓" in the static tier (three variants, CSS by
  tier).

The `sr-only` h2 reads "One call to Riverside Auto Repair, start to finish".

Beat captions (left column), each a small caption group; the head is at
`--text-statement`:

| Beat | Caption |
|---|---|
| ring | **(CP) Default, figure-free pain block** (ships when `getSource("auto-missed")` is undefined): head at `--text-chapter`, weight 300: "Closed since six." Body at `--text-lede`: "At 11:48 PM, the shop's phone rings anyway. Nobody's there to pick up." **Sourced variant** (only if G-4 confirms a source): "~38%" at `--text-chapter`, weight 300, with a non-interactive `FootnoteRef`; "of calls to independent auto repair shops go unanswered."; "This one came in at 11:48 PM. The shop closed at six." Both variants occupy the same reserved block (`min-height: 3 × chapter line + 2 × lede line`), so swapping content never changes layout. The cue sits in the slate area (above). |
| answer | Eyebrow "First words, every call" (ShieldCheck). Head: "It says it's an AI. And that the call may be recorded." Margin note: "Disclosed: AI + recording. First words, every call." |
| understand | "It listens for what matters." / "The problem, the car, a name, a time." Then, on a hold, "It checks your real availability." / "An actual open slot — not a note that says 'call back.'" |
| book | "It books from the caller's own words." / "Every field on this card was said on the call." |

Ring words: "Ring." ×3, `aria-hidden`, at `--text-statement`, weights 300 / 500 /
720. The accessible text is "The phone rings three times."

Transcript: `HERO_CALL.turns` (§4.11), in the teleprompter.
- Turn 0 (the disclosure plus "How can I help?") is set at `--text-statement`,
  weight 380.
- Other turns use `--text-transcript` (AI 380, caller 620).
- Mono labels read "HEYLOO AI · 00:01" and "CALLER · 00:07", with times from the
  envelope.
- Two ember underline strokes are placed under "their AI assistant" and "this call
  may be recorded".
- The facts (highlight pills) are "check engine light", "2019 Honda Civic",
  "Maria Alvarez" and "10:30 tomorrow morning". **(CP)** All four are in
  **caller** turns. The caller's last line becomes "Yes — 10:30 tomorrow
  morning works." (§4.11), so "the four phrases the caller actually said" is
  literally true. The AI's offer contains the same phrase but gets no pill.

Tools: `check_availability()` with result "Tomorrow · 10:30 AM — open", then
`create_booking()`, `send_sms_confirmation()`, and "Confirmation texted to (555)
014-2290".

Booking card (`OutcomeCard` size `film`, `data-film="booking-card"`):
- header "Booking · Riverside Auto Repair";
- Customer **M. Alvarez** (heard as "Maria Alvarez");
- Vehicle **2019 Honda Civic** (heard as "2019 Honda Civic");
- Service **Check engine diagnostic** (heard as "check engine light");
- When **Tomorrow · 10:30 AM** (heard as "10:30 tomorrow morning");
- Phone **(555) 014-2290** (from caller ID);
- **(CP)** a `data-outcome-badge` slot, empty until `create_booking()` docks,
  then `StatusBadge variant="booking" value="confirmed"`, which renders
  "Confirmed" (success). There is no Held/Booked state: `StatusBadge` has none,
  and the product writes `confirmed` for a booking without a deposit;
- footer "Call ended · {formatCallDuration}".

**Desktop scroll-tier layout.** The stage is `position: sticky; top: 0;
height: 100svh; overflow: clip`.

**(CP) The stage is a CSS grid, and these rows are binding.** Earlier drafts
gave only absolute y values for 900px, which collide below 800px of height
(the call line at y 640–736 overflows a 720px viewport).

```css
.film__stage { display: grid; grid-template-columns: repeat(12, 1fr);
  grid-template-rows:
    var(--header-h)                       /* under the fixed header          */
    clamp(0.5rem, 1.8svh, 1rem)           /* gap                              */
    2rem                                  /* slate row                        */
    2rem                                  /* cue row ("Scroll to answer ↓")   */
    minmax(0, 1fr)                        /* main: captions | teleprompter/card */
    clamp(4rem, 10.7svh, 6rem)            /* call-line band                   */
    clamp(1rem, 4svh, 2.5rem); }          /* bottom gap                       */
```

- The call part and the lands part are **two layers in the same grid**. Both
  have `grid-row: 1 / -1; grid-column: 1 / -1`, and each defines its own
  subgrid or inner grid.
- **WP-3 owns this stage CSS and the `FILM_PREBOOT` rules for all beats**,
  including `land` and `reach` (§7).
- The rows are chosen so the first 160px of the stage (the desktop peek) holds
  exactly the header row, the gap, the slate and the cue.

| Element | Placement (1440×900 reference values in brackets) |
|---|---|
| Slate row | row 3 [y 80–112] |
| Cue row | row 4, columns 1–5 [y 112–144] |
| Left column (captions, pain block, ring words) | row 5, columns 1–5, `align-self: start`, top padding `clamp(0.5rem, 3.5svh, 2rem)` [from y 176] |
| Teleprompter viewport | row 5, columns 6–12, `height: min(44svh, 100%)` [y 168–560], `overflow: clip` on an inner list translated in y. Current turn at full opacity; earlier turns dim to 0.35. At most `floor(viewportHeight / turnHeight)` are visible, capped at 4. |
| Call-line band | row 6, full bleed [y 768–864; at 900px the rows resolve to 64 / 16 / 32 / 32 / 624 / 96 / 36]. The SVG track is `durationS × 64px` wide and translates in x under a fixed playhead at x = 43% (1px `--foreground` line plus a 6px ember dot). A static overlay covers the area right of the playhead with **`var(--background)` at 55%** (CP: `--background` resolves to `--ink` on ink and to paper on a paper-surface business film) as a "future" dim, composite only. AI bars at `--foreground` 70%, caller bars at 35%. |
| Booking card | row 5, columns 7–11, `align-self: center`, `max-height: 100%` [about y 256–656]. Appears during the book beat while the teleprompter dims to 0.15. **(CP)** Below 760px of viewport height, the card uses compact density (field rows 28px instead of 36px), set by a static height media query before paint. |
| Chapter rail | `right: 20px`, vertically centred. Six `<a href="#film-beat-<id>">` ticks (2×24px, mono label on hover or focus); the active tick is `--foreground`. Anchors are absolute spans at `top: calc((var(--global-start) + 0.01) * (var(--film-travel-call) + var(--film-travel-lands, 0)) * 1svh + var(--header-h) + 1rem)`. **(CP)** The `+ header + 1rem` term cancels the root `scroll-padding-top`, which otherwise lands every jump about 80px (≈0.025 p) early, inside the previous beat. The `+ 0.01` lands just inside the beat rather than on its boundary. Ticks and anchors are `display: none` outside the scroll tier. |
| Skip | **(CP) One link, never two.** `<a href={skipTo} data-film-skip>` reads "Skip the film ↓" and is first in the film's DOM. In the scroll tier it is **always visible** as a chip at bottom right (row 6, over the band's right edge). In the play and static tiers it is visually hidden until focused. The old "hidden link plus visible chip" pair would have created two tab stops. |

**Mobile play-tier layout (below 1024px).**
- The call part becomes a **fixed-height card**: **(CP)**
  `height: clamp(30rem, 80svh, 40rem)`, full-bleed ink, no sticky. The old
  `min(640px, 80svh)` came to about 438px on an iPhone SE (548px svh), which is
  less than the 560px of fixed rows below, so the transcript would have been
  clipped mid-line. The card may be taller than a very short viewport; it is
  not sticky, and the play driver starts at 40% visible.
- Inside, the content column is `max-width: 40rem; margin-inline: auto`, so a
  short landscape desktop window (play tier by the height rule) doesn't
  stretch it across 1280px. Top to bottom, as a flex column:
  - slate chip (56px);
  - caption area (96px; captions stacked in one grid cell, only the current one
    visible);
  - teleprompter viewport (**`flex: 1 1 auto; min-height: 9rem`**, clipped;
    current turn plus 1 previous when it fits, at 20px);
  - call-line band (64px, playhead centred);
  - control row (44px): `[data-scene-control]` Pause/Replay button plus mono
    "0:12 / 0:47". The time readout is `aria-hidden`, `tabular-nums`, `9ch`
    wide, and written with `setText`.
- The booking card overlays the teleprompter and band during the book beat
  (slides up 24px with opacity).

**Static tier (storyboard; default CSS).**
- The film is normal flow in a 5/7 grid on desktop and stacked on mobile.
- One panel per beat group, each with its caption on the left and its resolved
  artifact on the right:
  1. incoming chip plus pain block;
  2. disclosure turn with underlines drawn and the badge;
  3. the full transcript (all turns, highlights applied, tool pill and result
     inline);
  4. the booked card with "heard as" notes.
- Panels are joined by a 1px left rule, with mono timestamps (11:48:02 PM …
  11:48:49 PM) computed from the envelope.
- Ring words and the call-line track are hidden; a flat `CallLine` divider is
  shown instead.

**Pre-boot state (scroll and play tiers, before `data-scene-state="live"`).**
**(CP)** This is the complete `FILM_PREBOOT` list; the earlier three bullets
missed half the hooks.
- Every `[data-beat]` except `ring` is at opacity 0. That includes the `land`
  and `reach` beats inside `[data-film-part="lands"]`.
- Ring words (`[data-ring-word]`) are at opacity 0. They cut in during the
  ring beat.
- The caller chip has `data-state="incoming"` with ring count 1.
- The call line (`[data-call-track]` wrapper) is at `scaleX(0)` with origin left.
- `[data-word]` is at opacity 0.3. Highlight pills (`[data-fact]::before`
  layer) are at `scaleX(0)`.
- `[data-flight]` is at opacity 0. The disclosure underline paths are at
  `stroke-dashoffset: 1`. The margin note is at opacity 0 and
  `translateX(16px)`.
- Tool pills are at opacity 0. `[data-film="booking-card"]` is at opacity 0 and
  `scale(0.94) translateY(3svh)`, with its `data-outcome-badge` at opacity 0.
- The pain block is at opacity 1.
- This must equal `render(0)`, which is unit-tested and browser-tested (§3.5
  rule 6).

**Choreography.** The scroll tier maps the call part's local p over 220svh, about
1980px at 900px tall.

| p (local) | Beat | Single effect | Details |
|---|---|---|---|
| 0.00–0.08 | Ring | three "Ring." lines cut in | **(CP)** Hard opacity cuts, not a mask-rise (§3.8 budget): line *n* goes 0 → 1 over 0.004 at 0.00 / 0.025 / 0.05. The chip's ring-count variant steps 1 → 2 → 3 at the same instants. The pain block stays static. |
| 0.08–0.10 | hold | — | |
| 0.10–0.13 | Pick up | call line draws out | Ring lines fade to 0 (0.10–0.11). The chip switches to `data-state="answered"` at 0.10 (CP: variant switch, not `textContent`). Call-line band goes `scaleX 0 → 1` from the left (`outCubic`). Pain block fades to 0 (0.10–0.12). |
| 0.13–0.30 | Answer | disclosure words light up | The call clock runs from 0 to the end of turn 0. The track translates 1:1 with the clock. Words cross from opacity 0.3 to 1 as the playhead passes their `t0`. The answer caption group rises at 0.13 (block, 16px, 0.02). |
| 0.30–0.33 | Answer | two ember underlines draw | dashoffset 1 → 0, linear |
| 0.33–0.35 | Answer | margin note slides in | x 16px → 0, opacity |
| 0.35–0.38 | hold | — | **(CP)** Caption swap: answer caption → understand caption ("It listens for what matters." / "The problem, the car, a name, a time."). |
| 0.38–0.50 | Understand | the transcript advances | **(CP: ends at 0.50, not 0.52.)** Turns 1–5 play at clock speed. When a new turn starts, the list translates up by the measured height of the previous turn (0.015, `outCubic`) and older turns dim to 0.35. Each fact's highlight pill goes `scaleX 0 → 1` from the left (0.01) as its phrase passes the playhead. |
| 0.50–0.52 | hold | — | **(CP)** Caption swap to "It checks your real availability." / "An actual open slot — not a note that says 'call back.'" The old text put this swap "on the 0.52 plateau", but no plateau existed there (rule 4). |
| 0.52–0.60 | Check | tool pill resolves | Turn 6 ("One moment while I check…") has just played. Both channels go flat because the envelope has a flat tool segment. `check_availability()` scales 0.92 → 1 with opacity (0.52–0.54). A deterministic glyph scramble runs left to right in the pill's `aria-hidden` `[data-tool-scramble]` layer (CP: never over the real name). Glyphs come from the fixed table `"_/01<>"`, indexed by local progress, with no randomness (0.54–0.58). At 0.58 the scramble layer goes to opacity 0 and the real name shows. The result row rises 10px (0.58–0.60). |
| 0.60–0.64 | hold | — | |
| 0.64–0.72 | Confirm | last turns | Turn 7 (the AI offer), then **(CP)** turn 8, the caller's "Yes — 10:30 tomorrow morning works.", at weight 620. The "10:30 tomorrow morning" highlight in that caller turn fills. |
| 0.72–0.74 | hold | — | **(CP)** Caption swap to "It books from the caller's own words." / "Every field on this card was said on the call." |
| 0.74–0.78 | Book | call ends; card materializes | The slate chip switches to `data-state="ended"` ("Call ended · 0:47") at 0.74. The call line compresses (`scaleY 1 → 0.15`, opacity 0.3). The teleprompter dims to 0.15. The card goes `scale 0.94 → 1`, y 3svh → 0, opacity 0 → 1 (`outExpo`), and its shadow-layer B fades in. |
| 0.78–0.86 | Book | **four phrase flights** | `[data-flight]` chips (aria-hidden, pre-rendered) travel from the highlight rect to the field rect (`measureDelta`, `inOutCubic`), with a y arc of −3svh via a separate `sin(π·t)` term. On landing each chip cross-fades phrase → canonical text, then hands off to the real field (field 0 → 1, chip 1 → 0 over 0.006). **(CP) Exact timing:** flight *i* (0–3, in fact order) starts at `0.78 + i × 0.018` and flies for 0.020, followed by its 0.006 handoff; the last one ends at 0.860. **(CP) Origin:** `measure()` reads identity rects, but at 0.78 the teleprompter list is translated up. The origin is therefore the highlight's identity rect plus the list's translateY at p = 0.78, taken from the scene's own turn-offset table, never from a live layout read. With fewer than 2 facts (§3.4.5), this row is a hold. |
| 0.86–0.90 | Book | tools dock | `create_booking()` docks (x from the playhead rect, 0.86–0.875). The "Confirmed" `StatusBadge` in `data-outcome-badge` steps to opacity 1 at 0.875 (CP: an opacity step; no check stroke, which would break the §3.8 stroke budget). Then `send_sms_confirmation()` docks (0.88–0.895) and "Confirmation texted to …" rises. **(CP)** The caption swap to "It books from the caller's own words." happens on the 0.72–0.74 plateau at the end of Confirm. The 0.86 point is mid-motion, not a plateau. |
| 0.90–1.00 | hold | — | **Handoff state:** the card at identity transform, fully opaque. |

The **play tier** uses the same beat order, mapped to 11000 ms linearly:
- ring 0–5%, answer 5–27%, understand 27–64%, confirm 64–74%, book 74–94%, hold.
- The phrase flights stay inside the card: the booking card overlays from the
  bottom, so the flights are short and vertical.
- The Pause/Replay control is always visible.

**Scene module (`call-scene.ts`, 5 KB gz or less).**
- `createCallScene(root, ctx)` reads the DOM hooks and the timings from
  `data-t0`/`data-t1`.
- It builds a piecewise clock map `p → callSeconds`. Holds keep the clock still.
- The karaoke, the track `translateX` and the highlights all derive from that
  single clock.
- It exports `CALL_BEATS_SCROLL` and `CALL_BEATS_PLAY` for tests.
- **(CP) Business-page scripts are not the hero call.** The p values above are
  authored for `HERO_CALL`. For any other script, `deriveCallBeats(envelope, script)`
  builds the table:
  - The structure is fixed: ring 0–0.10, pick-up 0.10–0.13, answer (turn 0)
    0.13–0.35, hold 0.35–0.38, and book 0.74–1.00 exactly as above.
  - Between 0.38 and 0.72, the remaining turns and tool segments are laid out
    in proportion to their envelope seconds.
  - Every `check_availability` gets a fixed 0.08 tool sub-beat followed by a
    0.02 hold. If the script has no `check_availability`, no tool sub-beat is
    inserted before book.
  - 0.72–0.74 is always a hold.
  - Flights follow the ≥ 2 facts rule. The outcome card in `data-film="booking-card"`
    is whatever `OutcomeCard` kind the script has (order, message, referral
    or hold). Tools after the call (`create_booking`, `create_order`,
    `take_message`, `send_payment_link`, `send_sms_confirmation`) dock in the
    0.86–0.90 window in script order, evenly spaced.
  - A unit test runs `deriveCallBeats` on all 8 fixtures. It asserts ranges
    that are contiguous, monotonic and within [0, 1], and it asserts that for
    `HERO_CALL` the derived table equals `CALL_BEATS_SCROLL` within ±0.005.

**Film compose module (`film-scene.ts`).**
- It composes `call` over `[0, split]` and `lands` over `[split, 1]` when a
  `[data-film-part="lands"]` exists; otherwise it runs `call` over `[0, 1]`.
  **(CP)** It statically imports `call-scene`, but loads `lands-scene` with
  `import()` only when the lands part exists, so business pages never
  download the ≤ 5 KB lands chunk.
- It toggles `data-active` on `[data-film-tick]`.
- In the play tier it creates **two independent** play-once drivers: the call
  card (`PLAY_ONCE_MS.call`) and the lands card (`PLAY_ONCE_MS.lands`).

**Reserved sizes / CLS.**

| Tier | Size |
|---|---|
| Scroll | `#film` height `calc((100 + var(--film-travel-call) + var(--film-travel-lands, 0)) * 1svh)` = 460svh on home |
| Play | call card fixed `clamp(30rem, 80svh, 40rem)` (CP) |
| Static | auto |

- All three are set in CSS.
- No ScrollTrigger pin, so no pin-spacer and no reparenting (both OPS-7 CLS
  mechanisms and the IntersectionObserver freeze are eliminated).
- Every text node is laid out at its final size.

**Budget.** 0 KB initial JS. Post-interaction: `call-scene` plus `film-scene`
6 KB or less. Film DOM 900 nodes or fewer, and 260 or fewer word and highlight
spans.

**A11y.**
- DOM order is story order.
- The transcript is an `<ol>` of turns with the speaker as text.
- Every turn is readable, since opacity keeps it in the accessibility tree.
- Only the skip link, the ticks and the Pause control are focusable.
- A VoiceOver/NVDA pass is required (§8.6).

---

### 4.4 `film` (part 2): where it lands, and the owner's phone

**Files (WP-4):**
- `v2/film/film-lands.tsx` (renders both `land` and `reach` beat groups inside
  `[data-film-part="lands"]`)
- `v2/film/dashboard-specimen.tsx`
- `v2/film/device-phone.tsx`
- `v2/film/film-reach.tsx`
- `v2/film/film-lands.css`
- `content/v2/film-lands.ts`
- `motion/scenes/lands-scene.ts`
- tests

**Content.**

Land caption: "It lands in your dashboard." / "The booking, the transcript, and
the recording — waiting for you."

Dashboard specimen (dark-ramp tokens inherited from the ink chapter):
- Frame header "Today". A **"Sample data"** tag is always visible at the top
  right.
- Metrics: **(CP) not `MetricCard` itself.** `MetricCard` takes
  `value: number`, formats it internally, and has no slot for an `Odometer` and
  no size prop. `dashboard-specimen.tsx` therefore defines a local
  `SpecimenMetric`. It is built from the same server-safe primitives
  `MetricCard` uses (`Card`, `CardHeader`, `CardTitle` and `CardContent` from
  `@heyloo/ui/primitives/card`, deep import) with `MetricCard`'s exact classes:
  - title `text-xs font-medium text-muted-foreground`;
  - value `text-2xl font-semibold tabular-nums`, which here holds the `Odometer`;
  - an added `size="large" | "compact"` that changes only the value's
    `font-size` (large = `text-4xl`) and the card's grid span.

  A parity test renders `MetricCard` (value 14) and `SpecimenMetric` (compact)
  and asserts that the title and value class lists match. Sizes are
  deliberately unequal:

| Metric | Value (from → to) | Size |
|---|---|---|
| **Calls today** | 13 → 14 | large |
| **Bookings** | 4 → 5 | large |
| Minutes used | 181 → 182 | compact |
| After-hours calls | 5 → 6 | compact |

  Values come from `HOME_CONTENT.dashboardMetrics`.
- Latest booking: `DataList` (deep import) with M. Alvarez / 2019 Honda Civic /
  Check engine diagnostic / Tomorrow, 10:30 AM, in **Inter tabular** (not mono).
  A mini calendar strip under it shows Tomorrow's slots 8:00 (booked), 9:00
  (booked), **10:30 (new)**, 1:00 (booked), 3:30 (open). This fills the old
  240px hole. The block is `[data-film-slot="latest-booking"]`.
- Recent calls are RSC rows styled like `CallFeedItem`. They are **not** that
  client component. Strings are preformatted, and numbers and badges use
  `whitespace-nowrap`. **(CP)** Each row's badge is the real server-safe
  `StatusBadge variant="call-class"` with real product values, so the labels
  are the product's own. The earlier "Booked / Message taken / Question
  answered" strings do not exist in the product. The numbers stay in the
  fictional (555) 01x range, which the §4.11 invariant enforces; the old
  201-/883- numbers broke it.
  - (555) 014-2290 · `new_booking` ("New booking") · 11:48 PM · {duration},
    with "Recording" and "Transcript" chips and an ember "new" dot.
  - (555) 017-7730 · `after_hours_message` ("After-hours message") · 9:12 PM · 1:36
  - (555) 018-4410 · `question_faq` ("FAQ question") · 7:41 PM · 0:48

Reach:
- The device is an upright CSS phone (chassis near-black in both themes, a DOM
  screen, `aspect-ratio: 9/19.5`, height `min(78svh, 640px)`). **(CP)** In dark
  theme the ink is 0.105, so a near-black chassis would disappear. The chassis
  therefore always has a 1px `--ink-edge` outer rim plus an inner bezel at
  `oklch(0.26 0.005 260)`.
- The lock screen shows the clock "11:49" (large, thin) **above** a text-message
  notification:
  - "Text message · now";
  - sender **Heyloo** (letter-spacing, never inserted spaces). **(CP)** This is
    the contact name the owner saved; US SMS has no alphanumeric sender IDs;
  - body "New booking — Riverside Auto Repair: M. Alvarez, 2019 Honda Civic, check
    engine diagnostic, tomorrow 10:30 AM."
  - **(CP) G-6 variant:** if owner SMS alerts are not live in production at
    WP-11, the same slot shows an email notification instead ("Mail · now ·
    Heyloo", subject "New booking — Riverside Auto Repair"). Both variants
    are SSR'd; a build-time constant in `content/v2/film-lands.ts` selects one.
- Payoff (`--text-chapter`, `SplitLines`): "**11:49 PM. Booked.**" (weight 700),
  then "You slept through it." in `--muted-foreground` (weight 330).
- Lede **(CP)**: "Heyloo texts or emails you every booking, order, and message
  as soon as the call ends." The old text said "texts and emails". Owner alerts
  go by email today, and SMS only once the texting sender is approved (G-6).

**Desktop scroll-tier layout.** **(CP)** Placement uses WP-3's stage grid
(§4.3). The bracketed values are 1440×900 references.
- Dashboard panel: `grid-row: 3 / 7` (slate through band), centred,
  `width: min(1040px, 100%)`, `max-height: 100%` [1040×600, y 150–750]. It
  has `perspective: 1600px` on its wrapper. Below 760px of viewport height (a
  static media query), Recent calls shows 2 rows instead of 3, and the metric
  cards use compact padding, so the panel fits the roughly 560px available at
  720.
- Reach: payoff type in row 5, columns 1–7 [y 260–560]. Phone in columns 8–11,
  `grid-row: 3 / 7`, `align-self: center`, height `min(78svh, 640px, 100%)`,
  `rotate(-3deg)`.

**Mobile play-tier layout.**
- Continuing the ink surface:
  - the caption;
  - a compact portal card (358px): Latest booking on top, 2 metrics (Calls,
    Bookings), 2 recent rows;
  - the payoff (40px, 2 lines);
  - the phone, cropped to its top 60%: width `min(72vw, 280px)`, fixed
    `aspect-ratio`, `overflow: clip`.

**Static tier.** Storyboard panels 5 and 6: the final dashboard (14 / 5 / 182 / 6,
the new row on top, a static ember "new" dot), then the phone with the
notification visible, the payoff and the lede.

**Pre-boot (scroll tier).** The lands part is invisible at global p 0. **(CP)**
This is done by its `land` and `reach` beat groups being at opacity 0 (listed in
`FILM_PREBOOT`), not by the part layer's own opacity.

**Choreography.** The scroll tier maps local p over 140svh.

| p (local) | Beat | Single effect | Details |
|---|---|---|---|
| 0.00–0.08 | Land | call layer clears | The call part's captions, teleprompter, slate chip and call line fade out, each child individually (CP: never the `[data-film-part="call"]` layer, §3.5 rule 7). The booking card stays. The "Skip the film" chip stays. **(CP)** This is one cross-fade: the book caption fades out while the Land caption ("It lands in your dashboard." / "The booking, the transcript, and the recording — waiting for you.") fades in at the same position. |
| 0.02–0.20 | Land | **camera pull-back** | The booking card (the handoff element) scales from 1 to the slot width ratio (about 0.45) and translates to `[data-film-slot]` (`measureDelta`, `inOutCubic`). The dashboard wrapper goes `scale 1.12 → 1`, `rotateX 8° → 0`, opacity 0 → 1 (`inOutCubic`). |
| 0.20–0.24 | Land | handoff | The card fades 1 → 0 while the real Latest booking block fades 0 → 1 (it is already in place). |
| 0.24–0.30 | Land | new row slides in | The top Recent-calls row goes `translateY(-100%) → 0` inside a clipped list. Older rows are SSR'd in final position and start at `translateY(-rowHeight)`. |
| 0.30–0.40 | Land | odometers tick | All four roll from → to (digit strips, `outQuint`), and the Recording and Transcript chips fade in. The ember "new" dot appears at 0.40. |
| 0.40–0.50 | hold | — | **(CP)** Caption swap on the plateau (0.44): the Land caption fades out. The reach part has no separate caption; the payoff is its caption. |
| 0.50–0.58 | Reach | dashboard recedes | `scale 1 → 0.9`, y −4vh, opacity → 0 (`inCubic`) |
| 0.54–0.70 | Reach | phone rises | y +40vh → 0, `rotate -6° → -3°` (`outCubic`), black screen. The shadow layer fades in. |
| 0.70–0.72 | Reach | screen wakes | screen-on layer opacity 0 → 1 |
| 0.72–0.78 | Reach | notification drops | y −24px → 0, opacity (`outBack(1.4)`) |
| 0.76–0.80 | Reach | one buzz | x ±1.5px, 3 cycles, `sin`-based, fully scrubbed |
| 0.80–0.92 | Reach | payoff rises | line 1 at 0.80, line 2 at 0.84 (`SplitLines`, yPercent 110 → 0, `outExpo`); lede fades in at 0.88 |
| 0.92–1.00 | hold | — | The stage releases naturally when the section ends. |

**Handoff test.** `call.render(1)` then `lands.render(0)` must leave
`[data-film="booking-card"]` with identity transform and opacity 1.

**Play tier.** The lands card plays once over 4800 ms. **(CP)** The old list
ran two effects at once (row plus counters, drop plus buzz), which breaks rule 4.
It is now sequenced:
- 0–20%: the new row slides in;
- 20–45%: the 2 counters tick (Calls, Bookings), and the "new" dot appears at 45%;
- 45–55%: hold;
- 55–62%: the screen wakes;
- 62–70%: the notification drops;
- 70–75%: one buzz;
- 75–95%: the payoff lines rise (the same `SplitLines` mask-rise as desktop,
  line 2 offset by 4%);
- 95–100%: hold.

The mobile specimen shows only Latest booking, 2 metrics and 2 recent rows
(§ Mobile play-tier layout), so the metrics without a counter in it (Minutes,
After-hours) are not rendered on mobile at all.

**(CP) Merge order.** WP-4 develops in parallel against WP-0's `call-scene`
stub, but **merges after WP-3**. The handoff test above must run green against
the real `call-scene` at WP-4's merge.

**Reserved sizes / CLS.**
- Everything is laid out in its final size and position.
- The phone box has a fixed aspect ratio.
- Odometer boxes are fixed `ch` widths.
- The dashboard's 3D transform sits on one wrapper.

**Budget.** 0 KB initial. `lands-scene` 5 KB or less. At most 5 moving layers
(card, dashboard, row, 2 digit groups) during Land, and at most 3 during Reach.

**(CP) CSS ownership.** WP-3's `film.css` owns the stage grid, both part
layers' placement and every `FILM_PREBOOT` rule. `film-lands.css` (WP-4)
styles only classes prefixed **`.lands__*`** inside the lands part. The §4.0
prefix list gains `.lands__*`.

---

### 4.5 `morning`: dawn and the fine print, said out loud

**Files (WP-5):**
- `v2/morning/morning.tsx`
- `v2/morning/dawn-clock.tsx`
- `v2/morning/trust-statements.tsx`
- `v2/morning/morning.css`
- `content/v2/morning.ts`

This chapter is **CSS only, with 0 KB JS.**

**Content.**

Dawn:
- Clock (Fraunces 300, `--text-mega`, `tabular-nums`, centred in a fixed `9ch`
  box). An `aria-hidden` strip of 8 labels: 11:49 PM, 12:00 AM, 1:00 AM, 2:00 AM,
  3:00 AM, 4:00 AM, 5:00 AM, **6:58 AM**. The static text for assistive
  technology is "6:58 AM".
- H2 (`--text-chapter`, weight contrast): "You open at 8. / **Your 10:30 is
  already booked.**"

Trust (eyebrow "The fine print, said out loud"). Three statements at
`--text-chapter` with weight contrast, each with a Plex Mono footnote. **(CP)**
The footnote is **IBM Plex Mono 400 at 0.8125rem / 1.5, sentence case, with no
tracking**. It is not the uppercase `--text-kicker` style, which is unreadable
for full sentences.
1. "It says it's **an AI.**" / "In the first sentence of every call. It's built
   into every agent and can't be turned off."
2. "It says the call **may be recorded.**" / "Same sentence. Recordings and
   transcripts land in your dashboard."
3. "Your number **stays yours.**" / "Calls reach Heyloo by forwarding from the
   number you already have. Port-out is guaranteed in our Terms." The link goes to
   `/legal/terms` with `prefetch={false}`.

This retires "Recorded with consent, every time".

**Desktop.**
- `#morning` has `id="morning"` (the film's skip target). **(CP)** It also has
  `tabIndex={-1}` and `outline: none` on `:focus` (it is only ever focused
  programmatically). Without that, "Skip the film" moves the scroll position
  but not the focus, and the next Tab goes back into the film.
- The horizon zone is 160svh under `motion-ok` plus `sda`, containing a
  `position: sticky; top: 0; height: 100svh` inner.
- The inner holds, bottom to top:
  - **the paper layer**, which is the real content: the clock at y 34% (the real
    `aria-hidden` strip plus its `sr-only` "6:58 AM"), a 1px horizon hairline
    (`--border`) at y 62%, and the H2, left-aligned in columns 1–9, at y 66%;
  - **(CP) the ink layer**
    (`position: absolute; inset: 0; class="heyloo-theme-dark surface-ink"`,
    `aria-hidden`). It holds a **duplicate** of the clock strip at the same
    position, in the dark ramp's `--foreground`.

  **(CP) Why two layers:** a single ink overlay over the paper clock would hide
  the clock at the start (dark text on ink) or force a `color` animation (a
  per-frame repaint of mega text). With the ink copy, both strips run the
  **same** keyframes on the **same** timeline, so they are always on the same
  digit. The ink layer fading out reveals the paper clock underneath. There is
  no gradient, per §2.3.
- **(CP) Header tone sentinel.** The zone contains
  `div.morning__tone-sentinel[data-header-tone="ink"]`
  (`position: absolute; top: 0; height: calc(18svh + 2rem)`), so the header
  stays in its ink tone until the ink layer is about half faded. Half faded is
  `contain 27.5%`, i.e. 16.5svh of scroll after the zone top reaches the viewport
  top, plus the header's 32px observer band. The sentinel exists only under
  `motion-ok` plus `sda`.
- Trust band follows on paper with about 90svh total:
  - each statement spans columns 1–9 with its footnote in columns 10–12,
    baseline-aligned;
  - hairline rules between statements;
  - statements spaced 16svh apart, so only one is in its reveal range at a time.

**Mobile.**
- **(CP)** Horizon zone **150svh** (was 130) with a sticky inner. At 130svh the
  `contain` range is only 30svh, so the whole dawn would play in about 140px of
  scroll. At 150svh it is 50svh, and the overlay part is about 230px at 844.
  The sentinel height becomes `calc(15svh + 2rem)`.
- Clock at `min(var(--text-mega), 17vw)` (64px at 390), H2 at 40px.
- Trust statements stacked at 32px, footnotes at 13px, hairlines between.

**Choreography.**
- The zone declares `view-timeline: --horizon block`, and children use
  `animation-timeline: --horizon`. All of these animations use
  `animation-fill-mode: both` (CP, §3.4.4).
- Ink layer: opacity 1 → 0 over `contain 0% contain 55%`.
- Clock strips (the paper one and the ink copy, identical keyframes):
  `translateY` in 8 discrete steps over the same range. The keyframes sit at
  each step with `steps(1, end)` segments, and step *k* moves to label *k* at
  `k × 55% / 7` of the range.
- Horizon hairline: `scaleX 0 → 1` over `contain 45% contain 60%`.
- H2: block rise (24px, opacity) over `contain 55% contain 85%`.
- Trust: each statement is a `.v2-rise` block; its rule is `.v2-rule`; ranges are
  staggered by index (+4%).
- Only one effect is active at a time, because the ranges do not overlap.
- Without scroll-timeline support (Firefox, Safari before 26), everything is
  static: no zone reserve, the ink layer and sentinel are `display: none`, and
  the paper clock rests on "6:58 AM". **(CP)** The strip's **un-animated**
  transform shows 6:58 AM, and the timeline keyframes start from 11:49 PM.
- **Dark theme:** the ink layer goes from 0.105 to the 0.155 paper. The change
  is intentionally subtle; the clock and hairline carry it (W16). Both clock
  copies are light in dark theme, so the swap is invisible by design.

**Reduced motion.** No horizon reserve, no ink layer and no sentinel. The clock
shows "6:58 AM", and the H2 and statements are visible.

**Reserved sizes / CLS.**
- The zone height exists only under `motion-ok` plus `sda` (CSS).
- The clock is a fixed-width box.
- Only transform and opacity animate.

**Primitives.** `.v2-rise`, `.v2-rule`, CSS digit strip.

---

### 4.6 `every-business`: 24 hours, 8 sample calls

**Files (WP-6):**
- `v2/rail/rail-section.tsx` (RSC)
- `v2/rail/rail-switcher.tsx` (`"use client"`, 1.5 KB or less)
- `v2/rail/rail-panel.tsx` (RSC)
- `v2/rail/rail-clock.tsx`
- `v2/rail/rail.css`
- `content/v2/rail.ts`

**Content.**
- Eyebrow "Sample calls".
- H2: "Pick your business. **See the call it takes.**"
- Sub: "Every call starts the same honest way. What happens next depends on your
  business — a booking, an order, a message, or a hand-off."
- Message-first line **(CP)**: "No integration needed. From day one, everything
  lands in your dashboard and your inbox — and by text once your texting number
  is approved." The old line promised text "on day one", but texting needs
  carrier registration, and owner alerts go by email until then
  (`MESSAGING_PROVIDERS.md`; G-6).

Markers (in DOM order = time order), from `SAMPLE_CALLS`:

| Time | Business | Outcome |
|---|---|---|
| 2:10 AM | Veterinary Clinics | referral + message |
| 7:02 AM | Dental Practices | booking |
| 12:40 PM | Restaurants | order |
| 3:05 PM | Any Service Business | message |
| 6:15 PM | Legal Intake | **(CP)** intake message; an attorney calls back. The legal template cannot book. |
| 8:30 PM | Real Estate Teams | **(CP)** showing booked (the template's `schedule_showing` state) |
| 9:52 PM | Motels & Small Hotels | hold (`scheduled`) + payment link |
| **11:48 PM** | **Auto Repair Shops** | booking (**selected by default**, labelled "The call you just saw") |

Each panel contains:
- **(CP)** a panel header with the time as **plain text** ("11:48 PM", mono) and
  a `VerticalIcon` with the displayName. The rolling `--text-chapter` clock is
  **not** in the panels. An in-panel clock would already show its own time when
  swapped in, so there would be nothing to roll. There is one shared
  `RailClock` outside the panels (see the RailClock API below);
- the transcript's first 4 turns, where turn 0 is **always the disclosure**,
  followed by `<details><summary>Show the whole call</summary>…</details>`.
  **(CP)** Turns are set at `--text-lede` in Fraunces (AI 380, caller 620) with
  mono speaker labels, the same transcript language as the film at a smaller
  size;
- tool pills;
- `OutcomeCard size="panel"`;
- "What it asks your callers" (the `intakeSummary` from `verticals.ts`);
- the business's `heroStat` at body size with a `FootnoteRef`, **only if**
  `SOURCES` has an entry for it. **(CP)** By default this row is omitted
  (§3.4.5). A `heroStat` with no digit (today only generic's) still renders, without a
  footnote;
- links:
  - "Heyloo for {displayName} →" → `/{slug}`
    (`data-track="vertical_card_clicked" data-track-vertical={slug}`);
  - "Try a live demo" → `/demo?vertical={slug}`
    (`data-track="demo_cta_clicked" data-track-location="rail" data-track-vertical={slug}`);
  - both with `prefetch={false}`;
- a "Sample call — illustrative" tag.

Night calls (8 PM–6 AM) render their panel card as `Surface tone="ink"`
(without `chapter`, so the header does not react, with the four-sided
`--ink-edge` border, §2.3); day calls use paper cards.

**`RailSwitcher` API.**
```ts
interface RailSwitcherProps {
  markers: Array<{ slug: string; label: string; time: string; minutes: number; vertical: Vertical }>;
  panels: Array<{ slug: string; node: React.ReactNode }>;  // RSC nodes; switcher wraps each in role="tabpanel"
  defaultSlug: "auto-repair";
}
```
- It follows the ARIA tablist pattern: `role="tablist"`, roving `tabindex`,
  Left/Right/Home/End, automatic activation, and `aria-controls` /
  `aria-labelledby`.
- **(CP) Panel visibility uses `data-state`, not the `hidden` attribute.** The
  earlier `hidden` plus `display: block` override meant a no-JS visitor saw only
  the auto-repair panel, with 7 calls unreachable, which breaks the static-tier
  promise.
  - SSR renders every panel with `data-state="active" | "inactive"` (the
    default is active).
  - Under `:root[data-js]`: `.rail__panels` is a single-cell grid (all panels
    in `grid-area: 1/1`), so the **container height equals the tallest
    panel**. `[data-state="inactive"] { visibility: hidden }` takes those
    panels out of the accessibility tree and focus order. This applies before
    hydration too, so hydration changes nothing.
  - Under `:root:not([data-js])`: the tablist is `display: none`, and the 8
    panels render as a normal stacked list, each with its own visible heading.
- On select, in motion tiers only, it calls
  `document.startViewTransition(() => flushSync(() => setActive(slug)))`.
  **(CP)** Only the active panel's outcome card has
  `view-transition-name: rail-outcome`. The playhead does **not** take part:
  it moves by its own CSS transition, and two mechanisms would fight over one
  element. During the transition,
  `html.vt-rail { view-transition-name: none }` is set (the switcher adds the
  class before starting and removes it on `transition.finished`). This stops
  the default root cross-fade of the whole viewport, a full-screen repaint of
  the kind W11 removed. Unnamed content swaps instantly, and only the outcome
  card morphs. Duration is 300 ms `--ease-camera`. Under reduced motion, or
  when `document.startViewTransition` is missing, it sets state directly.

**(CP) `RailClock` (`rail-clock.tsx`, RSC markup, driven by the switcher).**
- It renders digit strips at `--text-chapter`: hour tens (blank or 1), hour
  ones 0–9, minute tens 0–5, minute ones 0–9, and an AM/PM strip. Each strip is
  inside a fixed `1ch` (AM/PM `2ch`) mask, `tabular-nums`, `aria-hidden`.
- SSR sets `--h1 --h2 --m1 --m2 --ap` for the default call (11:48 PM) as
  inline custom properties. Each strip uses
  `transform: translateY(calc(var(--h2) * -1em))` with
  `transition: transform var(--duration-digit) var(--ease-editorial)` under
  `motion-ok`.
- On select, the switcher writes the five properties with
  `style.setProperty`. That is the whole clock roll: one clock, by
  construction.
- It sits beside the rail line on desktop and above the panel on mobile.
- Assistive tech reads the time from the active panel's header text.

**Playhead position (CP).** A CSS percentage `translateX` is relative to the
playhead's own width, not the rail's. So:
- the day line is `container-type: inline-size`;
- the playhead is `position: absolute; left: 0` with
  `transform: translateX(calc(var(--rail-min) / 1440 * 100cqw))`, where the
  switcher sets `--rail-min`, and SSR sets it to 1428 for the default.

**Desktop.**
- Container wide.
- H2 in columns 1–7; sub and the message-first line in columns 8–12.
- The rail spans the full width:
  - a 1px day line with mono ticks 12 AM · 6 AM · 12 PM · 6 PM · 12 AM;
  - markers are 44px buttons at `left: calc(minutes / 1440 * 100%)`, with labels
    alternating above and below;
  - an ember playhead dot sits on the line at the active marker.
  - **(CP) Label collisions.** At 1024 the 8:30 PM, 9:52 PM and 11:48 PM
    markers are about 60–90px apart, and full names collide or overflow the
    right edge. So:
    - from 64rem to 79.999rem, labels show the time only ("8:30 PM");
    - from 80rem up, they show the time plus a short name from `rail.ts`
      ("Vet clinic", "Dental", "Restaurant", "Plumber", "Law firm",
      "Real estate", "Motel", "Auto repair");
    - labels are centred on their marker, except the first (start-aligned)
      and the last (end-aligned).
    - A Playwright check asserts that no two label boxes overlap and none
      leaves the container, at 1024, 1280, 1440 and 1920.
- Panel grid: transcript card in columns 1–5; outcome, "What it asks", stat
  and links in columns 6–12. `RailClock` sits in the rail header, right of the
  H2 row.

**Mobile.**
- The rail becomes a horizontal chip row (`overflow-x: auto;
  scroll-snap-type: x mandatory; overscroll-behavior-x: contain`), with 44px chips
  showing time and name (the active chip gets a `--foreground` outline). Visible
  44px prev/next buttons and a "4 of 8" counter.
  - **(CP)** There is no day line or playhead on mobile. `RailClock` sits above
    the panel.
  - Prev and next **wrap** (8 → 1), matching the tablist's arrow keys.
  - The default (auto repair) is the **last** chip. On mount the switcher sets
    `chipRow.scrollLeft` so the active chip is visible. Scroll offsets are not
    layout shifts.
  - On every change, it calls
    `chip.scrollIntoView({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" })`.
    `block: "nearest"` keeps the page from scrolling vertically.
- The panel stacks: outcome first, then transcript (4 turns and `<details>`), what
  it asks, stat (when sourced), links.
- Same single-cell grid.

**Choreography.**
- On first view (IntersectionObserver, once, motion tiers only):
  - the day line draws (`scaleX 0 → 1`, 700 ms `--ease-editorial`);
  - then the playhead sweeps from 12 AM to 11:48 PM (900 ms `--ease-camera`).
- On select:
  - the playhead moves via `translateX` (CSS transition, 450 ms `--ease-camera`;
    it is outside the view transition);
  - the `RailClock` digit strips roll (`--duration-digit`);
  - the outcome card morphs inside the view transition while the rest of the
    panel swaps instantly.
  - These run concurrently because they are one user-initiated state change
    (rule 4's one-effect limit is for scrubbed beats).

**Reduced motion.** Static rail with the playhead on the selected marker. The swap
is instant and the content identical.

**Reserved sizes / CLS.**
- Single-cell grid.
- Fixed-`ch` clock.
- A click is "recent input", but nothing shifts anyway.

**Budget.** 1.5 KB or less initial (the switcher). Markers only are passed as
client props; **transcripts are RSC children, never serialized twice.** About
5 KB gz of HTML for 8 transcripts, which is an SEO benefit.

---

### 4.7 `every-call`: the sticky stack

**Files (WP-7):**
- `v2/stack/stack-section.tsx`
- `v2/stack/stack-card.tsx`
- `v2/stack/mini-calendar.tsx`
- `v2/stack/mini-order-message.tsx`
- `v2/stack/mini-transfer.tsx`
- `v2/stack/mini-delivery.tsx`
- `v2/stack/stack.css`
- `content/v2/stack.ts`

This chapter is **CSS only, with 0 KB JS.**

**Content.**

H2: "What a great front desk does — **on every call.**" The surface is muted
paper.

Four cards, each with a Fraunces statement at `--text-statement`, a 2-line lede
and a distinct real mini-UI (no two cards look the same):
1. **"Books into your real calendar."** A Mon–Sat week strip with the Tue 10:30
   slot filling. `check_availability()` → `create_booking()`.
2. **"Takes orders and messages, word for word."** An order ticket (Luna's
   Kitchen: 2 × Chicken shawarma plate (1 no onions), 1 × Hummus, pickup 1:05 PM,
   "Read back to caller ✓") next to a message card (Brightline Plumbing: callback
   request, water heater replacement quote, after 4 PM).
3. **"Hands a caller to a person when it should."** A `transfer_call()` card:
   "Transferring to the on-call line · a number you chose". Plus "After-hours
   emergency? It gives the referral you set, on the same call." (Gate G-7.)
   **(CP) Scope note, rendered as the card's mono footnote:** "Live transfer is
   available for veterinary and legal agents today. Other business types take a
   detailed message." In `packages/templates`, only `veterinary.ts` and
   `legal.ts` include `transfer_call`, so an unqualified "on every call" claim
   would be false for 6 of 8 types. The example line moves from "Service desk"
   (auto) to "the on-call line" (vet) for the same reason.
4. **"Texts the caller, and sends you everything."** An SMS bubble from Riverside
   Auto Repair: "You're booked for a check engine diagnostic tomorrow at
   10:30 AM. Reply STOP to opt out." Plus `send_sms_confirmation()`, and delivery
   rows Text ✓, Email ✓, Dashboard ✓, Airtable ✓. Airtable delivery is on the
   current Answer & Book plan list. **(CP)** Mono footnote: "Texting starts once
   your texting number is approved; until then, everything arrives by email."
   (G-6.)

Footer line: "Works on day one — no software to connect. On the Connected plan,
Heyloo can also write bookings straight into the software you already use." Tool
names are text only. **No third-party logos.**

**Desktop.** The `<ol>` reserves `4 × STACK_CARD_SVH` (240svh) under
`scroll-tier`.
- **(CP) The `<li>` itself is the sticky card.** A sticky element sticks only
  within its parent, so a sticky child inside a 60svh `<li>` would never
  stack. Each `<li class="stack__card">` is a direct child of the `<ol>`, with
  `position: sticky; top: calc(var(--header-h) + 32px + var(--i) * 24px)`,
  height `min(56svh, 520px)` and `margin-bottom: calc(var(--stack-card-svh) * 1svh - min(56svh, 520px))`,
  so each card starts `STACK_CARD_SVH` below the previous one. The last card
  has no margin. `--stack-card-svh: 60` is declared in `stack.css` and is
  covered by the motion-token parity test. The sticky position and the margins
  exist only under `scroll-tier`. The `<ol>`'s height (about 236svh) comes from
  its content, not from a fixed reserve.
- SSR writes `style="--i:<0-based index>; --n:4"` on each `<li>`.
- Radius `2xl`, `shadow-lg` (one pre-baked shadow per card), plus the
  dark-theme `--border` from §2.3.
- Layout inside: statement in columns 1–5, mini-UI in columns 6–12.
- The cards contain **no focusable elements** (§3.5 rule 10), so a covered card
  can never hold focus.

**Mobile.** A plain list of cards with auto height, stacked statement then
mini-UI, 24px gaps. No sticky.

**Choreography.**
- The `<ol>` declares `view-timeline: --stack block`.
- **(CP) Recede formula, corrected.** The old keyframe scaled by `(n − i)`
  steps, so the last card receded although nothing covers it. It also used an
  undefined `--i0`, and it compressed card 0's full 4-step recede into one 25%
  slot. Now each card except the last recedes by its final depth
  `d = n − 1 − i` (card 0: 3, card 1: 2, card 2: 1), progressively, from the
  moment the next card starts covering it until the stack ends:
  `@keyframes stack-recede { to { transform: scale(calc(1 - (var(--n) - 1 - var(--i)) * 0.035)) translateY(calc((var(--n) - 1 - var(--i)) * -6px)); } }`
  on the card's **inner** `.stack__content`, with `animation-timeline: --stack`,
  `animation-range: exit-crossing calc(var(--i) * 25%) exit-crossing 75%`,
  `animation-timing-function: linear` and `animation-fill-mode: both`. The last
  card (`--i: 3`) has `animation: none`.
- A dim overlay (`background: oklch(0 0 0)`, CP: colour and dark values were
  unspecified) goes from 0 to `calc((var(--n) - 1 - var(--i)) * 0.07)` opacity
  over the same range (0.21 max) in light theme. In dark theme the factor is
  0.1 (0.3 max), because black-on-dark needs more.
- Each mini-UI has one micro-beat on its own `view()` range (entry 30%–70%):
  1. calendar slot `scaleX`;
  2. ticket lines rise;
  3. transfer arrow `translateX`;
  4. **(CP)** the delivery checks step to opacity 1 in order. They are not a
     stroke draw, which would break the §3.8 stroke budget.
- Everything sits under `motion-ok` plus `sda`. Firefox gets a native sticky pile
  without scaling.

**Reduced motion.** No sticky, no scale: a normal list with every mini-UI in its
final state.

**Reserved sizes / CLS.** The reserve comes from CSS only. No `content-visibility`
(it breaks sticky measurement).

---

### 4.8 `price`: what it costs, your numbers, how you start

**Files (WP-8):**
- `v2/price/price-section.tsx`
- `v2/price/roi-calculator.tsx` (`"use client"`, 1.2 KB or less)
- `v2/price/plan-rows.tsx`
- `v2/price/funnel-strip.tsx`
- `v2/price/price.css`
- `content/v2/price.ts`
- `apps/web/src/lib/marketing/roi.ts` plus test

**Content.**
- Eyebrow "What it costs".
- The **H2 is real text** reading "Starting at $299/mo":
  - "Starting at" as a kicker;
  - **"$299"** at `--text-mega` (weight 300, `SplitChars`, `tabular-nums`);
  - "/mo" at `--text-lede`.
- Statements, divided by hairlines:
  - "No per-call penalty." (Stated in `content/legal/terms.mdx` § Billing.)
  - "See your exact price for your business at signup — before you enter payment
    details." (Signup step 2 comes before step 4.)
  - "Port-out is guaranteed in our Terms." **(CP)** "Cancel anytime." is
    **removed** by default. The Terms say only "billed monthly or annually in
    advance" and never mention cancellation; the phrase exists today only in
    the `/pricing` FAQ. It returns only if the owner answers G-14 yes.
- Footnote: "Plans include minutes; beyond that, billing is per minute. A setup
  fee applies to some business types and is shown at signup." **No rate, no minute
  counts, no per-type price.** The FRONTEND_SPEC §3.3 anti-leak rule holds.
- Plan rows, linking to `/pricing#plans` with `prefetch={false}`:
  - "Answer & Book · Recommended — answers, books, takes messages, and delivers
    by text and email." **(CP)** "Most popular" states a popularity fact the
    product has no customer data for. It becomes "Recommended" (a Heyloo
    recommendation) pending G-14.
  - "Connected — also writes bookings into the software you already use."
- **Calculator:** "Do the math with your own numbers."
  - Sentence form: "If I miss [3] calls a week and a typical job is worth [$200]…"
  - The first input is a range from 0 to 30 plus its number. **(CP)** The second
    is `type="text" inputmode="numeric" autocomplete="off"` with a visible "$"
    prefix, not `type="number"`. A focused number input changes its value on
    mouse wheel in Chromium, and with Lenis on, scrolling past the calculator
    would silently edit it.
    - Parsing strips everything but digits.
    - Empty means 0.
    - The value is clamped to 0–100000.
    - The field is reformatted with thousands separators on blur, never while
      typing.
  - **(CP) Accessible names**, since the sentence is not a `<label>`: the range
    gets `aria-label="Missed calls per week"` plus
    `aria-valuetext="3 calls a week"`, and the text input gets
    `aria-label="Typical job value in dollars"`. Both also carry
    `aria-describedby` pointing at the sentence.
  - Output **(CP)**: the visual `<output>` updates **immediately** on input
    (digits change instantly, §4.8 choreography) and has `aria-live="off"`. A
    separate `sr-only` `role="status"` repeats the sentence **800 ms after the
    last input**. The old single 150 ms debounce on a live `<output>` would
    announce on nearly every keystroke. The output reads "…that's about
    **$31,200** a year in work that could go to someone else." At 0 it reads
    "…that's about **$0** a year".
  - Under it: "Your numbers, your math — not a Heyloo result. Heyloo starts at
    $299/mo."
  - Formula (`lib/marketing/roi.ts`):
    `missedPerWeek × jobValue × 52`, formatted with `Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })`.
  - The default output is rendered on the server.
- Funnel strip "How you start" (6 steps, mapped 1:1 to `SIGNUP_STEPS`):
  1. Tell us about your business
  2. See your exact price
  3. Create your account
  4. Add payment
  5. We set up your agent
  6. Forward your calls
- CTAs:
  - "**Get started**" → `/signup` (ember primary, the decision moment,
    `data-track="signup_cta_clicked" data-track-location="{location}"`);
  - "See pricing" → `/pricing` (outline).

**Desktop.**
- Columns 1–6: kicker, "$299/mo" (about 193px), statements and footnote.
- Columns 7–12: plan rows (large tappable rows with hairlines), then the
  calculator card (radius `2xl`, `shadow-md`), then the CTAs.
- The funnel strip spans the full width below: 6 numbered nodes joined by a 1px
  line. It is a timeline, not cards.

**Mobile.** "$299" at 96px, then statements, plan rows, calculator (44px or
larger inputs), a vertical funnel and full-width 48px CTAs. **(CP)**
`--text-mega` is only 64px at 390, so the 96px is a local override:
`.price__amount { font-size: 6rem }` below `md`, then `--text-mega` from `md`
up. Below 360px use `min(6rem, 30vw)`.

**Choreography (CSS `view()`).**
- "$299" chars rise over `entry 15%+4%·i` to `cover 30%+4%·i`.
- Statements and plan rows use `.v2-rise`.
- **(CP)** The funnel line draws with `.v2-rule` (`scaleX`, a utility; the old
  `.v2-stroke` exceeded the stroke budget), and nodes step to full opacity in
  order.
- The calculator output digits change instantly: no rolling, because rolling a
  money figure reads as a gimmick.
- **The price never counts up.**

**Reduced motion.** Static.

**Reserved sizes / CLS.** The output uses `min-width: 12ch` plus `tabular-nums`,
and the calculator card has a fixed `min-height`.

---

### 4.9 `try`: the finale (ember)

**Files (WP-2):**
- `v2/finale/finale.tsx`
- `v2/finale/finale.css`
- `content/v2/finale.ts`

**Content.**
- `Surface tone="ember"` with `data-cta-hide`.
- H2 at `--text-mega` on 2 lines: "Hear it for" (left-aligned) / "**yourself.**"
  (right-aligned). A `--primary-foreground` stroke sits under "yourself.".
- Lede: "Enter your business name and website, and Heyloo builds a demo agent you
  can talk to — in your browser or on your phone."
- CTAs:
  - "**Try a live demo**" → `/demo`: inverse (dark on ember), `data-magnetic`,
    `data-track-location="{location}"`;
  - "Get started" → `/signup`: dark outline.
  - The `vertical` prop prefills both.
- Mono note: "Every demo agent says it's an AI and that the call may be recorded."

**Desktop.** `min-height: 100svh`, `overflow-x: clip` (the door transforms must
never create horizontal scroll). CTAs centred in columns 5–8 at y 62%.

**Mobile.** **(CP)** Lines at `min(var(--text-mega), 17vw)`, which is 64px at
390 (the old "60px" contradicted the token), then the lede at 17px and stacked
48px CTAs. The sticky CTA bar hides from here to the end of the page (§4.1).
Focus rings on this chapter use the ember override from §2.3.

**Choreography ("the doors close", CSS `view()` over `entry 0% cover 45%`).**
- Line 1 goes `translateX(-12%) → 0` and line 2 goes `translateX(12%) → 0`, with
  `scale 0.94 → 1` from the baseline origin.
- Then the stroke draws (`cover 40–55%`) and the CTAs rise (`cover 45–55%`).
- After the gate, the primary CTA becomes magnetic (desktop with a fine pointer).
- No clip-path reveal and no waveform.

**Reduced motion.** Static, with no magnet.

**Reserved sizes / CLS.** Transform only, with `overflow-x: clip`.

---

### 4.10 `footer`

**Files (WP-1):** `marketing-footer.tsx`, `v2/chrome/sources-list.tsx`,
`v2/chrome/masthead.tsx`.

**Content.**
- Business types: **all 8**, including Motels & Small Hotels, Restaurants and Any
  Service Business.
- Product: Pricing, Live demo, Blog, Get started.
- Legal: Terms, Privacy, DPA.
- **Sources** (`<ol id="sources">`, from `SOURCES`). Each entry reads "[n] figure —
  claim. Source name (link). Directional industry estimate, not a Heyloo result."
  **(CP)** It is rendered only when `SOURCES.length > 0`, which is not the case
  by default (§3.4.5). Source links are external `<a>` with
  `rel="noopener noreferrer"`, not `Link`.
- The Motion toggle.
- Copyright.
- Masthead wordmark (`aria-hidden`, cropped).

**Every `<Link>` has `prefetch={false}`.** This removes the measured 17.6 KB of
`/pricing` and `/blog` prefetch.

**Layout.**
- Desktop: 4 link columns, then the Sources row, then the toggle row, then the
  masthead.
- Mobile: link columns in a 2-column grid with 44px link rows; stacked sources.

**Motion.** None. The footer is navigation.

---

### 4.11 The 8 sample calls (`content/call-scripts.ts`, WP-0)

These are fictional fixtures, **"Sample call — illustrative"**. Every turn list
opens with `renderDisclosure(businessName, assistantName) + " How can I help?"`.
Every phone number is fictional and in the (555) 01x range. Assistant names are
fixture personas pending gate G-2.

**(CP)** Every tool in a script must be in **that business type's** template
`tools` list, not merely somewhere in `packages/templates`. The critic pass
found two violations and fixed them below:
- Legal booked a consultation with `check_availability`/`create_booking`, but
  the legal template has neither.
- Real estate had the AI assert a listing's status ("It's still listed"),
  which no tool supports.

1. **auto-repair**: Riverside Auto Repair · Riley · 11:48 PM · (555) 014-2290 · ink
   - Caller: "Hi — my check engine light just came on. Can someone look at it
     tomorrow?" (fact `service`: "check engine light")
   - AI: "I can get that booked. What's the year, make, and model?"
   - Caller: "2019 Honda Civic." (fact `vehicle`)
   - AI: "And what name should I put the appointment under?"
   - Caller: "Maria Alvarez." (fact `customer`)
   - AI: "Thanks, Maria. One moment while I check tomorrow's bay availability." →
     `check_availability()` → "Tomorrow · 10:30 AM — open"
   - AI: "We have 10:30 tomorrow morning open. Want me to book it?"
   - Caller: "Yes — 10:30 tomorrow morning works." (fact `time`: "10:30
     tomorrow morning". **(CP)** The fact moved to the caller's turn so that
     all four facts are the caller's own words.)
   - Then `create_booking()` and `send_sms_confirmation()`. Outcome: the booking
     card in §4.3, status `confirmed`.
2. **veterinary**: Northgate Animal Hospital · Casey · 2:10 AM · (555) 014-3318 · ink
   - Caller: "My dog just ate a bag of chocolate chips. Is anyone there?"
   - AI: "The clinic is closed right now, and I can't give medical advice. For
     emergencies after hours, Northgate refers patients to Valley Emergency Vet at
     (555) 014-7788 — they're open all night."
   - Caller: "Okay. Can you tell them I called?"
   - AI: "Yes — I'll leave a message for the team first thing in the morning.
     What's your name, and your dog's name?"
   - Caller: "Dana Whitfield. She's Juniper."
   - Then `take_message()`. Outcome `referral`: "After-hours emergency · Referred
     to the emergency clinic you set · Message for the morning team: Dana
     Whitfield (Juniper), callback requested."
3. **dental**: Harbor Street Dental · Morgan · 7:02 AM · (555) 014-5521 · paper
   - Caller: "Hi, I'm a new patient. Do you have anything before work this week?"
   - AI: "I can help with that. Is this for a cleaning and exam?"
   - Caller: "Yes. And do you take PPO insurance?"
   - AI: "Harbor Street Dental accepts most PPO plans, and the front desk confirms
     your coverage before your visit." → `check_availability()` → "Thu · 8:00 AM
     — open"
   - AI: "I have Thursday at 8:00 AM. Would that work?"
   - Caller: "Perfect."
   - Then `create_booking()` and `send_sms_confirmation()`. Outcome `booking`:
     "New patient · Cleaning + exam · Thu · 8:00 AM". **No HIPAA claims.**
4. **restaurants**: Luna's Kitchen · Ari · 12:40 PM · (555) 014-6604 · paper
   - Caller: "Can I get two chicken shawarma plates for pickup — one with no
     onions — and a side of hummus?"
   - AI: "Two chicken shawarma plates, one with no onions, and one side of hummus,
     for pickup. What name is it under?"
   - Caller: "Sam."
   - AI: "Thanks, Sam. It'll be ready at 1:05 PM."
   - Then `create_order()`. Outcome `order` (read back ✓, pickup 1:05 PM, no
     prices).
5. **generic**: Brightline Plumbing · Jordan · 3:05 PM · (555) 014-7130 · paper
   - Caller: "Hi, I need a quote to replace a water heater. Is someone available?"
   - AI: "The team is out on jobs right now, so I'll take a message and make sure
     they get it. What's your name and the best time to call back?"
   - Caller: "Priya Nair, anytime after 4."
   - AI: "Got it. I'm sending that to the team now."
   - Then `take_message()`. Outcome `message`: "Callback request · Water heater
     replacement quote · Priya Nair · After 4 PM · Sent by text and email."
6. **legal-intake**: Alder & Finch Law · Avery · 6:15 PM · (555) 014-8847 · paper
   **(CP, rewritten)** The legal template (`packages/templates/src/verticals/legal.ts`)
   collects name and phone, matter type, the opposing party for a conflict
   check, urgency, and a summary. It then "record[s] the full intake as a
   message" for an attorney to follow up. It has no booking tools.
   - Caller: "I was rear-ended on the way home and I don't know what to do."
   - AI: "I'm sorry that happened. I can't give legal advice, but I can take the
     details for the attorneys. Can I get your name?"
   - Caller: "Jamie Cole."
   - AI: "Thanks, Jamie. Was anyone hurt, and do you know the other driver's
     name? The firm checks it for conflicts."
   - Caller: "My neck is sore — I went to urgent care. The other driver was Dale
     Brooks."
   - AI: "Thank you. An attorney will review this, including the conflict check,
     and call you back at this number."
   - Then `take_message()`. Outcome `message`: "New intake · Jamie Cole · Auto
     accident (rear-end) · Injury reported · Other party: Dale Brooks (for
     conflict check) · Attorney callback requested · Caller told the AI can't
     give legal advice."
7. **real-estate**: Maple Row Realty Team · Quinn · 8:30 PM · (555) 014-9012 · ink
   **(CP, rewritten)** The old AI line "It's still listed" asserted listing data
   that no real-estate tool provides. The template's `schedule_showing` state
   books showings with `check_availability`, `create_booking` and
   `send_sms_confirmation`.
   - Caller: "Is the house on Birch Street still available? I'd like to see it
     Saturday."
   - AI: "I can't confirm a listing's status, but I can book you a showing and
     the agent will confirm it. Are you working with an agent, and are you
     pre-approved?"
   - Caller: "No agent yet, and yes, I'm pre-approved."
   - AI: "Great. What's your name?"
   - Caller: "Luis Ortega."
   - AI: "Thanks, Luis. One moment." → `check_availability()` → "Sat · 11:00 AM —
     open" → "I have Saturday at 11:00 AM. Should I book it?"
   - Caller: "Yes — Saturday at 11 works."
   - Then `create_booking()` and `send_sms_confirmation()`. Outcome `booking`
     (`confirmed`), with fields Customer **Luis Ortega** (heard as "Luis
     Ortega"), Showing **Birch Street house**, When **Sat · 11:00 AM** (heard as
     "Saturday at 11"), and notes "Pre-approved · No agent". Facts: "Luis
     Ortega" (`customer`) and "Saturday at 11" (`time`), so flights run.
8. **motels**: Lakeside Inn · Rowan · 9:52 PM · (555) 014-2764 · ink
   - Caller: "Do you have a room tonight? Two adults, one night."
   - AI: → `check_availability()` → "We have a queen room tonight at $89 plus tax.
     We hold rooms with a $50 deposit, and I can text you a secure link to pay it.
     Want me to hold it?"
   - Caller: "Yes, please."
   - AI: "What name should it be under?"
   - Caller: "Kim Tran."
   - Then **(CP)** `create_booking()` (status `scheduled`, the product's deposit
     hold per `bookings.hold_expires_at`) and `send_payment_link()`. Outcome
     `hold`: "Queen · Tonight · 1 night · 2 adults · Scheduled — held pending
     $50 deposit · Payment link texted." (The motel's own rates are fixture
     values; nothing here is Heyloo pricing.)

**Invariants (tested):**
- `turns[0].speaker === "ai"`, and its text starts with the rendered disclosure.
- Every `ToolName` exists in `packages/templates` (a static list in the test).
- **(CP)** Every tool a script uses is in **its own vertical's** template
  `tools` list. The test holds a static map copied from
  `packages/templates/src/verticals/*.ts`, with a comment naming each file; no
  package dependency is added.
- **(CP)** Every `fact.phrase` occurs verbatim in a `speaker: "caller"` turn,
  and a `booking` outcome field with `heardAs === phrase` exists.
- Numbers match `/^\(555\) 01\d-\d{4}$/`. This covers every number rendered
  anywhere on the site, including the dashboard's recent-call rows (CP).
- No visitor-facing string matches `/\b(tenant|vertical|adapter|upsell|primary|secondary)\b/i`.
- `receivedAt.minutes` values are unique and sorted.
- `surface` is derived from the hour.

---

## 5. How the other pages inherit the system (lighter touch)

All pages call `setRequestLocale` first. Server Components use deep `@heyloo/ui`
imports. No GSAP loads outside the film. The mobile CTA bar carries prefills.
**WP-9** owns everything in this section.

### 5.1 `/pricing` (`app/[locale]/(marketing)/pricing/page.tsx`)

1. **Cover.** Kicker "Pricing" and H1 "Starting at $299/mo" with the mega "$299"
   (`SplitChars`). **(CP)** Here the "$299" is above the fold and is the likely
   LCP element, so it must not use §4.8's `view()` rise. At load its range can
   be partly complete, leaving chars at fractional opacity on first paint. It
   uses the cover's first-paint `v2-settle` keyframe instead (`translate`
   only, 900 ms, 60 ms stagger, never opacity). Subhead: "Your exact price
   depends on your business type and call volume — you'll see it at signup,
   before you enter payment details." This drops the unverified "in under a
   minute".
2. **Plans** (`id="plans"`). Two **editorial columns** separated by a hairline, not
   cards:
   - Answer & Book (with the "Recommended" tag. **(CP)** It was "Most popular",
     a popularity claim with no data behind it; G-14);
   - Connected.
   - Feature lists keep the current PLANS copy, except "AI answering, 24/7, with
     disclosed recording" becomes "Answers every call, and tells callers it's an
     AI and the call may be recorded" (pending gate G-5).
   - Rules draw in with `.v2-rule`.
   - **No plan prices, rates or minute counts.**
3. **FAQ.** The existing 4 Q&As, verbatim except "we guarantee a smooth port-out"
   stays as is (it is in the Terms). Keep the Radix Accordion. Questions are set
   at `--text-statement` × 0.6 (about 30px) in Fraunces. **(CP)** The existing
   "cancel any time" answer is not backed by the Terms. It stays verbatim (out
   of scope to rewrite), but it is listed under G-14 for the owner, and WP-9's
   PR must flag it.
4. `RoiCalculator` and the funnel strip (the WP-8 components).
5. `<Finale location="pricing" />`, `<MobileCtaBar location="pricing" />`, and
   `data-page-event="pricing_viewed"`.

Motion is CSS only.

### 5.2 `/[vertical]` × 8 (`app/[locale]/(marketing)/[vertical]/page.tsx`)

Cold outbound email lands here, so each page must stand alone.
1. **Business cover.** Kicker: `VerticalIcon` plus "Heyloo for {displayName}". The
   H1 uses weight contrast and comes from `content/v2/business-pages.ts`
   (owner-approved copy). Defaults:

   | Business | H1 |
   |---|---|
   | Auto repair | "The bays are full. / **The phone still gets answered.**" |
   | Vet | "Every call about / **every patient, answered.**" |
   | Legal | "Every new case / **starts with a call you answered.**" |
   | Dental | "The chair is busy. / **The phone isn't missed.**" |
   | Real estate | "Every showing request / **gets a same-night answer.**" |
   | Motels | "The night desk / **answers every call.**" (CP: "never misses a booking" promised an outcome; the product promises the answer) |
   | Restaurants | "The lunch rush / **still gets its orders.**" |
   | Generic | "You're on a job. / **Your phone is still answered.**" |

   Lede **(CP)**: by default, the non-numeric `lede` from `business-pages.ts`.
   WP-9 writes 8 of these, each describing what Heyloo does for that business
   in the template's own terms, with no figures and no competitor claims. The
   sourced `heroStat` with a footnote replaces it only when `SOURCES` has the
   entry (§3.4.5). CTAs go to `/demo?vertical=slug` and `/signup?vertical=slug`,
   tracked with `location="vertical_landing"` and the vertical. The CTA row
   carries `data-cta-anchor`. Add the "Starting at $299/mo" microline.
2. **That business's own film:**
   `<FilmSection id="film" script={getSampleCall(slug)} surface={call.surface} travel={{ call: BUSINESS_FILM_TRAVEL_SVH }} skipTo="#asks" />`.
   It has only a call part (no lands). On desktop it scrubs over 160svh; on mobile
   it plays once over 9000 ms; otherwise it is the static storyboard. This
   **replaces the hardcoded generic "A typical call" block.** Each business's
   outcome card (order, message, referral, hold) goes through the same book beat.
3. **"What it asks your callers"** (`id="asks"`, **(CP)** with `tabIndex={-1}`
   because it is the film's skip target, as `#morning` is on home). The
   `intakeSummary` as a numbered list at `--text-statement` with `.v2-rise`
   items. It uses the corrected legal line (§3.4.5).
4. **Pain figures.** `painStats` as a ruled list at `--text-lede`. **(CP)**
   Numeric items render only if sourced, with a `FootnoteRef`. Non-numeric items
   render plain, **except** those asserting a measurement ("…of any vertical
   we've measured": Heyloo has measured nothing) or a competitor's behaviour.
   Those are dropped. If fewer than 2 items remain, the whole section is
   omitted. With no sources, applying this to today's `verticals.ts` omits the
   section on auto repair, vet, legal, dental and real estate. It keeps it on
   motels (3 items), restaurants (2) and generic (2). WP-9 lists the per-page
   result in its PR.
5. **(CP)** `competitorAnchor` renders **only after owner approval (G-14)**.
   Every string asserts how competitors behave ("Human answering services
   can't tell an emergency from a routine question at 2am") without a source.
   Default: omitted. Then the price statements (reusing the `plan-rows` and
   price statements from WP-8, without the calculator), then
   `<Finale vertical={slug} location="vertical_landing" />`,
   `<MobileCtaBar vertical={slug} />` and `data-page-event="vertical_landing_viewed"`.

Business-specific rules:
- Dental has **no HIPAA or BAA wording**.
- Legal keeps "what the AI can and can't advise on".
- Vet never advises and always refers.

### 5.3 `/demo` (`app/[locale]/(marketing)/demo/page.tsx`)

- **The DemoFlow logic, fields, events and routes are untouched.**
  `components/demo/demo-flow.tsx` is not edited.
- The page gets `setRequestLocale` (it currently lacks it).
- Header treatment: kicker "Live demo", H1 "Hear it for yourself." at
  `--text-chapter`, and the subhead as today.
- Aside copy is aligned: "Every demo agent says it's an AI and that the call may
  be recorded — same as a live agent on your account." ("is recorded" becomes
  "may be recorded".)
- The metadata description drops "in under a minute".
- CSS entrances only; the page is mobile-first and has no film.

### 5.4 Blog and legal

- Titles use `--text-chapter` (`blog/page.tsx`, `blog/[slug]/page.tsx`, and the
  title element of `components/marketing/legal-page.tsx`).
- **Legal MDX text and dates are untouched.** The footer still links all three
  legal pages.

### 5.5 Stretch: route morph

A React `<ViewTransition name={`biz-${slug}`} share="morph">` on the rail panel's
business kicker and on the business cover kicker, per
`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`.
- It needs `Link transitionTypes` forwarding through next-intl's `Link` (verify,
  V-5) and a warm destination: call `router.prefetch` on `pointerenter`/`focus`,
  never on viewport.
- If either fails verification, ship instant navigation. This is the first item
  on the cut list.

---

## 6. Performance plan

**Gates (unchanged, never loosened):** home LCP ≤ 2500 ms, CLS ≤ 0.05, initial JS
≤ 250 KB gz. Each is the median of 5 samples at 1440×900 with 4× CPU throttle, no
scroll, measured over load + 1.5 s.

**Internal targets:** LCP ≤ 1000 ms, CLS 0.000, initial JS ≤ 220 KB. Alarm at
228 KB.

### 6.1 Initial-JS ledger (per chunk, gz)

| Chunk | Today | v2 budget | Contents |
|---|---|---|---|
| Framework floor (Next runtime, React DOM, webpack runtime, main-app) | ≈135 | unchanged | — |
| Shared app (next-intl ICU, lucide ×2, sonner, react-query, next nav or Link, Radix Slot, global-error) | ≈63 | unchanged | Out of scope. A marketing-only Providers variant without react-query or sonner (≈ −15.7 KB) is logged as future headroom. |
| `[locale]/layout` | 4.4 | ≤ 4.6 | bootstrap script is inline HTML |
| `(marketing)/layout` | 5.7 | **≤ 8.5** | header (+ tone IntersectionObserver, menu a11y ≤ 0.5), MotionBoot ≤ 0.8 (CP: gate only; the rest is the lazy `boot.ts`), MotionToggle ≤ 0.4, TrackBridge ≤ 0.5 |
| `(marketing)/page` | 20.5 | **≤ 11** | RoleGuardToast (existing), RailSwitcher ≤ 1.5, RoiCalculator ≤ 1.2, MobileCtaBar ≤ 0.4. **Removed:** HeroScrollScene, HeroFilmScrubber, HeroStoryOverlay, hero-film-frames, HeroFilmThemedImage, use-scroll-progress, use-device-capability, LiveCallHero, OwnerPhoneReveal, DashboardPreview, VerticalGrid, HowItWorks, Reveal/useInView/useCountUp, DemoIconCycle, TrustStrip. |
| **Total** | 224.1 | **≈ 217 (≤ 220)** | |

### 6.2 After first paint (never inside load + 1.5 s)

| Chunk | gz | Loads when | Tiers |
|---|---|---|---|
| `boot` (`runtime/boot.ts`, CP) | ≤ 3 KB | intent gate | scroll, play |
| `scene-runtime` (`scene/*`) | ≤ 3 KB | intent gate and a scene within 150% | scroll, play |
| `film-scene` + `call-scene` | ≤ 6 KB | same | scroll, play |
| `lands-scene` | ≤ 5 KB | same (home only) | scroll, play |
| gsap core + ScrollTrigger | 46.1 KB | same, **scroll tier only** | scroll |
| Lenis | ≈ 6 KB | first `wheel`, pointer:fine, scroll tier | scroll |
| magnetic | ≤ 0.6 KB | gate and a `[data-magnetic]` element, pointer:fine, ≥1024 | scroll |
| debug | ≤ 1 KB | `?motion-debug` only | any |
| `@heyloo/analytics` + posthog | existing | existing deferred path | any |

Totals: desktop about 70 KB; mobile about 17 KB (no GSAP or Lenis; `lands-scene` only on home); reduced
motion and Motion Off **0 KB**.

### 6.3 LCP stays text-first

- The LCP element is the **cover H1 text**. It is rendered on the server and
  visible at FCP with next/font's size-adjusted fallback.
- It is **never at opacity 0**. Its entrance animates `translate` only.
- No image, poster, preload or canvas appears above the fold. This removes the
  measured hydration swap to `poster.webp` (desktop LCP 1.76–1.93 s).
- The film peek is text and borders, smaller than the H1, and never a late LCP
  candidate.
- **(CP)** The peek contains only the slate row and cue (§4.2). The pain block,
  in either variant, starts below the fold at 1440×900.
- The perf gate asserts that the LCP element **is the `h1` or inside it**:
  `entry.element.closest("h1") !== null` (§8.2). **(CP)** With `SplitLines`, each
  line is a block-level `span.v2-line`. Chrome reports the largest *text
  block* as the LCP element, so the entry's element will be a line `SPAN`, not
  the `H1`, and an assertion of `tagName === "H1"` would always fail.
- HTML budget: ≤ 90 KB gz for home. The RSC flight payload roughly doubles the
  text; the gate has no network throttle, so WP-10 adds a manual Fast-4G spot
  check.
- CSS budget: marketing CSS adds ≤ 16 KB gz.

### 6.4 CLS stays at 0

- **Tiers are chosen in CSS only**: `@media`, `@supports`, `html[data-js]` and
  `html[data-motion]`, all present before paint.
  - There is no JS tier swap anywhere. The OPS-7 mobile + reduced-motion edge is
    closed by construction, because LiveCallHero is gone.
- Scenes use sticky stages with **no ScrollTrigger pin**, so there is no
  pin-spacer and no reparenting.
- Every element is SSR'd at its final size and position; motion is transform and
  opacity only.
- Splits happen on the server; masks use padding and negative-margin pairs, so
  line boxes do not change.
- Counters and clocks are fixed-`ch` and `tabular-nums`.
- The rail and calculator heights are reserved (single grid cell, `min-height`).
- The CTA bar is `position: fixed` and never reserves space (CP): it is hidden from the finale to the page end (§4.1). The Motion switch's state text sits in a fixed `3ch` box.
- The header height is constant.
- No `content-visibility` on scene sections, and no images without dimensions.
- The failure fallbacks change layout only while off screen (§3.7).
- **Scroll-time CLS** (field CLS counts it, and the gate never scrolls) is covered
  by WP-10's report-only `scroll-cls.ts`, with a target of ≤ 0.02.
- **(CP) Font-swap CLS** (field CLS on phones, where H1 lines are close to the
  box width) is covered by the both-faces fit rule (§4.2) and the §8.3 blocked-font
  comparison.
- **(CP) First-paint `view()` animations above the fold are banned.** An
  element whose `view()` range is partly complete at load paints at a
  fractional state. Above-the-fold entrances (the cover H1, the `/pricing`
  "$299") use first-paint keyframes that animate `translate` only.

### 6.5 Runtime smoothness

- The target is no long task over 50 ms attributable to scene code during a 4×
  throttled scroll-through, and 55 fps or better on the film at 1440.
- One clock per driver: `gsap.ticker` drives ScrollTrigger and Lenis; the native
  and play drivers run their own rAF only while active.
- The style writer caches values, so only changed values are written.
- `will-change` is set per active beat only.
- No `filter`, `backdrop-filter`, blend modes or clip-path on moving layers.
- DOM caps: 2,500 or fewer nodes for home; 900 or fewer for the film.
- ScrollTriggers per page: 1 on home (the film). CSS handles the rest.
- **(CP) Play tier (mobile).** `beat-capture` runs the call card at 390×844
  under CDP `Emulation.setCPUThrottlingRate` 4 and records long tasks. The
  target is no task over 50 ms from scene code during the 11 s play.
  - The karaoke loop keeps the index of the last lit word and touches only
    words whose state changed this frame, never all 260 spans.
  - The play driver stops its rAF when the card holds at 1.

### 6.6 Guards

- **`motion/no-static-motion-imports.test.ts`** (WP-0, vitest) walks
  `apps/web/src`. It fails if any file other than `motion/gsap-loader.ts` and
  `motion/runtime/lenis-boot.ts` statically imports `gsap` or `lenis`.
  **(CP, corrected)** The old text let `runtime/motion-boot.tsx` statically
  import `motion/scene/*`, which would put the drivers in the initial layout
  chunk. The guard now enforces:
  - `motion/scene/*` and `motion/scenes/*` may be value-imported only by files
    inside `motion/scene/`, `motion/scenes/` and `motion/runtime/boot.ts`;
  - `import type` from `motion/scene/types.ts` is allowed anywhere, because it
    is erased;
  - `runtime/scene-registry.ts` may reference `motion/scenes/*` only through
    `import()`;
  - `runtime/motion-boot.tsx` may import only `motion-preference`,
    `intent-gate` and, via `import()`, `./boot`.

  Exception: `content/film-beats.ts` is pure data and allowed everywhere.
- **`scripts/site-perf/chunk-guard.ts`** (WP-10, runs in the `site-perf-budget`
  job after the build):
  - parses the `<script>` URLs in `.next/server/app/en.html`;
  - gzips each chunk and asserts the page chunk ≤ 11 KB and the marketing layout
    chunk ≤ 8.5 KB;
  - fails if any initial script body contains `ScrollTrigger`, `lenis-smooth` or
    the marker `heyloo-scene:`. Every scene module exports
    `const SCENE_MARKER = "heyloo-scene:<id>"`.
- `pnpm run check:server-barrels` stays green (deep imports only in RSC).
- Header, footer, rail, CTA bar and finale `Link`s all use `prefetch={false}`.
- Before trusting any number: `rm -rf apps/web/.next`, run one `next start` only,
  and use `--env-mode=loose` locally if next/font's fetch fails.

---

## 7. Build plan

**Order:**
1. **WP-0** (foundation) lands first.
2. **WP-1…WP-8 and WP-10** run in parallel.
3. **WP-9** starts when WP-1, WP-2, WP-3 and WP-8 have merged.
4. **WP-11** (integration) runs last.

**Ownership is disjoint:** a file belongs to exactly one package. The exception
is WP-0's scene **stubs** (`motion/scenes/film-scene.ts`, `call-scene.ts` and
`lands-scene.ts`, which export a factory whose `render` is a no-op). Ownership of
these transfers to WP-3 and WP-4, which replace them.
**(CP) Other sanctioned sequential handoffs** (never parallel edits):
- `content/marketing/home.ts`: WP-0 makes additive changes, WP-11 removes.
- `docs/BUILD_NOTES.md` and `docs/VERIFY.md`: WP-0, then WP-11.

**(CP) Cross-package seams**, where a consumer cannot edit the provider:
- WP-3 depends on WP-0's `OutcomeCard` and `ToolPill` hook contract (§3.4.3).
- WP-1 depends on `Surface`'s `data-header-tone`.
- WP-4 depends on WP-3's stage grid and pre-boot CSS (§4.4 CSS ownership) and
  merges after WP-3.
- WP-5 and WP-9 own the skip targets (`#morning`, `#asks`) with
  `tabIndex={-1}`.

A consumer that finds a missing hook files it against the provider; it never
patches the provider's file.

**(CP) Merge order inside the parallel wave:** WP-3 before WP-4. Everything
else is unordered.

Only WP-0 and WP-11 edit `docs/BUILD_NOTES.md` and `docs/VERIFY.md`. Section
packages put their notes and verify items in their PR description, and WP-11
appends them.

**Preview routes.** Each section package owns
`apps/web/src/app/[locale]/(marketing)/v2-preview/<section>/page.tsx`. It renders
the section between 100svh spacers, with `robots: { index: false }` metadata
from WP-0's `v2-preview/layout.tsx`. These are used for Playwright beat capture
and axe before integration. **WP-11 deletes `v2-preview/` entirely**, so no dead
files ship.

Each package must pass the repo gates before merge: biome, eslint (0 errors),
`tsc -b`, vitest, `next build --webpack` with a clean `git status`, and
`check:server-barrels`. After any `packages/ui` edit, run
`pnpm --filter @heyloo/ui build`.

**(CP) Definition of done for every section package (WP-1 to WP-9).** These are
in addition to each package's own acceptance list:
1. Screenshots of its preview route at 390×844 and 1440×900, in **light and
   dark**, are attached to the PR. For scene packages, add motion full, reduced
   motion and Motion Off.
2. No horizontal overflow (`scrollWidth === clientWidth`) at **320, 360, 390,
   768, 1024, 1280, 1440 and 1920**. 320 is also the 400%-zoom reflow check
   (WCAG 1.4.10).
3. Keyboard: every interactive element is reachable, shows a visible focus
   ring (including on ember), and is never obscured by the header or the CTA
   bar.
4. A reduced-motion test (§3.6 rule 8) exists, and every `view()` animation
   declares `animation-fill-mode: both`.
5. axe (wcag2a/aa) is clean on the preview route, in both themes.
6. No visitor-facing string is invented. Any factual claim (a capability,
   figure, policy or comparison) cites its repo source in the PR: a template
   file, `terms.mdx`, the pricing page or `SOURCES`. Otherwise it is removed.

### WP-0: Foundation and governance (must land first, ≈6 h)

**Files:**
- Tokens and theme:
  - `packages/ui/src/theme/globals.css` (type tokens, motion tokens, `--ink` and
    `--ink-edge` in all three theme blocks, the `data-motion` blanket rule, the
    view-transition reduced block, the `.heyloo-theme-dark` comment)
  - `packages/ui/src/theme/contrast.ts` and `contrast.test.ts` (new pairs)
  - `packages/ui/src/motion-tokens.ts` and `motion-tokens.test.ts`
- App shell:
  - `apps/web/src/app/globals.css` (custom variants)
  - `apps/web/src/app/[locale]/layout.tsx` (bootstrap)
  - `apps/web/src/app/[locale]/(marketing)/layout.tsx` (`#main`,
    `.marketing-root`, MotionBoot, TrackBridge, the `marketing-v2.css` import)
  - `apps/web/src/app/providers.tsx` (`connectMarketingAnalytics`)
  - `apps/web/src/lib/perf/defer-non-critical.ts` and its test (the options
    argument; defaults unchanged)
- Analytics:
  - `apps/web/src/lib/analytics/marketing-track.ts` plus test
  - `apps/web/src/components/analytics/track-bridge.tsx` plus test
- Marketing libs and content:
  - `apps/web/src/lib/marketing/call-envelope.ts` plus test (`roi.ts` belongs to
    WP-8)
  - `apps/web/src/content/marketing/disclosure.ts` plus `disclosure.parity.test.ts`
  - `apps/web/src/content/marketing/call-scripts.ts` plus test
  - `apps/web/src/content/marketing/sources.ts` plus test (**ships empty**, CP)
  - `apps/web/src/content/marketing/film-beats.ts` plus test (including
    `FILM_PREBOOT`, CP)
  - `apps/web/src/content/marketing/home.ts` (additive) plus test
  - **(CP)** `apps/web/src/content/marketing/verticals.ts`: only the two
    factual corrections in §3.4.5
- Motion runtime and scene core:
  - `motion/runtime/{motion-preference.ts, intent-gate.ts, motion-boot.tsx, boot.ts (CP), scene-registry.ts, lenis-boot.ts, magnetic.ts, debug.ts}` plus tests
  - `motion/scene/{types.ts, tween-math.ts, dom.ts, flip.ts, drivers.ts, compose.ts}` plus tests
  - `motion/scenes/{film-scene.ts, call-scene.ts, lands-scene.ts}` (stubs)
  - `motion/no-static-motion-imports.test.ts`
- Marketing primitives:
  - `v2/marketing-v2.css`
  - `v2/primitives/{split-text, call-line, odometer, footnote, surface, kicker, outcome-card, tool-pill}.tsx` plus tests
  - `apps/web/src/app/[locale]/(marketing)/v2-preview/layout.tsx`
- Docs (governance, §9):
  - `docs/design/WEBSITE_CREATIVE_BRIEF.md` (Brief v2 addendum)
  - `docs/DESIGN_SYSTEM.md` (marketing scale note)
  - `docs/BUILD_NOTES.md`
  - `docs/VERIFY.md`

**Acceptance:**
- The current home page renders **visually unchanged**, and the perf gate still
  passes: MotionBoot finds no `[data-scene]` and imports nothing.
- `html` gets `data-js`, and `data-motion="reduced"` from storage, before paint.
- `motion-ok`, `scroll-tier`, `play-tier` and `sda` compile, proven by a tiny
  class in the preview layout.
- The token CSS/JS parity test is green, and contrast tests are green in both
  themes for every new pair.
- `call-envelope` is deterministic (snapshot); the disclosure parity test is
  green; the call-scripts invariants (§4.11) are green.
- Driver, compose (handoff contract), tween-math and MotionBoot tests are green.
  MotionBoot tests include: no imports when reduced motion is set; gate events;
  the 6000 ms fallback; the GSAP-grace native fallback; the storyboard fallback.
  **(CP)** They also cover:
  - the on-screen and above-viewport fallback, which keeps the reserve and
    shows the final frame;
  - the `boot.ts` split (`motion-boot.tsx` never imports anything but the gate
    before intent).
- The static-import guard is green.
- BUILD_NOTES, VERIFY and Brief v2 entries are written.
- **(CP)** More acceptance items:
  - The `SCROLL_TIER_QUERY`/`PLAY_TIER_QUERY` parity test (JS strings equal
    the `globals.css` variant blocks) is green.
  - `OutcomeCard` exposes the full hook contract (§3.4.3), with a test per
    attribute. `StatusBadge` values are the real `confirmed`/`scheduled`.
  - `ToolPill scramble` renders an `aria-hidden` layer, and the real name stays
    in the accessibility tree.
  - `Odometer` uses the `--d` custom property (a test asserts no inline
    `transform` in SSR output).
  - `Surface` emits `data-header-tone="ink"` only with `chapter`.
  - `.surface-ember` overrides `--ring`, and the contrast test covers it.
  - The call-scripts invariants include "tools ⊆ that vertical's template
    tools" and "facts are verbatim caller phrases", and the legal and real
    estate fixtures pass them.
  - `SOURCES` is empty unless an entry was confirmed and logged in VERIFY.md
    with its URL.
  - The two `verticals.ts` corrections are made.
  - `lenis-boot` passes `anchors: false`.
  - MotionBoot plus TrackBridge add ≤ 1.3 KB gz to the layout chunk.

### WP-1: Chrome (header, footer, sources, masthead, toggles, CTA bar) (≈3 h)

**Files:**
- `apps/web/src/components/marketing/marketing-header.tsx`
- `apps/web/src/components/marketing/marketing-footer.tsx`
- `v2/chrome/{skip-link.tsx, use-header-tone.ts, motion-toggle.tsx, mobile-cta-bar.tsx, sources-list.tsx, masthead.tsx, chrome.css}` plus tests
- `apps/web/messages/en.json`
- `apps/web/src/app/[locale]/(marketing)/v2-preview/chrome/page.tsx`

**Acceptance:**
- The skip link is the first tab stop and moves focus to `#main`.
- The business-types menu has `aria-expanded`, Escape and focus return.
- Menu icons are `aria-hidden`.
- Every header and footer `Link` has `prefetch={false}` (tested).
- The footer lists all 8 business types. `#sources` renders only when
  `SOURCES` is non-empty (CP), which is tested both ways.
- The Motion toggle persists across reload with no flash, and fires
  `MOTION_CHANGE_EVENT`.
- The CTA bar has correct show and hide logic and never overlaps content at 390px.
- Header tone switches over `[data-header-tone="ink"]` (CP), and **not** over an
  ink rail card (a test with a non-chapter `Surface tone="ink"` below the header).
- Reduced-motion tests pass.
- The layout chunk delta is ≤ 1.3 KB.
- **(CP)** CTA bar details:
  - It is visible from 768 to 1023 as well.
  - It is hidden from the finale to the page end, including over the footer
    (a test at max scroll).
  - It adds no body padding on blog, legal, demo or signup.
  - `scroll-padding-bottom` keeps a Tab-focused footer link fully above the bar.
  - Its background follows the theme, so it is legible over the ink film in
    both themes.
- **(CP)** Motion switch details:
  - It renders checked, `aria-disabled` and "Set by your device" under
    `reducedMotion: "reduce"`.
  - After a toggle from the footer at 1440×900, the switch's
    `getBoundingClientRect().top` changes by ≤ 2px.

### WP-2: Cover and Finale (≈3 h)

**Files:**
- `v2/cover/{cover.tsx, kicker-cycler.tsx, cover.css}` plus tests
- `v2/finale/{finale.tsx, finale.css}` plus tests
- `apps/web/src/content/marketing/v2/{cover.ts, finale.ts}`
- `v2-preview/{cover,finale}/page.tsx`

**Acceptance:**
- The H1 is SSR text, Fraunces, and never at opacity 0 (computed-style check at
  t=0).
- The first-paint sequence runs as specified, and the kicker ends on "your
  business" at 5.1 s ± 0.1 s (CP). The kicker shows its first label during the
  1.6 s delay with no flash (`fill-mode: both`).
- `sr-only` text is present.
- No horizontal overflow at 320, 360, 390, 768, 1024, 1280, 1440 or 1920
  (CP: added 320, 360 and 1280), including the finale doors mid-animation.
- **(CP) Peek.** At 1440×900 on load, the film's slate row and cue are fully
  above the fold, and no pain-block text is. At 390×844 the call card's slate
  chip is fully above the fold. At 1366×657 the H1, lede and CTAs are fully
  above the fold.
- **(CP) Font swap.** At each width in §4.2, the H1 height is identical with
  the Fraunces request aborted and with it loaded.
- **(CP) Underlines.** The cover and finale underline SVGs are outside
  `.v2-mask` and are not clipped (checked with a bounding-box test).
- **(CP) Lede copy.** It reads "by text or email" (G-6).
- The finale inverse CTA passes contrast.
- `data-cta-anchor` and `data-cta-hide` are present.
- Magnetic markers are present.
- Reduced-motion tests pass.
- 0 KB client JS.

### WP-3: Film A, stage shell and call scene (≈7 h)

**Files:**
- `v2/film/{film-section.tsx, film-slate.tsx, film-chapter-rail.tsx, film-call.tsx, teleprompter.tsx, film.css}` plus tests
- `motion/scenes/{film-scene.ts, call-scene.ts}` plus tests (replacing the stubs)
- `apps/web/src/content/marketing/v2/film.ts`
- `v2-preview/film-call/page.tsx`

**Acceptance:**
- All three tiers render from one DOM: the storyboard by default, the play card
  in the play tier, and the sticky stage in the scroll tier (`SCROLL_TIER_QUERY`,
  CP).
- The pre-boot state equals `render(0)` (CP): vitest checks `render(0)` against
  `FILM_PREBOOT`, and the WP-10 browser test checks computed styles against the
  same table.
- The DOM hook contract (§4.3) is implemented.
- Unit tests at every beat boundary of `CALL_BEATS_SCROLL` and `CALL_BEATS_PLAY`
  check the karaoke, flights, tool pill and booking-card states.
- `render` is idempotent, and `destroy` restores the SSR DOM exactly.
- The handoff state holds at p=1.
- The Pause/Replay control works with keyboard and screen reader.
- The film has 900 nodes or fewer.
- The scene chunk is ≤ 6 KB.
- Beat screenshots are taken at 1440×900 and 390×844 in light and dark.
- **(CP)** Stage and fallback:
  - The stage grid (§4.3) fits at 1280×720, 1366×657 and 1024×576 (the
    scroll-tier floor): no clipped transcript line, no overlap between the
    booking card and the band, and the compact card below 760px of height.
    At 1024×575 the play tier is used.
  - The static fallback (`data-scene-state="static"`, forced in a test) shows
    only the final frame, with no overlapping beats.
- **(CP)** Links and focus:
  - Every chapter tick lands inside its own beat: after activation, the
    active tick equals the target, in both the native and the Lenis runs.
  - "Skip the film" is a single tab stop and moves focus to `#morning` (with
    WP-5's `tabIndex`; tested against a stub target in the preview).
- **(CP)** Text and scripts:
  - No `textContent` write happens outside `aria-hidden` readouts (a test
    spies on `setText` targets).
  - `deriveCallBeats` passes on all 8 fixtures. The business preview renders
    the vet (referral, no flights), restaurant (order) and real-estate
    (booking, 2 flights) films.
- **(CP) Play card:** its height is `clamp(30rem, 80svh, 40rem)`, and at 375×548
  (iPhone SE svh) the current transcript turn is fully visible.

### WP-4: Film B, lands and reach (≈5 h)

**Files:**
- `v2/film/{film-lands.tsx, dashboard-specimen.tsx, device-phone.tsx, film-reach.tsx, film-lands.css}` plus tests
- `motion/scenes/lands-scene.ts` plus test (replacing the stub)
- `apps/web/src/content/marketing/v2/film-lands.ts`
- `v2-preview/film-lands/page.tsx` (composes `FilmSection` from WP-3 once merged;
  until then it renders `FilmLands` inside a local 100svh stage)

**Acceptance:**
- The specimen uses only server-safe `@heyloo/ui` deep imports; no `"use client"`
  component is imported. `SpecimenMetric` passes the class-parity test with
  `MetricCard` (CP), and recent-call badges are `StatusBadge variant="call-class"`
  with the real labels.
- The "Sample data" tag is always visible.
- The phone clock never overlaps the notification, and the sender label renders
  "Heyloo".
- Nothing wraps at 390px.
- The handoff contract test with `call-scene` is green.
- Odometers reach 14 / 5 / 182 / 6 at p=1.
- Reduced-motion tests pass.
- The scene chunk is ≤ 5 KB.
- **(CP)** More acceptance items:
  - WP-4 merges after WP-3.
  - `film-lands.css` contains only `.lands__*` selectors (a grep test).
  - No opacity or transform is ever written on a `[data-film-part]` element (a
    spy test).
  - The phone chassis rim is visible on dark-theme ink (dark screenshot in the
    PR).
  - The G-6 email-notification variant renders when the constant is flipped.
  - The lede reads "texts or emails".
  - The mobile lands card sequence matches the §4.4 play-tier list (fake-timer
    test at each boundary).
  - All rendered phone numbers match the (555) 01x invariant.

### WP-5: Morning (≈2.5 h)

**Files:**
- `v2/morning/{morning.tsx, dawn-clock.tsx, trust-statements.tsx, morning.css}` plus tests
- `apps/web/src/content/marketing/v2/morning.ts`
- `v2-preview/morning/page.tsx`

**Acceptance:**
- 0 KB JS.
- The static tier shows 6:58 AM, the H2 and three statements.
- In Chrome, the scroll-driven dawn completes before the H2 enters.
- In a browser without scroll timelines (emulated by overriding `@supports`), the
  content is fully visible.
- The Terms link has `prefetch={false}`.
- The dark-theme review screenshot is attached to the PR.
- **(CP)** Layers and tone:
  - The ink layer and the paper clock show the **same** label at every one of
    the 8 steps (screenshots at each step boundary).
  - The clock is never dark-on-ink or light-on-paper in light theme.
  - The header stays in its ink tone until the ink layer is about half faded
    (the sentinel), then flips.
- **(CP)** Focus and size:
  - `#morning` has `tabIndex={-1}`, and "Skip the film" focuses it.
  - The mobile zone is 150svh.
  - Every timeline animation has `animation-fill-mode: both`, so no flash
    appears at range start (checked by screenshotting 1px before each range).
  - The clock fits at 320px.
- Reduced-motion tests pass (the static composition is present and no ink
  layer or sentinel is rendered visible).

### WP-6: Rail, every business every hour (≈5 h)

**Files:**
- `v2/rail/{rail-section.tsx, rail-switcher.tsx, rail-panel.tsx, rail-clock.tsx, rail.css}` plus tests
- `apps/web/src/content/marketing/v2/rail.ts`
- `v2-preview/rail/page.tsx`

**Acceptance:**
- All 8 panels are in the HTML.
- The container height is constant across switches (a test measures it).
- The tablist keyboard pattern works (Left, Right, Home, End).
- Hidden panels are not focusable.
- **(CP)** Visibility and the view transition:
  - Panels use `data-state`, not `hidden`.
  - With JS disabled, all 8 panels are visible as a stacked list and the
    tablist is not rendered visible.
  - Hydration changes no panel's visibility.
  - `html.vt-rail` is present only during a transition, so there is no root
    cross-fade (a screenshot mid-transition shows the header and CTA bar
    unchanged).
  - The playhead has no `view-transition-name`.
- **(CP)** Clock and playhead:
  - There is a single `RailClock` outside the panels, and it rolls to each
    selected time.
  - The playhead's `translateX` uses `cqw` and lands on the marker within 1px
    at 1024, 1440 and 1920.
- **(CP) Labels:** no two marker labels overlap or leave the container at 1024,
  1280, 1440 and 1920 (time-only below 80rem).
- **(CP) Mobile:**
  - The active chip is scrolled into view on mount and on every change,
    without vertical page scroll.
  - Prev and next wrap.
- **(CP) Content:**
  - The legal panel shows an intake message (no booking tools).
  - The real-estate panel shows a booked showing, and no panel asserts listing
    status.
  - The message-first line matches §4.6.
  - No unsourced numeric `heroStat` is rendered (a test with `SOURCES = []`).
- The disclosure is the first turn in every panel.
- The view transition runs only in motion tiers.
- Links have `prefetch={false}` and the analytics attributes.
- The switcher is ≤ 1.5 KB and receives no transcript props.
- Reduced-motion tests pass.

### WP-7: Stack, every call (≈3 h)

**Files:**
- `v2/stack/{stack-section.tsx, stack-card.tsx, mini-calendar.tsx, mini-order-message.tsx, mini-transfer.tsx, mini-delivery.tsx, stack.css}` plus tests
- `apps/web/src/content/marketing/v2/stack.ts`
- `v2-preview/stack/page.tsx`

**Acceptance:**
- 0 KB JS.
- The four mini-UIs are visually distinct.
- The static tier is a plain list.
- The sticky pile works in Firefox without scaling.
- No third-party logos.
- Reduced-motion tests pass.
- **(CP)** Sticky stack:
  - Each `<li>` is itself sticky. At the end of the pile all four cards are
    visible as a stack, and card 3 never scales.
  - Final scales are 0.895 / 0.93 / 0.965 / 1 for cards 0–3.
  - The cards fit at 1280×720 and 1024×576 (card plus top offset below the
    viewport height).
- **(CP)** Visual details:
  - The dim overlay is present in both themes (0.21 and 0.3 max).
  - Cards have the dark-theme border.
  - There are no focusable elements inside cards.
  - The delivery checks are opacity steps, not strokes.
- **(CP)** Card 3 carries the transfer scope footnote and card 4 the texting
  footnote (§4.7).

### WP-8: Price and calculator (≈3 h)

**Files:**
- `v2/price/{price-section.tsx, roi-calculator.tsx, plan-rows.tsx, funnel-strip.tsx, price.css}` plus tests
- `apps/web/src/lib/marketing/roi.ts` plus test
- `apps/web/src/content/marketing/v2/price.ts`
- `v2-preview/price/page.tsx`

**Acceptance:**
- The SSR output is "$31,200" with JS disabled.
- **(CP)** Calculator behaviour:
  - The visual output updates immediately.
  - A separate `role="status"` announces once, 800 ms after the last input.
    Typing "1500" produces one announcement, not four.
  - The job-value field is `type="text" inputmode="numeric"`, and a wheel event
    over it while focused does not change its value.
  - Empty input gives "$0". A pasted "$1,2a00" parses as 1200. Values clamp to
    0–100000.
- Inputs are 44px or larger, and each has the accessible name from §4.8. The
  sentence is linked with `aria-describedby`.
- No rate, minute count or per-type price appears anywhere. **(CP)** The old
  grep `/min|…/` would have matched the spec's own "billing is per minute"
  footnote. The rendered HTML of the section must match none of
  `/\$\s?0?\.\d{2}\b/` (a per-minute rate), `/\d[\d,]*\s?(included\s)?minutes/i`
  (a minute count) or `/\/\s?min\b/i`. The only dollar amounts present are
  "$299", "$200" and the computed output.
- **(CP) Copy:**
  - "Cancel anytime" is absent (G-14).
  - The plan tag is "Recommended".
  - Mobile "$299" is 96px, via the `.price__amount` override.
  - The funnel line uses `.v2-rule`.
- The funnel labels map to `SIGNUP_STEPS`.
- The calculator is ≤ 1.2 KB.
- Reduced-motion tests pass.

### WP-9: Inherited pages (depends on WP-1, WP-2, WP-3, WP-8; ≈5 h)

**Files:**
- `apps/web/src/app/[locale]/(marketing)/pricing/page.tsx`
- `apps/web/src/app/[locale]/(marketing)/[vertical]/page.tsx`
- `apps/web/src/app/[locale]/(marketing)/demo/page.tsx`
- `apps/web/src/app/[locale]/(marketing)/blog/page.tsx`
- `apps/web/src/app/[locale]/(marketing)/blog/[slug]/page.tsx` (title classes only)
- `apps/web/src/components/marketing/legal-page.tsx` (title classes only)
- `v2/business/{business-cover.tsx, what-it-asks.tsx, business.css}` plus tests
- `v2/pricing-page/{plan-columns.tsx, pricing-faq.tsx}` plus tests
- `apps/web/src/content/marketing/v2/business-pages.ts`

**Acceptance:**
- All 8 `generateStaticParams` routes still build statically.
- Each business page's film shows **its own** sample call, with the disclosure
  first.
- Prefills are present on every CTA (and the CTA bar).
- `/pricing` shows no plan prices.
- DemoFlow is unchanged (the file diff is empty).
- The legal MDX is unchanged.
- No page imports `components/marketing/reveal.tsx` any more.
- axe is clean on `/pricing`, `/auto-repair` and `/demo`.
- The page events fire.
- **(CP) Content defaults:**
  - With `SOURCES = []`, no business page renders a digit-bearing `heroStat`
    or `painStats` item (§3.4.5 test).
  - The cover lede comes from `business-pages.ts`.
  - `competitorAnchor` is absent until G-14.
  - The pain section follows the drop rules, and the PR lists the per-page
    outcome.
- **(CP) Focus:** `#asks` has `tabIndex={-1}`, and "Skip the film" focuses it.
- **(CP) Pricing page:**
  - The `/pricing` "$299" uses the first-paint settle, not `view()`. Its
    computed opacity is 1 at t=0.
  - The plan tag is "Recommended".
  - The PR flags the FAQ's "cancel any time" for G-14.
  - `/pricing` shows the CTA bar from hydration (there is no anchor).
- **(CP) Motels H1** reads "answers every call.".

### WP-10: QA harness (parallel with sections; ≈4 h)

**Files:**
- `scripts/site-perf/{scroll-cls.ts, beat-capture.ts, chunk-guard.ts, a11y.ts, marketing-matrix.ts}`
- **(CP)** `scripts/site-perf/web-vitals-probe.ts` (records `entry.element` for
  the LCP entry) and `scripts/site-perf/measure.ts`. The only change there is a
  **report-only** "LCP element inside h1: yes/no" line. Samples, viewport,
  throttle, timing and pass/fail logic stay unchanged. Earlier text both
  required this assertion and said `measure.ts` was unchanged, and gave the
  work to no file.
- `apps/web/tests/e2e/marketing-v2.spec.ts`
- `.github/workflows/ci.yml` (adds `chunk-guard` as **gating** and
  `scroll-cls`/`a11y`/`beat-capture` as **report-only** steps in
  `site-perf-budget`)

**Acceptance:**
- The scripts run against `next start` using Chromium from
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Never run `playwright install`.
- `beat-capture` writes PNGs for every beat and section at 1440×900 and 390×844 in
  light, dark, reduced motion and Motion Off.
- `a11y.ts` injects the lockfile's `axe-core` (`axe.min.js` via
  `page.addScriptTag({ path })`; if it cannot be resolved from `apps/web`, add
  `axe-core` as an exact-pinned devDependency and log it). It runs wcag2a and
  wcag2aa.
- `chunk-guard` fails on a planted static `import "gsap"` (a self-test fixture).
- `budgets.ts` is **not modified**.
- **(CP)** More acceptance items:
  - Before any film capture, the scripts dispatch one `pointermove` and wait
    for `#film[data-scene-state="live"]` (timeout 8 s). Otherwise the first
    captures are pre-boot frames.
  - The `FILM_PREBOOT` computed-style test runs before any input.
  - The blocked-font H1 comparison (§4.2) runs at 320, 360, 390, 768, 1024 and
    1440.
  - The rail label-overlap check (§4.6) runs.
  - The short-viewport stage checks run at 1280×720, 1366×657 and 1024×576.
  - Overflow checks cover 320, 360, 390, 768, 1024, 1280, 1440 and 1920.
  - The mobile play-tier long-task report runs (§6.5).
  - The LCP-element line prints for `/`.

### WP-11: Integration (last; ≈4 h)

**Files:**
- `apps/web/src/app/[locale]/(marketing)/page.tsx` (§4.0)
- `motion/index.ts` (the barrel, rewritten to export the new runtime pieces only)
- `apps/web/src/content/marketing/home.ts` (remove `answerRatePercent`,
  `heroStats`, `howItWorks` once unused)
- **Deletions (Rule 3, no dead files):**
  - Hero and scroll-scene components, each with its test:
    - `motion/{hero-film-frames, hero-film-scrubber, hero-film-static, hero-film-themed-image, hero-scroll-scene, hero-story, hero-story-overlay, scroll-orchestration-provider, smooth-scroll-region, use-device-capability, use-scroll-progress, use-play-once-progress}.*`
    - `components/marketing/{hero-scroll-section, live-call-hero, owner-phone-reveal, dashboard-preview, how-it-works, vertical-grid, trust-strip, demo-icon-cycle, reveal}.*`
    - `components/marketing/shared/**`
    - `lib/marketing/{use-count-up, use-in-view}.ts*`, only if unused
    - **(CP)** `motion/{use-reduced-motion, use-resolved-theme, use-isomorphic-layout-effect}.*`
      if a grep proves them unused after integration. Today their only
      consumers are the components deleted above, and the new runtime uses
      `motion-preference.ts` instead. Keep any still imported, and say which in
      BUILD_NOTES.
  - Content and assets:
    - `content/marketing/hero-call.ts`
    - `apps/web/public/site/hero-film/**` and `hero-loop*`
  - `v2-preview/**`
- `docs/BUILD_NOTES.md` and `docs/VERIFY.md` (final entries, including every
  section PR's notes).

**Acceptance:**
- Home composes in the §4.0 order.
- The perf gate (`measure.ts` ×5) is green, with a median at or under **220 KB**
  initial JS, the LCP element inside the `h1` (`closest("h1")`, CP), and CLS
  0.000.
- `chunk-guard` is green.
- `scroll-cls` ≤ 0.02 on desktop and mobile.
- axe finds 0 violations on 4 pages × 2 tiers × 2 themes.
- The §8 keyboard pass has been done.
- Owner gates G-1…G-14 are answered (CP: G-14 added), and the defaults are
  reverted where a gate says no.
- **(CP)** Page length is measured and recorded in BUILD_NOTES: the value of
  `scrollHeight / innerHeight` at 1440×900 and 390×844. Apply §9.5's shorter
  travel if desktop is over 15.
- **(CP)** The G-6 decision is applied: the notification variant constant is
  set according to whether owner SMS alerts are live in production.
- **(CP)** The no-unsourced-figure render test (§3.4.5) is green for `/` and
  all 8 business pages.
- The tag `site-v1-final` has been created before the asset deletion.
- `git status` is clean after build.

---

## 8. Test plan

### 8.1 Unit (vitest, jsdom)

- **Pure logic:**
  - `call-envelope`: determinism (same input gives the same output), a snapshot of
    the hero envelope, word counts, flat tool segments, and the duration label.
  - `tween-math`, `dom` (redundant writes skipped), `flip` (with mocked rects),
    `roi`.
- **Content:**
  - `disclosure.parity`: the templates source equals the site constant.
  - `call-scripts` invariants (§4.11), **including (CP)** tools ⊆ that
    vertical's template tools, and facts being verbatim caller phrases.
  - `sources`: ids unique; every entry has `source`, `url` and `checkedOn`. The
    default export is empty (CP).
  - `film-beats`: ranges contiguous, 0 to 1. `FILM_PREBOOT` selectors all exist
    in the WP-3/WP-4 fixture DOM.
  - `home.booking` equals `HERO_CALL` outcome fields.
  - A forbidden-word walk over every exported string in `content/marketing/**`.
- **Scenes:**
  - For `call-scene` and `lands-scene`: `render(p)` at every beat start, middle and
    end, asserting opacity and transform on the hooks.
  - Idempotency (`render(p)` twice changes nothing).
  - `destroy()` restores the SSR HTML (`innerHTML` equality).
  - `render(0)` equals `FILM_PREBOOT` (CP: the data table, since jsdom cannot
    read the CSS).
  - **(CP)** `deriveCallBeats` on all 8 fixtures. It matches `CALL_BEATS_SCROLL`
    for `HERO_CALL`, within ±0.005.
  - **(CP)** No opacity or transform write on `[data-film-part]`. `setText` only
    on `aria-hidden` targets.
  - The **handoff contract** (`call.render(1)` then `lands.render(0)` leaves the
    booking card at identity).
- **Drivers:**
  - `playOnceDriver` with fake timers: holds at 1, pause and replay work, pauses
    when hidden.
  - `nativeScrollDriver`: progress maps from mocked scroll values.
  - `scrollTriggerDriver`: gsap mocked, `refresh(true)` called after create.
- **MotionBoot:**
  - reduced motion or `data-motion` means **no dynamic import** is called (spy on
    the registry);
  - gate events and the 6000 ms fallback;
  - the GSAP grace window falls back to the native driver;
  - an import rejection gives the storyboard when below the viewport and static
    otherwise, including when the section is **above** the viewport, where the
    reserve is kept (CP);
  - pathname changes rescan;
  - **(CP)** `motion-boot.tsx` imports nothing before intent; `boot.ts` is the
    only importer of the registry and drivers.
- **Components:** every new component has a **reduced-motion test** (repo rule),
  plus:
  - RailSwitcher keyboard behaviour and constant height;
  - RoiCalculator SSR default and update, the immediate visual update, a
    single delayed announcement, parsing and clamping (CP);
  - MotionToggle persistence and event, the OS-reduce disabled state, and the
    re-anchoring `scrollBy` (CP);
  - **(CP)** `SpecimenMetric` versus `MetricCard` class parity; `OutcomeCard`
    hook attributes; `Odometer` has no SSR inline transform;
  - header `aria-expanded`/Escape and `prefetch={false}` on every Link.
- **Tokens:** motion-tokens CSS/JS parity; the contrast pairs in §2.3.
- **Guard:** `no-static-motion-imports`.

### 8.2 CI perf gate (`site-perf-budget` job)

- `measure.ts` unchanged: home, median of 5, LCP ≤ 2500, CLS ≤ 0.05, JS ≤ 250 KB.
  WP-10 adds a report line that asserts the **LCP element is the `h1`**, read in
  the probe from `PerformanceObserver` entry `.element.tagName`.
- `chunk-guard.ts` is gating: page chunk ≤ 11 KB, layout chunk ≤ 8.5 KB, and no
  motion signatures in initial scripts.
- `scroll-cls.ts` is report-only at first and becomes gating after one green week.
  It covers `/` at 1440×900 and 390×844, light and dark, in 24 scroll steps with
  300 ms settles, and reports the windowed CLS (target ≤ 0.02) plus long tasks
  over 50 ms.
- Proposal, not part of this pass: once numbers are green, add `/pricing` and
  `/auto-repair`, and a 390 home entry, to `ROUTE_BUDGETS`.

### 8.3 Playwright visual checks (`beat-capture.ts`, `marketing-v2.spec.ts`)

- Matrix:
  - viewports 1440×900 and 390×844, plus overflow-only checks at 768, 1024 and
    1920;
  - `colorScheme` light and dark;
  - motion full, `reducedMotion: "reduce"`, and Motion Off (set
    `localStorage["heyloo-motion"]="reduced"` via `addInitScript`).
- **Film beats:** **(CP)** first dispatch one `pointermove` and wait for
  `#film[data-scene-state="live"]`. Then, for each chapter start and midpoint,
  set `scrollY = section.offsetTop + p × (section.offsetHeight − innerHeight)`,
  wait 900 ms for the scrub to settle, and screenshot.
  - Assertions via computed style: the expected beat group has opacity 1; the
    booking card is visible from the book beat on; odometers read their final
    values at p=1.
  - No debug hook is needed. Verify with `?motion-debug` `seek()` only for
    triage.
- **Mobile play tier:** dispatch `touchstart` (the intent gate), scroll the
  call card to 40% visible, wait
  `PLAY_ONCE_MS.call + 500`, and assert the final state. Pause at 3 s and assert
  progress freezes.
- **Lenis beat-position test** (desktop, scroll tier):
  - dispatch real `mouse.wheel` events through the film;
  - assert the chapter tick `data-active` sequence ring → reach is monotonic, and
    the final state is correct;
  - repeat with `SMOOTH_SCROLL_ENABLED=false`.
  - If it fails with Lenis on, ship with Lenis off (G-10).
- **Every page and viewport:**
  - `document.documentElement.scrollWidth === clientWidth` (no horizontal
    scroll);
  - no element's text is clipped. **(CP)** `scrollHeight` is not a valid check
    on an `overflow: clip` box (it is not a scroll container, so the value does
    not report clipped overflow reliably). Instead, once animations finish,
    for every `.v2-mask`, the `getBoundingClientRect()` of a `Range` over its
    text must lie inside the mask's rect (±1px).
  - **(CP)** Short viewports: at 1280×720, 1366×657 and 1024×576 (scroll tier),
    no film beat clips a transcript line or overlaps the card and the band.
  - **(CP)** Font swap: the H1 height is equal with the Fraunces request
    aborted (`page.route`) and with it allowed, at 320, 360, 390, 768, 1024
    and 1440.
  - **(CP)** Rail labels: no overlap or overflow at 1024, 1280, 1440 and 1920.
  - **(CP)** Pre-boot: right after load, with no input, the computed styles of
    the `FILM_PREBOOT` selectors equal the table.
- Sections: top, middle and bottom screenshots of `morning`, `every-business` (after
  selecting 2:10 AM and 12:40 PM), `every-call`, `price`, `try` and the footer.
- Reviewers compare against this spec; there is no pixel-diff baseline in this
  pass.

### 8.4 Reduced-motion check

- With `reducedMotion: "reduce"`, and separately with Motion Off:
  - the network log has **no** requests for GSAP, Lenis or scene chunks (match
    chunk bodies by the `SCENE_MARKER` or `ScrollTrigger` signature);
  - `window.ScrollTrigger` is undefined;
  - **(CP)** `#film`'s stage is not `position: sticky`, and `#film` is shorter
    than the scroll-tier reserve (`< 0.9 × 4.6 × innerHeight`). The old
    "≤ 3.5 × innerHeight" would fail on a correct storyboard: six panels,
    including the full transcript, the dashboard and the phone, come to about
    3.6k px at 1440×900;
  - every storyboard panel is visible;
  - the dawn clock reads "6:58 AM";
  - rail switching is instant.
- Toggling Motion Off mid-page on desktop:
  - the reserves collapse;
  - `scene.destroy()` has restored the DOM;
  - no console errors.

### 8.5 Keyboard pass (manual plus scripted in `marketing-v2.spec.ts`)

Expected tab order:
1. Skip link
2. Header (logo, business types with arrow/Escape behaviour, pricing, demo, theme,
   log in, get started)
3. Cover CTAs
4. Film "Skip the film" → chapter ticks (scroll tier) or Pause/Replay (play tier)
5. Morning Terms link
6. Rail tabs (a single tab stop; arrows move between tabs) → active panel links
   and `<details>`
7. Price plan rows → calculator inputs → CTAs
8. Finale CTAs
9. Footer links → Motion toggle

Assertions:
- Focus is always visible (`--ring` plus `--shadow-focus`).
- No focus lands inside hidden rail panels or on opacity-0 film content.
- A focused element is never hidden under the sticky header (`scroll-padding-top`).
- Enter on "Skip the film" moves focus to `#morning` (`document.activeElement.id === "morning"`),
  both with Lenis on and off (CP: requires `anchors: false`).
- Activating a chapter tick scrolls to the beat, and after the scroll settles
  that tick is the active one (CP: the scroll-padding offset is compensated).
- **(CP)** While the CTA bar is shown (390×844), Tab through the rail and price
  links. No focused element's rect intersects the bar's rect.
- **(CP)** On the ember finale, the focus ring's computed `box-shadow` or
  `outline` colour is `--primary-foreground`, not ember.
- Escape closes the business-types menu and returns focus.

### 8.6 Accessibility and review passes

- axe wcag2a/aa (`a11y.ts`): `/`, `/pricing`, `/auto-repair`, `/demo` × motion and
  reduced × light and dark. **0 violations.**
- VoiceOver (Safari) and NVDA (Firefox): the film reads in story order (disclosure
  first); decorative duplicates are silent; the rail tablist announces its tabs.
- Forbidden-word scan of rendered text plus `aria-label`, `alt` and `title` on the
  4 pages.
- Real devices: iPhone Safari (play card, CTA bar, svh, no overflow) and a
  mid-range Android on 4G (first-scroll readiness, the play card).
- Separate review passes for dark theme and for reduced motion (both are
  first-class compositions).

---

## 9. Governance, owner gates, cut list, risks

### 9.1 Docs WP-0 writes (CLAUDE.md Rules 1 and 4)

**`docs/design/WEBSITE_CREATIVE_BRIEF.md`**: append "Brief v2 — Spoken Type
(2026-09)". It supersedes:
- §2's rule of no new sections, copy or order;
- §7's set-piece cap, which becomes 3 set pieces (film with dawn epilogue, stack,
  finale doors) with quiet chapters between;
- §7's "no autoplay", now with two logged exceptions: the one-pass kicker cycler
  (3.5 s, CP) and the play-once mobile cards (with pause controls);
- §6's Lenis rule: window mode is allowed; wrapper mode is banned.

It also records the retirement of the Higgsfield film and the ember-chapter
exception to accent use.

**`docs/DESIGN_SYSTEM.md`**: the marketing type scale and expressive motion tokens
apply to marketing only. Product UI keeps the 150–250 ms and `--text-display`
caps.

**`docs/BUILD_NOTES.md`** (entry "SITE-V2"):
- Lenis "breaks pinned ScrollTriggers" applies to wrapper mode and GSAP `pin`.
  v2 uses window-mode Lenis with **CSS-sticky** stages and no pins.
- The disclosure is mirrored rather than imported (no `@heyloo/templates`
  dependency), with a parity test.
- The trust copy changes from "is recorded" to "may be recorded".
- The 917-minute figure is a median.
- The answer-rate metric is replaced by after-hours calls.
- Dashboard values are fictional sample data.
- **(CP)** `VERTICAL_RESEARCH.md` names no sources, so `SOURCES` ships empty and
  every figure slot uses its figure-free default (G-4).
- **(CP)** The legal template takes intake as a message and cannot book.
  `transfer_call` exists only for vet and legal. Owner alerts are email-first
  until the texting sender is approved. The site copy was aligned to all three.
- **(CP)** The scroll tier requires `min-height: 36rem`. MotionBoot is split
  into a gate (initial) and `boot.ts` (lazy). Lenis runs with
  `anchors: false`, so skip links move focus.

**`docs/VERIFY.md`**, each with the doc URL or installed path to confirm:

| Item | What to verify |
|---|---|
| V-1 | Tailwind v4 `@custom-variant` block form with nested `@media` and `&:where()` (tailwindcss.com/docs) |
| V-2 | CSS scroll-driven animations: named `view-timeline` on an ancestor; `contain`, `exit-crossing` and `cover` ranges; `animation-range` with `calc()` and custom properties; **(CP)** `animation-fill-mode: both` behaviour before and after the range, and Safari 26 parity (MDN, developer.chrome.com, scroll-driven-animations.style) |
| V-3 | GSAP 3.15 proxy-tween scrub, `ScrollTrigger.refresh(true)`, `config({ ignoreMobileResize })`, `quickTo`, `elastic.out` (installed `node_modules/gsap/types/*.d.ts`; gsap.com is bot-walled) |
| V-4 | Lenis 1.3.26 options (`autoRaf`, `syncTouch`, `anchors`, `respectReducedMotion` default true) and the gsap ticker integration (`node_modules/lenis/dist/lenis.d.ts`, README). **(CP)** Also confirm that with `anchors: false`, a native hash jump while Lenis is running lands exactly, Lenis resyncs from the native `scroll` event with no snap-back, and focus moves to the target. |
| V-5 | React `ViewTransition` and `Link transitionTypes` through next-intl `Link` (`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`); stretch only |
| V-6 | `document.startViewTransition` typing in TS 5.9 lib.dom and the `flushSync` pattern |
| V-7 | iOS Safari `svh` plus `position: sticky` plus `overflow: clip` ancestors |
| V-8 | Fraunces `@font-face` weight range in the built CSS (variable `wght` 100–900) |
| V-9 | Next 16 global-CSS import from components and ordering (`next/dist/docs` CSS guide) |
| V-10 | **(CP)** Same-document view transitions: that `html { view-transition-name: none }` for the duration of a transition suppresses the root snapshot, so unnamed content swaps live and only named elements morph. Also the pointer-blocking behaviour of `::view-transition` during 300 ms (MDN, developer.chrome.com view-transitions guide). |
| V-11 | **(CP)** Container query units (`cqw`) inside `transform` on an absolutely positioned child of a `container-type: inline-size` element, in Chrome, Safari 16+ and Firefox 110+ (MDN). |
| V-12 | **(CP)** Chrome's LCP entry `element` for block-level spans inside an `h1`, which confirms the `closest("h1")` assertion (web.dev LCP docs, Chromium LCP explainer). |

### 9.2 Owner gates (answer before WP-11 merges; defaults let the build proceed)

| Gate | Question | Default |
|---|---|---|
| G-1 | Approve Brief v2 supersessions (§9.1) | Yes |
| G-2 | Mirror DISCLOSURE_LINE verbatim with fixture persona names (Riley, Casey, Morgan, Ari, Jordan, Avery, Quinn, Rowan) | Yes |
| G-3 | Trust copy uses "may be recorded"; retire "Recorded with consent, every time" | Yes |
| G-4 | Which industry figures may be headlined; each needs a nameable source, otherwise it is **cut** | **(CP)** No figures. `VERTICAL_RESEARCH.md` names no source for any figure, so the old default ("keep figures whose source is named there") kept nothing while implying it kept ~38%. The owner may supply a publisher and URL per figure. WP-0 or WP-11 confirms each one and logs it in VERIFY.md, and the figure then fills its reserved slot (§3.4.5). |
| G-5 | Confirm after-hours/24/7 answering (forwarding setup, SYSTEM_DESIGN §15 #5). The film is set at 11:48 PM. | Yes (current copy already claims 24/7; the product answers any forwarded call, and even conditional forwarding sends unanswered after-hours calls). **(CP) If no:** move the auto-repair call to **2:20 PM** ("You were under a car"). 12:40 PM is taken by the restaurant fixture, and the `receivedAt` uniqueness invariant forbids a clash. Rewrite the payoff to "2:21 PM. Booked. You never left the bay." and **cut the dawn zone**; `morning` keeps only the trust band. Change the slate and ring caption to match. The film's ink surface becomes paper. |
| G-6 | Owner gets alerts "as soon as the call ends" | **(CP) Default copy says "texts or emails".** Per `MESSAGING_PROVIDERS.md`, owner alerts go **by email today**, and SMS only once the texting sender is carrier-approved. Caller texts are also copied to the owner by email until then. At WP-11: if owner SMS alerts are live in production, the reach beat shows the text-message notification; otherwise it shows the email variant (§4.4). The cover lede, rail line and stack card 4 are already worded for both cases. |
| G-7 | `transfer_call` and `send_payment_link` are live enough to depict | Yes. **(CP)** `transfer_call` exists only in the veterinary and legal templates, and `send_payment_link` only in motel and restaurant, so stack card 3 carries the scope footnote (§4.7). If no, drop stack card 3 and change the motel outcome to a message. |
| G-8 | Retire the Higgsfield film and loops (2.9 MB); tag `site-v1-final` | Yes |
| G-9 | Typographic wordmark replaces the phone glyph | Yes (reversible) |
| G-10 | Desktop Lenis on | Yes if the §8.3 test passes |
| G-11 | Wire FRONTEND_SPEC marketing events (PostHog stays env-gated and deferred); whether a consent banner is needed is out of scope | Wire them |
| G-12 | Keep the pre-signup anti-leak rule ($299 only) | Yes |
| G-13 | Fictional sample business names (Riverside Auto Repair, Northgate Animal Hospital, Harbor Street Dental, Luna's Kitchen, Brightline Plumbing, Alder & Finch Law, Maple Row Realty Team, Lakeside Inn) | Yes, each tagged "illustrative" |
| G-14 | **(CP)** Unbacked commercial claims found in existing copy: (a) "Cancel anytime" / "cancel any time" (the Terms say only "billed monthly or annually in advance"); (b) the "Most popular" plan badge (no customer data); (c) the `verticals.ts` `competitorAnchor` lines, which each assert how competitors behave. | (a) Omit it from new copy. The existing `/pricing` FAQ answer stays verbatim but is flagged. (b) Use "Recommended". (c) Omit it on business pages. Each returns only on an explicit owner yes, and for (a) the Terms must say the same thing. |

### 9.3 Explicitly out of scope

- Adapters and provider SDKs.
- Retell in-browser "talk to it" on home, and recorded call audio (phase 2, behind
  `packages/adapters`, verify first).
- `demo-flow.tsx` logic.
- Signup funnel logic.
- Route paths, form fields and analytics event names.
- Legal text.
- OG image changes.
- Non-English locales. With next-intl `en` only, headline lengths are tuned for
  English, and the split budget is safe for about 30% expansion if locales arrive.

### 9.4 Cut list (in order, if time runs short; each cut leaves a complete site)

1. The React `ViewTransition` route morph (§5.5).
2. Lenis (native scroll only).
3. Magnetic CTAs.
4. The rail's first-view playhead sweep.
5. The deterministic glyph scramble on the tool pill (it fades in instead).
6. The header tone swap (the header stays in its paper style over ink with the
   existing blur).
7. Stack scale and dim (the native sticky pile remains).
8. The business-type page films (show the static storyboard on those pages).

**Never cut:**
- the static storyboard tier;
- disclosure-first transcripts;
- reserves decided in CSS;
- the guards;
- reduced-motion tests.

### 9.5 Residual risks

| Risk | Mitigation |
|---|---|
| The film (460svh) feels long to skimmers | Chapter ticks, "Skip the film", header CTAs; `FILM_TRAVEL_SVH` can go to `{ call: 180, lands: 110 }` without re-authoring the beats (they are progress-relative). Watch scroll depth once events are wired. |
| First scroll before the runtime has loaded | Pre-boot ring frame, warm-load on pointer, touch and focus, native-driver grace, fallbacks (§3.7). |
| Scroll-driven CSS is unavailable in Firefox and Safari before 26 | Default content is the final state; only enhancements are lost. QA covers both. |
| Fraunces masks clip at a new breakpoint | Mask padding tokens plus the Playwright clip assertion (§8.3). |
| Specimens drift from the real product UI | Built from real `@heyloo/ui` server-safe components and tokens; the review includes a side-by-side with the tenant dashboard. |
| An initial-JS regression from one stray import | Static-import guard plus chunk-guard, both gating. |
| Sample calls read as real customers | "Sample call — illustrative" on every panel, fictional names, (555) numbers, "Sample data" on the dashboard, no testimonials, logos or counters anywhere. |
| Dark-theme dawn is subtle | Accepted by design (W16); reviewed in the dark-theme pass. |
| **(CP)** With no sourced figures, the page loses its "pain" numbers | The ring beat and business covers carry the pain through story instead ("Closed since six."). Each figure the owner sources later drops into a reserved slot with no layout work. |
| **(CP)** The site depicts a capability the product lacks | Fixture tools are tested against each vertical's template `tools`. The legal and real-estate scripts were rewritten. Transfer and texting carry scope footnotes. The §7 definition of done requires a repo citation for every factual claim. |
| **(CP)** Short laptop viewports (1366×657, 1280×720) crush the sticky stage | Proportional stage grid, compact card below 760px of height, `min-height: 36rem` on the scroll tier, and short-viewport Playwright checks. |
| **(CP)** Mobile font swap re-wraps the H1 | Both-faces fit rule with ≥ 6% spare width, and the blocked-font comparison test. |
| **(CP)** Lenis breaks keyboard skip links | `anchors: false`, plus a focus assertion with Lenis on (§8.5). |
