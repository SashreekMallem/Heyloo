# Retell AI vs. ElevenLabs Agents — 2026 Comparison for Heyloo

Research date: 2026-09-11. Read-only research task; no code or config changed.
Grounds against `docs/MASTER_PLAN.md` §2 (unit economics), `docs/SYSTEM_DESIGN.md`
§2/§4 (architecture, conversation layer), and
`packages/canonical-types/src/voice-provider.ts` (the `VoiceProvider`
interface every adapter must satisfy).

**Bottom line up front:** stay on Retell as primary. Headline per-minute
pricing is closer than the marketing pages suggest once ElevenLabs' LLM
pass-through and bundled-minute math are normalized (~$0.10–0.18/min all-in
on both, depending on LLM tier). The decisive differentiator is **HIPAA**:
Retell gives a free, self-serve BAA on every plan; ElevenLabs gates the BAA
to **Enterprise only** (custom pricing, Zero Retention Mode required),
which would materially worsen dental-vertical economics or block it
entirely on a $299 base. ElevenLabs is a credible second provider behind
our existing `VoiceProvider` abstraction — better funded, has closed several
capability gaps in 2026 (Workflows, versioning/publish) — but full compiler
parity is a 4–6 week lift, not justified before ~150–300 clients or a
Retell-specific trigger (repricing, outage pattern, funding event).

---

## 1. Pricing — apples to apples

### 1.1 Component pricing (official pages, fetched 2026-09-11)

| Component | Retell AI | ElevenLabs Agents |
|---|---|---|
| Voice engine (STT+turn-taking+orchestration) | $0.055/min (Retell infra) | Bundled into the flat per-minute Agents rate below |
| TTS | $0.015/min (native: Retell/MiniMax/Fish/Cartesia/OpenAI) or **$0.040/min for ElevenLabs voices** | Included (native — ElevenLabs' own voices, 5k+ voices/70+ languages catalog) |
| Platform per-minute rate | n/a (see infra above) | **$0.08/min flat** — verified: every paid tier's (base fee)/(included minutes) = $0.08/min exactly (Free $0, Starter $6/75min, Creator $22/275min, Pro $99/1,238min, Scale $299/3,738min, Business $990/12,375min all ≈ $0.08/min), and the official overage rate is stated as $0.08/min flat. **Note:** several 2026 third-party comparisons and ElevenLabs' own Feb-2025 pricing-cut blog post cite a *tiered* 8¢ (Business annual) / 10¢ (Creator/Pro) rate — that may be stale; the currently-fetched official `elevenlabs.io/pricing/agents` page states a flat $0.08/min overage with 2x ($0.16/min) **burst** pricing above the plan's concurrency limit (up to 3x concurrency or 300, whichever is lower). Verify at contract time. |
| LLM | Bundled per-minute, provider sets the price by model: **$0.003/min** (GPT-5 nano) up to **$0.32/min** (GPT-5.5 Fast); mid-tier ~$0.08/min (GPT-5.4, Claude Sonnet) | **Billed separately**, "based on usage," deducted from ElevenLabs credits; same model families available (OpenAI GPT-5.x, Anthropic Claude Opus/Sonnet/Haiku, Google Gemini 3.x, plus ElevenLabs-hosted Qwen3.x) — no official per-model $/min table found (priced per-1M-tokens; convert per call). Custom/BYO LLM via webhook supported on both. |
| Telephony — Retell/ElevenLabs-provisioned number | $2.00/mo (basic), $10/mo (verified/10DLC-style) | Not itemized separately (native numbers exist but Heyloo BYO's Twilio, so this doesn't apply) |
| Telephony — BYO Twilio/SIP | **No markup on infrastructure** ("No Charge for SIP Trunking/Custom Telephony"); Retell-listed per-country carrier passthrough shown as ~$0.015/min for US | **"At cost"** — SIP trunking natively supported (Twilio, Telnyx, Vonage, Plivo, Bandwidth, etc.), no ElevenLabs markup documented |
| Knowledge base | $0.005/min usage + $8/mo per KB (first 10 free) | Included in the platform; RAG/knowledge base described as bundled across all tiers, no separate cost found |
| Post-call analysis | **Ambiguous — flag for verification.** Pricing page lists a distinct add-on, **"AI Quality Assurance: first 100 min free, then $0.10/min."** This reads as a premium QA-scoring product, separate from the baseline `call_analysis` feature (Boolean/Text/Number/Enum custom extraction fields + `call_analyzed` webhook) that `docs.retellai.com/features/post-call-analysis` describes as a built-in platform feature. **We could not confirm from official pages whether the baseline structured extraction our SYSTEM_DESIGN §4.4 requires (`classification`, `structured_booking_payload`, etc.) is free or billed under this $0.10/min line.** This should go in `docs/VERIFY.md` before contracting. | Success Evaluation (pass/fail/unknown criteria) and Data Collection (structured field extraction) are documented as standard features delivered via Post-call Webhooks; **no separate cost line found** — appears bundled into the $0.08/min rate, but this is also not explicitly stated as "$0" anywhere official. |
| Concurrency (free) | 20 concurrent calls included (pay-as-you-go); additional = **$8/concurrency-slot/mo** | Tiered by plan: Free 4, Starter 6, Creator 10, Pro 20, Scale 30, **Business 40**; burst allows 3x (cap 300) at 2x rate; no published flat "$/extra slot" self-serve price beyond burst — higher steady-state concurrency requires a bigger plan or Enterprise |
| Free tier | "$0 to start," $10 free credit, full platform access | 10,000 credits (~15 call-minutes) |
| HIPAA / BAA | **Free, self-serve, on any plan** (PAYG included) — request via `click-agreements.retellai.com`, no extra fee, most countersigned within a business day | **Enterprise tier only**, custom-negotiated pricing, **requires Zero Retention Mode** (no transcripts/recordings/tool-call logs stored); "no PHI should be submitted to the Service" without it |

Sources: [Retell AI pricing](https://www.retellai.com/pricing) · [Retell HIPAA/BAA blog](https://www.retellai.com/blog/hipaa-compliant-voice-ai-without-enterprise-contract) · [ElevenLabs pricing](https://elevenlabs.io/pricing) · [ElevenAgents pricing](https://elevenlabs.io/pricing/agents) · [ElevenLabs burst pricing docs](https://elevenlabs.io/docs/conversational-ai/guides/burst-pricing) · [ElevenLabs HIPAA docs](https://elevenlabs.io/docs/eleven-agents/legal/hipaa) · [ElevenLabs LLM/models docs](https://elevenlabs.io/docs/conversational-ai/customization/llm) · [ElevenLabs "we cut our pricing" blog (Feb 2025 — check for staleness)](https://elevenlabs.io/blog/we-cut-our-pricing-for-conversational-ai)

### 1.2 Realistic 3-minute booking call

Two LLM tiers modeled since the LLM line dominates the spread on both
platforms: **Economy** (~$0.03/min — nano/mini-tier model, adequate for
our tool-calling/slot-filling design) and **Standard** (~$0.08/min —
Claude Sonnet/GPT-5.4-class). Twilio's own PSTN leg (~$0.01/min,
unverified this session, same on both platforms since we BYO Twilio either
way) is shown separately since it's identical and not a provider
differentiator.

| Scenario | Retell (native TTS) | Retell (+ElevenLabs voice) | ElevenLabs Agents |
|---|---|---|---|
| Per-min, Economy LLM | $0.055+$0.015+$0.03+$0.005 = **$0.105** | $0.055+$0.040+$0.03+$0.005 = **$0.13** | $0.08+$0.03 = **$0.11** |
| Per-min, Standard LLM | $0.055+$0.015+$0.08+$0.005 = **$0.155** | $0.055+$0.040+$0.08+$0.005 = **$0.18** | $0.08+$0.08 = **$0.16** |
| 3-min call, Economy | $0.32 | $0.39 | $0.33 |
| 3-min call, Standard | $0.47 | $0.54 | $0.48 |
| + Twilio PSTN leg (both) | +~$0.03 | +~$0.03 | +~$0.03 |

**Finding:** once LLM and bundled-minute pricing are normalized, the two
platforms land within a few percent of each other per minute — the
"ElevenLabs is 8¢, Retell is 7–14¢" headline comparison commonly repeated
in 2026 third-party blogs is misleading because it compares ElevenLabs'
voice-only rate against Retell's all-in estimate. This does **not** match
`docs/MASTER_PLAN.md`'s framing of Retell as clearly cheaper — the pricing
gap has narrowed; HIPAA economics, not per-minute cost, is now the
deciding factor for our vertical mix (see §5).

### 1.3 Monthly cost at 50 tenants

At $299/mo base + $0.35–0.45/min overage, MASTER_PLAN's revenue reference
point is **~$24,950/mo** at 50 × 500 min blended. Provider cost only
(excludes Twilio PSTN, Supabase infra, Stripe fees):

| | 50×300min (15,000 min/mo) | 50×500min (25,000 min/mo) |
|---|---|---|
| **Retell**, Economy LLM | $1,575 (**93.7%** gross margin*) | $2,625 (**89.5%**) |
| **Retell**, Standard LLM | $2,325 (90.7%) | $3,875 (84.5%) |
| **Retell**, Standard LLM + 11labs voice | $2,700 (89.2%) | $4,500 (82.0%) |
| **ElevenLabs**, Economy LLM† | $1,650 (93.4%) | $2,750 (89.0%) |
| **ElevenLabs**, Standard LLM† | $2,400 (90.4%) | $4,000 (84.0%) |

\* Margin computed against the $24,950/mo revenue reference point for
illustration only — actual revenue scales with the vertical price card
in `docs/SYSTEM_DESIGN.md` §1, not this flat number; shown for
directional comparability with MASTER_PLAN §2's table.
† ElevenLabs figure = cheapest adequate plan's base fee + $0.08/min
overage beyond included minutes (Business plan, $990/mo, 12,375 min
included, is the only tier whose 40-concurrent limit is remotely adequate
at this scale) + LLM pass-through. Because included minutes and overage
both net to $0.08/min, the plan choice barely matters once volume exceeds
the plan's included minutes — see §1.1.

**Conclusion:** at scale, provider cost is within ~5–15% of each other
depending on LLM tier chosen, not the 25–30% gap MASTER_PLAN's directional
(pre-verification) numbers implied. Add-on line-item ambiguity (Retell's
"AI Quality Assurance," §1.1) could move Retell's real number if our
required post-call fields turn out to be billed under it — this is the
single highest-value unresolved question for the margin model.

---

## 2. Feature parity for our architecture

| Capability | Retell AI | ElevenLabs Agents | Notes for Heyloo |
|---|---|---|---|
| Agent-per-tenant at scale | No published hard cap on agent count; scaling is gated by **concurrency**, not agent count | Same — no published agent-count cap; gated by concurrency (plan tier) | Parity. Neither vendor documents a ceiling; verify informally at ~50-tenant pilot on either. |
| Custom tools/webhooks | Custom function tools call our `/voice/tools`; timeout config exists (used today) | "Server tools" call webhooks; **query/body/path params are dynamically generated from the conversation** (different mechanism than Retell's typed-arg JSON schema); **webhook tool timeout now supports up to 300s** | Both support our hot-path webhook pattern. ElevenLabs' param-generation model may need re-validating against our strict JSON-Schema tool contracts (`packages/canonical-types/src/tools.ts`) — it's a looser generation mechanism, not schema-first the way Retell's is. |
| Structured conversation design | **Conversation Flow** (typed node graph, Extract-DV nodes, global intents) + Multi-prompt states + single prompt — 3 compile targets, matches our compiler design directly | **Verify claim in task brief is outdated.** ElevenLabs shipped **Agent Workflows** in 2026: a visual node graph with Subagent nodes (override base config per phase), Agent Transfer nodes, Transfer-to-Number nodes, End Call nodes, and conditional edges — stored as `conversation_config.workflow` JSON, scriptable via API/CLI. This is a real, if less mature, analog to our `conversation_flow` compile target. It is **not** the same node semantics (subagent phase-override vs. Retell's typed slot-filling extraction nodes), so it is not a drop-in compile target. | Genuine capability gap has narrowed in 2026 — this needs to be reflected in any future migration estimate; the task's premise ("ElevenLabs has no conversation-flow builder") is **stale as of Sept 2026**. |
| Transfers (to human / to another agent) | `transfer_call` tool, warm transfer with context summary supported | Both exist as first-class **system tools**: `transfer_to_number` (default: dial-and-conference, drops the AI; native Twilio integration supports a warm-transfer `agent_message` spoken to the human) and `transfer_to_agent` (agent-to-agent handoff) | Parity, including warm-transfer-with-context on the native Twilio path. |
| Post-call data extraction | Custom Boolean/Text/Number/Enum analysis fields via `call_analyzed` webhook + nightly `get-call` reconciliation (matches our `structured_booking_payload`/`classification` design directly) | **Success Evaluation** (custom criteria → success/failure/unknown + rationale) + **Data Collection** (structured field extraction), both delivered via three webhook types: `post_call_transcription` (full data), `post_call_audio` (base64 audio only), `call_initiation_failure` | Parity in capability; field-typing granularity (Retell's explicit Bool/Text/Number/Enum vs ElevenLabs' evaluation-criteria model) isn't identical and would need a remap in our canonical `CallEndedEvent`/analysis schema. |
| Batch/outbound calling with consent | Batch Call (dashboard or API, upload list) | Batch Calling (real-time monitoring, per-recipient reporting) | Parity. Consent enforcement (our `CreateOutboundCallInput.consentRef` + mandatory `disclosure_line`) is our own application-layer control either way — neither vendor enforces consent for us. |
| Voicemail detection | Built-in (implied by `DISCONNECTION_REASONS` including `voicemail_reached` in our own canonical types, already confirmed against the Retell SDK) | Dedicated **Voicemail Detection** system tool — auto-detects, can leave a custom dynamic-variable-personalized message, then ends the call; logged in conversation history/batch results | Parity. |
| Webhook signature scheme | HMAC-based (already implemented in `packages/adapters/retell/src/signature.ts`) | HMAC-SHA256, header format `ElevenLabs-Signature: t=<timestamp>,v0=<signature>` — verified against the **raw** request bytes (JSON re-serialization breaks it, same caveat as most HMAC webhook schemes) | Parity in mechanism; matches our Rule 2 requirement ("verify signature against the RAW body first"). |
| Inbound-call webhook: dynamic variables + agent override by called number | Retell's `call_inbound` webhook resolver returns `dynamic_variables` **and** can override which agent handles the call (`InboundCallResolution.overrideAgentId` in our canonical types exists specifically for this) | **Gap.** ElevenLabs' "fetch initiation client data" webhook response schema is `dynamic_variables` (required) + `conversation_config_override` (prompt/voice/language/first-message overrides) + `branch_id`/`environment` — **no `agent_id` field**. The agent is fixed to the phone number at import/assignment time; the webhook cannot reroute a call to a different agent. | **Real architectural constraint for ElevenLabs.** Since Heyloo's model is already "our own Twilio number → 1 dedicated agent per tenant" (MASTER_PLAN §1, "agent-per-tenant"), this is likely a non-issue for the steady-state case — but any code path that shares one number across tenants (e.g., a pooled trial number before dedicated provisioning) would need redesigning on ElevenLabs. Verify no such path exists before treating this as low-risk. |
| Number import from Twilio | `POST` import endpoint with SIP termination URI + agent binding (our `ImportPhoneNumberInput` shape) | `POST /v1/convai/phone-numbers` — **two paths**: native Twilio integration (Account SID + Auth Token/API Key) or generic SIP trunk (URI-based, closer to Retell's shape) | Both support Twilio-originated numbers; field shapes differ (credential-based vs. URI-based for the "native" path), adapter-level translation needed either way — no canonical-type change required (Rule 2 already isolates this). |
| SIP trunking | Yes, "no charge for custom telephony" | Yes, explicit multi-provider support list (Twilio, Telnyx, Vonage, RingCentral, Sinch, Infobip, Exotel, Plivo, Bandwidth) | Parity. |
| Latency / TTFB claims | Not independently fetched this session (Retell docs didn't surface a headline TTFB number in this research pass) | ElevenLabs claims **~75ms TTFB** for the real-time-appropriate model (Flash v2.5); explicitly warns their most expressive model (v3) is **not suitable for real-time/conversational use** — third-party 2026 tests report 250–480ms streaming TTFB in practice depending on region/format | Note the internal caveat: ElevenLabs' own flagship "v3" voice quality is NOT what powers low-latency conversational calls — the conversational path uses Flash v2.5, a lower-fidelity, lower-language-count model. Relevant if we assumed "ElevenLabs voice quality" applies uniformly. |
| Languages | **55 languages / 63 locale variants**, every one covered by both an STT and TTS provider (all deployable today) | Flash v2.5 (the real-time-capable model): **32 languages**. v3 (70+ languages) is documented as unsuitable for conversational/real-time use, so it doesn't count for our use case. | **Retell has broader real-time language coverage than ElevenLabs' actual conversational-capable model.** This inverts the "ElevenLabs = voice quality leader" assumption for anything outside its 32 real-time languages. |
| Voice quality / cost delta | Native TTS at $0.015/min; ElevenLabs-brand voices available as an add-on at $0.040/min (+$0.025/min premium) | Native — ElevenLabs' own voices are simply "the product," bundled in the $0.08/min platform rate, no separate voice-tier line item found | If ElevenLabs-quality voice matters for a vertical (e.g. real estate, motel guest-facing warmth), Retell's ElevenLabs-voice add-on ($0.18/min all-in Standard scenario) is priced almost identically to buying it natively on ElevenLabs Agents ($0.16/min Standard) — voice-quality parity is achievable on Retell at a small premium, not a decisive ElevenLabs advantage. |
| MCP / tool ecosystem | Native **Retell MCP Server** (agents, calls, phone numbers, KBs, QA runs addressable from Claude/Cursor/Codex-style MCP clients) + an MCP tool **node** an agent can call at runtime (Salesforce, HubSpot, Calendly, Zapier/n8n, etc.) | "Model Context Protocol servers that provide tools and resources to agents" — MCP-as-a-tool-source is supported per the platform overview docs, but no first-party MCP *server* (i.e., driving ElevenLabs itself from an MCP client) was found in this research pass | Retell has a more visible, dual-direction MCP story (both consuming MCP tools at runtime and exposing itself as an MCP server for agentic dev workflows) as of this research. |
| Testing / simulation APIs | Dedicated **Batch Test** API (bulk scenario test cases via API; accepts `retell-llm` and `conversation-flow` response engines specifically) + interactive simulator | "Simulate Conversations" guide exists (`elevenlabs.io/docs/conversational-ai/guides/simulate-conversations`) — found in search results but not independently fetched this session; presumed to cover single-conversation simulation, no evidence found of a bulk/API-driven batch-test harness comparable to Retell's | Retell's batch-test API is a better match for our red-team suite (`packages/templates/src/red-team/`) which already runs adversarial-fixture regression at scale — would need to verify ElevenLabs' simulation API supports comparable bulk/CI-friendly invocation before relying on it. |
| Analytics | Dashboard + per-call cost/latency/tool-stat breakdown (used today for our cost ingestion) | Dashboard with conversation history, transcripts, evaluation results; user-tracking by external ID; A/B testing across agent versions (ties into the 2026 Versioning feature) | Roughly comparable; ElevenLabs' A/B-by-version is a feature Retell doesn't appear to have a direct analog for. |

---

## 3. Prebuilt agents / templates

### ElevenLabs (`elevenlabs.io/agent-templates`, "Agent Templates" launched 2026)

| Template | What it does | Exposes tools pointing at our backend? | Verdict |
|---|---|---|---|
| Front Desk Receptionist | Department routing, general inquiries, call routing | Yes — templates are editable prompt+tool starting points; server tools can be repointed to any webhook, including ours | Seeds, doesn't replace. No triage gating, no disclosure compiler, no injection-resistance guarantees. |
| Healthcare Receptionist | Collects patient info, schedules appointments for medical facilities | Same — tool-repointable | Same. Notably: **no HIPAA-specific structural guardrail described** (e.g. no equivalent to our DOB/insurance-deferred-to-secure-link design in §4.3) — and per §1.1, HIPAA use of this template requires Enterprise + Zero Retention Mode regardless of template. |
| Hospitality Concierge | Hotel front-desk guest inquiries | Same | Closest off-the-shelf match to our motel vertical's *tone*, none of its rate-table-via-tool-call discipline. |
| Sales/Appointment Scheduling | Demo/meeting booking, calendar-availability checks, confirmations | Same | Closest match to real estate/generic qualification flow; still lacks our qualification-without-interrogation single-prompt design work already encoded in `packages/templates/src/verticals/real-estate.ts`. |

### Retell AI

No first-party public template *gallery* comparable to ElevenLabs' as of
this research — Retell's own roadmap thread ("Revamped Retell Template
Library," `community.retellai.com/t/revamped-retell-template-library/1057`)
confirms this is **actively being rebuilt**, i.e. today's official offering
is thin (a "Receptionist" and "Insurance Verification Caller" starter plus
a prompt-generation assistant called "Conductor"). What exists beyond that
is third-party/community content (e.g. an unofficial `retell-prompt-library`
GitHub repo) — not vendor-guaranteed, not a first-party marketplace.

### Overall verdict

Neither platform's templates come close to replacing
`packages/templates/src/verticals/*` and its shared building blocks
(`disclosure.ts`, `fragments.ts`, `global-intents.ts`, `utility-states.ts`,
plus the `red-team/` adversarial suite). Both vendors' templates are
generic starting points aimed at a single-tenant "build your own bot"
user, not:

- the compiled-in, non-removable AI+recording disclosure gate (G1/G2,
  `disclosureVerified` on `CompiledAgentArtifact`),
- vertical-specific structural guarantees (vet's global emergency
  red-flag node, legal's hard no-advice/conflict-check gate, dental's
  PHI-out-of-transcript deferral),
- the 12-class call taxonomy and read-back/give-up-ladder conversation
  discipline in SYSTEM_DESIGN §4.3–4.5,
- or injection-resistance validated against our red-team fixture set.

**They're worth a skim for phrasing/UX inspiration (ElevenLabs' Hospitality
Concierge and Healthcare Receptionist in particular), not worth building
on.** This doesn't change with either vendor's 2026 roadmap additions.

---

## 4. Migration cost if we switched

`VoiceProvider` method-by-method (`packages/canonical-types/src/voice-provider.ts`):

| Method | Maps cleanly? | Why / what changes |
|---|---|---|
| `createOrUpdateAgent` | **No — biggest lift** | ElevenLabs' `conversation_config` (prompt + tools + `workflow` JSON) is structurally different from Retell's response-engine object. Needs a new compiler backend for all 3 `CompileTarget`s: `conversation_flow`→ElevenLabs Workflows (plausible but different node semantics — Subagent/phase-override vs. our typed Extract-DV/global-intent nodes), `multi_prompt`→Workflows-with-branching-subagents (unproven), `single_prompt`→direct prompt (straightforward). |
| `publishAgentVersion` | **Mostly — new 2026 feature** | ElevenLabs shipped agent **Versioning** in 2026: per-user drafts, explicit publish gate ("nothing reaches the live agent until you publish"), branches/deployments for gradual rollout. Maps to our version/publish gate reasonably well. One caveat found but not fully verified: rollback capability was described alongside "enterprise users" in one source — confirm tier-gating before relying on it. |
| `importPhoneNumber` | **Yes, with field translation** | `POST /v1/convai/phone-numbers` exists; native-Twilio path uses Account SID/Auth Token (not Retell's termination-URI shape), generic SIP-trunk path is closer to Retell's shape. Adapter-internal change only (Rule 2 already isolates provider payload shapes from canonical types). |
| `verifyWebhookSignature` | **Yes** | HMAC-SHA256, raw-body verification, timestamp tolerance — same shape as our existing fail-closed pattern. |
| `resolveInboundCall` / `buildInboundResponse` | **Partial — one real gap** | `dynamic_variables` + `conversation_config_override` map to our `AgentDynamicVariables`/overrides. **No `overrideAgentId` equivalent** — ElevenLabs fixes the agent to the phone number at assignment time. Low risk under our default 1-number-per-tenant model; needs a design check for any shared/pooled-number code path. |
| `verifyAndParseToolCall` / `buildToolCallResponse` | **Needs verification** | Server-tools webhook payload shape differs (dynamically-generated query/body/path params vs. our typed JSON-Schema args). **Unverified this session: does the tool-webhook payload carry an authoritative, session-bound caller number outside model-controlled args**, the way Retell's `ToolCallRequest.callerNumberE164` does? This is load-bearing for our G6 `lookup_customer` authorization rule (CLAUDE.md Rule 2) — must be confirmed against current docs/a test account before any migration work starts, not assumed. |
| `verifyAndParseCallEndedWebhook` | **Partial — new mapping table needed** | `post_call_transcription` webhook exists and carries transcript/analysis/metadata, but ElevenLabs' termination-reason taxonomy was not found to be as granular as Retell's 33-value `DISCONNECTION_REASONS` enum (verified against the official `retell-typescript-sdk` per existing code comments). A full remap/superset table would need building and testing. |
| `compileTemplate` | **No — see `createOrUpdateAgent`** | Same compiler rebuild, this is the method that does the lowering. |
| `createOutboundCall` (optional) | **Yes** | Batch Calling / outbound call endpoints exist; our disclosure-line enforcement is application-layer regardless of provider, so this is a straightforward implementation. |

**Engineering estimate:** building a `packages/adapters/elevenlabs` to the
same maturity as today's `packages/adapters/retell` (which has ~15 source
files including full test coverage for agents, call-events, client,
inbound, numbers, outbound, provider, signature, tool-call, and an SDK
contract test) is realistically **4–6 weeks (20–30 engineer-days)** for one
senior engineer, dominated by: (1) the compiler backend for all 3 compile
targets against ElevenLabs Workflows — genuinely novel work with unproven
node-semantics fit, (2) the disconnection-reason remap, and (3) resolving
the caller-number-authorization unknown above before anything ships. A
**failover-only** dual-provider slice (single-prompt compile target only,
basic tools, no Workflows mapping) is a much smaller ~3–5 day lift and is
the pragmatic starting point if dual-provider is pursued at all (§5).

**Risks:**
- **Lock-in:** both vendors are proprietary config formats; our
  `VoiceProvider` abstraction is the correct hedge regardless of which
  vendor we pick, and is already built — this argues for *keeping* the
  abstraction current, not for switching.
- **Roadmap volatility:** ElevenLabs' Agents product has been renamed at
  least three times found in this research (Conversational AI → Agents
  Platform → Eleven Agents / ElevenAgents), with docs paths scattered
  across `/docs/conversational-ai/`, `/docs/agents-platform/`, and
  `/docs/eleven-agents/` still all live simultaneously — a signal of fast,
  possibly not-yet-settled internal product organization. Retell's own
  template library is also mid-rebuild per their public roadmap.
- **Funding / durability:** Retell has raised **$5.1M** total, reported
  **~$60M ARR** (Apr 2026, up 650% YoY) — extremely capital-efficient but
  thin balance sheet if growth stalls or a well-funded competitor
  undercuts on price. ElevenLabs raised a **$500M Series D at an $11B
  valuation** (Feb 2026, Sequoia-led) on **~$500–600M ARR** — a much
  larger cushion, but also a company whose gravity center (TTS/voice
  cloning/dubbing/Creator tools) is not phone-answering SMB receptionists;
  Agents is one product line among several, and a company at that scale
  and valuation multiple (~22x ARR) has its own repricing/consolidation
  pressure risk.
- **Outages:** Retell's public status trackers show several 2026
  incidents (a 70-min TTS-provider-down window in July, a 95-min partial
  inbound-call outage in June, a 50-min batch-call failure in July) — none
  catastrophic, all resolved same-day, consistent with a fast-growing but
  young infra. No comparable outage-history source was found for
  ElevenLabs Agents specifically in this research pass (their public
  status page covers primarily the TTS/API product) — treat as an
  unverified gap, not a clean bill of health.

---

## 5. Recommendation

**Stay on Retell as the sole active provider for now.** The pricing gap
this research turned up is much narrower than MASTER_PLAN's directional
estimate assumed (§1.2–1.3: roughly $0.10–0.18/min all-in on *either*
platform depending on LLM tier, not a clean Retell-cheaper story), so cost
alone doesn't justify a switch or urgent dual-provider build. What does
justify staying:

1. **HIPAA economics are the real deciding number, not per-minute cost.**
   Retell's free, self-serve, any-plan BAA is structurally compatible with
   a $349/mo dental price point (`docs/SYSTEM_DESIGN.md` §1). ElevenLabs
   requires Enterprise (custom-negotiated, likely $990/mo+ territory
   given their published tier ladder) **and** Zero Retention Mode, which
   also disables standard transcript/recording storage — a real product
   trade-off, not just a price one, for a vertical whose SYSTEM_DESIGN
   already leans on deferring PHI out of transcripts rather than
   forbidding storage outright. Building the dental vertical on
   ElevenLabs would either blow the vertical's margin target or force an
   architecture change.
2. **The compile-target rebuild is real, multi-week work** — not
   justified pre-revenue/pre-scale, especially with two open unknowns
   (Retell's "AI Quality Assurance" line-item applicability, and whether
   ElevenLabs' tool webhook furnishes an authoritative caller number for
   our G6 authorization rule) that could each move the calculus.
3. Both platforms closed capability gaps in 2026 that make either a
   viable **second** provider later (ElevenLabs shipped Workflows and
   agent Versioning; both have MCP, batch calling, voicemail detection,
   warm transfer, HMAC webhooks, BYO-SIP telephony at no markup).

**Recommended path:**
- Keep `VoiceProvider` strict and current (already CLAUDE.md Rule 2) —
  this is the hedge, not a vendor switch.
- Append the two open unknowns above to `docs/VERIFY.md` and resolve them
  with a live Retell/ElevenLabs test account before finalizing the
  per-vertical margin model, per CLAUDE.md Rule 1.
- Revisit dual-provider (ElevenLabs as **failover only**, single-prompt
  compile target, non-HIPAA verticals) at roughly **150–300 clients**
  (MASTER_PLAN §2's own self-hosting revisit threshold is a reasonable
  anchor) or immediately if a Retell-specific trigger fires: a material
  repricing, a funding-driven reliability concern, or an outage pattern
  that starts affecting SLA commitments to tenants. At that point the
  ~3–5 day failover-only slice (not the full 4–6 week compiler rebuild)
  is the right scope.
- Do **not** build ElevenLabs as primary for the dental vertical under
  current pricing — the BAA gate makes it strictly worse than Retell for
  that vertical specifically, independent of the broader platform
  comparison.

---

## Sources

- [Retell AI — Pricing](https://www.retellai.com/pricing)
- [Retell AI — HIPAA compliant voice AI without enterprise contract](https://www.retellai.com/blog/hipaa-compliant-voice-ai-without-enterprise-contract)
- [Retell AI — Do Retell AI's Voice Agents Have HIPAA Compliance and BAAs](https://www.retellai.com/blog/do-retell-ais-voice-agents-have-hipaa-compliance-and-baas)
- [Retell AI — Post Call Analysis feature docs](https://docs.retellai.com/features/post-call-analysis)
- [Retell AI — Batch test your agent](https://docs.retellai.com/test/batch-test-simulation)
- [Retell AI — Introduces Simulation and Batch Testing](https://www.retellai.com/blog/retell-ai-introduces-simulation-and-batch-testing-for-ai-agents)
- [Retell AI — Batch Call feature page](https://www.retellai.com/features/batch-call)
- [Retell AI — Concurrency, CPS, and burst limits](https://docs.retellai.com/deploy/concurrency)
- [Retell AI — Supported Languages 2026](https://www.retellai.com/blog/how-to-use-ai-phone-agents-for-multilingual-communication)
- [Retell AI — MCP Server](https://www.retellai.com/blog/retell-mcp-server)
- [Retell AI — Revamped Template Library (roadmap)](https://community.retellai.com/t/revamped-retell-template-library/1057)
- [Retell AI — Seed funding announcement](https://www.retellai.com/blog/seed-announcement)
- [Sacra — Retell AI at $60M/yr, up 650% YoY](https://sacra.com/research/retell-ai-60m-yr-up-650-yoy/)
- [StatusGator — Retell AI status history](https://statusgator.com/services/retell-ai)
- [ElevenLabs — Pricing](https://elevenlabs.io/pricing)
- [ElevenLabs — ElevenAgents Pricing](https://elevenlabs.io/pricing/agents)
- [ElevenLabs — We cut our pricing for Conversational AI (Feb 2025 — verify for staleness)](https://elevenlabs.io/blog/we-cut-our-pricing-for-conversational-ai)
- [ElevenLabs — Burst pricing docs](https://elevenlabs.io/docs/conversational-ai/guides/burst-pricing)
- [ElevenLabs — Agents Platform overview](https://elevenlabs.io/docs/conversational-ai/overview)
- [ElevenLabs — HIPAA docs](https://elevenlabs.io/docs/eleven-agents/legal/hipaa)
- [ElevenLabs — LLM models & custom LLM docs](https://elevenlabs.io/docs/conversational-ai/customization/llm)
- [ElevenLabs — Server tools docs](https://elevenlabs.io/docs/conversational-ai/customization/tools/server-tools)
- [ElevenLabs — Transfer to number](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/transfer-to-number)
- [ElevenLabs — Agent transfer](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/agent-transfer)
- [ElevenLabs — Post-call webhooks](https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks)
- [ElevenLabs — Success Evaluation](https://elevenlabs.io/docs/conversational-ai/customization/agent-analysis/success-evaluation)
- [ElevenLabs — Data collection](https://elevenlabs.io/docs/conversational-ai/customization/agent-analysis/data-collection)
- [ElevenLabs — Batch calling docs](https://elevenlabs.io/docs/conversational-ai/phone-numbers/batch-calls)
- [ElevenLabs — Voicemail detection docs](https://elevenlabs.io/docs/conversational-ai/customization/tools/system-tools/voicemail-detection)
- [ElevenLabs — Introducing batch calling blog](https://elevenlabs.io/blog/introducing-batch-calling-for-elevenlabs-conversational-ai)
- [ElevenLabs — Twilio personalization (inbound webhook schema)](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization)
- [ElevenLabs — Dynamic variables](https://elevenlabs.io/docs/agents-platform/customization/personalization/dynamic-variables)
- [ElevenLabs — Agent Workflows docs](https://elevenlabs.io/docs/agents-platform/customization/agent-workflows)
- [ElevenLabs — Introducing Agent Workflows blog](https://elevenlabs.io/blog/introducing-agent-workflows)
- [ElevenLabs — Introducing Versioning blog](https://elevenlabs.io/blog/introducing-versioning)
- [ElevenLabs — Agent versioning docs](https://elevenlabs.io/docs/eleven-agents/operate/versioning)
- [ElevenLabs — SIP trunking docs](https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking)
- [ElevenLabs — Agent Templates](https://elevenlabs.io/agent-templates)
- [ElevenLabs — Introducing Agent Templates blog](https://elevenlabs.io/blog/introducing-agent-templates)
- [ElevenLabs — Series D announcement ($500M / $11B valuation)](https://elevenlabs.io/blog/series-d)
- [CNBC — ElevenLabs hits $11B valuation](https://www.cnbc.com/2026/02/04/nvidia-backed-ai-startup-elevenlabs-11-billion-valuation.html)
- [Sacra — ElevenLabs revenue, valuation & funding](https://sacra.com/c/elevenlabs/)
- Third-party 2026 pricing breakdowns used only to fill gaps, explicitly
  flagged inline where relied on: [HappyRobot — ElevenLabs Pricing 2026](https://www.happyrobot.ai/hub/elevenlabs-pricing), [Flexprice — ElevenLabs pricing breakdown](https://flexprice.io/blog/elevenlabs-pricing-breakdown), [Cekura — ElevenLabs Pricing 2026](https://www.cekura.ai/blogs/elevenlabs-pricing)
