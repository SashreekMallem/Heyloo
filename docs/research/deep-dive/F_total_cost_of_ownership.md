# Part F — Real-World Total Cost Per Customer

Research date / access date for every citation below: **2026-09-11**, unless
marked otherwise. Grounded against `docs/research/RETELL_VS_ELEVENLABS_2026.md`
(pricing baseline, re-cited not re-fetched where noted), `docs/MASTER_PLAN.md`
§2 (unit economics targets), and `.env.example` (every paid service Heyloo's
architecture actually touches). Read-only research — no code, config, or git
state changed.

**Labeling convention:** unmarked numbers are official vendor pricing pages
fetched this session. **UNVERIFIED** = third-party blog/community source,
named inline. **[MODEL]** = our own bottom-up calculation from disclosed
assumptions, not a vendor-sourced fact — every one of these states its
inputs so it can be re-derived or corrected.

---

## 0. The scenario (as given)

One typical customer — **auto repair shop**: 300 min/mo, ~120 calls, avg 2.5
min/call, 15% spam/robocall/hangup calls under 20s, 10% voicemail/silence,
60 SMS sent, 20 SMS received, 2 hours of recordings stored/mo, nightly
post-call analysis on every call. We model this customer's cost on **both**
Retell and ElevenLabs, per `RETELL_VS_ELEVENLABS_2026.md`'s established
framing (Heyloo BYO's Twilio regardless of voice-platform choice, so the
Twilio line is identical on both).

---

## 1. Voice platform minutes

### 1.1 Billing rounding rules

| | Retell | ElevenLabs |
|---|---|---|
| Rounding | **Per-second, no minimum rounding** for the base call. **UNVERIFIED** (multiple 2026 pricing-breakdown sites agree: "Retell bills to the nearest second with no per-call rounding... billing is prorated to the second"). One documented **exception, confirmed official**: calls under 10 seconds using a dynamic AI-speaks-first opening message are billed a **10-second minimum** — source: [Retell — Exceptions to Our Per-Minute Pricing](https://docs.retellai.com/accounts/billing-exceptions) (fetched 2026-09-11; the page states the exception exists but the underlying per-second-default claim itself was not independently confirmed in official text this session — flag for `docs/VERIFY.md`). | Billed per the plan's included-minutes pool, then $0.08/min overage; **no official statement of sub-minute rounding granularity was found** in the pages fetched this session — flag for `docs/VERIFY.md` before relying on any per-second assumption. |
| Silence/hold time billed? | **UNVERIFIED**, consistent across sources: "billing covers the entire duration of the call because the speech-to-text engine remains active and listening throughout, even during silence... per-second billing includes hold and dead air." | Not confirmed either way in official docs fetched this session — **UNVERIFIED gap**, assume billed (same architectural reason: STT/turn-detection must stay active) unless confirmed otherwise. |
| Transfer time billed? | **UNVERIFIED**: "the AI voice agent fee stops after a call is transferred and only telephony continues for the transferred portion" — i.e. Retell's own per-minute fee should stop at hand-off, but the underlying Twilio PSTN leg keeps running and billing separately regardless of provider. | Not confirmed this session — same Twilio-leg caveat applies regardless. |

**Practical read for the scenario:** the "15% spam/robocall/hangup under
20s" and "10% voicemail/silence" cohorts are **not free** on either platform
under the sourced billing model above — they're short, but still billed
per-second (or per-minute-rounded) for their actual duration, and the given
300 min/mo total is treated in this report as **already inclusive** of those
calls (i.e. we do not add extra minutes on top of the stated 300 — the
scenario's total already nets them in).

### 1.2 All-in per-minute rate, reused from `RETELL_VS_ELEVENLABS_2026.md` §1.2 (not re-fetched this session — see that doc for the component build-up)

| Combination | $/min |
|---|---|
| Retell, Economy LLM, native TTS | $0.105 |
| Retell, Standard LLM, native TTS | $0.155 |
| Retell, Standard LLM, ElevenLabs voice (+$0.025/min surcharge) | $0.180 |
| ElevenLabs Agents, flat platform rate (LLM billed separately, see §2) | $0.080 |

At **300 min/mo**: Retell Economy = **$31.50**; Retell Standard = **$46.50**;
Retell Standard+ElevenLabs voice = **$54.00**; ElevenLabs platform-only =
**$24.00**.

---

## 2. LLM tokens — Economy vs. Standard tier, estimated from the call shape

**[MODEL] — methodology, fully disclosed:** ~1,000-word system prompt (≈1,350
tokens at ~1.35 tokens/word for English) + tool schemas for a typical
booking flow (`lookup_customer`, `check_availability`, `create_booking`,
`transfer_call`, `send_payment_link`-style definitions — call it 6 tools ×
~130 tokens ≈ 800 tokens) → **~2,150 tokens of fixed context** per call. 12
conversational turns, each ~15 words caller / ~18 words agent (≈20/25
tokens). **Naive architecture** (no prompt caching — the full transcript is
resent to the LLM on every turn, which is the default behavior of a
stateless chat-completions call and the conservative case to cost out):

```
input tokens  = Σ(i=1..12) [2,150 fixed + 40×(i-1) accumulated transcript + 20 current utterance]
              ≈ 12×2,150 + 40×66 + 12×20 ≈ 28,680 tokens
output tokens = 12 turns × ~30 tokens (incl. tool-call JSON overhead) ≈ 360 tokens
```

Pricing, source [Claude — Pricing](https://claude.com/pricing) (fetched
2026-09-11):

| Tier | Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|---|
| Economy | Claude Haiku 4.5 | $1/MTok | $5/MTok | $0.10/MTok | $1.25/MTok |
| Standard | Claude Sonnet 5 | $2/MTok | $10/MTok | $0.20/MTok | $2.50/MTok |

**[MODEL] per-call LLM cost, naive (no caching):**

| Tier | Input cost | Output cost | Total/call | $/min (÷2.5 min avg) |
|---|---|---|---|---|
| Economy (Haiku 4.5) | $0.0287 | $0.0018 | **$0.0305** | $0.0122 |
| Standard (Sonnet 5) | $0.0574 | $0.0036 | **$0.0610** | $0.0244 |

**[MODEL] with prompt caching** (Anthropic supports incrementally caching
the growing conversation prefix — a well-implemented voice agent should use
this to stay inside the 500ms `/voice/tools` budget, CLAUDE.md Rule 2, as
well as to cut cost): assuming roughly half the naive input volume is served
from cache reads rather than full-price input tokens (a directional estimate,
**not vendor-sourced** — actual reduction depends on our own prompt/cache
implementation and should be measured against real call transcripts, not
assumed):

| Tier | Estimated total/call | $/min |
|---|---|---|
| Economy, cached | ~$0.013 | ~$0.0052 |
| Standard, cached | ~$0.026 | ~$0.0104 |

**Important, disclosed discrepancy — the single biggest sensitivity in this
whole report:** this bottom-up per-token estimate (**~$0.012–0.024/min**
naive, lower with caching) comes in **well below** the "Economy ~$0.03/min /
Standard ~$0.08/min" LLM figures used in `RETELL_VS_ELEVENLABS_2026.md`,
which were themselves sourced from **Retell's own bundled per-minute LLM
price table** (their per-model $/min line, $0.003–$0.32/min depending on
model). That gap most likely reflects Retell's platform margin on the LLM
line (a bundled per-minute product will price in overhead a raw
pay-per-token API call doesn't carry) and/or real production calls running
token-heavier than this scenario's 12-turn/1,000-word assumption (longer
tool-call payloads, retries, disambiguation turns, injected system
reminders). **This should be validated against real Heyloo call transcripts
before it's used to pick an LLM tier or provider — treat every $/min LLM
figure in this document as directional, not contractual**, and note it in
`docs/VERIFY.md`.

**For the totals below**, we use: **Retell** = its own bundled all-in rate
(§1.2, includes Retell's LLM markup, no separate LLM line — that's the point
of a bundled platform). **ElevenLabs** = the platform's $0.08/min (voice
only) **plus** this section's naive (conservative/higher) per-token LLM
estimate as a separate line, since ElevenLabs genuinely bills LLM usage
separately.

---

## 3. TTS/voice surcharges

Already folded into §1.2's all-in rates. Restated: Retell's ElevenLabs-voice
pass-through costs **$0.025/min more** than Retell's native/Cartesia/MiniMax
voices ($0.040/min vs $0.015/min); ElevenLabs' own platform has **no
published model-based surcharge** — `eleven_v3_conversational` and Flash
v2.5 cost the same $0.08/min per the ElevenLabs pricing page (fetched this
session, confirmed no per-model pricing tier found) — see
`docs/research/deep-dive/E_voice_naturalness.md` §1 for the model detail.

---

## 4. Telephony (Twilio) — identical on both platforms, BYO model

Sources: [Twilio — Voice Pricing US](https://www.twilio.com/en-us/voice/pricing)
and [Twilio — SMS Pricing US](https://www.twilio.com/en-us/sms/pricing/us)
(both fetched 2026-09-11).

| Item | Rate | Monthly (this scenario) |
|---|---|---|
| Local number rental | $1.15/mo | $1.15 |
| Toll-free number rental (alt.) | $2.15/mo | — (not used in base scenario) |
| Inbound minutes, local number | $0.0085/min | $2.55 (300 min) |
| Inbound minutes, toll-free (alt.) | $0.0220/min | $6.60 (300 min, if toll-free chosen) |
| Outbound minutes, local/toll-free | $0.0140/min | $0 (scenario has no outbound calls) |
| **Subtotal, voice** | | **$3.70/mo (local)** |
| SMS outbound, per segment | $0.0083 | $0.498 (60 msgs) |
| SMS inbound, per segment | $0.0083 | $0.166 (20 msgs) |
| Carrier fees, per message (varies by carrier, e.g. AT&T $0.0035, T-Mobile $0.0045/$0.0025, Verizon $0.0045/$0.007) | ~$0.003–0.007/msg | ~$0.32 (80 msgs × ~$0.004 avg) |
| **Subtotal, SMS (per-customer variable cost)** | | **~$0.98/mo** |

**A2P 10DLC — shared platform cost, not per-customer:** Heyloo registers
**one** brand/campaign at the platform level per `.env.example`
(`TWILIO_A2P_BRAND_SID`/`TWILIO_A2P_CAMPAIGN_SID`, "one-time, Week-0"), so
these fees amortize across every tenant rather than billing per customer.
**UNVERIFIED** (the official Twilio support article on this returned a 403
this session; figures corroborated across 2+ independent 2026 summaries):
brand registration **$4.50 one-time** (low-volume) or **$46 one-time**
(standard, secondary vetting), campaign registration **monthly fee ~$1.50
(Low-Volume Mixed) up to ~$10/mo** depending on use-case type, plus **~$0.003–0.005/message**
carrier-side A2P surcharge on top of the base segment/carrier fees above.
Modeled at **$5/mo shared** (mid-estimate) in §7's infra amortization.

**Billing rounding (Twilio voice):** **UNVERIFIED** but consistent across
Twilio's own changelog and help content — standard Voice products **round up
to the nearest minute by default** (a 1:18 call bills as 2 minutes);
**sub-minute/per-second billing is a negotiated contract term**, not the
self-serve default. This means Twilio's own PSTN leg is billed coarser than
Retell's apparent per-second billing on its own line — worth confirming
before assuming the two invoices reconcile cleanly minute-for-minute.
Sub-second calls always round up to a 1-second minimum per Twilio's own
2021 changelog (confirmed via search, page not independently refetched this
session).

---

## 5. Knowledge base, post-call analysis, recording storage

| Item | Retell | ElevenLabs |
|---|---|---|
| Knowledge base | $0.005/min usage + $8/mo per KB doc beyond the first 10 free. At 300 min/mo, fully used: **$1.50/mo** (within free doc count → $0 extra). | Bundled into the platform rate per `RETELL_VS_ELEVENLABS_2026.md` §1.1 — no separate line found. **$0/mo**. |
| Post-call analysis (nightly, every call — this scenario's requirement) | **Ambiguous, flagged in `RETELL_VS_ELEVENLABS_2026.md` §1.1 and unresolved this session.** Retell's pricing page lists a distinct "AI Quality Assurance: first 100 min free, then $0.10/min" add-on, separate from the baseline `call_analysis` structured-extraction feature our `structured_booking_payload`/`classification` design needs (SYSTEM_DESIGN §4.4). **Low bound** (baseline extraction is free, as its own docs page implies): **$0/mo**. **High bound** (our required fields are billed under the AI-QA line, and the 100-free-minute pool is shared across the whole Heyloo account rather than reset per tenant, so one illustrative tenant effectively gets none of the free pool): 300 min × $0.10/min = **$30/mo**. | Success Evaluation + Data Collection delivered via standard post-call webhooks; no separate cost line found on the official pricing page — appears bundled into $0.08/min. **$0/mo**, with the same caveat that "appears bundled" is not the same as an explicit "$0" statement anywhere official. |
| Recording storage (2 hrs/mo, this scenario) | **[MODEL]**: 8kHz G.711 μ-law mono ≈ 64kbit/s ≈ 28.8 MB/hour → 2 hrs ≈ **~58 MB/customer/mo** (our own calc, not vendor-sourced — actual codec/container choice changes this). Against Supabase Pro's pooled **100 GB free file storage** ([Supabase — Pricing](https://supabase.com/pricing), fetched 2026-09-11, overage $0.0213/GB beyond that), even 200 tenants × 58 MB × 3 months' retention ≈ 34 GB stays **inside the free allocation** — recording storage cost is effectively **$0/customer** at both 50- and 200-tenant scale under this scenario's volume, unless retention policy runs far longer than a few months or call volume is much higher per tenant than this example. | Same architecture (Heyloo's own Supabase Storage regardless of voice provider) — **same $0/customer** conclusion. |

---

## 6. Concurrency add-ons at 50 / 200 customers

**[MODEL] — peak-concurrency assumption disclosed:** neither vendor
publishes a "typical simultaneous-call ratio," so we assume, conservatively,
that **15–25% of tenants** might have an active call at the same moment
during a shared peak hour (lunch rush across many small businesses
clustering calls) — this ratio is our own estimate and should be replaced
with real production data once Heyloo has traffic to measure.

| Scale | Assumed peak concurrent calls | Retell (20 free, then $8/slot/mo) | ElevenLabs (concurrency gated by plan tier) |
|---|---|---|---|
| 50 customers | ~8–13 | Inside the 20 free slots → **$0/mo** | Creator (10 concurrent, $22/mo–$11/mo per `RETELL_VS_ELEVENLABS_2026.md`) is marginal; Pro (20 concurrent, $99/mo, 1,238 min included) is the safer self-serve fit |
| 200 customers | ~30–50 | 10–30 slots over free tier → **$80–240/mo shared** | Business (40 concurrent, $990/mo, 12,375 min included) may not even cover the high end of this range — **the concurrency ceiling, not minute volume, becomes the binding constraint first**, likely forcing Enterprise custom pricing before 200 tenants is reached |

**This is a real structural difference, not just a pricing one:** Retell's
concurrency scaling is linear and self-serve ($8/extra slot, no tier
jump required); ElevenLabs' is stepped by plan tier and tops out at 40
concurrent on its highest published self-serve tier (Business, $990/mo) —
consistent with the finding already on record in
`RETELL_VS_ELEVENLABS_2026.md` §1.1, re-confirmed here in the specific
context of this scenario's 200-customer case.

---

## 7. Our platform infra, amortized

Sources fetched 2026-09-11: [Supabase — Pricing](https://supabase.com/pricing),
[Vercel — Pricing](https://vercel.com/pricing), [Sentry — Pricing](https://sentry.io/pricing/),
[Resend — Pricing](https://resend.com/pricing), [PostHog — Pricing](https://posthog.com/pricing).

| Service | Base plan | What's included | Overage |
|---|---|---|---|
| Supabase Pro | $25/mo | 8GB DB disk, 100GB file storage, 250GB egress, 100k MAU, $10/mo compute credit (covers one Micro compute instance) | Storage $0.125/GB, file storage $0.0213/GB, egress $0.09/GB |
| Vercel Pro | $20/mo | 1TB bandwidth, 1M function invocations, 360 GB-hrs compute, 1 dev seat | $0.15/GB bandwidth, $0.60/1M invocations |
| Sentry Team | $26/mo (annual billing) | 50k errors, 5GB logs, 5GB metrics, 5M spans, 50 replays | $0.50/GB logs/metrics |
| Resend | $0/mo (Free, 3,000 emails/mo, 100/day cap) up to $20/mo (Pro, 50,000 emails/mo) | Transactional email (booking confirmations, notifications) | $0.90/1,000 emails beyond plan |
| PostHog | $0/mo (Free, 1M events/mo) | Product analytics | ~$0.00005/event (1–2M tier), stepping down to $0.000009/event at 250M+ |
| Twilio A2P 10DLC (shared, §4) | ~$5/mo mid-estimate | One brand/campaign, platform-wide | — |

**[MODEL] amortization** — this scenario doesn't specify per-tenant email
volume, so Resend is modeled at Free ($0) up to roughly 50 tenants
(~50 emails/tenant/mo keeps the platform under the 3,000/mo free cap) and
stepped to Pro ($20/mo) at 200 tenants, where email volume almost certainly
exceeds the free tier. PostHog's Free 1M-event tier comfortably covers both
scales under a ~15-events/call assumption (200 tenants × 120 calls ×
15 events ≈ 360,000 events/mo, well under 1M) — **[MODEL]**, not vendor-sourced.
Supabase compute may need to step up from the included Micro instance well
before 200 tenants depending on real query load — **flag as a likely
underestimate at 200-tenant scale**, not something this pricing-page-only
research can size accurately; treat as a `docs/VERIFY.md` item once there's
real load to measure.

| Scale | Total shared infra/mo | Per-tenant share |
|---|---|---|
| 50 customers | $25+20+26+0+0+5 = **$76** | **$1.52/tenant** |
| 200 customers | $25+20+26+20+0+5 = **$96** (likely understated — see compute caveat) | **$0.48/tenant** |

---

## 8. Stripe fees on the $299 base

Source: [Stripe — Pricing](https://stripe.com/pricing) (fetched 2026-09-11):
**"2.9% + 30¢ per successful transaction for domestic cards."** Applied to
each plan card's base charge (this scenario's customer stays within every
plan's included minutes, so no overage line adds to the Stripe-fee base):

| Plan | Base | Stripe fee |
|---|---|---|
| $299/300min/$0.35 overage | $299 | $299×0.029+$0.30 = **$8.97** |
| $349/350min/$0.40 overage | $349 | $349×0.029+$0.30 = **$10.42** |
| $249/500min/$0.30 overage | $249 | $249×0.029+$0.30 = **$7.52** |

**UNVERIFIED add-on** (search-summarized, not independently fetched from
stripe.com/billing this session): Stripe Billing's usage-metering feature
itself may carry an additional **~0.7%** fee on metered-billing volume on
some plans — if Heyloo's Stripe Billing Meters implementation (per
`.env.example`'s `STRIPE_METER_EVENT_NAME`) is on a plan that charges this,
it would apply to any overage-minutes revenue specifically (not the flat
base fee) — flag for `docs/VERIFY.md`, confirm against the actual Stripe
account's plan terms before finalizing the margin model.

---

## 9. Total real cost per customer and margin

Using **Retell Standard LLM, native voice** (the realistic default tier per
`RETELL_VS_ELEVENLABS_2026.md`'s own framing — Economy tier voice quality is
arguably below bar for production, and native voice avoids the ElevenLabs
surcharge) as the primary worked example, at **50-tenant infra share**:

| Line | Low bound (AI-QA free) | High bound (AI-QA billed) |
|---|---|---|
| Retell voice+LLM+TTS, 300 min | $46.50 | $46.50 |
| Knowledge base | $1.50 | $1.50 |
| Post-call analysis | $0.00 | $30.00 |
| Twilio voice (number+inbound) | $3.70 | $3.70 |
| Twilio SMS | $1.00 | $1.00 |
| Recording storage | $0.00 | $0.00 |
| Infra share (50 tenants) | $1.52 | $1.52 |
| **Subtotal cost before Stripe** | **$54.22** | **$84.22** |

| Plan | Revenue | + Stripe fee → total cost | Gross profit | Gross margin |
|---|---|---|---|---|
| $299/300min ($0.35 overage) — low bound | $299 | $54.22+$8.97=$63.19 | $235.81 | **78.9%** |
| $299/300min — high bound | $299 | $84.22+$8.97=$93.19 | $205.81 | **68.8%** |
| $349/350min ($0.40 overage) — low bound | $349 | $54.22+$10.42=$64.64 | $284.36 | **81.5%** |
| $349/350min — high bound | $349 | $84.22+$10.42=$94.64 | $254.36 | **72.9%** |
| $249/500min ($0.30 overage) — low bound | $249 | $54.22+$7.52=$61.74 | $187.26 | **75.2%** |
| $249/500min — high bound | $249 | $84.22+$7.52=$91.74 | $157.26 | **63.2%** |

All six cells land inside or above `docs/MASTER_PLAN.md`'s **70–85% margin**
target range except the two "AI-QA billed" high-bound cases on the $249 and
$299 cards, which slip to 63–69% — **this single unresolved Retell pricing
ambiguity (§5) is worth resolving before finalizing any plan card's assumed
margin.**

**Referral share effect (50% of gross profit, MASTER_PLAN framing), shown on
the $299 card, low bound:** gross profit $235.81 → referral payout
$117.91 (50%) → **net-to-Heyloo margin drops to $117.91, or 39.4% of
revenue**, on any customer sourced through the referral channel. This halves
realized margin on referred accounts regardless of which provider is used —
a bigger lever than the Retell-vs-ElevenLabs choice itself.

### ElevenLabs equivalent (same infra/Twilio/Stripe assumptions)

| Line | Naive LLM (no caching) | Cached LLM estimate |
|---|---|---|
| ElevenLabs platform, 300 min | $24.00 | $24.00 |
| LLM (Standard/Sonnet 5, §2) | $7.32 | $3.12 |
| Twilio voice+SMS | $4.70 | $4.70 |
| Recording storage | $0.00 | $0.00 |
| Infra share (50 tenants) | $1.52 | $1.52 |
| **Subtotal before Stripe** | **$37.54** | **$33.34** |

On the $299 card: total cost $37.54+$8.97=$46.51 (naive) → gross profit
$252.49 → **84.4% margin** (naive LLM) or $33.34+$8.97=$42.31 → gross profit
$256.69 → **85.9% margin** (cached LLM estimate) — **both above the Retell
Standard-tier low bound**, driven mostly by §2's disclosed LLM-cost
discrepancy (our raw-token estimate vs. Retell's bundled per-minute LLM
markup) rather than by a fundamental ElevenLabs cost advantage. **Restating
the §2 caveat: this favorable ElevenLabs comparison is the most
assumption-sensitive number in this report and should not be used to pick a
provider without first validating LLM token usage against real call
transcripts.**

---

## 10. 50-customer and 200-customer monthly totals

**[MODEL]**, summing per-customer costs (§9, Retell Standard/native voice
and ElevenLabs/naive-LLM rows) × tenant count, **plus** §6's concurrency
add-on and §7's infra (already-shared, not re-multiplied):

| | 50 customers | 200 customers |
|---|---|---|
| **Retell**, low bound (AI-QA free), per-customer variable × N | $52.70×50=$2,635 | $52.70×200=$10,540 |
| + concurrency add-on | +$0 | +$80–240 |
| + shared infra (§7, already totaled) | +$76 | +$96 |
| **Retell total, low bound** | **≈$2,711/mo** | **≈$10,716–$10,876/mo** |
| **Retell**, high bound (AI-QA billed) | $82.70×50=$4,135 +$76 | $82.70×200=$16,540 +$96+$80–240 |
| **Retell total, high bound** | **≈$4,211/mo** | **≈$16,716–$16,876/mo** |
| **ElevenLabs**, naive LLM | $36.02×50=$1,801 +$76 | $36.02×200=$7,204 +$96 |
| **ElevenLabs total (concurrency: Business plan $990/mo likely required at 200-tenant peak, per §6)** | **≈$1,877/mo** | **≈$7,300 + up to $990 plan-tier cost ≈ $8,290/mo** (or Enterprise custom pricing if 40 concurrent is insufficient) |

**Revenue reference** (all 50/200 customers on the $299 card, per
`docs/MASTER_PLAN.md`'s own reference point): 50×$299=$14,950/mo;
200×$299=$59,800/mo. Provider+infra cost as a share of that revenue lands
in the **13–28%** range across every scenario above, consistent with the
70–85% gross-margin target once Stripe fees and (where applicable) referral
share are layered on top per-customer as shown in §9.

---

## 11. Break-even minutes per customer where a plan goes negative

**[MODEL].** Because every plan card charges a **flat base fee** regardless
of usage, low-usage customers are the *most* profitable, not the least —
the risk direction is the opposite of "goes negative at low minutes."
The real question is whether **overage minutes** ever cost more to deliver
than they're charged for.

Worst-case marginal cost per minute (Standard LLM + ElevenLabs voice on
Retell + toll-free number + Retell's AI-QA line billed on every minute, no
free-pool credit):

```
$0.180 (Standard LLM + ElevenLabs voice, §1.2)
+ $0.0220 (Twilio toll-free inbound, §4)
+ $0.005  (knowledge base, §5)
+ $0.100  (AI-QA, high bound, §5)
= $0.307/min marginal cost
```

Compared against each plan's overage rate:

| Plan | Overage rate | Worst-case marginal cost | Spread |
|---|---|---|---|
| $349/350min, $0.40/min overage | $0.400 | $0.307 | **+$0.093/min profit**, safe |
| $299/300min, $0.35/min overage | $0.350 | $0.307 | **+$0.043/min profit**, safe but thin |
| $249/500min, $0.30/min overage | $0.300 | $0.307 | **−$0.007/min loss** on every overage minute |

**Only the $249 card, and only under this specific worst-case cost stack**
(the least-likely combination — toll-free + premium voice + fully-billed
AI-QA all at once), goes marginally negative on overage minutes. Even then,
the base-fee cushion is large: solving for total monthly minutes `m` where
cumulative profit crosses zero (fixed costs ≈ $10/mo for infra+SMS+storage
share at this scale, from §9's line items excluding the per-minute voice
cost):

```
Profit(m) = $249 − $10 − 500×$0.307 + (m−500)×($0.300−$0.307)   for m > 500
          = $85.50 − $0.007×(m−500)
Profit(m) = 0  →  m ≈ 500 + 85.5/0.007 ≈ 12,714 minutes/mo
```

**≈12,700 minutes/month (~423 hours) is an unrealistic single-customer
volume for this vertical** — so a lone whale customer is not the practical
risk. **The real risk is aggregate**: if a meaningful share of $249-card
customers land in this worst-case cost mix, the *plan's* blended margin
erodes across the book even though no single customer's account technically
goes negative — worth watching as a cohort metric (average cost mix per
plan card) rather than a per-customer alarm, once real usage data exists.

---

## 12. "Hidden" costs agencies report in 2026 — UNVERIFIED

All items below are third-party/community reports, not vendor-confirmed;
included because the task explicitly asked for them, and because several
recur across independent sources (raising, though not proving, their
credibility):

- **Failed-call minimums (a Bland AI practice, not confirmed for Retell or
  ElevenLabs):** "$0.015 minimum per failed outbound call attempt" — at
  scale, failed calls (wrong numbers, voicemails, no-answers) can be
  "20–40% of outbound attempts" (**UNVERIFIED**,
  [Aircall — AI Voice Agent Pricing 2026](https://aircall.io/blog/best-practices/ai-voice-agent-cost/)).
  Not directly applicable to Heyloo's inbound-heavy model, but relevant if
  outbound batch-calling (confirmation reminders, review requests) scales up.
- **Burst/concurrency penalties:** ElevenLabs' documented **2x burst rate**
  above the plan's concurrency ceiling (confirmed official, already priced
  into §6) is echoed by third-party summaries as a common surprise line item
  agencies under-budget for (**UNVERIFIED** framing, same Aircall source).
- **"15–30% hidden-cost tax" heuristic:** multiple 2026 buyer's-guide sites
  independently converge on a rule of thumb that real all-in cost runs
  15–40% above the headline advertised per-minute rate once silence billing,
  concurrency limits, and premium-feature surcharges are included
  (**UNVERIFIED**, consistent across
  [Klariqo — "Why $0.05/min really costs $0.25"](https://klariqo.com/blog/voice-ai-cost-per-minute/)
  and [Aircall](https://aircall.io/blog/best-practices/ai-voice-agent-cost/)).
  This report's own bottom-up §9/§10 figures already land close to this
  range relative to each vendor's headline per-minute number, which is a
  reassuring (if unverified) cross-check.
- **Test/dev minutes billed the same as production:** not specifically
  confirmed for Retell or ElevenLabs this session, but a commonly-cited
  complaint pattern in the voice-AI-agency space generally — worth a direct
  question to either vendor's sales team before assuming a dev-sandbox
  discount exists.
- **Enterprise-gated features beyond HIPAA:** already established
  (`RETELL_VS_ELEVENLABS_2026.md` §1.1) that ElevenLabs' BAA requires
  Enterprise; one 2026 source adds that **Branded Caller ID adds ~$200/mo**
  as an example of a line item that "rarely gets modeled upfront"
  (**UNVERIFIED**, [agenticindex.io — ElevenLabs vs Retell AI 2026](https://agenticindex.io/compare/elevenlabs-vs-retell-ai)).
  Not currently a Heyloo requirement, but worth remembering if a vertical
  later wants a recognizable outbound caller ID.
- **Provider price hikes:** one competitor (Bland) reportedly raised its
  advertised per-minute rate from $0.09 to $0.11 (**UNVERIFIED**, same
  Aircall source) — cited as a general industry-volatility signal, not a
  Retell/ElevenLabs-specific data point; reinforces
  `RETELL_VS_ELEVENLABS_2026.md` §4's existing "repricing risk" framing for
  both of Heyloo's actual candidate vendors.
- **Minimum concurrency purchases:** ElevenLabs' plan-tiered concurrency
  (§6) is itself a de facto minimum-purchase mechanic — you cannot buy
  "just enough" concurrent capacity without jumping to the next $/mo tier,
  unlike Retell's linear $8/slot model. This one is **confirmed from
  official pricing pages**, not third-party — included here because it
  functions exactly like the "hidden minimum-concurrency-purchase" pattern
  the task asked about, even though it's openly published rather than
  hidden.

**Support/ops time is explicitly excluded from every dollar figure in this
report**, per the task brief — none of the above line items account for the
human time to investigate a billing discrepancy, dispute a carrier fee, or
handle a customer's "why did my bill jump" question, all of which the 2026
commentary above suggests are non-trivial in practice.

---

## Sources

**Official (fetched this session):**
- [Claude — Pricing](https://claude.com/pricing)
- [Twilio — Voice Pricing US](https://www.twilio.com/en-us/voice/pricing)
- [Twilio — SMS Pricing US](https://www.twilio.com/en-us/sms/pricing/us)
- [Supabase — Pricing](https://supabase.com/pricing)
- [Vercel — Pricing](https://vercel.com/pricing)
- [Sentry — Pricing](https://sentry.io/pricing/)
- [Resend — Pricing](https://resend.com/pricing)
- [PostHog — Pricing](https://posthog.com/pricing)
- [Stripe — Pricing](https://stripe.com/pricing)
- [Retell — Exceptions to Our Per-Minute Pricing](https://docs.retellai.com/accounts/billing-exceptions)
- [ElevenLabs — Pricing / Agents](https://elevenlabs.io/pricing/agents) (re-cited, originally fetched for `RETELL_VS_ELEVENLABS_2026.md`)
- `docs/research/RETELL_VS_ELEVENLABS_2026.md` (this repo) — §1's all-in per-minute rates and concurrency/plan-tier figures, re-cited not re-fetched
- `.env.example` (this repo) — every paid service in scope, and the A2P 10DLC platform-level (not per-tenant) registration model

**Third-party / community — UNVERIFIED, cited only where explicitly labeled inline:**
- [Aircall — AI Voice Agent Pricing in 2026](https://aircall.io/blog/best-practices/ai-voice-agent-cost/)
- [Klariqo — AI Voice Agent Pricing 2026: Why "$0.05/min" Really Costs $0.25](https://klariqo.com/blog/voice-ai-cost-per-minute/)
- [agenticindex.io — ElevenLabs Conversational AI vs Retell AI (2026)](https://agenticindex.io/compare/elevenlabs-vs-retell-ai)
- [textbee.dev — Twilio SMS Pricing 2026: The Real Monthly Cost](https://textbee.dev/blog/twilio-pricing-real-cost-breakdown)
- [ghlscaleup.com — A2P 10DLC Fees Explained 2026](https://www.ghlscaleup.com/blog/a2p-10dlc-fees-explained)
- [sociocs.com — Twilio 10DLC Registration & Pricing Explained](https://www.sociocs.com/post/twilio-10dlc-explained/)
- [checkoutpage.com — Stripe fees explained: every rate and cost (2026)](https://checkoutpage.com/blog/stripe-processing-fees)
