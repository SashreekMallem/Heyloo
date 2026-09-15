# Website assets — generation log

Owned by cluster **ASSETS**. Companion to `docs/design/WEBSITE_CREATIVE_BRIEF.md`
§5 (asset list) and §7 (anti-slop checklist). Every asset below was graded
against §7 before being accepted; none were adopted on a first pass without
review. Files live in `apps/web/public/site/**`, which they do not exceed
in total (see budget at the bottom).

Per the brief's own "asset budget discipline" note in §5: only items 2
(hero loop) and 4 (OG still) are in scope for v1. Item 3 (dashboard-reveal
background texture) ships procedural-only by default; item 5 (vertical
icons) is explicitly "do nothing new." Both are recorded below as
**not generated**, matching the brief. Item 6 (hero scroll-scrubbed frame
sequence) is a SITE-2-wave addition, generated after the brief's own §3
"scroll-driven, cinematic hero" direction superseded item 2's original
role as the hero's own background loop — item 2 itself is unaffected and
still ships as-is for its own non-qualifying-tier fallback use.

All assets are an *enhancement layer* per the brief — the procedural/code
fallback described in the brief remains the shipped default in each
component; swapping a generated asset in is a decision for the PAGES/ENGINE
build cluster after its own visual review, not something this cluster wires
into components (this cluster owns `apps/web/public/site/**` and this file
only).

---

## Tooling

- Generation: Higgsfield MCP (`generate_video`, `generate_image`).
- Encoding: `ffmpeg` (installed via `apt-get install ffmpeg`, since the
  `ffmpeg` preinstalled at `/opt/pw-browsers/ffmpeg-*` is a Playwright
  screenshot-capture build with h264/hevc decoding compiled out —
  `configuration: --disable-everything --enable-decoder=mjpeg
  --enable-muxer=webm --enable-libvpx …` — and cannot demux the Higgsfield
  MP4 source at all; a general-purpose ffmpeg was required for any
  transcoding step in this cluster).
- Stills: `sharp` (already a repo dependency, resolved from
  `node_modules/.pnpm/node_modules/sharp`).

## Licensing note (per CLAUDE.md Rule 1 — verified against current docs,
not memory)

Confirmed 2026-09-14 against Higgsfield's own help-center article
([higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially](https://higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially))
and the Terms of Use it cites (§4.3/§4.4):

- Higgsfield does not claim ownership of inputs or outputs; the generating
  account owns the outputs below and commercial use (ads, marketing
  materials, product UI) is permitted with no separate commercial license
  needed.
- Caveat: outputs are non-exclusive (another user could generate something
  similar) and, outside an Enterprise plan, Higgsfield may use outputs to
  train its own models unless the content/account is deleted. IP
  indemnification is an Enterprise-only benefit — noted here, not a
  blocker for this internal marketing-site use.
- This note itself stands in for a `docs/VERIFY.md` entry per Rule 1.2:
  the help-center page (not raw legal ToS text) was what was reachable
  from this environment; if a future audit needs the literal ToS
  clause text, re-fetch `higgsfield.ai/terms-of-use-agreement` directly.

---

## Item 2 — Hero mobile/reduced-tier loop (generated, adopted)

**Brief prompt (verbatim, §5.2):**
> "Extreme macro, a single continuous thin warm-neutral line (charcoal on
> off-white, no color gradient) smoothly straightening from a soft wave
> shape into a straight horizontal line, then folding once into a rounded
> rectangle outline, studio lighting, minimal, no text, no logo, no glow,
> no particles, clean premium product-photography aesthetic, 3 second
> seamless loop, 4K, shallow depth of field."

**Generation:**
- Model: `seedance_2_5` (Bytedance Seedance 2.5, t2v mode) — the MCP's
  stated default general-purpose video model; no reference media needed
  since this is a pure text-to-video abstract-material shot.
- Params: `aspect_ratio: 16:9` (chosen over 9:16 despite "mobile" in the
  asset's name — the line's motion is strongly horizontal, so a landscape
  source lets `object-fit: cover` crop top/bottom on portrait phone
  viewports without losing the line's endpoints, and works equally well
  behind any non-qualifying-desktop fallback case), `duration: 4`
  (model minimum is 4s — the brief's "3 second" ask isn't reachable on
  this model; 4s is the closest supported value and the loop is still
  short), `resolution: 1080p`, `generate_audio: false` (muted background
  loop, no audio track needed — confirmed no audio stream in the
  delivered file).
- Cost: 36 credits. Job id `c7d4d767-d6bf-4b92-a55e-8975afbd487b`.
- Delivered: 1920×1080 HEVC (Main10), 24fps, 4.04s, no audio, 823KB —
  reviewed frame-by-frame (first/mid/last) against §7 before accepting:
  charcoal line on warm off-white paper-grain ground, wave → straight →
  rounded-rectangle-outline morph exactly as specified, no text/logo/glow/
  particles/gradient. Adopted without a regeneration pass.

**Anti-slop check (§7):** no robots/blobs/orbs/sparkles/cubes/particles;
not a stock metaphor — it IS the literal waveform-to-card morph the hero
narrative is built on (§3); no emoji; restrained warm-neutral palette
matching `--neutral`/paper-grain, not the ember accent (this is
deliberately the *background* material layer, not a UI element, so it
stays out of the accent's "used sparingly" budget per `DESIGN_SYSTEM.md`).

**Encoding → shipped files** (`apps/web/public/site/`):

| File | Format | Dimensions | Duration | Size |
|---|---|---|---|---|
| `hero-loop.mp4` | H.264 (High profile), yuv420p, faststart | 1280×720 | 4.04s, 24fps, no audio | 136KB |
| `hero-loop.webm` | VP9, yuv420p | 1280×720 | 4.04s, 24fps, no audio | 100KB |
| `hero-loop-poster.avif` | AVIF | 1280×720 | — (final/rounded-rectangle frame) | 8KB |
| `hero-loop-poster.webp` | WebP | 1280×720 | — (final/rounded-rectangle frame) | 8KB |

Downscaled from the delivered 1920×1080 to 1280×720 (`lanczos`) — both
well inside the ≤2MB/asset budget with headroom to spare, muted,
`playsinline`-safe (H.264 High/yuv420p, no B-frame/profile issues on iOS
Safari), poster = the video's true final frame (extracted via
`ffmpeg -sseof -0.15 … -vframes 1`) so there's zero flash between the
poster and the loop's first playback frame landing on that same state on
replay.

---

## Item 4 — OG/social image (generated, adopted)

**Brief prompt (verbatim, §5.4):**
> "Clean product photography still life: a smartphone lying flat on a warm
> off-white surface, screen showing a simple booking-confirmation card UI
> (rounded rectangle, one checkmark, one line of text — abstracted, not
> literal pixel UI), soft directional studio light, one small warm
> coral-amber accent shape, generous negative space, no logo, no extra
> text, no gradient background, premium minimal aesthetic."

**Generation:**
- Model: `gpt_image_2_5` (OpenAI GPT Image 2.5, `flare` variant default)
  — the MCP's stated default for ordinary photorealistic generation.
- Params: `aspect_ratio: 16:9`, `quality: high`, `resolution: 2k`.
- Cost: 3 credits. Job id `bb8c9302-3103-4fa9-a809-81df19fa1a13`.
- Delivered: 2688×1520 PNG. Reviewed against §7 before accepting: warm
  off-white product-photography surface, one leaf-shadow adding organic
  interest (not a decorative gradient), phone screen shows the abstracted
  checkmark + line (a `success`-semantic sage-green checkmark circle —
  correctly *not* the ember accent, per `DESIGN_SYSTEM.md`'s "semantic
  tokens are status-only, never branding" rule), and the one accent shape
  the prompt asked for reads as the warm coral-amber pebble beside the
  phone — no logo, no extra text, no gradient background. Adopted without
  a regeneration pass.

**Anti-slop check (§7):** no robots/blobs/orbs/sparkles/cubes/particles/
emoji; real (abstracted-but-recognizable) product artifact, not a generic
tech icon; the checkmark uses success-green rather than the ember accent,
keeping the accent reserved as the design system directs.

**Processing → shipped files** (`apps/web/public/site/`), via `sharp`,
center-cropped from the 2688×1520 (16:9) source to the standard
1200×630 OG aspect (1.905:1 — a ~7% height crop, negligible given the
generous negative space in the shot):

| File | Format | Dimensions | Size |
|---|---|---|---|
| `og-still.avif` | AVIF | 1200×630 (1×) | 10KB |
| `og-still.webp` | WebP | 1200×630 (1×) | 12KB |
| `og-still@2x.avif` | AVIF | 2400×1260 (2×, retina) | 27KB |
| `og-still@2x.webp` | WebP | 2400×1260 (2×, retina) | 31KB |

Not wired into `opengraph-image.tsx` by this cluster (out of ownership
scope — `apps/web/public/site/**` and this file only). Per the brief:
"only replace [the code-generated OG image] if the generated still
genuinely reads as more premium after review" — these files are staged
for that PAGES-cluster review/decision, procedural `ImageResponse`
generation remains the live default until someone swaps it.

---

## Item 3 — Dashboard-reveal section background texture (NOT generated)

Per the brief's explicit budget discipline: "item 3 ships procedural-only
unless a reviewer explicitly asks for the generated texture after seeing
both side by side." No reviewer request has been made, so this cluster did
not spend budget generating it. The shipped default is the brief's own
described procedural fallback — a CSS `background-image` SVG
`feTurbulence` noise filter at ~2% opacity, implemented inline with zero
network request by the PAGES/ENGINE cluster — "visually indistinguishable
from the generated version at the opacity used" per the brief.

## Item 5 — Vertical/business-type icons (NOT generated)

Per the brief: "**Not generated, no request**" — `VerticalIcon`/
`VERTICAL_ICONS` in `packages/ui` already maps each business type to a
`lucide-react` glyph per `docs/DESIGN_SYSTEM.md`'s icon rule. Nothing to
do here; recorded for completeness against the full §5 list.

---

## Item 6 — Hero scroll-scrubbed frame-sequence film (generated, adopted, SITE-2)

Not one of the original brief's 5 §5 items — added for the SITE-2 wave's
scroll-scrubbed hero (replacing the WebGL/three.js line-morph scene,
which is removed) after the brief's own "scroll-driven, cinematic hero"
direction (§3). Same anti-slop review discipline (§7) as every other
item here.

**Generation:**
- Model: `seedance_2_5` (Bytedance Seedance 2.5, t2v/i2v), the same
  general-purpose video model item 2 used, chosen for the same reason —
  a literal object (a phone; a booking card) rather than an abstract
  metaphor.
- Params: `resolution: 1080p`, `duration: 8` (seconds), muted
  (`generate_audio: false`) — generated once per theme (light/dark), the
  chassis/card colors swapped between passes so each theme gets a native
  take rather than a single take color-graded twice.
- Delivered: two 1920×1080 8s clips (light, dark), no audio — reviewed
  against §7 before accepting in both themes: the ring → answer → book →
  land morph beat progression (see `docs/BUILD_NOTES.md`'s `SITE-2`
  entry for the exact frame-range mapping) reads clearly, no
  robots/blobs/orbs/particles, matte-black phone chassis identical
  across both theme takes (deliberately not a themed illustration — the
  same physical object recurring through beat 6's `owner-phone-reveal`
  payoff too).

**Extraction → shipped files** (`apps/web/public/site/hero-film/{light,dark}/`):
every second frame extracted at 1440×810 WebP q76 (chosen over shipping
the source video directly so the scrubber can seek to an exact frame
per scroll pixel with zero decode latency, which a `<video>` element's
`currentTime` seeking cannot guarantee frame-accurately across browsers)
— 97 frames per theme (`f001.webp`…`f097.webp`), plus each theme's
`poster.webp` (frame 1) and `final.webp`/`final-720.webp` (frame 97, full
+ mobile-width) for the non-scrubbing fallback tiers. ~1.3MB (light) /
~1.4MB (dark), ~2.15MB combined — the single largest item in this
budget, still well inside the 8MB `/public/site` ceiling with headroom.

**Anti-slop check (§7):** no robots/blobs/orbs/sparkles/cubes/particles/
emoji; a literal product artifact (phone, booking card), not a generic
tech metaphor; muted/neutral chassis colors, ember/accent used only
where the design system already reserves it (the sound-ribbon/booking-
card accent moments), not as ambient decoration.

**Licence**: same note as the top of this file (Higgsfield help-center
+ ToS §4.3/§4.4, verified 2026-09-14) — the generating account owns
these outputs, commercial use is permitted, no separate licence needed.

---

## Total `apps/web/public/site/` budget

| File | Size |
|---|---|
| `hero-loop.mp4` | 136KB |
| `hero-loop.webm` | 100KB |
| `hero-loop-poster.avif` | 8KB |
| `hero-loop-poster.webp` | 8KB |
| `og-still.avif` | 10KB |
| `og-still.webp` | 12KB |
| `og-still@2x.avif` | 27KB |
| `og-still@2x.webp` | 31KB |
| `hero-film/light/*` (97 frames + poster + final + final-720) | ~1.3MB |
| `hero-film/dark/*` (97 frames + poster + final + final-720) | ~1.4MB |
| **Total** | **~2.45MB** |

Well inside the 8MB `/public/site` budget and the brief's own "~2.5MB
before compression" ceiling for items 2+4 combined (actual: nowhere near
it — both source generations came back compact, and no asset here
approaches the 2MB per-loop cap in §6).
