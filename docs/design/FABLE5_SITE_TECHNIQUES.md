# Cinematic AI-Built Websites (Aug–Sep 2026): Techniques Research

Research pass for cluster DS / marketing site work. Scope per assignment:
survey the Aug–Sep 2026 wave of "Claude Fable 5 / Claude Code one-shots a
world-class site" videos, threads, and repos; extract concrete technique
and prompt patterns; separate signal from hype; produce a checklist for
Heyloo's own marketing site (`apps/web` `(marketing)` route group).

**Method note:** YouTube video playback and most X/Twitter threads were not
directly fetchable in this environment (video content, and X returned HTTP
403 on every fetch attempt) — findings from those are sourced from their
titles/descriptions and from linked write-ups, GitHub repos, and Claude
Code skill files that *were* fetchable. Anything not confirmed from a
primary source (repo code, official docs, a skill file, or a written
article actually read) is marked **UNVERIFIED**. Dollar figures ("$10K
website") and view/star counts are marketing claims from titles — treated
as hype, not fact, throughout.

**Context note:** "Claude Fable 5" (and "Fable 5.1") is the current
Anthropic Mythos-class model line as of this research (per
platform.claude.com/docs and anthropic.com/claude/fable) — i.e. it is the
model most of these Aug–Sep 2026 demos run on inside Claude Code, not a
separate product. Treated here as "Claude Code, current model" throughout.

---

## 1. Examples surveyed

| # | Title / Author | URL | What it shows | Stack (claimed/shown) | Repo/demo | Status |
|---|---|---|---|---|---|---|
| 1 | "Claude Fable 5 builds INSANE $10,000 Websites! (with 1 prompt)" | [youtube.com/watch?v=mokCv4xaPWM](https://www.youtube.com/watch?v=mokCv4xaPWM) | One-shot premium site build, sold as "$10K agency quality" | Claude Code + Fable 5 | — | **UNVERIFIED** (title/description only; not fetchable) |
| 2 | "I Challenged Claude Fable 5 to Build a $10,000 Animated Website…" | [youtube.com/watch?v=9WBkENNlwOQ](https://www.youtube.com/watch?v=9WBkENNlwOQ) | Animated site challenge format | Claude Code + Fable 5 | — | **UNVERIFIED** |
| 3 | "Claude Fable 5 Builds $10,000 Websites in 21 mins" | [youtube.com/watch?v=AFRL9dtUHeI](https://www.youtube.com/watch?v=AFRL9dtUHeI); write-up: [daily.dev](https://daily.dev/posts/claude-fable-5-builds-10-000-websites-in-21-mins-u9txav3mz) | 21-minute build session | Claude Code + Fable 5 | — | **UNVERIFIED**; daily.dev card confirms only that it's a video pointer, no transcript |
| 4 | "Fable 5 Is Back. Use It To Print With These $10K Websites" | [youtube.com/watch?v=h6G9R4UxR6g](https://www.youtube.com/watch?v=h6G9R4UxR6g) | Same format, framed around Fable 5's pricing-window return | — | — | **UNVERIFIED** |
| 5 | "Claude Fable 5 Built a $10K Website in Minutes" | [youtube.com/watch?v=m-f56P_L660](https://www.youtube.com/watch?v=m-f56P_L660); write-up: [claude-daily.com](https://claude-daily.com/articles/claude-fable-5%E3%81%8C%E6%95%B0%E5%88%86%E3%81%A710%E4%B8%87%E3%83%89%E3%83%AB%E7%B4%9A%E3%81%AEweb%E3%82%B5%E3%82%A4%E3%83%88%E3%82%92%E4%BD%9C%E3%82%8Bhiggsfield-mcp%E5%AE%9F%E6%BC%94-m-f56pl660/) | Pairs **Higgsfield MCP** (AI video/image gen) with Claude Code for the cinematic footage, then GSAP+canvas frame-rendering for the scroll experience | Claude Fable 5, Higgsfield MCP, Kling 3.0 / Cence 2.0 for 4K video, Nano Banana Pro for images, GSAP + ScrollTrigger, Lenis/ScrollSmoother, FFmpeg (video→JPEG frame sequence) | — | Partially verified via [aitecharchive.com write-up](https://aitecharchive.com/articles/cinematic-3d-scroll-fable-5-guide) (see §2.1) |
| 6 | "Claude Fable 5 Built Those INSANE $10,000 Websites in Minutes" | [youtube.com/watch?v=JjwvFSGOp7c](https://www.youtube.com/watch?v=JjwvFSGOp7c) | Same "$10K" format | — | — | **UNVERIFIED** |
| 7 | "Claude Code + Fable 5 = INSANE $10,000 Websites" | [youtube.com/watch?v=Nm-TkTQJN-Y](https://www.youtube.com/watch?v=Nm-TkTQJN-Y) | Same format | — | — | **UNVERIFIED** |
| 8 | "Claude Fable 5 + New Design Skill = Beautiful $10,000 Websites" | [youtube.com/watch?v=_2FlJYE4p3Q](https://www.youtube.com/watch?v=_2FlJYE4p3Q) | Ties result quality to installing a third-party **design skill** (not raw model output) — the load-bearing detail across this whole genre | — | Likely one of the skills catalogued in §5.2 | **UNVERIFIED** which specific skill |
| 9 | "I Built 6 Websites in 17 Minutes With Claude Fable 5" | [youtube.com/watch?v=gnZz32bF5sg](https://www.youtube.com/watch?v=gnZz32bF5sg); write-up: [designingforuncertainty.com](https://designingforuncertainty.com/2026/06/11/i-built-6-websites-in-17-minutes-with-claude-fable-5/) | **Escalating-difficulty test**, levels 1–6: (1) landing page → (2) brand identity → (3) animated layout → (4) futuristic site w/ custom 3D JS background → (5) immersive Three.js scroll-through → (6) full scroll-driven 3D site, "done in one prompt what took hours with Opus" | Three.js explicitly named; **no Spline, no external asset services** used | — | Confirmed structure via write-up; exact prompts **not published** on the page |
| 10 | "Claude Fable 5 Tutorial: How to Build 3D Websites As a Complete Beginner" | [youtube.com/watch?v=1KL06bwKzME](https://www.youtube.com/watch?v=1KL06bwKzME) | Beginner-framed 3D-site tutorial | — | — | **UNVERIFIED** |
| 11 | "Fable 5 built this 3D website in just ONE prompt" (Short) | [youtube.com/shorts/mjGRJQFbxqU](https://www.youtube.com/shorts/mjGRJQFbxqU) | Short-form, scroll-triggered 3D site claimed built in ~20 min from one prompt | — | — | **UNVERIFIED** |
| 12 | FHILY on X — cinematic scroll thread | [x.com/Oluwaphilemon1/status/2053773794288751009](https://x.com/Oluwaphilemon1/status/2053773794288751009) | Author's own 5-step recipe (quoted in full in §4.1) | Three.js + GSAP + ScrollTrigger, layered parallax images, scroll→zoom/scale/scene-transition mapping | — | Quoted from search snippet (X itself returned 403 on fetch) |
| 13 | MIKE on X — Fable 5 web-design guide pointer | [x.com/mikenevermiss/status/2076603705323892815](https://x.com/mikenevermiss/status/2076603705323892815) | Points to a full written guide + "complete prompts in the comments" | — | Likely the aitecharchive.com guide (row 5) | **UNVERIFIED** (403 on fetch; comments/prompts not retrievable) |
| 14 | `pulkitxm/claude-directory` (GitHub) | [github.com/pulkitxm/claude-directory](https://github.com/pulkitxm/claude-directory) | **Open-source gallery, most concretely verifiable source in this survey.** 180+ AI-generated UI experiments across hero sections (41), landing pages (98), animation/loaders (12), 3D/games (2), portfolios (14), components, shaders, templates. Every project ships its own `prompt.md` with the literal prompt used. Repo tagline: *"every project here was generated with Claude Fable 5—this whole repo is vibe coded."* | React 18/19 + TS, Vite, Tailwind v3/v4, Framer Motion + GSAP, Three.js; some vanilla HTML/CSS/JS | Repo itself is the demo | **Verified** (fetched directly) |
| 15 | Codrops — "How to Build Cinematic 3D Scroll Experiences with GSAP" | [tympanus.net/codrops/…](https://tympanus.net/codrops/2025/11/19/how-to-build-cinematic-3d-scroll-experiences-with-gsap/) | Not an AI-generated example, but the technique reference this genre of prompt/video visibly draws its vocabulary from: GSAP as "cinematic director" driving camera path, lighting, and shader-driven effects off scroll | Three.js + GSAP ScrollTrigger | — | Verified via search result |
| 16 | `dappasol.com` — "How to Make a Cinematic Website (2026): The Actual Build Path" | [dappasol.com/guides/how-to-make-a-cinematic-website/](https://dappasol.com/guides/how-to-make-a-cinematic-website/) | Non-AI-authored but the single most technically precise writeup found — pinned single-canvas/single-timeline architecture (see §2.2) | Three.js + GSAP ScrollTrigger, **explicitly no Lenis** | — | **Verified** (fetched directly) |

**Reading of the sample as a whole:** the "$10K website in N minutes" title format is a near-identical clickbait template repeated across at least 7 different channels in this list — none of the underlying videos were fetchable to confirm what actually shipped, and the pattern (identical claim, different creator, same 15–25 minute runtime) is itself evidence this is a content-farm trend riding the Fable 5 launch, not 7 independently remarkable builds. The two sources that *are* independently verifiable — the `claude-directory` repo and the `dappasol.com`/`aitecharchive.com` technique writeups — are consistent with each other on stack (Three.js + GSAP/ScrollTrigger as the core) and are the basis for the technique catalog below.

---

## 2. Technique catalog

### 2.1 Hero + cinematic-scroll composition (the dominant pattern)

The recipe repeated across nearly every source, most explicitly in the FHILY X thread (quoted verbatim, row 12):

> "1. Ask Claude for a scroll-based cinematic animation plan 2. Generate prompts for depth, parallax, and camera movement 3. Install Three.js + GSAP + ScrollTrigger 4. Use scroll to control zoom, scale, and scene transitions 5. Add layered images for 3D depth illusion" — refined with easing, lighting and shadows "until it feels like one continuous scene."

**How-to, synthesized from `dappasol.com` (the most technically specific source) + Codrops:**

1. **One pinned element, one 0→1 timeline.** A single `ScrollTrigger` pins one container for the full scroll length; every visual beat in the experience is driven off that one progress value (0 to 1), never off independent per-section triggers. Shot/beat data lives in an ordered array so re-sequencing the story is a data edit, not a re-code.
2. **Composite, don't render live 3D, when the source is film/video.** Where the visual is a cinematic shot sequence (AI-generated video or pre-rendered frames) rather than an interactive 3D object: slice video to a JPEG frame sequence (FFmpeg), draw frames onto an offscreen 2D `<canvas>` with alpha cross-dissolve between shots, then pass that 2D canvas as a texture through one fullscreen WebGL shader that only does the *grade* — bloom, vignette, chromatic aberration, grain. Keeps the debuggable part (compositing) in 2D and the GPU part (shader) to a thin, testable layer.
3. **Real 3D (Three.js/R3F) for anything the user should read as an object**, not for pure scenery — camera path, lighting and material choices become the "cinematography," with GSAP timelines driving camera position/target and light intensity off the same scroll progress value.
4. **Layered parallax images** (2–4 depth planes moving at different scroll-linked rates) are the cheap, no-WebGL version of the same depth illusion, and multiple sources use it as the fallback for hero sections that don't justify a 3D budget.
5. **Text reveals** are per-character/per-line, driven by GSAP `SplitText` (now free — see §5) scrubbed against the same scroll timeline rather than fading in as blocks.

### 2.2 Scroll-linked "morph" techniques

- **Shader/particle morph** (the technique behind "particles → shape" hero effects, confirmed across multiple three.js-forum/tutorial sources): store two position buffers (initial cloud, target shape) on the geometry, interpolate per-vertex in the vertex shader against a single `uProgress` uniform driven by ScrollTrigger's `onUpdate`. `InstancedMesh` is the practical vehicle when the "particles" are actual meshes rather than GL points.
- **SVG morph** (flubber / GSAP MorphSVG): MorphSVG is now bundled free with GSAP (see §5.1) — used for logo/icon transitions and simple shape storytelling; lighter-weight than a shader morph and the better default when the morph target is 2D iconography (e.g. Heyloo's "ringing phone → checkmark → calendar" beat) rather than an atmospheric 3D shape.
- **CSS-only scroll-timeline morph** is now viable for simpler cases: `animation-timeline: scroll()` has real 2026 support (Chrome/Edge 115+, Safari 18+/26+, Firefox still behind a flag as of Firefox 152/June 2026 — ~84% global support). Worth using for progressive-enhancement-tier motion (simple reveals, progress bars) so JS-driven GSAP is reserved for the parts CSS genuinely can't do (camera paths, shader uniforms, complex sequencing).

### 2.3 Sticky-scroll storytelling sections

Consistent pattern across the hero-gallery repo and the technique writeups: one pinned "stage" per story beat, each stage internally driving 2–4 sub-animations (camera/parallax move, text reveal, a UI element materializing) off the same local scroll-progress slice, then releasing the pin to the next stage. This is the direct analog for Heyloo's call→answer→booking→dashboard narrative (see §6).

### 2.4 Page transitions, cursor/magnetic effects

- **Magnetic cursor/button effects** — buttons/links subtly lean toward the pointer on hover, springs rather than linear eases — are called out by a 2026 trend report as "the cheapest way to make a site feel expensive," implemented either by hand (mouse-position delta → CSS transform, spring-damped) or via Motion's own cursor plugin (Motion+ Cursor — paid tier).
- Page-level transitions were not deeply verifiable from these sources; the View Transitions API (native browser) is the 2026-appropriate primitive per the CSS scroll-driven-animations research and pairs naturally with the same "story beat" model.

### 2.5 Lighting/material choices in Three.js

- **Matcaps** (`MeshMatcapMaterial`) — a pre-baked, view-space "fake environment map" on a sphere texture — repeatedly recommended as the lightweight default for stylized product/hero objects where a real HDRI environment map would cost more GPU/bandwidth than the payoff justifies.
- **Bloom / postprocessing**: three.js r183 shipped `RenderPipeline`, a node-based, WebGPU-native postprocessing rewrite with automatic WebGL2 fallback — the current-generation way to add bloom/grade rather than the older `EffectComposer`/`UnrealBloomPass` pattern (still works, but is the previous generation's approach).
- **Environment maps** proper (HDRI) reserved for genuinely reflective/PBR hero objects; matcaps for everything else.

### 2.6 Asset strategy: Spline vs. code vs. pre-rendered video

Three real options, each seen in the wild:

1. **Spline embed** — true WYSIWYG 3D editor, best defaults for materials/lighting, fastest to a good-looking result, but: proprietary scene format (no ownership of editable code), runtime bundle weight on low-end devices, and a ceiling once interactions get complex. Pricing 2026: free tier, Starter ~$12–15/mo, Pro ~$20–25/mo (sources disagree on exact tiers — treat as approximate).
2. **Hand-coded Three.js/R3F** — full control, owns the code, no per-seat cost, but requires real WebGL/shader competency and more build time. The consistent 2026 guidance: Spline wins for a 4-week marketing site; Three.js wins for anything with a multi-year lifespan or that needs custom interaction the visual editor can't express.
3. **Pre-rendered video loops** (row 5's Higgsfield/Kling pipeline: generate cinematic video with an AI video model, slice to frames, composite in canvas+shader) — sidesteps needing a real-time 3D scene at all when the visual is "a beautiful establishing shot," at the cost of a video-generation pipeline dependency and larger asset payloads (mitigated by frame-sequence + sliding-window loading, see §2.7).

**Heyloo call:** hand-coded Three.js/R3F for the phone→booking story sequence (it's a small number of custom shapes we own conceptually — a stylized phone/waveform/calendar/checkmark — not a generic decorative scene), no Spline dependency, no AI-video pipeline. Keeps the story assets under our own version control and matches the "provider isolation" spirit of Rule 2 even though this is marketing, not core code.

### 2.7 Performance tricks

- **DPR capping** — clamp `renderer.setPixelRatio` to e.g. 1.5–2 rather than the raw device value; multiple performance-tips sources list this as the single highest-leverage GPU-memory fix on high-DPI mobile.
- **Dynamic quality scaling** — listen for a performance-monitor's "degrade" event and respond by lowering DPR first, then disabling postprocessing, then culling non-essential scene objects (`setLowSetting`-style tiering) — never all-or-nothing.
- **Lazy/offscreen pause** — pause the render loop (`renderer.setAnimationLoop(null)` equivalent) when the canvas leaves the viewport (`IntersectionObserver`) and on `visibilitychange`; don't spend GPU/battery animating hidden canvases.
- **Sliding-window frame loading** for the pre-rendered-video pattern (§2.6.3): keep only a handful of frames buffered around the current scroll position in memory, not the whole shot — required to avoid iOS Safari memory crashes; serve a downscaled (720p) frame variant on phones. Desktop testing does **not** catch these failures; real-device testing is called out as mandatory.
- **GPU-only animated properties**: animate `transform` and `opacity` exclusively wherever the effect can be expressed that way (both the elite-frontend-ux skill and general GSAP guidance converge on this); anything touching layout (`width`, `top`, `left` position without `transform`) triggers reflow and is the most common cause of janky "premium" sites that actually run at 20fps on a mid-range phone.
- **Screenshot-based canvas testing doesn't work** — a canvas mid-animation reads back as black in a naive screenshot; the verification pattern instead exposes the ScrollTrigger instance and a debug object on `window` so an agent (or CI) can programmatically set scroll position, call `.update()`, and read back transform/opacity/text state — this is the mechanism to reuse for any automated visual regression test of Heyloo's own scroll story.

---

## 3. What separates "world-class" from "AI slop" — concrete tells

Cross-referenced across four independent write-ups (SmoothUI, 925studios, vibecodekit, and Thomas Wiegold's breakdown of Anthropic's own frontend-design plugin — all converge on nearly the same list):

**The tells (slop signals):**
- **Purple-to-blue/indigo gradient** anywhere on the hero — called out by *every* source as the single most common "this was AI-generated" signal ("purple reads as premium, indigo reads as technical, and the training corpus is saturated with both").
- **Inter / Roboto / Arial as the *display* font** — not that these fonts are bad (Inter is a perfectly good body/UI face — see Heyloo's own `DESIGN_SYSTEM.md`, which already uses Inter for *body* only), but using a default system sans as the *headline* face reads as "didn't make a choice."
- **Generic floating 3D blob** — an abstract, non-representational glossy shape in the hero with no connection to what the product actually does.
- **Three (or six) identical cards in a row** — uniform border-radius, one icon + heading + two lines of body text each, no visual hierarchy between them.
- **Shadows at ~0.1 opacity, uniformly applied** — a specific, oddly consistent tell one source names outright.
- **Vague headline copy** ("Build the future of work") that could apply to any SaaS product — a copy-layer tell, not just visual.
- **Rainbow/unpurposeful color use** and **inconsistent border-radius** across components in the same layout.
- **Too many simultaneous effects with no hierarchy** — glow + gradient + blob + particles + parallax all firing at once, none of it in service of showing the actual product doing its actual job (the "no product truth" failure mode named in the task brief, and echoed by the vibecodekit/925studios "generic, interchangeable" framing).

**What the praised ones do instead (from the same sources, stated as the fix):**
- **Pick one aesthetic direction on purpose, before writing code** — the Anthropic frontend-design plugin's core mechanic is literally forcing this as a pre-code step (purpose → tone → constraints → one named direction: brutalist / maximalist / retro-futuristic / editorial / luxury / playful / etc.), and every derivative skill in §5.2 repeats the same forcing function.
- **A real typography pairing** — one distinctive display face (examples repeatedly cited: Fraunces, Instrument Serif, Space Grotesk, Playfair) + one refined, quiet body face — not "whatever sans-serif loads fastest."
- **Realistic content, not lorem ipsum** — named independently by the Anthropic cookbook guidance and the griffinwooldridge writeup as disproportionately correlated with a UI "looking finished."
- **Explicit states** — hover, focus, loading, empty — specified up front rather than left to the model's default (which is to skip them).
- **Motion in service of a story**, scrubbed to scroll position, not decorative idle-looping — i.e. exactly the single-timeline pattern in §2.1, where every animation beat corresponds to a narrative beat.
- **Restraint** — this is Heyloo's own `DESIGN_SYSTEM.md` framing ("premium restraint... near-monochrome neutrals, ONE signature accent used sparingly") and it is independently the fix every anti-slop source converges on: fewer simultaneous effects, one accent, generous whitespace, hairline borders.

---

## 4. Prompt patterns

### 4.1 The five-step recipe (FHILY, X — quoted verbatim)

> "1. Ask Claude for a scroll-based cinematic animation plan 2. Generate prompts for depth, parallax, and camera movement 3. Install Three.js + GSAP + ScrollTrigger 4. Use scroll to control zoom, scale, and scene transitions 5. Add layered images for 3D depth illusion. Add smooth easing, lighting, and shadows for realism, refined until it feels like one continuous scene."
— [x.com/Oluwaphilemon1/status/2053773794288751009](https://x.com/Oluwaphilemon1/status/2053773794288751009)

This is a **planning-first** pattern: get the model to produce the storyboard/plan as a distinct step before any code, then implement stack-by-stack.

### 4.2 Design-system-first pattern (griffinwooldridge.com — quoted)

> "Force design-system thinking first. I asked the model to define a design system before building any components, so the output is coherent rather than component-by-component guesswork." ... "Specify states explicitly. Hover, focus, loading skeletons, empty states. Models skip these by default unless you ask." ... "Write your prompt like a brief you would hand to a senior design engineer, then let the model plan and build against it."

Example brief opener quoted on the page:

> "Build a fully interactive dashboard for a B2B analytics SaaS product... Use a cohesive design system - define your spacing scale, type scale, and color system before building components... All data should be realistic and hardcoded - no placeholder Lorem Ipsum"

Source: [griffinwooldridge.com/blog/claude-fable-5-for-ui-design-how-to-get-beautiful-output-every-time](https://griffinwooldridge.com/blog/claude-fable-5-for-ui-design-how-to-get-beautiful-output-every-time)

### 4.3 Anthropic's own forcing-function pattern (official — verified)

The `frontend-design` plugin shipped by Anthropic itself (authors: Prithvi Rajasekaran, Alexander Bricken — [github.com/anthropics/claude-code/tree/main/plugins/frontend-design](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design)) is, per the Thomas Wiegold breakdown, "a single SKILL.md file, about 50 lines of markdown" that:

1. Makes Claude declare **purpose, tone, constraints, and a named aesthetic direction** before generating any code.
2. Governs five concrete dimensions explicitly: **typography, color/theme, motion, spatial composition, backgrounds.**
3. Carries an explicit **forbidden list**: *"Inter, Roboto, Arial, system fonts. Purple gradients on white backgrounds. Predictable layouts."*
4. Prompting contrast the cookbook itself teaches: **don't** over-specify pixel values ("H1 at 64px Inter Bold" removes creative latitude and tends to regress to generic); **do** give principle-based direction ("editorial magazine aesthetic," "serif display font like Fraunces or Playfair") and let the model make intentional choices inside that frame.

Full reference notebook (official, worth reading directly before the marketing site work starts): [claude-cookbooks/coding/prompting_for_frontend_aesthetics.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/coding/prompting_for_frontend_aesthetics.ipynb).

### 4.4 Reference-site / scraped-pattern layer

Multiple sources (the aiagentslibrary "7-level framework" summary, and the wilwaldon toolkit's Figma-MCP entry) converge on a second layer on top of §4.3: feed the model *real* shipped design as reference rather than describing it in prose — via a design-pattern MCP (Mobbin cited by name), a Figma file (Figma MCP / Code Connect), or scraped competitor pages (Firecrawl) — specifically to fight "generic output drift" across a multi-screen build, not just a single hero.

### 4.5 Iterative screenshot/vision-feedback loop

Confirmed pattern, not specific to any one video: give the agent browser control (Playwright MCP is the concrete, official tool named across every source that discusses this) so it can navigate to its own build, screenshot or read the accessibility tree, judge the result against the stated design direction, and iterate — the same "capture → propose → confirm → verify" loop is named explicitly by one skill (`mcpmarket.com/tools/skills/visual-feedback-loop-eyes`, titled "Eyes"). This is the mechanism that turns a one-shot prompt into the "it kept refining until it looked right" result these videos show, and it composes directly with the `window`-exposed debug/scroll-state hook from §2.7 for testing the motion itself, not just static layout.

---

## 5. Libraries and starters to adopt now

### 5.1 Core motion/3D stack

| Library | Version / status (2026) | License | Notes |
|---|---|---|---|
| **GSAP** (core + ScrollTrigger + **all** former Club plugins: SplitText, MorphSVG, DrawSVG, ScrollSmoother) | Actively maintained | **100% free**, incl. commercial use, since Webflow's Oct 2024 acquisition of GreenSock (all premium plugins freed ~Apr 2025) — **not open-source**: cannot fork/decompile, but no licensing blocker for Heyloo's use | Now the default choice with zero cost tradeoff — previously "free GSAP + paid Club plugins" was the friction point, that's gone |
| **Three.js** | r183+ (RenderPipeline: node-based, WebGPU-native postprocessing with automatic WebGL2 fallback) | MIT | Use the new `RenderPipeline` for bloom/postprocessing rather than the legacy `EffectComposer` pattern on any new work |
| **@react-three/fiber** + **@react-three/drei** | R3F v9 (peer-requires React ≥19, <19.3) | MIT | Only pull in if the marketing site needs declarative JSX-composed 3D scenes beyond a couple of hand-tuned hero objects — for Heyloo's scope (a handful of custom story shapes), plain Three.js in a client island may be simpler than adopting the full R3F render-loop model inside Next.js RSC |
| **Lenis** | 1.3.26 (npm, actively published) | MIT | Smooth-scroll layer — **but explicitly avoid combining with pinned ScrollTrigger sections**; `dappasol.com`'s guide states plainly it "breaks stacked and pinned ScrollTriggers," use native scroll + ScrollTrigger for any pinned cinematic sequence, reserve Lenis (if used at all) for pages with no pinning |
| **Motion** (formerly Framer Motion; import from `motion/react`, not `framer-motion`) | 3.6M weekly downloads, 30.7k★ | MIT | Renamed 2025; same team/API. Good fit for component-level micro-interactions (card hover, button spring, page-level `AnimatePresence`) — not a replacement for GSAP's scroll-timeline/pin muscle |
| **CSS `animation-timeline: scroll()`** | Chrome/Edge 115+, Safari 18+/26+; Firefox still flagged as of Firefox 152 (June 2026) | Web std | Use for simple, progressive-enhancement-tier scroll reveals (fade/translate on entry) to cut JS weight; keep GSAP for anything with pinning, camera paths, or shader uniforms |
| **Spline** (optional, evaluate not default) | Free tier / ~$12–25/mo paid tiers (sources vary — verify at build time) | Proprietary | Only if a genuinely designer-driven 3D asset is needed fast and code-ownership of that asset doesn't matter; see §2.6 tradeoffs |
| **Rive** | — | — | Better fit for interactive 2D/vector character or icon state machines (e.g. a small animated mascot reacting to state) than for the cinematic-scroll hero pattern; not central to this genre of site |
| **Playwright MCP** | Official Microsoft MCP package | — | Adopt as the standard verification loop for any agent-built motion work (§4.5) — accessibility-tree-based, faster/cheaper than pure screenshot diffing |

### 5.2 Claude Code skills/rules-file ecosystem (context, not necessarily to install verbatim)

- **`anthropics/claude-code` `frontend-design` plugin** — official, ~50-line SKILL.md forcing function (§4.3). Worth reading as the reference implementation even if Heyloo writes its own tighter version tied to `DESIGN_SYSTEM.md`'s existing tokens, since a generic skill would fight the already-decided neutral/ember palette.
- **`freshtechbro/claudedesignskills`** ([github.com/freshtechbro/claudedesignskills](https://github.com/freshtechbro/claudedesignskills)) — community collection incl. a `gsap-scrolltrigger` SKILL.md (verified fetch, §content: tween/timeline fundamentals, ScrollTrigger start/end syntax, scrub/toggleActions, `ScrollTrigger.batch()`, pin+parallax patterns, `useGSAP` React hook usage, and explicit performance rules — GPU-only properties, `will-change`, cleanup/`kill()` on unmount) and a `react-three-fiber` skill.
- **`wilwaldon/Claude-Code-Frontend-Design-Toolkit`** ([github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit](https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit)) — a curated meta-list (skills, MCPs, CLAUDE.md tricks) across design-system, theming (OKLCH-based token generation — directly aligned with Heyloo's own OKLCH-based `DESIGN_SYSTEM.md`), animation (23 sub-skills spanning GSAP/Motion/React Spring/Lottie), design-to-code (Figma MCP), and testing (Playwright MCP, visual regression). Confirms the CLAUDE.md-rules-block pattern for locking in a single aesthetic direction.
- **`majidmanzarpour`'s `elite-frontend-ux` gist** — tight, quotable anti-slop rule set: nine named aesthetic directions to choose from, explicit forbidden-fonts and forbidden-color rules ("NEVER purple gradients on white," 60-30-10 color-ratio rule), GPU-only-property animation rule.
- **Anthropic's `prompting_for_frontend_aesthetics.ipynb` cookbook** — the primary source underlying most of the derivative skills above; read directly rather than through a third-party skill when writing Heyloo's own rules.

**Recommendation:** don't install a third-party mega-skill wholesale — Heyloo already has an opinionated, OKLCH-based, restraint-first `DESIGN_SYSTEM.md`. The useful thing to borrow is the *forcing-function mechanic* (declare direction + forbidden list before generating code) wired to our *existing* tokens, plus the `gsap-scrolltrigger` skill's technical patterns for the scroll-story build itself.

---

## 6. Heyloo build checklist — what our marketing site must include to match the best examples

Story to tell: **call rings → answered by the AI receptionist → booking materializes → lands in the tenant's dashboard.** This maps directly onto the "sticky-scroll storytelling, one pinned timeline, N story beats" pattern from §2.1/§2.3, which is the one piece of technique that shows up, independently, in nearly every credible source in this survey.

1. **One pinned hero sequence, one 0→1 scroll timeline, 3–4 story beats** (ring → answer → booking card materializes → dashboard row appears) — not four separate scroll-triggered sections stitched together. Build it on the `dappasol.com` architecture: shot data as an ordered array, ScrollTrigger drives progress, GSAP timeline reads that progress to move/scale/fade each beat's elements. This is the single highest-leverage technique in this whole survey and the one that most separates "premium" from "a page with some fade-ins."
2. **Represent the actual product, not a generic 3D blob.** The morphing/visual language should literally be a phone icon → sound-wave/transcript → calendar/booking-card → dashboard-row sequence (SVG/MorphSVG or a couple of hand-modeled Three.js objects), matching the anti-slop finding in §3 that the praised examples show the product doing its real job, not abstract decoration.
3. **Ship the forbidden-list forcing function as a CLAUDE.md / skill rule for any agent-assisted work on the marketing site**, tied to the tokens already defined in `docs/DESIGN_SYSTEM.md` (near-monochrome neutrals + the "ember" accent, Fraunces display + Inter body + Plex Mono for numbers/ids) — explicitly forbid purple/indigo gradients, forbid Inter (or any system sans) as a *display* face, forbid decorative multi-effect stacking, require realistic content (real-looking transcript text, a real-looking booking, not lorem ipsum) per §3/§4.3.
4. **GPU-only animated properties, DPR cap, and offscreen pause from day one** (§2.7) — the hot-path budget discipline this repo already applies to `/voice/tools` (Rule 2) should extend to the marketing site's scroll experience: cap `devicePixelRatio`, pause the render loop via `IntersectionObserver` when the hero scrolls out of view, and test on a real mid-range phone, not just desktop Chrome — this is the concrete, named cause of "looks amazing on the recording, janky in your hand" failures across the performance sources.
5. **Text reveals and micro-interactions scrubbed to the same scroll/interaction state, not decorative loops**: per-character `SplitText` reveals timed to each story beat (free with GSAP now, §5.1), a subtle magnetic hover on the primary CTA (§2.4), spring rather than linear easing throughout — "small, felt-not-seen details" per the 2026 trend synthesis, applied sparingly (restraint over density, per §3).
6. **Wire an automated visual-verification loop into the build process**, not just a one-shot generation: expose the ScrollTrigger instance + a debug object on `window` (§2.7's testing pattern) and drive Playwright MCP (or a Playwright test) through the full scroll range, asserting each story beat reaches its target transform/opacity/text state — reuse this as an actual Playwright smoke test per `docs/FRONTEND_STACK.md`'s existing test plan, not only as a manual Claude Code screenshot loop during authoring.
7. **Progressive enhancement via native CSS scroll-timelines** for the *simpler* on-scroll reveals elsewhere on the marketing site (pricing cards, testimonials, footer) — reserve GSAP/JS for the one hero sequence that actually needs pinning and camera-path-grade choreography, keeping JS payload proportional to what's earning its keep.

---

## Sources index (all URLs cited above, deduplicated)

- https://x.com/Oluwaphilemon1/status/2053773794288751009
- https://new2026.medium.com/best-claude-code-skills-for-3d-websites-scroll-animation-three-js-gsap-and-spline-7f42b28b20c7
- https://github.com/freshtechbro/claudedesignskills
- https://github.com/freshtechbro/claudedesignskills/blob/main/.claude/skills/gsap-scrolltrigger/SKILL.md
- https://dappasol.com/guides/how-to-make-a-cinematic-website/
- https://www.claudepluginhub.com/plugins/mustbesimo-cinematic-scroll (403 — not verified)
- https://github.com/pulkitxm/claude-directory
- https://www.mindstudio.ai/blog/generate-25-websites-claude-fable-5-single-prompt
- https://www.mindstudio.ai/blog/animated-3d-websites-claude-code-ai-video-generation
- https://x.com/mikenevermiss/status/2076603705323892815 (403 — not verified)
- https://www.youtube.com/shorts/mjGRJQFbxqU
- https://www.youtube.com/watch?v=bhietcNpXw8
- https://www.youtube.com/watch?v=_odUXU-1m-Y
- https://www.youtube.com/watch?v=gnZz32bF5sg
- https://designingforuncertainty.com/2026/06/11/i-built-6-websites-in-17-minutes-with-claude-fable-5/
- https://www.youtube.com/watch?v=1KL06bwKzME
- https://aitecharchive.com/articles/cinematic-3d-scroll-fable-5-guide
- https://claude-daily.com/articles/claude-fable-5%E3%81%8C%E6%95%B0%E5%88%86%E3%81%A710%E4%B8%87%E3%83%89%E3%83%AB%E7%B4%9A%E3%81%AEweb%E3%82%B5%E3%82%A4%E3%83%88%E3%82%92%E4%BD%9C%E3%82%8Bhiggsfield-mcp%E5%AE%9F%E6%BC%94-m-f56pl660/
- https://www.youtube.com/watch?v=mokCv4xaPWM
- https://www.youtube.com/watch?v=9WBkENNlwOQ
- https://www.youtube.com/watch?v=AFRL9dtUHeI
- https://www.youtube.com/watch?v=h6G9R4UxR6g
- https://www.youtube.com/watch?v=m-f56P_L660
- https://www.youtube.com/watch?v=JjwvFSGOp7c
- https://www.youtube.com/watch?v=Nm-TkTQJN-Y
- https://daily.dev/posts/claude-fable-5-builds-10-000-websites-in-21-mins-u9txav3mz
- https://chatyt.io/trending/claude-fable-5-built-a-10k-website-in-minutes-uncovered (403 — not verified)
- https://www.youtube.com/watch?v=_2FlJYE4p3Q
- https://www.aiagentslibrary.com/blog/best-claude-fable-5-website-prompts/
- https://griffinwooldridge.com/blog/claude-fable-5-for-ui-design-how-to-get-beautiful-output-every-time
- https://www.indiehackers.com/post/the-ai-purple-problem-why-every-ai-brand-looks-the-same-6cb0aa2a02
- https://smoothui.dev/blog/ai-design-slop
- https://mohitphogat.medium.com/ai-design-slop-why-every-ai-built-interface-looks-the-same-and-how-to-fix-it-bf874e0b470c
- https://www.925studios.co/blog/ai-slop-web-design-guide
- https://vibecodekit.dev/ai-slop-design
- https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website
- https://claude.com/blog/improving-frontend-design-through-skills
- https://github.com/anthropics/claude-cookbooks/blob/main/coding/prompting_for_frontend_aesthetics.ipynb
- https://claude.com/plugins/frontend-design
- https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design
- https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/README.md
- https://thomas-wiegold.com/blog/claude-code-frontend-design-plugin/
- https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit
- https://gist.github.com/majidmanzarpour/8b95e5e0e78d7eeacd3ee54606c7acc6
- https://www.npmjs.com/package/lenis
- https://www.npmjs.com/package/framer-motion
- https://gsap.com/blog/3-13/
- https://tympanus.net/codrops/2025/11/19/how-to-build-cinematic-3d-scroll-experiences-with-gsap/
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations
- https://svilenkovic.com/3d/three-js-vs-spline
- https://www.utsubo.com/blog/threejs-best-practices-100-tips
- https://threejsroadmap.com/blog/the-complete-guide-to-threejs-post-processing-in-2026
- https://sbcode.net/threejs/meshmatcapmaterial/
- https://motion.dev/magazine/introducing-magnetic-cursors-in-motion-cursor
- https://motionkit.io/blog/web-animation-trends-2026
- https://threejs-journey.com/lessons/particles-morphing-shader
