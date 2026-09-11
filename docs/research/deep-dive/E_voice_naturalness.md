# Part E — How Human Does It Sound, Really: Retell vs. ElevenLabs on a Live Phone Call

Research date / access date for every citation below: **2026-09-11**, unless a
source is explicitly marked otherwise. Grounded against
`docs/research/RETELL_VS_ELEVENLABS_2026.md` (pricing/feature baseline) and
`docs/MASTER_PLAN.md` §2. Read-only research — no code or config changed.

**Labeling convention:** unmarked claims are from official `elevenlabs.io`,
`docs.retellai.com`, or `retellai.com` pages, fetched this session. Anything
from a third-party blog, review site, or benchmark is marked **UNVERIFIED**
and named as such inline — treat as directional, not contractual.

---

## Verdict, up front

**On a real phone call today, neither platform is dramatically more "human"
than the other — the gap is mostly in latency-consistency and backchannel
polish, not raw voice quality, and it is genuinely close.** ElevenLabs'
native voices (Flash v2.5, and now a purpose-built **`eleven_v3_conversational`**
model) carry more expressive prosody in isolation; Retell's own orchestration
(turn-taking + backchannel + interruption tuning) is more mature and
independently benchmarks slightly faster and more consistent end-to-end in
2026 third-party tests (**UNVERIFIED**). Both are materially degraded by the
8kHz phone codec, which flattens exactly the prosodic nuance that
differentiates a $0.04/min ElevenLabs voice from a $0.015/min native one —
so the "sounds more human" gap that's obvious in a browser demo narrows
substantially on an actual PSTN call. **For Heyloo's booking-call use case
(short, tool-heavy, interruption-tolerant), we'd call it a low-single-digit-percent
edge to whichever platform has better-tuned turn-taking for a given
vertical's prompt — not a strategic differentiator — at a real latency cost
if you reach for ElevenLabs' most expressive model, and a real dollar cost
either way for the ElevenLabs-brand voice on Retell ($0.025/min premium).**
See §9 for the full "what a caller experiences" breakdown and §10 for
per-vertical settings recommendations.

---

## 1. TTS models available in the real-time agent path

### 1.1 ElevenLabs

Source: [ElevenLabs — Models](https://elevenlabs.io/docs/overview/models) (fetched 2026-09-11).

| Model | Latency (model-only, excl. app/network) | Languages | Real-time/conversational? |
|---|---|---|---|
| **Eleven Flash v2.5** | **~75ms†** | 32 | Yes — lowest-latency option |
| **Eleven v3 Conversational** (`eleven_v3_conversational`) | **~280ms** | 70+ | **Yes** — "our most expressive, realtime speech synthesis model" |
| Eleven Multilingual v2 | not given as a latency-optimized figure | 29 | No — quality-first, not listed for the agent path |
| Eleven v3 (base, non-conversational) | not real-time optimized | 70+ | **No** — offline/studio use (audiobooks, character voiceover), 5,000-char limit |
| Scribe v2 Realtime (STT, not TTS) | ~150ms† | — | Yes (the ASR side of the pipeline) |

† Model latency only — excludes turn detection, STT, LLM inference, tool
calls, network, and telephony, which dominate the caller-perceived gap (§9).

**Key finding, correcting a stale assumption:** as of this research date,
ElevenLabs' Agents Platform docs explicitly list **`eleven_v3_conversational`**
— not the base v3 — as an option: *"Use `eleven_v3_conversational`,
`eleven_flash_v2_5`, `eleven_flash_v2` or `eleven_multilingual_v2`"* for the
Agents product, adding *"Use `eleven_v3_conversational` for the most
expressive delivery."* **So yes — a v3-generation model with audio-tag-driven
emotion IS available in the live conversational agent path today, not only
for offline TTS** — this is a materially different answer than "v3 is studio-only,"
which several 2026 third-party articles still repeat, e.g.
[ElevenLabs v3 vs Flash v2.5: when each wins (UNVERIFIED, Waboom AI)](https://www.waboom.ai/blog/elevenlabs-v3-vs-flash-voice-agents)
and an inworld.ai review (**UNVERIFIED**) both state ElevenLabs "explicitly
recommends v2.5 Turbo or Flash for real-time... as v3 is optimized for
quality rather than low-latency." **Our read: that guidance is accurate for
base `eleven_v3`, but stale/imprecise with respect to the newer
`eleven_v3_conversational` variant specifically built to close that gap** —
worth re-confirming against a live test account before committing a vertical
to it, since docs pages for a fast-moving product line have proven
internally inconsistent (`RETELL_VS_ELEVENLABS_2026.md` §4 already flagged
three product-name changes in this line during 2026).

At **~280ms model latency**, `eleven_v3_conversational` is still well inside
generally-cited "feels natural" budgets (≤500-800ms full-turn, see §9), but
it is **~3.7x slower at the model layer than Flash v2.5** — on a hot path
where Heyloo's own budget for `/voice/tools` is 500ms end-to-end
(CLAUDE.md Rule 2), that delta is not free, especially stacked with STT,
tool-call round trips, and LLM inference.

### 1.2 Retell

Source: [Retell — Create Agent API reference](https://docs.retellai.com/api-references/create-agent) `voice_model` enum (fetched 2026-09-11); provider list corroborated by [Retell — Voice customization docs](https://docs.retellai.com/build/voice) and third-party summary (**UNVERIFIED**, [Cekura — Retell AI Voice Automation Features](https://www.cekura.ai/blogs/retell-ai-voice-automation-features)).

Retell's `voice_model` enum, verbatim from the official API reference:

```
eleven_flash_v2, eleven_flash_v2_5, eleven_multilingual_v2, eleven_v3,
sonic-3, sonic-3-latest, sonic-3.5, sonic-3.6,
tts-1, gpt-4o-mini-tts,
speech-02-turbo, speech-2.8-turbo,
s1, s2-pro, s2.1-pro,
inworld-tts-2, inworld-tts-2-flash
```

Mapped to providers: **ElevenLabs** (Flash v2, Flash v2.5, Multilingual v2,
v3), **Cartesia** (`sonic-*` family), **OpenAI** (`tts-1`, `gpt-4o-mini-tts`),
**MiniMax** (`speech-*-turbo`), **Fish Audio** (`s1`/`s2*`), **Inworld**
(`inworld-tts-2*`), plus Retell's own platform-native clone voices. **PlayHT**
is named in several third-party comparison pieces as a Retell-supported
provider (**UNVERIFIED** — not confirmed in the official enum fetched this
session; may have been deprecated/renamed, or the enum above may be
incomplete — flag for `docs/VERIFY.md`).

**Important nuance for Heyloo:** Retell's enum lists **`eleven_v3`** (the
base, non-latency-optimized model) — **not** `eleven_v3_conversational`. If
this enum is accurate and current, **selecting "v3" voice quality on Retell
today may mean using ElevenLabs' offline-oriented model over a live phone
call**, not the purpose-built low-latency conversational variant ElevenLabs
itself now recommends for agents (§1.1). This is a genuine, previously
unflagged risk: **append to `docs/VERIFY.md`** — confirm with a live Retell
test call whether `eleven_v3` on Retell is latency-comparable to
`eleven_v3_conversational`, or whether it behaves like base v3 (multi-second
generation, unsuitable for real-time) before ever offering "ElevenLabs
premium voice" as a Heyloo add-on.

**Surcharge:** ElevenLabs-brand voices cost **$0.040/min** on Retell vs.
**$0.015/min** for native/Cartesia/MiniMax/Fish/OpenAI voices — a
**$0.025/min premium**, confirmed via `retellai.com/pricing` in
`RETELL_VS_ELEVENLABS_2026.md` §1.1 (re-cited here, not re-fetched this
session).

---

## 2. Emotion / expressiveness controls

### 2.1 ElevenLabs

- **Audio tags (v3 / v3 Conversational only):** bracketed cues embedded in
  the text sent to TTS — `[excited]`, `[whispers]`, `[sighs]`, `[laughs]`,
  `[TIRED]`, `[NERVOUS]`, `[FRUSTRATED]` — direct "emotion, pacing, delivery,
  and tone." Source:
  [ElevenLabs — Audio tags 101](https://elevenlabs.io/blog/v3-audiotags),
  corroborated by
  [ElevenLabs — Eleven v3 audio tags blog](https://elevenlabs.io/blog/eleven-v3-audio-tags-expressing-emotional-context-in-speech).
  Eleven v3 (including the Conversational variant) went GA **March 14, 2026**
  (**UNVERIFIED** date, third-party: [inworld.ai — ElevenLabs v3 GA review](https://inworld.ai/resources/elevenlabs-v3-review)).
  Practically: for this to work in our agent, the **LLM's generated response
  text** needs to include the bracketed tags — i.e. emotion direction is
  prompt-driven, not a separate API parameter, and only works on Flash v2.5's
  more-limited cousin models or v3/v3 Conversational, not on Multilingual v2.
- **Stability, Similarity, Speed** (standard voice-settings sliders, apply
  to all models): Source: [ElevenLabs — Conversational voice design best practices](https://elevenlabs.io/docs/eleven-agents/customization/voice/best-practices/conversational-voice-design).
  - Stability 0.30–0.50 → more emotional/dynamic, occasionally unstable.
  - Stability 0.60–0.85 → consistent, can read monotonous.
  - Similarity boost: higher = clearer/more consistent to the source voice;
    too high risks distortion artifacts.
  - Speed: **0.9–1.1x recommended for natural conversation**; slow down for
    complex info, speed up for routine confirmations.
  - No explicit numeric recommendation given for "style" (v3 has an implicit
    style dimension via audio tags rather than a separate style slider, per
    the same source).

### 2.2 Retell

Source: [Retell — Create Agent API reference](https://docs.retellai.com/api-references/create-agent).

- **`voice_temperature`** (0–2): "Controls how stable the voice is. Lower =
  more stable, higher = more variant speech generation" — Retell's rough
  analog to ElevenLabs' stability slider, but inverted in spirit (higher =
  *more* variance here, whereas ElevenLabs' higher stability = *less*
  variance).
- **`voice_emotion`**: enum of `calm, sympathetic, happy, sad, angry,
  fearful, surprised` — **but the field is explicitly scoped: "Currently
  supported for Cartesia and Minimax TTS providers"** — i.e. **not** available
  on ElevenLabs voices selected through Retell. This is a real gap: if a
  vertical wants ElevenLabs voice quality *and* explicit emotion control on
  Retell, it can't have both today — only Cartesia/MiniMax voices get the
  `voice_emotion` knob.
- **`voice_speed`** (0.5–2, default 1) and **`enable_dynamic_voice_speed`**
  (adjusts to caller's own speech rate) — no ElevenLabs-side restriction
  noted for these two.
- No documented audio-tag or SSML-like inline markup system on Retell (not
  found in the API reference or orchestration docs fetched this session) —
  emotion is set at the voice/session level (`voice_emotion`,
  `voice_temperature`), not per-utterance the way ElevenLabs' bracketed tags
  allow. This is a real capability gap **on Cartesia/MiniMax voices too** —
  Retell has no per-line emotion directive equivalent to `[sighs]`.

---

## 3. Turn-taking and interruption handling

### 3.1 Retell

Source: [Retell — Create Agent API reference](https://docs.retellai.com/api-references/create-agent), [Retell — Orchestration overview](https://docs.retellai.com/general/orchestration_overview).

| Setting | Range/default | What it does |
|---|---|---|
| `responsiveness` | 0–1, default 1 | Lower = agent waits longer/responds slower; higher = faster exchanges |
| `enable_dynamic_responsiveness` | bool | Adapts responsiveness to the caller's own speech rate and turn-taking history |
| `interruption_sensitivity` | 0–1, default 1 | Lower = caller needs more words to interrupt; higher = easier to barge in |
| `enable_backchannel` | bool | Agent interjects "yeah," "uh-huh" during caller speech |
| `backchannel_frequency` | 0–1, default 0.8 | How often backchannel fires when eligible |
| `backchannel_words` | string array | Customizable phrase list, e.g. brand-appropriate affirmations |
| `reminder_trigger_ms` | ms, default 10000 | Fires an "are you there?" style nudge after N ms of caller silence |
| `reminder_max_count` | int, default 1 | Caps how many times the agent nudges an unresponsive caller |

Retell also markets "Intelligent Endpointing & Turn-taking" with "precise
detection of speech completion" and "context-aware turn-taking with
configurable thresholds," plus streaming background-noise filtering and echo
cancellation aimed specifically at real phone-line conditions (source: orchestration
overview doc above). It supports both a traditional STT→LLM→TTS pipeline and
newer Speech-to-Speech (S2S) models that skip intermediate text generation
for lower latency (same source) — the S2S option is worth a follow-up VERIFY
item since it wasn't detailed further in the pages fetched this session.

### 3.2 ElevenLabs

Source: [ElevenLabs — Conversation flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow) (fetched via search-summarized WebFetch this session — see note below).

| Setting | Range/default | What it does |
|---|---|---|
| `turn.turn_eagerness` | `eager` \| `normal` (default) \| `patient` | Eager = jumps in fast; patient = waits longer for the caller to finish a thought |
| `turn.turn_timeout` | 1–30s | How long the agent waits during caller silence before taking its turn |
| `turn.soft_timeout_config` | 0.5–8.0s, default −1 (disabled) | Plays a filler ("Hhmmmm...yeah." by default, or an LLM-generated contextual filler) if the LLM is still "thinking" past this threshold — a direct, documented answer to the "how is thinking-pause handled" question |
| Client Events → interruption | on/off, Advanced tab | Caller can barge in mid-utterance only if "interruption" is enabled as a client event |
| **Skip Turn** (system tool) | — | Lets the agent explicitly pause and cede the floor when the caller says "give me a second" / "let me think," rather than treating that as silence to fill |

A proprietary turn-taking model drives ElevenLabs' endpointing and barge-in
decisions (stated on the product overview page,
[elevenlabs.io/docs/product/conversational-ai/overview](https://elevenlabs.io/docs/product/conversational-ai/overview),
though the detailed mechanics weren't published on the page fetched this
session — flag for `docs/VERIFY.md` if it becomes decision-relevant).

**Side-by-side read:** Retell's knob set is more granular for *ambient
naturalness* (backchannel word lists, dynamic responsiveness tied to caller
pace) — closer to what a trained human receptionist does while listening.
ElevenLabs' knob set is more granular for *turn ownership* (three discrete
eagerness modes, an explicit silence-filler system, and a dedicated
skip-turn tool for "let me think") — closer to what a well-trained IVR
designer would want for deterministic call flows. Both are configurable
enough to tune per vertical (§10).

---

## 4. Silence, laughter, hesitation, speaking rate, pauses

- **Filler words / thinking pauses:** ElevenLabs has an explicit,
  first-party feature for this (`soft_timeout_config`, §3.2) — either a
  static phrase or an LLM-generated one, triggered specifically when
  generation is running long, which is a closer match to how a human pauses
  ("um, let me check that") than either a silent gap or a robotic instant
  answer. **No equivalent documented Retell feature was found in this
  research pass** — Retell's `reminder_trigger_ms` fires only when the
  *caller* is silent (nudging them to respond), not when the *agent's own*
  LLM/tool-call pipeline is slow — this is a real, documented capability gap
  worth flagging in `docs/BUILD_NOTES.md` if tool-call latency spikes are
  observed in production, since a caller hearing dead air during a slow
  `lookup_customer` call reads as broken, not as "thinking."
- **Laughter/hesitation as sound, not just words:** only reachable via
  ElevenLabs' v3/v3-Conversational audio tags (`[laughs]`, `[sighs]`,
  `[hesitates]`-style cues) — Flash v2.5 and Retell's native/Cartesia/MiniMax
  voices have no documented equivalent; the caller-perceived difference is
  the LLM producing a literal word like "haha" vs. the TTS model rendering
  actual laughter audio. For a booking-flow agent this is a nice-to-have,
  not core — overuse of audio tags in a business-answering context risks
  reading as gimmicky rather than warm (our own judgment, not sourced).
- **Speaking rate:** both platforms expose an explicit speed control
  (ElevenLabs `speed`, recommended 0.9–1.1x; Retell `voice_speed`, range
  0.5–2, plus `enable_dynamic_voice_speed` to match the caller's own pace).
  Retell's dynamic-speed-matching-to-caller and ElevenLabs' equivalent are
  functionally similar features under different names.
- **Pauses within a sentence:** neither platform's fetched docs described an
  explicit SSML-style `<break time="300ms">` pause-insertion primitive for
  the agent path specifically (ElevenLabs' core TTS API does support SSML in
  some contexts per general product docs, but this wasn't confirmed for the
  Conversational AI agent path this session — **VERIFY** before relying on
  it for pacing rather than plain audio tags/punctuation).

---

## 5. Phone-line audio (8kHz narrowband) impact

**UNVERIFIED, all third-party** — no first-party ElevenLabs or Retell page
fetched this session quantified the narrowband degradation directly.

- Telephony-friendly audio is 8kHz G.711 μ-law/A-law — "PSTN compression
  flattens expressive nuance" and realtime TTS "is engineered to preserve
  naturalness through G.711" but the compression itself is real and lossy
  (**UNVERIFIED**, [Gradium — Best Voice AI API for Phone-Based Voice Agents 2026](https://gradium.ai/content/best-voice-ai-api-phone-based-voice-agents-2026)).
  Practical read: the emotional nuance that differentiates `eleven_v3_conversational`
  or an ElevenLabs premium voice from a $0.015/min native Retell voice is
  disproportionately carried in exactly the high-frequency, dynamic-range
  detail that 8kHz narrowband strips out — **the quality gap you'd hear in a
  browser demo compresses on an actual PSTN call**, which weakens the case
  for paying the $0.025/min ElevenLabs surcharge purely for expressiveness
  on phone-only verticals (it may still be worth it for accent/language
  coverage or brand-voice consistency reasons independent of raw fidelity).
- One India-market-focused source claims modern TTS (ElevenLabs, Cartesia,
  Azure Neural) is "mistaken for human in 70–80% of Hindi/Indian-English
  calls" in their own testing, and that **end-to-end latency above 500ms
  "feels robotic"** to their caller population regardless of voice quality —
  i.e. latency, not voice fidelity, is the dominant naturalness lever once
  you're on a real phone line (**UNVERIFIED**, same Gradium source). This
  matches our own read: see §9's verdict that latency/turn-taking, not TTS
  model choice, is the bigger caller-perceived lever for a US booking-call
  use case too.

---

## 6. Multilingual and accents

Re-confirming and extending `RETELL_VS_ELEVENLABS_2026.md` §2's finding with
this session's model-level detail:

- **Retell:** 55 languages / 63 locale variants, each covered by a paired STT
  + TTS provider, all deployable today (source: `RETELL_VS_ELEVENLABS_2026.md`,
  originally sourced from
  [retellai.com/blog — multilingual phone agents](https://www.retellai.com/blog/how-to-use-ai-phone-agents-for-multilingual-communication),
  not re-fetched this session).
- **ElevenLabs:** the fast, low-latency real-time model **Flash v2.5 covers
  32 languages**; the newer **`eleven_v3_conversational` claims 70+
  languages** at ~280ms (per §1.1's official model table) — **this is a
  material update to the earlier research doc's conclusion**, which
  (correctly, at the time) said ElevenLabs' only genuinely real-time model
  (Flash v2.5) trailed Retell's real-time language coverage. **If
  `eleven_v3_conversational`'s 70+-language claim holds up in practice at
  ~280ms, ElevenLabs' real-time language coverage now exceeds Retell's** —
  this is exactly the kind of claim that needs a live-account confirmation
  before it changes any vertical's provider recommendation (append to
  `docs/VERIFY.md`): does 70+-language quality/latency hold uniformly, or
  does it degrade for lower-resource languages the way many "70+ language"
  claims do in practice?
- Accent handling specifically (e.g., regional US English accents, code-switching
  mid-call) was not detailed in either platform's docs fetched this session —
  gap, not a negative finding.

---

## 7. Voice cloning terms

### 7.1 ElevenLabs

- **Professional Voice Clone: own-voice-only, with mandatory verification.**
  "You can only create a Professional Voice Clone of your own voice... even
  with their consent, you cannot clone someone else's voice... All
  Professional Voice Clones require a verification process to confirm the
  voice belongs to you." Source:
  [ElevenLabs Help Center — Can I create a Professional Voice Clone of someone else's voice?](https://elevenlabs.io/docs/help-center/product/voice-customization/voice-cloning/can-i-create-a-professional-voice-clone-of-someone-elses-voice).
- Users must affirmatively confirm rights/permissions **before each upload**
  used for cloning. Misuse (unauthorized commercial cloning) risks permanent
  account bans (**UNVERIFIED**, third-party synthesis of ElevenLabs policy:
  [margabagus.com — ElevenLabs Voice Cloning Consent Policy 2026](https://margabagus.com/elevenlabs-voice-consent-policy/)).
  Commercial usage rights: paid-plan-generated audio can be used
  commercially, including "perpetually" after subscription ends for audio
  already generated; free-plan output cannot be used commercially and
  requires attribution (**UNVERIFIED**, [Terms.Law — ElevenLabs Commercial Rights](https://terms.law/ai-output-rights/elevenlabs/)).

### 7.2 Retell

- Retell's Terms of Service place **consent-law compliance responsibility on
  the customer**, not Retell: Retell "makes no representation that
  customer's consent practices comply with applicable law." Source:
  [Retell — Terms of Service](https://www.retellai.com/legal/terms-of-service)
  (via search summary this session — recommend a direct fetch before citing
  in a legal/compliance document).
- Disclosure requirements are pushed onto the *deploying business*: outbound
  calls must identify the business/entity and purpose at call start, and
  (jurisdiction-dependent) disclose the AI-generated nature of the voice —
  this is the same obligation Heyloo's own compiled-in AI+recording
  disclosure gate (CLAUDE.md Rule 2, SYSTEM_DESIGN §4) already satisfies
  structurally.
- Customers are contractually barred from reselling/redistributing
  AI-generated voice output as a standalone product, or using it to train
  competing models.
- **No first-party Retell page found this session describing a
  verification step analogous to ElevenLabs' "confirm before each upload +
  identity verification" process for cloning a specific voice** — if Retell
  supports custom/cloned voices for a tenant's own brand voice (plausible
  future feature — "Platform clones" appeared in the voice-provider list,
  §1.2), the consent-verification rigor looks thinner on paper than
  ElevenLabs' today. Worth a direct VERIFY if Heyloo ever offers
  tenant-specific voice cloning as a feature.
- **State-law backdrop (both platforms, informational, UNVERIFIED):**
  several US states (California Civil Code §3344, NY Civil Rights Law
  §50-51, Tennessee's ELVIS Act) require written consent to clone an
  identifiable person's voice — this is an obligation on Heyloo and its
  tenants regardless of provider, not something either vendor's ToS can
  waive away.

---

## 8. Independent 2026 evaluations — latency and naturalness (all UNVERIFIED)

No independently-published, methodologically-transparent benchmark comparing
Retell and ElevenLabs head-to-head was found from a source with disclosed
testing methodology; everything below is third-party blog/review content,
explicitly marked, and should be treated as directional color, not a number
to put in a contract or a margin model.

- **Retell latency:** "measured between 580ms and 800ms across independent
  2026 tests, with measured latency near 620ms" for a full conversational
  turn — comfortably under an "800ms feels natural" threshold cited by the
  same source (**UNVERIFIED**, [FutureAGI — How to Optimize Retell Voice Agent Latency in 2026](https://futureagi.com/blog/how-to-optimize-retell-latency-2026/)).
- **ElevenLabs latency:** "full-conversation latency typically lands in the
  400ms to 800ms range depending on the LLM" in one source, but a different
  source's "fixed-stack full-turn benchmark" measured **1.73 seconds p50** —
  a striking inconsistency that underscores how sensitive these numbers are
  to LLM choice, region, network, and exactly what's being measured
  (model-only vs. full pipeline) (**UNVERIFIED**, both figures from
  [Telnyx — Voice AI agents compared on latency](https://telnyx.com/resources/voice-ai-agents-compared-latency)
  and [Layer3Labs — ElevenLabs Agents Limits](https://www.layer3labs.io/guides/elevenlabs-agents-limits)
  respectively). **Do not treat either number as authoritative** — the ~10x
  spread between the two ElevenLabs figures (400ms vs 1.73s) is itself the
  finding: full-pipeline latency is overwhelmingly dominated by *your* LLM
  and tool-call choices, not the TTS model, which matches ElevenLabs' own
  official caveat that its 75ms/280ms figures exclude "endpointing,
  transcription, language-model inference, application logic, telephony, and
  network delivery" (§1.1).
- **Naturalness, blind A/B:** "a blind A/B test with 200 callers in March
  2026 found Retell wins by a hair when both platforms use the same TTS
  provider, with the difference in latency tuning and turn detection, not
  the underlying voice model" — i.e. even this source's own framing credits
  *orchestration*, not voice model, for the win (**UNVERIFIED**, same Telnyx
  source above). A different source frames it the opposite way — "ElevenLabs
  wins outright on voice quality/naturalness... voices serving as the
  benchmark for other platforms' comparison charts" (**UNVERIFIED**, same
  source, self-contradictory across two paragraphs — flagging the source's
  internal inconsistency rather than picking a side).
- **Read across all of this:** the 2026 commentary consistently separates
  "voice model quality in isolation" (ElevenLabs favored) from
  "conversational orchestration quality in a live call" (closer, sometimes
  Retell favored) — which is exactly the distinction this report leads with
  in the verdict at the top.

---

## 9. What a caller actually experiences on a booking call

| Dimension | Retell | ElevenLabs |
|---|---|---|
| Time-to-first-word (model layer, official) | Not published as a headline number in docs fetched this session | Flash v2.5 ~75ms; `eleven_v3_conversational` ~280ms (both explicitly "excluding app & network") |
| Time-to-first-word (full pipeline, UNVERIFIED 3rd-party) | ~580–800ms typical | 400ms–1.73s depending on source/LLM/stack (huge spread — see §8) |
| Response gap between turns | Tunable via `responsiveness` (0–1) + `enable_dynamic_responsiveness`; default is fast (responsiveness=1) | Tunable via `turn_eagerness` (eager/normal/patient) + `turn_timeout` (1–30s); default = `normal` |
| What fills a slow gap | `reminder_trigger_ms` only addresses *caller* silence, not agent-side processing delay (no documented agent-side filler) | `soft_timeout_config` explicitly fills agent-side "thinking" delay with a natural filler phrase (0.5–8s trigger) — a real, documented UX advantage for tool-call-heavy flows |
| How interruption feels | `interruption_sensitivity` (0–1) tunes how many words of caller speech are needed to cut the agent off; paired with `enable_backchannel` so the agent sounds like it's actively listening between the caller's sentences, not just waiting | Binary on/off via Client Events, with three discrete `turn_eagerness` presets shaping how "eager" the agent's own turn-taking is; explicit `skip_turn` tool for a caller who says "let me think" rather than the agent defaulting to silence-as-timeout |
| Voice expressiveness ceiling (in principle, before the phone codec strips it, §5) | Native voices flat/consistent; Cartesia/MiniMax voices get `voice_emotion` presets; ElevenLabs voices on Retell get NEITHER `voice_emotion` nor documented audio tags | Full audio-tag range on `eleven_v3_conversational` — richest expressiveness ceiling of any option surveyed, IF the LLM is prompted to emit the tags and IF `eleven_v3_conversational`'s real-world latency holds near its ~280ms spec on Retell's... wait, on ElevenLabs' own infra (not Retell — the surcharge/gap noted in §1.2 is specifically about running ElevenLabs voices *through Retell*) |

**Bottom line for a booking call specifically:** a caller dialing to book an
oil change or a dental cleaning is not doing an emotionally rich, multi-turn
narrative exchange — they're doing 3–5 short, transactional turns
(availability → slot pick → confirm → maybe a spelled-out name/phone
number). In that pattern, **turn-taking crispness and not talking over the
caller matters far more than whether the "yeah, we can do that!" has
audio-tag-driven warmth in it.** That favors investing tuning effort in
`responsiveness`/`interruption_sensitivity`/backchannel (Retell) or
`turn_eagerness`/`soft_timeout_config` (ElevenLabs) over chasing the
priciest voice model.

---

## 10. Verdict and recommended settings per vertical

**Which sounds more human today, and by how much:** genuinely close — call
it a wash in isolation, with the caveat that the two platforms win on
different axes (ElevenLabs: raw voice expressiveness, IF you pay the
surcharge/use their own infra and the phone codec doesn't erase it too much;
Retell: turn-taking/backchannel maturity and a more granular ambient-listening
feel). **No credible, methodology-disclosed 2026 source gives either
platform more than a small, contested edge** (§8) — this is not a "clearly
sounds more human" story either direction, and Heyloo shouldn't market it as
one.

**Latency/cost trade-off:** the *cheapest and fastest* combination on either
platform (Retell native $0.015/min voice + Economy LLM tier, or ElevenLabs
Flash v2.5 + Economy LLM) is materially faster (75ms model layer) and
$0.025–0.05/min cheaper than reaching for ElevenLabs-brand or
`eleven_v3_conversational` voices. Given §5's finding that the phone codec
compresses much of the expressiveness gain anyway, **the economy path is the
right default for every Heyloo vertical**, with the premium voice reserved
for verticals where warmth/brand-voice is explicitly the differentiator.

**Recommended settings by vertical (our own judgment, applying the settings
inventory above — not independently benchmarked per-vertical):**

| Vertical | Voice/model | Turn-taking tuning | Why |
|---|---|---|---|
| Auto repair, Veterinary (urgent/transactional) | Native/Cartesia voice, no ElevenLabs surcharge | Higher `responsiveness` (fast), moderate `interruption_sensitivity` (let a panicked pet owner interrupt easily), backchannel ON | Calls are often urgent/anxious; fast, easily-interruptible turn-taking reads as attentive, not rushed |
| Real estate, Legal intake (qualification-heavy) | Native voice; consider `voice_emotion: sympathetic` (Cartesia/MiniMax) for legal intake specifically | `turn_eagerness: normal`/moderate `responsiveness`; ElevenLabs `soft_timeout_config` (if on ElevenLabs) to cover tool-call lookups without dead air | Longer, more consultative exchanges tolerate — and benefit from — a beat of "thinking" pause before answering |
| Dental (HIPAA-relevant, PHI-deferral design) | Retell required regardless of voice choice per `RETELL_VS_ELEVENLABS_2026.md` §5 (free BAA) | Lower `interruption_sensitivity` during any compliance-disclosure line (don't let a caller barge past the AI+recording disclosure) | Structural: the disclosure gate (CLAUDE.md Rule 2) must complete, so tune to protect it, not just for warmth |
| Motels (night-shift, message-first) | Native/economy voice; expressiveness is low-value at 2am | High backchannel, moderate reminder settings for groggy/distracted callers | Cost-sensitive vertical (thin margins per `docs/MASTER_PLAN.md` motel notes); no reason to pay the ElevenLabs surcharge here |
| Any vertical piloting a "premium/white-glove" tier | ElevenLabs Flash v2.5 native (not v3/v3-Conversational, and not the Retell ElevenLabs pass-through given the `eleven_v3` vs `eleven_v3_conversational` ambiguity in §1.2) | `turn_eagerness: eager` if the brand wants to feel snappy, `patient` if it wants to feel unhurried/luxury | If we ever justify the premium-voice upsell, go straight to ElevenLabs as primary rather than the Retell pass-through, until §1.2's VERIFY item is resolved |

**Open items to append to `docs/VERIFY.md` before any of this becomes a
pricing or vertical-default decision:**

1. Does Retell's `eleven_v3` voice model behave like ElevenLabs'
   latency-optimized `eleven_v3_conversational`, or like the slower base
   `eleven_v3`? (§1.2 — highest-priority item, directly affects whether the
   ElevenLabs-voice-on-Retell add-on is even viable for live calls.)
2. Does `eleven_v3_conversational`'s 70+-language claim hold at ~280ms
   uniformly, or degrade for lower-resource languages? (§6)
3. Confirm whether ElevenLabs' Conversational AI agent path supports
   SSML-style inline pause control, or only audio tags/punctuation, for
   pacing. (§4)

---

## Sources

**Official (fetched or previously fetched and re-cited this session):**
- [ElevenLabs — Models](https://elevenlabs.io/docs/overview/models)
- [ElevenLabs — Conversational voice design best practices](https://elevenlabs.io/docs/eleven-agents/customization/voice/best-practices/conversational-voice-design)
- [ElevenLabs — Conversation flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow)
- [ElevenLabs — Product / Conversational AI overview](https://elevenlabs.io/docs/product/conversational-ai/overview)
- [ElevenLabs — Audio tags 101](https://elevenlabs.io/blog/v3-audiotags)
- [ElevenLabs — Eleven v3 audio tags blog](https://elevenlabs.io/blog/eleven-v3-audio-tags-expressing-emotional-context-in-speech)
- [ElevenLabs — Pricing / Agents](https://elevenlabs.io/pricing/agents)
- [ElevenLabs Help Center — Professional Voice Clone of someone else's voice](https://elevenlabs.io/docs/help-center/product/voice-customization/voice-cloning/can-i-create-a-professional-voice-clone-of-someone-elses-voice)
- [Retell — Create Agent API reference](https://docs.retellai.com/api-references/create-agent)
- [Retell — Orchestration overview](https://docs.retellai.com/general/orchestration_overview)
- [Retell — Voice customization docs](https://docs.retellai.com/build/voice)
- [Retell — Terms of Service](https://www.retellai.com/legal/terms-of-service)
- [Retell — Pricing](https://www.retellai.com/pricing)
- `docs/research/RETELL_VS_ELEVENLABS_2026.md` (this repo, 2026-09-11) — re-cited for the 55-language Retell figure and the ElevenLabs voice surcharge figure, not re-fetched this session.

**Third-party / community — UNVERIFIED, cited only where explicitly labeled inline:**
- [FutureAGI — Optimize Retell Voice Agent Latency 2026](https://futureagi.com/blog/how-to-optimize-retell-latency-2026/)
- [Telnyx — Voice AI agents compared on latency](https://telnyx.com/resources/voice-ai-agents-compared-latency)
- [Layer3Labs — ElevenLabs Agents Limits: Latency, Barge-In, Guardrails](https://www.layer3labs.io/guides/elevenlabs-agents-limits)
- [Hamming AI — Voice Agent Interruption Handling runbook](https://hamming.ai/resources/voice-agent-interruption-handling-runbook)
- [Gradium — Best Voice AI API for Phone-Based Voice Agents 2026](https://gradium.ai/content/best-voice-ai-api-phone-based-voice-agents-2026)
- [Waboom AI — ElevenLabs v3 vs Flash v2.5](https://www.waboom.ai/blog/elevenlabs-v3-vs-flash-voice-agents)
- [inworld.ai — ElevenLabs v3 GA review](https://inworld.ai/resources/elevenlabs-v3-review)
- [margabagus.com — ElevenLabs Voice Cloning Consent Policy 2026](https://margabagus.com/elevenlabs-voice-consent-policy/)
- [Terms.Law — ElevenLabs Commercial Rights & Voice Output Ownership 2026](https://terms.law/ai-output-rights/elevenlabs/)
- [Cekura — Retell AI Voice Automation: Full Features Breakdown 2026](https://www.cekura.ai/blogs/retell-ai-voice-automation-features)
