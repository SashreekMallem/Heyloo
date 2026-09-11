# Sweep C — Exact Pricing / Cost Model: Retell AI vs. ElevenLabs Agents

Research date: 2026-09-11. Read-only research; no repo code or config touched,
per this task's rules. Extends/corrects `docs/research/RETELL_VS_ELEVENLABS_2026.md`
(prior shallow pass) and `docs/research/deep-dive/B_retell_capabilities.md`.
All figures below are sourced from official pricing/docs pages fetched live
this session unless explicitly marked **[ASSUMPTION]** or **[UNVERIFIED —
third-party]**. Exact URLs + access date are in §8.

---

## 0. Two things that will silently wreck a naive model — read first

1. **ElevenLabs "included minutes" and "overage" are priced at the *same*
   $0.08/min rate on every paid tier.** Checked across all 6 tiers on the
   dedicated Agents pricing page (`elevenlabs.io/pricing/agents`): base fee
   ÷ included minutes = $0.08/min exactly (Starter $6/75min, Creator
   $22/275min, Pro $99/1,238min, Scale $299/3,738min, Business
   $990/12,375min — Pro's $99/1,238 = $0.07996, rounds to $0.08). This
   means **plan tier does not change your per-minute cost at all** once
   volume exceeds the plan's included minutes (which it will, for any real
   tenant base) — the *only* reason to pick a bigger ElevenLabs plan is
   **concurrency headroom** (Free 4 → Starter 6 → Creator 10 → Pro 20 →
   Scale 30 → Business 40), not unit economics. Model total ElevenLabs
   platform spend as `volume_min × $0.08`, independent of plan, then
   separately check concurrency fits.
2. **ElevenLabs has two separate billing pools that must not be conflated.**
   (a) The Agents-specific **included-minutes** pool above (what actually
   answers phone calls, billed in $/min). (b) A **shared credits pool**
   (also used by TTS/dubbing/STT products) that LLM usage and other
   consumption draw from, billed per-token "at cost." The general
   `elevenlabs.io/pricing` page's "~$0.17–0.36/min" overage figures are
   **TTS-credit-equivalent rates for the character-billed products, not
   the Agents per-minute rate** — a prior draft of this comparison could
   easily have mis-cited those numbers as the phone-call rate. The real
   Agents platform rate is the flat $0.08/min in item 1, confirmed on the
   Agents-specific pricing page.

---

## 1. Per-component $/min table (official, this session)

### Retell AI (BYO Twilio/SIP model, matching Heyloo's architecture)

| Component | Rate | Source |
|---|---|---|
| Voice infra (STT + turn-taking + orchestration) | **$0.055/min** | retellai.com/pricing |
| TTS — native (Retell/MiniMax/Fish/Cartesia/OpenAI) | **$0.015/min** | retellai.com/pricing |
| TTS — ElevenLabs-brand voice add-on | **$0.040/min** | retellai.com/pricing |
| LLM — Claude 4.5 Haiku (cheapest listed) | **$0.025/min** | retellai.com/pricing |
| LLM — GPT-4.1 | **$0.045/min** | retellai.com/pricing |
| LLM — Claude 5 Sonnet | **$0.080/min** | retellai.com/pricing |
| LLM — GPT-5.4 | **$0.080/min** | retellai.com/pricing |
| LLM — Gemini 3.5 Flash | **$0.081/min** | retellai.com/pricing |
| LLM — GPT-5.5 | **$0.160/min** | retellai.com/pricing |
| Telephony — Retell-provisioned Twilio-backed number, per-min | $0.015/min | retellai.com/pricing |
| Telephony — Retell-provisioned number, monthly | $2.00/mo (basic) or $10.00/mo (verified/10DLC-style) | retellai.com/pricing |
| Telephony — BYO SIP/custom (our model) | **$0 Retell charge** ("no charge for SIP trunking / custom telephony") | retellai.com/pricing; confirmed again in `docs.retellai.com/accounts/billing` ("Custom telephony (SIP trunking) carries no Retell telephony charge") |
| Knowledge base | $0.005/min usage + $8/mo/KB beyond first 10 free | retellai.com/pricing |
| Baseline post-call structured extraction (`call_analysis`: Boolean/Text/Number/Enum fields, `call_analyzed` webhook) | **No separate charge found** — not listed as a billed line item anywhere in `docs.retellai.com/accounts/billing`'s 4-category cost breakdown (voice infra / LLM / telephony / concurrency); appears bundled into voice infra | `docs.retellai.com/accounts/billing`, `docs.retellai.com/features/post-call-analysis` (no pricing text on that page at all) |
| **AI Quality Assurance (separate product — NOT the same as above)** | First 100 min/mo free per workspace, then **$0.10/min of analyzed call time** | `docs.retellai.com/ai-qa/overview`, retellai.com/pricing |
| PII removal (add-on) | $0.01/min | retellai.com/pricing |
| Advanced denoising / safety guardrails (add-ons, each) | $0.005/min | retellai.com/pricing |
| Concurrency — free | 20 concurrent (PAYG default) | `docs.retellai.com/deploy/concurrency`, `docs.retellai.com/accounts/billing` |
| Concurrency — additional | **$8.00/concurrency-slot/month** | retellai.com/pricing |
| Concurrency burst | 3× limit or limit+300 (whichever lower); surcharge **$0.10/min applied to the entire call duration** while bursting | `docs.retellai.com/deploy/concurrency` |
| Minimum commitment (PAYG) | **None** — "$0 to start," credit-based, non-refundable credits, no minimum spend found | retellai.com/pricing, `docs.retellai.com/accounts/billing` |
| HIPAA/BAA | Free, self-serve, any plan incl. PAYG (carried over from prior pass, `click-agreements.retellai.com`; **not re-confirmed against the live pricing page text this session** — flagged for re-verification below) | prior-session Retell HIPAA blog (see §8) |

### ElevenLabs Agents (`elevenlabs.io/pricing/agents` — the correct page; NOT `elevenlabs.io/pricing`)

| Component | Rate | Source |
|---|---|---|
| Platform rate (all paid tiers, flat) | **$0.08/min** — same whether inside included minutes or overage (see §0.1) | elevenlabs.io/pricing/agents |
| Overage, explicit | **$0.08/min** | elevenlabs.io/pricing/agents |
| Burst (over plan concurrency, up to 3× or 300 concurrent, whichever lower) | **$0.16/min** (2×) | elevenlabs.io/pricing/agents, elevenlabs.io/docs/conversational-ai/guides/burst-pricing |
| Beyond burst cap | Calls rejected (no further elastic overflow) | elevenlabs.io/docs/conversational-ai/guides/burst-pricing |
| Silent / hold-time minutes | **Not free** — billed on full conversation duration including silence; no official "silent minute" discount found. **[UNVERIFIED — third-party]** recommendation to enable auto-hangup-on-silence (default 15s) to control cost; no official ElevenLabs page on this policy was located this session | third-party (pxlpeak.com, cekura.ai — search summary only, not independently fetched) |
| LLM | Billed **separately**, per-token, "at cost," drawn from the **credits pool** (distinct from included-minutes pool, see §0.2) — **no official per-model $/min table published** | elevenlabs.io/pricing/agents, elevenlabs.io/docs/conversational-ai/customization/llm |
| Telephony — BYO SIP/Twilio | **"At cost"** per pricing page; the dedicated SIP-trunking docs page (`elevenlabs.io/docs/agents-platform/phone-numbers/sip-trunking`) has **zero pricing text at all** — no markup confirmed, but also no explicit "$0 markup" sentence found on the docs page itself this session | elevenlabs.io/pricing/agents (page-level claim); sip-trunking docs page checked, silent on cost |
| Telephony — native ElevenLabs-provisioned number | **Not found this session** — no per-minute or monthly number-fee figure located; not applicable to Heyloo (BYO Twilio only), flagged as a gap not a blocker | — |
| Concurrency by plan | Free 4, Starter 6, Creator 10, Pro 20, Scale 30, Business 40, Enterprise custom | elevenlabs.io/pricing/agents |
| Concurrency — self-serve add-on beyond plan tier | **None found.** Three searches (docs, help center, third-party roundups) turned up no self-serve "buy N more concurrent slots" product — only path to more concurrency is a bigger plan, temporary burst (2×, capped), or Enterprise | help.elevenlabs.io article (search summary), elevenlabs.io/pricing/agents |
| Minimum commitment (self-serve tiers) | None stated; annual billing is optional (~2 months free, i.e. pay for 10 months) | elevenlabs.io/pricing (annual math) |
| HIPAA/BAA | **Enterprise tier only.** Exact quote: *"Execution of a BAA, as may be required by HIPAA, is only available for Enterprise tier subscriptions."* Zero Retention Mode presented as required alongside the BAA; PHI barred from the service without both in place | elevenlabs.io/docs/eleven-agents/legal/hipaa (fetched this session) |
| Enterprise pricing | Custom, undisclosed; no published floor found this session | elevenlabs.io/pricing/agents |

### Twilio (same for both platforms under BYO — official, fetched this session)

| Component | Rate |
|---|---|
| Inbound to US local number | **$0.0085/min** + $1.15/mo per number |
| Outbound to US local/toll-free | **$0.0140/min** |

Source: twilio.com/en-us/voice/pricing/us, fetched this session.

---

## 2. Four scenarios, both platforms: $/min all-in

"Economy LLM" = Claude 4.5 Haiku (Retell official $0.025/min) /
ElevenLabs equivalent-class model **[ASSUMPTION — see caveat below]**.
"Premium LLM" = Claude 5 Sonnet / GPT-5.4 (Retell official $0.080/min) /
ElevenLabs equivalent-class model **[ASSUMPTION]**.

> **Caveat, load-bearing:** ElevenLabs does not publish a per-model $/min
> table (§1). The Economy/Premium LLM figures used for ElevenLabs below are
> **assumed equal to Retell's published rates for the same model families**
> (both platforms route to the same underlying OpenAI/Anthropic/Google
> models), as the closest defensible proxy — not an official ElevenLabs
> number. This is the single largest source of error in this model and
> should be added to `docs/VERIFY.md` by whoever owns that file (this task
> is restricted to writing only under `docs/research/deep-dive/`).

| Scenario | Retell $/min | ElevenLabs $/min |
|---|---|---|
| Economy LLM + BYO Twilio | $0.055+$0.015+$0.025+$0(SIP)+$0.0085(Twilio) = **$0.1035** | $0.08+$0.025†+$0(SIP,"at cost")+$0.0085(Twilio) = **$0.1135** |
| Economy LLM + vendor telephony | $0.055+$0.015+$0.025+$0.015(Retell tel.) = **$0.110** (+$2–10/mo/number) | $0.08+$0.025†+? — **vendor number rate not found**; using $0 markup floor = **$0.105** (unverified floor, see §1) |
| Premium LLM + BYO Twilio | $0.055+$0.015+$0.080+$0+$0.0085 = **$0.1585** | $0.08+$0.080†+$0+$0.0085 = **$0.1685** |
| Premium LLM + vendor telephony | $0.055+$0.015+$0.080+$0.015 = **$0.165** (+$2–10/mo/number) | $0.08+$0.080†+? = **$0.160** (unverified floor) |

† ElevenLabs LLM figure is the assumed proxy described above, not an
official ElevenLabs rate.

**Heyloo's actual model is "Economy/Premium LLM + BYO Twilio"** (row 1) —
the other three rows are shown only because the task asked for all four;
vendor telephony is not part of our architecture (CLAUDE.md research brief:
"BYO Twilio numbers").

---

## 3. Realistic 3-minute booking call

Using row 1 (BYO Twilio) from §2, Retell's Knowledge Base line excluded
unless the flow does a live KB lookup (add $0.015 for 3 min if it does):

| | Retell | ElevenLabs |
|---|---|---|
| Economy LLM, 3 min | $0.1035 × 3 = **$0.31** | $0.1135 × 3 = **$0.34** |
| Premium LLM, 3 min | $0.1585 × 3 = **$0.48** | $0.1685 × 3 = **$0.51** |

Retell is ~8–9% cheaper than ElevenLabs on this call shape under both LLM
tiers, once the flat-rate/credits distinction in §0 is applied correctly —
narrower than a naive "$0.07 vs $0.08" headline comparison would suggest,
but a real and consistent gap, not the near-parity the prior shallow pass
concluded (that pass used an ElevenLabs LLM estimate that happened to land
closer to Retell's; this pass's Economy-LLM proxy ($0.025) is Retell's
*actual* cheapest published model rate, tightening the ElevenLabs premium
slightly to a real ~8-9%, not eliminating it).

---

## 4. Monthly provider cost at volume, concurrency, and forced plan tier

Concurrency needed = 8% of tenant count on a call simultaneously (task
assumption), rounded up. All costs below use **Premium LLM + BYO Twilio**
(realistic quality bar for reliable slot-filling; Economy-LLM totals are
~35% lower on Retell, ~34% lower on ElevenLabs — scale linearly using the
§2 row-1 rates if needed).

### 50 tenants × 300 min/mo = 15,000 min/mo

- Concurrency needed: 0.08 × 50 = **4 concurrent**
- **Retell:** platform cost = 15,000 × $0.15 (infra+TTS+LLM) = **$2,250/mo**.
  Concurrency: 4 ≤ 20 free → **$0 concurrency add-on**. Plan: **PAYG, no
  minimum commitment.**
- **ElevenLabs:** platform+LLM cost = 15,000 × $0.16 = **$2,400/mo**
  (flat — see §0.1, independent of tier). Concurrency: 4 needed → smallest
  tier that covers it is **Starter (6 concurrent, $6/mo base)**, but
  **Creator (10 concurrent, $22/mo base)** is the realistic minimum for any
  headroom above a razor-thin 4-of-6 buffer. No minimum commitment
  (self-serve monthly).
- **+ Twilio direct (both platforms, identical):** 15,000 × $0.0085 ≈
  **$128/mo** + ~$1.15/mo × ~50 numbers ≈ **$58/mo** ≈ **$186/mo** total,
  paid directly to Twilio, not to either voice vendor.

### 50 tenants × 500 min/mo = 25,000 min/mo

- Concurrency needed: still **4 concurrent** (task's assumption is
  tenant-count-driven, not per-tenant-minutes-driven)
- **Retell:** 25,000 × $0.15 = **$3,750/mo**. Concurrency still $0
  add-on. PAYG, no minimum commitment.
- **ElevenLabs:** 25,000 × $0.16 = **$4,000/mo**. Same Creator/Starter
  tier choice as above (concurrency unchanged).
- **+ Twilio direct:** ~25,000 × $0.0085 ≈ $213 + $58 ≈ **$271/mo**.

### 200 tenants × 400 min/mo = 80,000 min/mo

- Concurrency needed: 0.08 × 200 = **16 concurrent**
- **Retell:** 80,000 × $0.15 = **$12,000/mo**. Concurrency: 16 ≤ 20 free
  → **still $0 add-on**, but only a 4-slot / 20% buffer above the free
  cap — **flag this as a thin margin**, not a comfortable one: the task's
  flat 8% peak assumption is a simplification (real peak concurrency has
  variance — Monday-morning rush for vet/dental, seasonal spikes — and a
  single bad day could exceed 20 and trigger the $0.10/min burst
  surcharge). Recommend proactively buying a buffer (e.g. +10 slots =
  **+$80/mo**) once tenant count approaches ~200 on Retell's free-20 cap,
  rather than waiting to hit it. PAYG, no minimum commitment even here —
  Retell's stated Enterprise trigger is "no cap on concurrent calls,"
  which 16–30 concurrent doesn't come close to needing.
- **ElevenLabs:** 80,000 × $0.16 = **$12,800/mo**. Concurrency: 16 needed
  rules out Creator (10, insufficient) — **minimum viable plan is Pro (20
  concurrent, $99/mo base, 1,238 min included)**; because pricing is flat
  (§0.1) the $99 base is not extra cost, it's prepaid minutes at the same
  $0.08 rate. Given 16-of-20 is also an 80% peak utilization ratio (as
  thin as Retell's), **Business (40 concurrent, $990/mo base)** is the
  safer practical choice for the same reason as the Retell buffer above.
  Either way: total spend is still $12,800/mo (flat-rate insight holds) —
  only the plan *label* and concurrency headroom change, not the bill.
  No minimum commitment (self-serve).
- **+ Twilio direct:** 80,000 × $0.0085 ≈ $680 + (~200 numbers × $1.15)
  ≈ $230 ≈ **$910/mo**.

**Key finding: neither platform forces an Enterprise/custom contract at
any of these three volumes.** Both remain fully self-serve, no-minimum-
commitment up to 200 tenants × 400 min/mo (80,000 min/mo, 16 peak
concurrent) under the task's concurrency assumption. The forcing function
for Enterprise on either platform is **not volume** in this range — it's
**HIPAA/BAA on ElevenLabs** (Enterprise-only, any volume, see §1) or a
concurrency need Retell's PAYG tier can't cover with paid add-on slots
(not reached at 200 tenants here).

---

## 5. Margin at Heyloo's price cards

Price cards (from `docs/SYSTEM_DESIGN.md` §1, matching this task's brief
exactly):

| Card | Base | Incl. min | Overage |
|---|---|---|---|
| Auto repair | $299 | 300 | $0.35 |
| Dental | $349 | 350 | $0.40 |
| Restaurants | $249 | 500 | $0.30 |

All-in $/min used (from §2, row 1, BYO Twilio, includes Twilio's own
$0.0085/min — the real cost Heyloo bears):

- Retell Premium: $0.1585/min · Retell Economy: $0.1035/min
- ElevenLabs Premium: $0.1685/min · ElevenLabs Economy: $0.1135/min

### Auto repair ($299/300 min/$0.35), at included minutes (300 min, no overage — matches SYSTEM_DESIGN's own "expected usage ~300 min/mo")

| | Cost | Margin |
|---|---|---|
| Retell, Premium LLM | $47.55 | **84.1%** |
| Retell, Economy LLM | $31.05 | **89.6%** |
| ElevenLabs, Premium LLM | $50.55 | **83.1%** |
| ElevenLabs, Economy LLM | $34.05 | **88.6%** |

SYSTEM_DESIGN's own table states "~88%" for this vertical — that number
lines up almost exactly with the **Economy-LLM** rows here, not Premium.
This is a decisive finding: **SYSTEM_DESIGN's margin assumption is only
correct if we run the auto-repair flow on the cheapest LLM tier**
(Claude 4.5 Haiku or equivalent). Running it on a Premium model for
better slot-filling reliability costs ~5–6 margin points, still healthy
(83–84%) but a real, quantified trade-off that wasn't previously priced
into the model.

### Dental ($349/350 min/$0.40), at included minutes vs. mid-range usage (SYSTEM_DESIGN states 350–600 expected; shown at 350 and 500)

| | 350 min (no overage) | 500 min (150 min overage @ $0.40 = $60) |
|---|---|---|
| Retell, Premium: cost / margin | $55.48 / **84.1%** | $79.25 / rev $409 / **80.6%** |
| Retell, Economy: cost / margin | $36.23 / **89.6%** | $51.75 / rev $409 / **87.4%** |
| ElevenLabs, Premium: cost / margin | $58.98 / **83.1%** | $84.25 / rev $409 / **79.4%** |
| ElevenLabs, Economy: cost / margin | $39.73 / **88.6%** | $56.75 / rev $409 / **86.1%** |

Margin drifts down a few points as usage grows into overage territory
because the $0.40/min overage rate, while well above marginal cost, is
closer to marginal cost than the blended base-plan rate is — expected
and not alarming (overage minutes are still ~60%+ margin on their own),
but worth knowing the blended % isn't flat with volume.

**HIPAA is the dominant lever here, not per-minute cost** (unchanged
from the prior research pass, now with the exact ElevenLabs quote):
ElevenLabs' BAA is Enterprise-tier-only with no published price floor.
Even a conservative **[ASSUMPTION]** Enterprise floor of $1,500–2,500/mo
(no official number found this session — flag for direct sales contact
before ever considering ElevenLabs for a PHI-handling tenant) would
require roughly **5–8 dental tenants at $349/mo just to cover the
platform minimum**, before a single per-minute cost — a materially worse
starting economics than Retell's $0-minimum, free self-serve BAA. This
makes ElevenLabs a non-starter for the dental vertical below meaningful
scale, independent of the per-minute numbers above.

### Restaurants ($249/500 min/$0.30), at included minutes vs. mid-range usage (SYSTEM_DESIGN states 500–900; shown at 500 and 700)

| | 500 min (no overage) | 700 min (200 min overage @ $0.30 = $60) |
|---|---|---|
| Retell, Premium: cost / margin | $79.25 / **68.2%** | $110.95 / rev $309 / **64.1%** |
| Retell, Economy: cost / margin | $51.75 / **79.2%** | $72.45 / rev $309 / **76.6%** |
| ElevenLabs, Premium: cost / margin | $84.25 / **66.2%** | $117.95 / rev $309 / **61.8%** |
| ElevenLabs, Economy: cost / margin | $56.75 / **77.2%** | $79.45 / rev $309 / **74.3%** |

This is the **most margin-fragile card of the three**, and the gap between
Economy and Premium LLM margin (79.2% vs 68.2% at 500 min on Retell — an
11-point swing) is the largest of any vertical, because the $249 base is
the lowest of the three cards against similar per-minute cost. SYSTEM_DESIGN
states "72–77%" for this vertical, which again lines up with the
**Economy-LLM** rows, not Premium — same pattern as auto repair. Restaurant
reservations (party size, date/time, name capture, callback number) are
exactly the kind of structured slot-filling task where a cheap LLM's
lower reliability is riskiest to get wrong on a live call; if Premium
turns out to be necessary for acceptable booking accuracy on this
vertical, the real margin is closer to **61–68%**, not the 72–77% in the
current plan — this is the single most consequential number in this
report for repricing/LLM-tier decisions and is called out in
`decisive_claims`.

---

## 6. Cross-check against SYSTEM_DESIGN's margin assumptions

All three verticals checked in §5 show the same pattern: **SYSTEM_DESIGN's
stated margins match the Economy-LLM scenario, not Premium.** This is a
consistent, structural finding (not vertical-specific noise) and is the
single highest-leverage thing to resolve before finalizing per-vertical
LLM-tier assignments: every vertical's real margin is 5–11 points lower
than planned if Premium-tier LLM turns out to be necessary for acceptable
booking accuracy, and the restaurant card is thin enough (61.8–68.2% at
Premium) that it's worth deciding this deliberately rather than defaulting
to Premium for quality and finding out later.

---

## 7. Assumptions flagged (candidates for `docs/VERIFY.md` — not appended
there per this task's write-scope restriction; hand off to the owning task)

1. **ElevenLabs per-model LLM $/min rates** — no official table found;
   this report substitutes Retell's published rates for the same model
   families as a proxy. Verify directly (ElevenLabs sales/docs, or a test
   account's usage report) before this number drives pricing decisions.
2. **ElevenLabs native/vendor-provisioned phone number pricing** — not
   found this session (not itemized on the Agents pricing page or the
   SIP-trunking docs page). Not a blocker for Heyloo (BYO Twilio only)
   but leaves the "vendor telephony" column of §2/§3 partly unverified
   for ElevenLabs.
3. **ElevenLabs Enterprise price floor** — no number published; the
   $1,500–2,500/mo figure in §5 is an unsourced planning assumption, not
   a quote. Get an actual quote before using it in a board/investor model.
4. **ElevenLabs BYO-SIP "at cost" claim** — confirmed on the pricing page
   but the dedicated SIP-trunking docs page itself is silent on cost;
   treat as page-level marketing language until seen in a contract or an
   actual test-account invoice.
5. **Retell HIPAA/BAA "free, self-serve, any plan" claim** — carried over
   from the prior research pass's blog-sourced citation
   (`retellai.com/blog/hipaa-compliant-voice-ai-without-enterprise-contract`);
   **not re-fetched or re-confirmed against the current pricing page this
   session** (the pricing page fetch this session showed "Custom BAA"
   listed under Enterprise-plan features, which is at minimum ambiguous
   next to the blog's "free on any plan" claim and should be reconciled
   before the dental unit-economics story is finalized).
6. **ElevenLabs "silent minute" / hold-time billing policy** — the "billed
   on full duration, no free silent minutes" claim in §1 traces to
   third-party summaries surfaced by search, not an official ElevenLabs
   page fetched directly this session. Worth a direct doc fetch/support
   ticket before relying on it.
7. **Twilio rates used are list/PAYG rates**, not any volume-discount tier
   Heyloo might negotiate at 200+ tenants — real cost at scale could be
   somewhat lower on the Twilio leg specifically.

---

## 8. Sources (fetched live this session unless noted)

- [Retell AI — Pricing](https://www.retellai.com/pricing)
- [Retell AI — Billing (docs)](https://docs.retellai.com/accounts/billing)
- [Retell AI — AI QA overview (docs)](https://docs.retellai.com/ai-qa/overview)
- [Retell AI — Post-call analysis (docs)](https://docs.retellai.com/features/post-call-analysis)
- [Retell AI — Concurrency, CPS, burst limits (docs)](https://docs.retellai.com/deploy/concurrency)
- [ElevenLabs — Pricing (general/credits)](https://elevenlabs.io/pricing)
- [ElevenLabs — ElevenAgents Pricing](https://elevenlabs.io/pricing/agents)
- [ElevenLabs — LLM customization docs](https://elevenlabs.io/docs/conversational-ai/customization/llm)
- [ElevenLabs — Burst pricing docs](https://elevenlabs.io/docs/conversational-ai/guides/burst-pricing)
- [ElevenLabs — SIP trunking docs](https://elevenlabs.io/docs/agents-platform/phone-numbers/sip-trunking)
- [ElevenLabs — HIPAA docs](https://elevenlabs.io/docs/eleven-agents/legal/hipaa)
- [Twilio — US Voice Pricing](https://www.twilio.com/en-us/voice/pricing/us)
- [Retell AI — HIPAA compliant voice AI without enterprise contract (prior-session source, not re-fetched)](https://www.retellai.com/blog/hipaa-compliant-voice-ai-without-enterprise-contract)
- `docs/SYSTEM_DESIGN.md` §1 (per-vertical price card, quoted verbatim for
  base/included/overage figures and "expected usage" ranges)
- Third-party, search-summary-only, explicitly flagged inline: silent-minute
  billing behavior (pxlpeak.com, cekura.ai) and AI-QA/$0.10/min confirmation
  cross-check (cloudtalk.io, dialora.ai, zeeg.me — used only to corroborate,
  not as primary source, for figures already confirmed on official pages)
