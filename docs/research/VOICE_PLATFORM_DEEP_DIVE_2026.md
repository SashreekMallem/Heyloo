# Voice Platform Deep Dive 2026 — Retell vs. ElevenLabs Agents

Decision document. Synthesizes six deep-dive sweeps
(`docs/research/deep-dive/A–F`) plus this task's own verification pass
(15 claims independently re-checked against live official sources,
2026-09-11). Extends and, where they diverge, supersedes
`docs/research/RETELL_VS_ELEVENLABS_2026.md` (prior shallow pass).

**Only claims marked confirmed (either in the sweep reports' own citations,
or in the 15-item verification pass supplied to this task) are used as
load-bearing facts below.** Everything else is labeled **[ASSUMPTION]**,
**[MODEL]**, or **UNVERIFIED** inline, matching the sweep reports' own
convention. Access date for every citation is **2026-09-11** unless a
citation states otherwise.

---

## 1. Executive verdict

1. **Stay on Retell as the sole production voice provider now.** Keep
   `VoiceProvider` as a real abstraction (it already is one) but do not
   build a second adapter yet — none of the reasons found this pass justify
   the engineering cost today.
2. **HIPAA is the single deciding fact, not price.** Retell's BAA is
   self-serve, free, on any plan (`click-agreements.retellai.com`, carried
   from the prior pass — **not re-fetched this session, flagged in §10**).
   ElevenLabs' BAA is confirmed, verbatim, **Enterprise-tier only**, with no
   published price floor — a non-starter for a $349/mo dental card below
   meaningful scale.
3. **Price is close, not a wash: Retell is ~8–9% cheaper** on Heyloo's
   actual architecture (BYO Twilio, per-minute blend) — $0.1035–0.1585/min
   Retell vs. $0.1135–0.1685/min ElevenLabs, both **[confirmed via official
   pricing pages, LLM figure partly assumption — see §3]**.
4. **The architectural gap that actually matters for us is small**: Retell's
   inbound webhook can select a *different* agent per call
   (`override_agent_id`); ElevenLabs' cannot — the number→agent binding is
   static, set at import/assign time. Because Heyloo's design is already
   one dedicated Twilio number per tenant (1:1 either way), **this is not a
   blocker** — but it forecloses any future shared-number routing design on
   ElevenLabs.
5. **Retell HMAC-signs the raw body of every tool-call webhook**
   (`X-Retell-Signature`); **ElevenLabs has no documented signature scheme
   for tool-call webhooks**, only a configurable shared-secret header —
   confirmed by direct re-fetch this task. Adopting ElevenLabs would require
   explicitly re-specifying CLAUDE.md Rule 2's "fail closed on missing/
   invalid signature" as "fail closed on missing/incorrect shared secret," a
   materially weaker guarantee.
6. **Concurrency scales more cleanly and cheaply on Retell** at our 50→500
   tenant trajectory: 20 free, then a linear **$8/slot/month**. ElevenLabs is
   plan-tier-gated (Free 4 → Business 40 concurrent, $990/mo), tops out at
   40 self-serve, and the **max-agents-per-workspace number for ElevenLabs
   was never found in official docs** — a potentially load-bearing unknown
   for our agent-per-tenant model at 500 tenants (§10, item 1).
7. **Margin finding independent of vendor choice, and the most consequential
   number in this whole report**: SYSTEM_DESIGN's stated per-vertical
   margins (auto ~88%, dental ~84%, restaurant ~72–77%) match the
   **Economy-LLM** scenario on either vendor, not Premium. Running Premium
   for better slot-filling reliability costs **5–11 margin points**
   (restaurant card drops to 61.8–68.2%) — decide LLM tier per vertical
   deliberately, this is not a Retell-vs-ElevenLabs question.
8. **Reliability**: Retell's most recent incident (3 hours, 2026-09-05, six
   days before this research, published postmortem) is larger than anything
   found for ElevenLabs Agents specifically in the same window. ElevenLabs
   is far better capitalized ($11B valuation, ~$600M ARR, $781M raised)
   which is a durability signal in its favor, but does not change the
   HIPAA/pricing/latency facts above.
9. **Migration cost is real, not nominal**: the existing Retell adapter is
   **~2,850 lines of implementation + ~2,665 lines of tests (~5,515 total)**
   across 20 files behind a clean 411-line `VoiceProvider` interface. A
   parity ElevenLabs adapter (three compile targets, webhook handlers,
   Enum-to-String down-conversion for post-call extraction, a
   static-binding provisioning-flow change) is comparably sized —
   **[MODEL] ~20–35 engineer-days**, not a drop-in swap (§8).
10. **Named conditions that would flip this recommendation**: (a) Retell
    suffers a second Sept-5-caliber outage within ~90 days; (b) Retell
    changes its free self-serve BAA terms; (c) ElevenLabs publishes a
    self-serve or sub-$1,500/mo HIPAA path; (d) a live-account check answers
    §10's open items in ElevenLabs' favor on max-agents-per-workspace and
    tool-webhook signing. None of these are true today.

---

## 2. Capability matrix (our stated needs only — full matrices in sweeps A/B)

| Need | Retell | ElevenLabs | Winner for Heyloo |
|---|---|---|---|
| Agent-per-tenant at 50→500 tenants | No published agent-count cap; gated by **concurrency**, not agent count | **Max agents/workspace not found in current docs — unresolved, potentially blocking** | Retell (known quantity) |
| BYO Twilio numbers | ✓ Elastic SIP trunking, "no charge for custom telephony" | ✓ Native Twilio import + SIP trunking, "at cost" | Tie |
| Inbound webhook: pick/override agent by dialed number | ✓ `override_agent_id`/`_version`, `agent_override`, `reject:true` | ✗ Static binding at import/assign time; webhook only reshapes prompt/voice/language/branch of the *already-bound* agent | Retell (not a blocker for our 1:1 design, but real) |
| Inbound webhook: inject per-call dynamic variables | ✓ `dynamic_variables`, `metadata` | ✓ `dynamic_variables`, `branch_id`, `environment` | Tie |
| Custom tool webhooks: AUTHORITATIVE caller number in the request | ✓ **Automatic** — `call.from_number`/`to_number`/`direction` always in the fixed `{name, call, args}` envelope on phone calls | **partial** — not automatic; compiler must explicitly template `{{system__caller_id}}` into every tool's params/headers, or that tool silently loses caller authority | **Retell** — real footgun class ElevenLabs doesn't have to design around |
| Tool webhook signature verification (raw body, Rule 2) | ✓ `X-Retell-Signature: v={ts},d={hex}` HMAC-SHA256 over raw body+timestamp, 5-min replay tolerance | ✗ **No signature scheme found**; only configurable static shared-secret headers (Bearer/Basic/OAuth2/custom) — bearer-token auth, not body-integrity HMAC, no replay protection | **Retell** — decisive for Rule 2 compliance |
| Post-call webhook signature | ✓ same HMAC scheme as tool calls | ✓ `elevenlabs-signature` header, `constructEvent`/`construct_event` SDK helpers, HMAC-SHA256 + timestamp | Tie |
| Structured conversation design (flows/workflows) | ✓ Conversation Flow (node graph), Multi-Prompt (legacy), Single Prompt, Components (reusable subflows) | ✓ Workflows (node graph), Procedures (structured/free-form state machines) | Tie, arguably ElevenLabs edges on versioning maturity |
| Versioning | ✓ V0/V1/V2… immutable, drafts, environment tags, diff view | ✓ Immutable snapshots + **git-like branches** (create from any version, merge any non-archived branch, rebase non-main→main) + deterministic conversation-ID traffic split | **ElevenLabs** — more mature branch/merge/rebase model, confirmed |
| Global/always-reachable node (vet emergency escalation) | ✓ Global nodes, reachable from anywhere, "prevent immediate re-trigger" cooldown | **partial — not explicitly confirmed**; closest primitive is an agent-level system tool callable from any state, but that's LLM-discretionary, not structurally guaranteed | **Retell** — needed for the Vet vertical's hard structural guarantee |
| Transfers | ✓ Cold/Warm/Agentic-Warm/Agent-swap (same call_id) | ✓ Conference (warm, `agent_message`, **native-Twilio-import only**)/Blind/SIP-REFER/Agent-transfer (workflow-aware, can jump to a node without switching agents) | Tie, different constraints each |
| Post-call structured data extraction | ✓ Boolean/Text/Number/**Enum(Selector)**, bundled, no separate charge found | **partial** — String/Boolean/Integer/Number only, **no native Enum**; 25 items/agent (40 Trial/Enterprise); 30 success-eval criteria/agent, **tri-state** success/failure/unknown | **Retell** for native Enum fit; ElevenLabs' tri-state honestly-unsure result is arguably better-designed |
| Consented outbound reminders + voicemail detection | ✓ batch CSV, outbound-only voicemail/IVR detection, <30ms added latency, $0.005/dial | ✓ batch calling + **two** voicemail mechanisms (LLM-inferred + brand-new native Twilio AMD, 2026-09-07) — **but ZRM and batch calling are mutually exclusive**, forcing one-by-one calls for any HIPAA tenant | Retell (simpler, and moot for HIPAA tenants who can't use ElevenLabs anyway) |
| HIPAA BAA at $349/mo | ✓ **Free, self-serve, any plan** [carried from prior pass, not re-fetched this session] | ✗ **Enterprise-tier only**, confirmed verbatim, ZRM required alongside | **Retell — decisive** |
| p95 latency | No numeric p95 published either side; UNVERIFIED third-party figures span 400ms–1.73s for ElevenLabs, 580–800ms for Retell — 10x spread makes these uncitable | Same caveat | Neither confirmed; not decidable from docs |
| Testing/simulation APIs | ✓ 4-tier stack (Playground, Simulation test cases, Batch/CI test runs, Web/Phone call testing); no discount tier | ✓ 3 test types + repeat/bucketed runs (flakiness detection) + folder org + create-test-from-real-call | Tie, ElevenLabs' bucketed-run flakiness detection is a genuine edge |
| Cost ≤ ~$0.12/min all-in | Economy $0.1035/min BYO Twilio — **under budget** | Economy $0.1135/min BYO Twilio — **under budget but higher** | Retell |

---

## 3. Pricing tables and margin at our price cards

### 3.1 Official per-component rates (both fetched live this session; see sweep C §1, §8 for full citations)

| Component | Retell | ElevenLabs |
|---|---|---|
| Voice infra / platform | $0.055/min | $0.08/min flat (same inside-plan or overage, confirmed identical across all 6 tiers — sweep C §0.1) |
| TTS native | $0.015/min | bundled into $0.08/min |
| TTS ElevenLabs-brand voice | $0.040/min (on Retell) | n/a (native) |
| LLM Economy (Haiku-class) | $0.025/min (official) | **[ASSUMPTION]** same figure used as proxy — ElevenLabs publishes no per-model $/min table |
| LLM Premium (Sonnet/GPT-class) | $0.080/min (official) | **[ASSUMPTION]** same proxy |
| BYO Twilio/SIP telephony | $0 markup | "at cost," page-level claim, SIP-trunking docs silent on price |
| Concurrency, free tier | 20 concurrent | 4 (Free) → 40 (Business $990/mo) |
| Concurrency, additional | $8/slot/month, linear, self-serve | Plan-tier jump only; no self-serve add-on found; burst = 2× rate, capped at 3× limit or 300 |
| HIPAA/BAA | Free, self-serve, any plan [not re-fetched this session] | Enterprise-tier only, no published floor |

### 3.2 All-in $/min, our actual architecture (Economy/Premium LLM + BYO Twilio — the other two scenarios the pricing task computed, vendor telephony, are not part of Heyloo's design)

| Scenario | Retell | ElevenLabs |
|---|---|---|
| Economy LLM + BYO Twilio | **$0.1035** | **$0.1135** |
| Premium LLM + BYO Twilio | **$0.1585** | **$0.1685** |

Realistic 3-minute booking call: Retell $0.31–$0.48, ElevenLabs $0.34–$0.51 —
Retell ~8–9% cheaper, consistent across LLM tiers (sweep C §3).

### 3.3 Margin at our three price cards (sweep C §5, Retell numbers; ElevenLabs is ~1–3 points lower at equal usage due to the per-minute delta, before the HIPAA gate is even applied)

| Card | Included min | At included min, Economy LLM | At included min, Premium LLM |
|---|---|---|---|
| Auto repair $299/300min/$0.35 | 300 | **89.6%** margin | **84.1%** margin |
| Dental $349/350min/$0.40 | 350 | **89.6%** margin | **84.1%** margin |
| Restaurant $249/500min/$0.30 | 500 | **79.2%** margin | **68.2%** margin |

**Structural finding (both vendors, not just Retell)**: SYSTEM_DESIGN's own
stated margins (~88% auto, ~84% dental, 72–77% restaurant) match the
**Economy-LLM** row, not Premium, on either platform. Restaurant is the
thinnest card — an 11-point Economy-vs-Premium swing — and is exactly the
kind of structured slot-filling task where a cheap LLM's lower reliability
is riskiest to get wrong live. Decide LLM tier per vertical deliberately.

### 3.4 Four volume scenarios (Retell vs. ElevenLabs total monthly provider spend, sweep C §4)

| Scenario | Retell | ElevenLabs |
|---|---|---|
| 50 tenants × 300min = 15,000 min | $2,250/mo, $0 concurrency add-on, PAYG | $2,400/mo, Creator tier ($22/mo) realistic minimum |
| 50 tenants × 500min = 25,000 min | $3,750/mo, $0 add-on | $4,000/mo, same tier |
| 200 tenants × 400min = 80,000 min | $12,000/mo, 16-of-20 free concurrency (thin, recommend buying buffer) | $12,800/mo — **concurrency forces at minimum Pro (20, $99/mo), realistically Business (40, $990/mo)**; spend is flat regardless of tier label |

**Neither platform forces Enterprise pricing on volume alone** through 200
tenants at these usage levels — the ElevenLabs Enterprise trigger for us is
HIPAA, not scale.

---

## 4. HIPAA / BAA terms, verbatim

| | Retell | ElevenLabs |
|---|---|---|
| BAA availability | "HIPAA compliant"; BAA **self-serve, free, no extra fee** at `click-agreements.retellai.com` [carried from prior research pass — **not independently re-fetched this session**, flagged in §10 for reconciliation against a "Custom BAA" listed under ElevenLabs' Enterprise features, which prompted a caveat in sweep C too] | Verbatim, confirmed by direct re-fetch this task: **"Execution of a BAA, as may be required by HIPAA, is only available for Enterprise tier subscriptions. Contact your account representative."** |
| Precondition | Per-agent Data Storage Settings (Everything / Everything-except-PII / Basic-Attributes-Only) + configurable retention (1–730 days or forever) | **Zero Retention Mode (ZRM) required alongside the BAA.** Verbatim: "To the extent Covered Entities and Business Associates... have executed a BAA and have Zero Retention Mode engaged, ElevenLabs allows such customers to develop AI-powered voice agents for the handling of Protected Health Information." Forgoing ZRM: "no PHI should be submitted to the Service." |
| ZRM/BAA availability | N/A (BAA doesn't require an equivalent mode) | **ZRM itself is Enterprise-only.** Confirmed: "Enterprise customers can use Zero Retention Mode. It is primarily intended for use by our customers in the healthcare and banking sector." |
| LLM allowlist under compliance mode | Not applicable (no ZRM-equivalent restriction found) | Under ZRM, only a fixed Google/Anthropic/ElevenLabs-hosted list; **every OpenAI model requires Enterprise+BAA even under ZRM**; non-allowlisted LLM → HTTP 400. Anthropic models (Claude Sonnet 5, Opus 4.8/4.7, Haiku 4.5) **are** on the allowlist without needing Enterprise for the LLM itself — but the BAA gate to submit PHI at all remains Enterprise-only regardless |
| ZRM operational cost | N/A | Confirmed: ZRM **cannot be combined with batch calling** — a HIPAA tenant needing consented outbound reminders must place them one-by-one via the individual outbound-call API. Also: "Enabling ZRM may impact ElevenLabs' ability to debug call-related issues" — and per the HIPAA page, **the post-call webhook becomes the only record of a ZRM call** ("To retrieve information about calls made with ZRM-enabled agents, you must use post-call webhooks") — no dashboard/API backfill after the fact |
| Retention (baseline, non-HIPAA) | 1–730 days or forever, `data_storage_retention_days` field, daily automatic deletion | Default 2 years; configurable per-agent to any days, -1 unlimited, 0 scheduled deletion; ElevenLabs' own recommendation: "For HIPAA compliance, retain records for a minimum of 6 years" |
| Enterprise price floor | N/A (self-serve) | **Not published.** Sweep C's $1,500–2,500/mo is an **[ASSUMPTION]**, not a quote — get an actual quote before using it in a board/investor model |
| Certifications | SOC 2 Type 1 AND Type 2 (confirmed on the compliance page with a live Vanta Trust Center link); GDPR via AWS's DPA, but "we do not currently operate services within the EU" | SOC 2 Type II, ISO 27001/27017/27018/27701, ISO 42001, PCI DSS Level 1, HIPAA/GDPR attestations — via Trust Center at `compliance.elevenlabs.io` (secondary-sourced, not independently re-fetched from that domain directly) |

**Bottom line, unchanged from every pass that touched this question:**
even a conservative Enterprise-floor assumption of $1,500–2,500/mo would
require **5–8 dental tenants at $349/mo just to cover ElevenLabs' platform
minimum**, before a single per-minute cost. Retell's $0-minimum, free
self-serve BAA makes it the only viable choice for the dental vertical
below meaningful scale — this is not close.

---

## 5. Multi-tenant seam checks — exact doc quotes

### 5.1 Per-call agent override by dialed number

- **Retell**: ✓. `docs.retellai.com/features/inbound-call-webhook` — response
  can set `override_agent_id`, `override_agent_version`,
  `dynamic_variables`, `metadata`, `agent_override` (~25-field partial
  config override, session-scoped only), or `reject: true`.
- **ElevenLabs**: ✗ for agent selection. Confirmed by direct re-fetch this
  task: the `conversation_initiation_client_data` response schema has
  `type`, `conversation_config_override`, `custom_llm_extra_body`,
  `dynamic_variables`, `user_id`, `branch_id`, `environment` — **no
  `agent_id` field anywhere**. `conversation_config_override` is limited to
  `agent.prompt.prompt`/`agent.prompt.llm`, `agent.first_message`,
  `agent.language`, `tts.voice_id`, `conversation.text_only`/`asr.keywords`
  — prompt/voice/language/branch, never a different agent instance. Which
  agent a number routes to is set only via `PATCH
  /v1/convai/phone-numbers/:phone_number_id`, i.e. at
  import/assign time, not per call.

### 5.2 Dynamic variables per call

- **Retell**: ✓ `dynamic_variables` (string values only, cast in code),
  `metadata`, `custom_sip_headers`.
- **ElevenLabs**: ✓ `dynamic_variables` object; must include every custom
  variable the agent defines; system variables
  (`system__caller_id`, `system__called_number`, etc.) auto-available with
  no wiring; `secret__`-prefixed variables are hidden from the LLM (usable
  to thread an authoritative tenant/call token into a tool-call header
  without it entering the transcript).

### 5.3 Authoritative caller number in tool-call payloads

- **Retell**: ✓ automatic. The fixed `{name, call, args}` envelope's `call`
  object "always includes `from_number`/`to_number`/`direction`" on phone
  calls — matches `ToolCallRequest.callerNumberE164` exactly, with zero
  per-tool wiring required.
- **ElevenLabs**: **partial, compiler responsibility.** Confirmed by direct
  re-fetch this task: no automatic caller-number field on tool-webhook
  requests; must explicitly template `{{system__caller_id}}` into a tool's
  headers/path/query/body per tool. This is a **compiler-level
  requirement**, not a platform guarantee — a build-time lint rule would be
  needed in any ElevenLabs adapter to prevent a tool silently losing caller
  authority.

### 5.4 Webhook signatures

- **Retell tool calls**: ✓ `X-Retell-Signature: v={ms_timestamp},d={hex}` —
  HMAC-SHA256(rawBody + timestamp, apiKey), verified via SDK `Retell.verify()`.
- **ElevenLabs tool calls**: ✗. Confirmed by direct re-fetch this task
  (grepped the live page for "signature"/"HMAC" — zero occurrences outside
  unrelated S3 asset URLs). Only OAuth2/Basic/Bearer/Custom-Header
  **outbound** auth (ElevenLabs authenticating *to* our webhook) is
  documented — functions as a shared secret we configure, not a
  body-integrity HMAC with replay protection.
- **Retell post-call**: ✓ same HMAC scheme as tool calls.
- **ElevenLabs post-call**: ✓, confirmed by direct re-fetch this task:
  `ElevenLabs-Signature: t=timestamp,v0=signature`, HMAC-SHA256, verified
  via `elevenlabs.webhooks.constructEvent()`/`construct_event()`. This is
  the one ElevenLabs webhook surface that meets our Rule 2 bar.

### 5.5 Number import

- **Retell**: ✓ elastic SIP trunking (Twilio/Telnyx/Vonage guides), no
  charge for custom telephony, IP allowlist `18.98.16.120/30` + 3 more
  CIDRs.
- **ElevenLabs**: ✓ native Twilio import (SID + Auth Token, API Key
  recommended) or SIP trunking (TLS, custom headers, BYE-header support),
  "at cost." Field-level parity vs. our canonical `ImportPhoneNumberInput`
  (`terminationUri`, `inboundWebhookUrl`, auth fields) **not diffed this
  pass** — flagged in §10.

---

## 6. Templates verdict

**Neither platform's templates are a substitute for
`packages/templates/src/verticals/*`** (1,760 lines, 8 verticals). Both are
single-tenant "faster cold start" starting points. Specifically absent from
**both**, confirmed across the template sweep:

- the compiled-in, non-removable AI+recording disclosure gate (our G1/G2);
- vertical structural guarantees (vet's global emergency node, legal's
  conflict-check-before-substantive-discussion + hard no-advice gate,
  dental's PHI-out-of-transcript deferral);
- the 12-class call taxonomy and give-up-ladder/read-back discipline;
- red-team/injection-resistance validation.

ElevenLabs' gallery (9 templates, live) includes a "Healthcare
Receptionist" template with **no HIPAA-specific structural guardrail found**
— using it for real PHI still requires Enterprise+ZRM regardless of the
template. Retell has no public gallery; instead ships **Conductor**, an AI
copilot that generates/reviews/simulates a whole agent from a plain-English
description and can write test cases from real call transcripts —
functionally a template-*generator*, a different mechanism than
ElevenLabs' static cards. Neither is pre-built-vertical-product-ready;
both are worth tracking as potential first-draft accelerators for future
template authoring, not replacements for the finished set.

---

## 7. Direction, roadmap, and risk

| | Retell | ElevenLabs |
|---|---|---|
| 12-month trajectory | Moving **upmarket into enterprise call-center replacement**: Assure/AI QA (2025-12), Flex Mode, versioning 2.0, built-in CRM sync (Salesforce/HubSpot, 2026-06), live call monitoring, Conductor (AI copilot, 2026-07), Retell Workflows/orchestration (2026-08) | **Developer-workflow-first**: Workflows (node graph), Procedures (GA 2026-08-24), CLI v1 "agents as code" (`pull`/`push`, git-managed configs, CI/CD, 2026-08-24), MCP tool scoping |
| Funding/durability | ~$5.1M raised, ~$60M ARR (Apr 2026, 650% YoY per Sacra), team of ~30 | $781M raised across 5 rounds, $11B valuation (Series D, 2026-02, Sequoia-led), ~$600M ARR (Jun 2026, up from $330M end-2025) — an order of magnitude more capitalized |
| Pricing trend | Flat headline rate; new billing-transparency line items (TTS/voice-engine split, upfront-prorated concurrency) + new Concurrency Burst ($0.10/min) | Real ~20% cut, 2026-05-07 (Scale $330→$299, Business $1,320→$990) — got *more* competitive on per-minute rate, but doesn't change the HIPAA-gated conclusion |
| Reliability, last 12mo | **3-hour full outage 2026-09-05** (6 days before this research, postmortem published); at least 4 distinct 50+min incidents Jun–Sep 2026 | No Agents-specific incident at that severity found this pass; largest found were a 34-min upstream TTS/STT issue (2026-08-03) and a same-day-resolved tool-config-save bug (2026-06-25) |
| Portability / lock-in | No config-as-code tooling found (REST API/SDKs + Conductor only) | **CLI v1 is a genuine git/CI-workflow upgrade** — not a portability upgrade (still proprietary schema), but materially better DevOps tooling if we ever want to snapshot/diff/audit provider-side config |
| Community signal (UNVERIFIED, directional only) | Complaints cluster on "non-existent support beyond Discord," "frequent breaking API changes," "agent management across multiple clients is cumbersome" (directly relevant to our agency-scale, agent-per-tenant model) | Complaints cluster on billing (credits vanish on downgrade/cancellation, pricing unpredictability), **not reliability or product quality** — day-to-day reliability described as good by the same sources |

**Read**: Retell's roadmap is solving problems adjacent to our own admin
cockpit (QA, monitoring, multi-agent management) — good if it reduces our
own build burden, but also a signal Retell may be drifting toward
enterprise call centers as its primary buyer, a different segment than our
SMB verticals. ElevenLabs' capital position is a real durability advantage
if Retell's growth stalls, but doesn't touch the HIPAA/pricing facts today.
**Both vendors had real, non-zero 2026 incidents; neither publishes an
independently-audited uptime SLA we could confirm.**

---

## 8. Migration cost to ElevenLabs

**Current Retell adapter** (`packages/adapters/retell/src`, excluding
`dist/` build output and `node_modules`):

- **20 source files, ~2,850 lines of implementation**: `provider.ts` (135),
  `client.ts` (143), `inbound.ts` (77), `tool-call.ts` (79), `outbound.ts`
  (75), `numbers.ts` (58), `agents.ts` (154), `call-events.ts` (137),
  `signature.ts` (89), `raw-types.ts` (314), `tests-api.ts` (420),
  `index.ts` (29), `fixtures/templates.ts` (179), plus the compiler
  subpackage (`compiler/types.ts` 327, `conversation-flow.ts` 253,
  `multi-prompt.ts` 126, `single-prompt.ts` 82, `index.ts` 66,
  `extraction.ts` 65, `disclosure-gate.ts` 42 — 961 lines across 3 compile
  targets).
- **19 test files, ~2,665 lines** (`registry-consistency.test.ts` alone is
  454 lines — cross-checks the compiler's own field registry).
- Sits behind `packages/canonical-types/src/voice-provider.ts` (411 lines):
  a clean `VoiceProvider` interface (`createOrUpdateAgent`,
  `publishAgentVersion`, `importPhoneNumber`, `verifyWebhookSignature`,
  `resolveInboundCall`, `buildInboundResponse`, `verifyAndParseToolCall`,
  `buildToolCallResponse`, `verifyAndParseCallEndedWebhook`,
  `compileTemplate`, optional `createOutboundCall`) plus
  `ProviderCapabilities` flags core code branches on.

**Note (repo hygiene, not part of this research task's remit but worth
flagging):** `packages/adapters/retell/dist/` currently contains ~150
committed build-output files (`.js`, `.d.ts`, `.map`, a `.tsbuildinfo`), and
`node_modules/.bin/*` binaries also appear under the adapter directory —
CLAUDE.md Rule 3 states "no committed build output... no compiled-JS
siblings." Flagging for whichever cluster owns repo hygiene; out of scope
to fix here (read-only research task, write-scope restricted to this file's
directory).

**What a parity ElevenLabs adapter would require, beyond a 1:1 line-count
port:**

1. **Compile-target down-conversion, not a straight port.** ElevenLabs has
   no native Enum type for post-call data collection (String/Boolean/
   Integer/Number only) — our canonical Enum fields (e.g. a 12-way
   `classification`, `urgency_flag` tiers) must down-convert to a
   constrained String via the `allowed_values` mechanism. Workflows/
   Procedures map conceptually to Conversation Flow/Multi-Prompt but are
   not a 1:1 schema match — full field-level diffing wasn't done in any
   sweep this pass.
2. **A caller-number-injection lint rule.** Because ElevenLabs doesn't
   automatically include the caller number in tool-call requests, the
   compiler must be extended to verify every compiled tool definition
   explicitly wires `{{system__caller_id}}` — a new build-time check with
   no Retell-side analog needed.
3. **A weaker Rule 2 signature contract**, requiring an explicit ADR (not a
   silent downgrade) since `verifyAndParseToolCall`'s "fail closed on
   missing/invalid signature" becomes "fail closed on missing/incorrect
   shared-secret header."
4. **A provisioning-flow change** for the static number→agent binding:
   Retell's `create_agent`+`import_number` flow can set the binding
   implicitly; ElevenLabs needs an explicit `PATCH
   /v1/convai/phone-numbers/:phone_number_id` assign-agent step in our
   provisioning saga.
5. **Resolving the ~15 items sweeps A/B/C/E/F flagged as unverified before
   any of this ships to production** — most are a live-account or sales
   question, not research (§10 lists them).

**[MODEL] estimate**: ~20–35 engineer-days for a parity adapter (compile
targets, webhook handlers, signature/auth layer, provisioning changes,
tests) for one engineer familiar with the existing Retell adapter's shape
— roughly 4–7 calendar weeks, not counting the calendar time to get
answers to §10's open items from ElevenLabs directly. This is a real,
multi-week investment, not a config swap — the `VoiceProvider` abstraction
buys us portability *in principle*, but portability still costs real
engineering time to exercise.

**Ongoing cost of running dual-provider** (if we ever did, e.g. Retell for
non-HIPAA verticals + ElevenLabs Enterprise for HIPAA-flagged dental
tenants): roughly doubles the adapter-layer test/maintenance surface (two
compilers, two signature schemes, two provisioning flows, two sets of
vendor deprecation notices to track — Retell alone ships breaking changes
on a ~monthly cadence per sweep B §5), plus reconciling two separate
billing/cost-event shapes against our own usage ledger. **[MODEL]**: call
it a 15–20% ongoing tax on adapter-layer engineering time indefinitely,
which only pencils out if a specific vertical's requirements (HIPAA at
real scale) can't be met any other way — which, given Retell's own free
self-serve BAA, isn't currently true for us.

---

## 9. Recommendation

**Stay on Retell as the sole production voice provider.** Do not begin an
ElevenLabs adapter now. Specifically:

- Keep `VoiceProvider`/`ProviderCapabilities` exactly as designed — the
  abstraction is doing its job and costs nothing to maintain as a
  single-implementation interface.
- Do **not** invest in ElevenLabs Enterprise pricing/BAA negotiation unless
  a dental (or other PHI-handling) tenant cohort materializes at a scale
  where a $1,500–2,500/mo **[ASSUMPTION]** floor pencils out — get an actual
  quote first if that scale is approached, since no price floor is
  published.
- Revisit this recommendation if **any** of: (a) a second Retell outage of
  Sept-5 caliber within ~90 days; (b) Retell changes its free/self-serve
  HIPAA BAA terms (re-verify this specific claim directly — it was carried
  from the prior pass, not re-fetched this session, see §10 item 3); (c)
  ElevenLabs publishes a self-serve or materially-lower-than-Enterprise
  HIPAA path; (d) a direct ElevenLabs sales conversation resolves
  max-agents-per-workspace and tool-webhook signing in ElevenLabs' favor at
  a competitive price.
- Before finalizing per-vertical LLM-tier assignments (independent of
  provider choice): explicitly decide Economy vs. Premium per vertical,
  since SYSTEM_DESIGN's stated margins only hold at Economy and the
  restaurant card is thin enough (61.8–68.2% at Premium) to warrant a
  deliberate choice, not a default.

---

## 10. What we still don't know (refuted/unverifiable claims and open items)

Carried up from the six sweeps' own VERIFY-flagged items; **not** appended
to `docs/VERIFY.md` (this task's write scope is `docs/research/deep-dive/`
and this file only) — hand off to whichever cluster owns that file.

1. **Max agents per workspace, ElevenLabs** — not found in any page fetched
   across any sweep. Potentially load-bearing for our 50→500-tenant
   agent-per-tenant model; could be a hard blocker independent of every
   other finding in this report. **Highest priority** — ask ElevenLabs
   sales/support directly before any further ElevenLabs evaluation.
2. **Retell's "free, self-serve, any plan" HIPAA/BAA claim** — carried
   across every sweep from a prior-session blog citation
   (`retellai.com/blog/hipaa-compliant-voice-ai-without-enterprise-contract`),
   **never independently re-fetched this session**. One sweep's pricing-page
   fetch showed "Custom BAA" listed under Retell's own Enterprise-plan
   features, which is at minimum ambiguous next to the blog's claim and
   should be reconciled directly before the dental unit-economics story is
   finalized on either vendor.
3. **ElevenLabs per-model LLM $/min rates** — no official table found on
   any page fetched; every ElevenLabs LLM figure in §3 is an
   **[ASSUMPTION]** (Retell's published rate for the same model family used
   as a proxy). This is the single largest source of error in the pricing
   comparison.
4. **ElevenLabs Enterprise price floor** — not published anywhere found;
   the $1,500–2,500/mo figure used in this report is an unsourced planning
   assumption, not a quote.
5. **Tool-webhook timeout/retry behavior, ElevenLabs** — not documented;
   needed to size our hot-path abort budget the way Retell's documented
   10s/3-retry number lets us today.
6. **Global/always-reachable workflow node, ElevenLabs** — not confirmed to
   exist or not exist; needed for the Vet vertical's structural emergency
   guarantee before ElevenLabs could be considered for that vertical.
7. **Stereo/dual-channel recording, ElevenLabs** — not found; SYSTEM_DESIGN
   wants it (salvaged from old-system production experience) for QA/disputes.
8. **`eleven_v3` vs `eleven_v3_conversational` on Retell's pass-through** —
   Retell's `voice_model` enum lists base `eleven_v3`, not the
   latency-optimized `eleven_v3_conversational` ElevenLabs itself now
   recommends for live agents. If accurate, selecting "v3 voice" on Retell
   today may mean a multi-second-generation, non-real-time model. Needs a
   live Retell test call before ever offering "ElevenLabs premium voice" as
   a Heyloo add-on.
9. **ElevenLabs language-count self-contradiction** — the official Overview
   page states both "31 languages" and "70+ languages" in different
   sections of the same page. Resolve before citing either number
   externally, e.g. for a Spanish-language vertical decision.
10. **ElevenLabs Scale-vs-Business concurrency parity** — pricing page copy
    shows "30 Concurrent Calls" for both tiers despite Business costing
    3.3× more; a second independent fetch in one sweep found Business =
    40, contradicting the first. Confirm the real number before using it
    in a capacity plan.
11. **Field-level SIP-import parity**, ElevenLabs vs. our canonical
    `ImportPhoneNumberInput` (`terminationUri`, `inboundWebhookUrl`, auth
    fields) — not diffed field-by-field in any sweep.
12. **`GET /conversations/{id}` response schema, ElevenLabs** — not fetched
    from the API reference; needed to confirm `state_trace`/
    `variable_values` equivalents exist as response fields rather than
    only as list-filter parameters (which is all that was confirmed).
13. **p95 latency, either vendor** — no first-party numeric figure found on
    either side; all latency figures in circulation are UNVERIFIED
    third-party, with a 10x spread on the ElevenLabs figures alone
    (400ms–1.73s) depending on source and what's actually being measured.
14. **Retell's PII `phone_number` scrubbing vs. the *live* tool-call
    webhook** — does enabling it ever blank `callerNumberE164` on a live
    `/voice/tools` request, or only on the stored/post-call record? Load-
    bearing for our G6 `lookup_customer` authorization scoping. Docs
    strongly imply "post-call only" but this was not stated with 100%
    explicitness for the tool-call payload specifically.
15. **Twilio rates used throughout are list/PAYG rates**, not any volume
    discount Heyloo might negotiate at 200+ tenants.

---

## Sources

Primary synthesis inputs (each independently sourced and cited in full
within its own file — not re-listed line-by-line here):
- `docs/research/deep-dive/A_elevenlabs_capabilities.md` (~101 official
  pages fetched via `elevenlabs.io/docs/<path>.md` verbatim mirror)
- `docs/research/deep-dive/B_retell_capabilities.md` (114 pages via
  `docs.retellai.com/llms-full.txt`, 1,547,252 bytes)
- `docs/research/deep-dive/C_pricing_model.md` (official pricing pages,
  both platforms + Twilio, fetched live)
- `docs/research/deep-dive/D_templates_and_direction.md` (template
  galleries, changelogs, status pages, funding sources)
- `docs/research/deep-dive/E_voice_naturalness.md` (TTS model docs,
  turn-taking settings docs)
- `docs/research/deep-dive/F_total_cost_of_ownership.md` (Claude, Twilio,
  Supabase, Vercel, Sentry, Resend, PostHog, Stripe pricing pages)
- `docs/research/RETELL_VS_ELEVENLABS_2026.md` (prior shallow pass — read
  first per every sweep's instructions, superseded where findings diverge)

This task's own verification pass (15 claims, each independently re-fetched
from official sources 2026-09-11, all 15 returned CONFIRMED or REFUTED with
a corrected/precision-refined claim — see the individual verdicts supplied
to this task for full evidence chains):
- `elevenlabs.io/docs/eleven-agents/customization/personalization`
- `elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization`
- `elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools`
- `elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks`
- `elevenlabs.io/docs/eleven-agents/legal/hipaa`
- `elevenlabs.io/docs/agents-platform/phone-numbers/batch-calls`
- `elevenlabs.io/pricing/agents`
- `elevenlabs.io/docs/eleven-agents/guides/burst-pricing`
- `elevenlabs.io/docs/eleven-agents/customization/agent-analysis/data-collection`
- `elevenlabs.io/docs/eleven-agents/customization/agent-analysis/success-evaluation`
- `elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/transfer-to-number`
- `elevenlabs.io/docs/changelog/2026/9/7`
- `elevenlabs.io/docs/eleven-agents/operate/versioning`
- `elevenlabs.io/docs/changelog/2026/6/1`
- `elevenlabs.io/docs/eleven-agents/customization/privacy/retention`

Repo context read (not web sources):
- `docs/SYSTEM_DESIGN.md` §2/§4/§5
- `packages/canonical-types/src/voice-provider.ts` (411 lines, read in full
  this task)
- `packages/adapters/retell/src/**` (line counts computed this task via
  `wc -l` across all 20 non-test-snapshot source/compiler files, 2 test
  suites)

Every third-party/UNVERIFIED source cited inline in sweeps A–F is
inherited by reference, not re-listed here — see each sweep's own
"Sources" section for the full third-party bibliography and its explicit
UNVERIFIED labeling.
