# Sweep D — Templates, Ecosystem & Platform Direction (Retell vs. ElevenLabs)

Research date: 2026-09-11. Read-only research task; no code/config changed,
nothing written outside `docs/research/deep-dive/`. Extends
`docs/research/RETELL_VS_ELEVENLABS_2026.md` (read first for pricing/feature
parity — this file does not repeat that ground except where it changed).
Compared honestly against `packages/templates/src/verticals/*.ts` (dental,
veterinary, legal, auto-repair, motel, restaurant, real-estate, generic —
1,760 lines total) and `docs/SYSTEM_DESIGN.md` §4 (compile targets, 12-class
taxonomy, triage/read-back discipline, disclosure rules).

**Bottom line up front:** Neither platform's templates are a substitute for
`packages/templates/*` — both are single-tenant "faster cold start" starting
points with no compiled-in disclosure gate, no vertical safety structure
(triage red-flags, conflict checks, PHI deferral), and no adversarial
red-team coverage. On **direction**, both vendors shipped a lot in the last
12 months and both are converging toward what we already built by hand:
Retell added Workflows/Conductor/Assure (orchestration + AI-authored +
AI-QA'd agents) and ElevenLabs added Workflows + Procedures + a genuine
"agents-as-code" CLI (push/pull, git-managed configs, CI/CD). Pricing moved
in ElevenLabs' favor (a real ~20% cut, May 2026) and stayed flat-ish on
Retell (mostly billing-transparency changes, one new burst-pricing line).
Reliability: both had 2026 incidents; Retell's status page shows a **3-hour
full outage on 2026-09-05** (six days before this research), the most recent
and largest incident found for either vendor this pass. Neither vendor
offers real portability (no cross-vendor export format on either side) —
ElevenLabs' CLI is a better **git/CI workflow** for their own proprietary
schema, not an exit ramp. Community signal is genuinely mixed on both and
should be read as directional, not decisive.

---

## 1. Template enumeration

### 1.1 ElevenLabs Agent Templates gallery (`elevenlabs.io/agent-templates`)

Fetched live 2026-09-11. The gallery currently shows **9 templates**; the
[launch blog post](https://elevenlabs.io/blog/introducing-agent-templates)
(`elevenlabs.io/blog/introducing-agent-templates`) describes a broader set
at launch across 4 categories (Customer Support, Education, Go-to-Market,
Receptionists) including an E-commerce assistant, New Hire Onboarding bot,
Outbound Sales Rep, and Survey Intake agent that are **not** on the gallery
as fetched today — the live catalog appears to have been pruned or
reorganized since launch; treat the blog's fuller list as historical, the
gallery below as current.

| Template | Category | What it does (per gallery) | Tools/integrations shown | Disclosure/consent, triage, read-backs, tests | Verdict vs. our templates |
|---|---|---|---|---|---|
| Customer Support Representative | Customer Support | "Field support inquiries" | Not shown on card (templates are prompt+tool starting points editable after selection — server tools repointable to any webhook per prior research) | None visible pre-selection | Irrelevant to our verticals (no phone-booking use case) |
| Language Practice Tutor | Education | Adaptive language learning, corrects, teaches vocabulary | None shown | None | Irrelevant |
| **Front Desk Receptionist** | Receptionist | "General front desk receptionist to handle department transfers and inquiries" | None shown pre-selection | No AI/recording disclosure line documented on the card; no triage structure | **Seeds** tone/phrasing only — closest to our `generic.ts`, none of its call-taxonomy discipline |
| Inbound Lead Qualifier | Sales | Qualifies inbound leads, assesses budget/timeline, routes to sales rep | None shown | None | Partial overlap with `real-estate.ts` qualification flow; no injection-resistance or over-interrogation guardrails documented |
| **Hotel Reservation Agent** | Receptionist | Books hotel reservations, checks availability, handles modifications/cancellations | None shown | None documented | **Seeds** — direct overlap with `motel.ts`, but no equivalent to our "rate only from the owner-configured rate table via tool call" hard constraint (SYSTEM_DESIGN §4.3) — nothing stops the model from inventing a rate |
| Renewal & Expansion Agent | Customer Support | Outbound; drives renewals, spots expansion opportunities | None shown | Outbound — no visible consent-capture requirement on the template itself (our `CreateOutboundCallInput.consentRef` is an application-layer control regardless of vendor) | Irrelevant to our verticals |
| **Hospitality Concierge** | Receptionist | "Hotel front desk concierge to handle inquiries and issues" | None shown | None documented | **Seeds** tone for `motel.ts`-adjacent guest-facing warmth, nothing structural |
| Appointment Setter | Sales | Books demos/meetings, checks calendar, confirms | None shown | None | Generic scheduling pattern, weaker than our vertical-specific slot-filling (auto-repair/dental/vet) |
| **Healthcare Receptionist** | Receptionist | "Medical facility front desk reception to collect info and schedule" | None shown | **No HIPAA-specific structural guardrail found** (no DOB/insurance-deferred-to-secure-link pattern analogous to our `dental.ts` `PHI_DEFERRAL_FRAGMENT`) | **Seeds** the use case only; per §1.1 of the prior research doc, using this template for real PHI still requires ElevenLabs **Enterprise + Zero Retention Mode** regardless of the template itself — confirmed again this pass via `elevenlabs.io/docs/eleven-agents/legal/hipaa` ("Execution of a BAA is only available for Enterprise tier... Zero Retention Mode engaged") |

No template card, in the gallery as fetched, surfaces tool lists,
disclosure/consent copy, triage logic, read-back behavior, or test cases —
those only become visible after importing the template into a workspace
(behind auth, not fetchable this session). This means the gallery is a
**marketing/discovery surface**, not a spec; our verdict is based on the
category-level description plus the general template mechanism (editable
prompt + tools, confirmed in the prior research pass).

### 1.2 Retell AI templates

Retell has **no public template gallery URL** comparable to ElevenLabs' —
templates are selected inside the authenticated dashboard when creating a
new agent ("build from scratch, pick a ready-made template, or use
Generate-from-prompt / Conductor"). As of this research:

- The community roadmap thread
  ([`community.retellai.com/t/revamped-retell-template-library/1057`](https://community.retellai.com/t/revamped-retell-template-library/1057))
  shows the "Redesign official agent templates and build a template library
  or marketplace" request opened **2026-03-12** and marked **"done"** on
  Retell's roadmap, with a Retell staff reply (Evie, 2026-06-11) saying the
  team is "open to" the community's further ask of allowing template
  *selling*/commissions in a marketplace — i.e., a basic template library
  shipped by mid-2026, but a creator marketplace has not.
- Search results (not independently verified against an authenticated
  dashboard this session) describe templates keyed to call model —
  "receptionist, support, sales qualifier, or scheduler" — plus
  industry-flavored starters for "plumbers, dentists, law firms,
  restaurants, auto shops, and real estate" referenced in third-party 2026
  coverage; **this is UNVERIFIED** (could not confirm firsthand without an
  authenticated account, and third-party SEO content in this space is
  frequently generated/imprecise — flagged accordingly).
- What IS verified from official docs (`docs.retellai.com/llms-full.txt`,
  fetched this session): Retell ships a **Conductor** AI copilot (launched
  2026-07-02, see §2.1) that *generates* an agent from a plain-English
  description and validates every proposed change via simulation before
  it reaches production — functionally a template-generator rather than a
  fixed gallery, a materially different mechanism than ElevenLabs' static
  cards.
- A third-party, non-official GitHub repo
  (`AmplifyAutomation/retell-prompt-library`) exists with generic outbound
  sales prompts — explicitly **not** vendor-maintained, not a first-party
  offering.

**Overall verdict, both vendors:** Neither is a drop-in replacement for
`packages/templates/src/verticals/*`. Specifically absent from both, per
everything found this pass (consistent with the prior research doc's §3
verdict, now re-confirmed with live 2026-09 data):

- the compiled-in, non-removable AI+recording disclosure gate (our G1/G2,
  `disclosureVerified` on `CompiledAgentArtifact`) — no template card or
  changelog entry on either platform documents an equivalent hard gate;
- vertical structural guarantees — vet's global emergency red-flag node,
  legal's conflict-check-before-substantive-discussion + hard no-advice
  gate, dental's PHI-out-of-transcript deferral;
- the 12-class call taxonomy and give-up-ladder/read-back discipline
  (SYSTEM_DESIGN §4.2–4.5);
- red-team/injection-resistance validation (`packages/templates/src/
  red-team/`).

Retell's **Conductor** (AI-generates-and-simulates agents) and ElevenLabs'
**Procedures** (task-specific instruction sets loaded contextually, GA
2026-08-24) are the two most template-adjacent 2026 features on either
platform, but both are *authoring aids*, not pre-built vertical products —
worth tracking for whether either could *generate* a first draft of a
Heyloo-style compiled state graph faster than we hand-author one, not for
replacing the finished template set.

---

## 2. Platform direction (last 12 months: Sept 2025 – Sept 2026)

### 2.1 Retell — changelog synthesis (official `retellai.com/changelog`, fetched 2026-09-11)

Retell shipped on a roughly monthly cadence. Selected entries most relevant
to our architecture:

- **2025-09-22:** Node-level Knowledge Base assignment; role-based user
  manager (Admin/Developer/Member); reCAPTCHA on public keys/widgets
  (toll-fraud/spam protection); outbound SMS via API; IVR/DTMF navigation
  (Press Digit node); batch-call time windows.
- **2025-11-24:** Conversation Flow **Components** (reusable sub-flows,
  update-once-syncs-everywhere — directly relevant to our shared
  `fragments.ts`/`utility-states.ts` pattern, since Retell now offers a
  native analog); **warm-transfer caller-ID control**, explicitly called out
  by Retell as "critical for... HIPAA compliance"; Claude 4.5 Sonnet
  support; simulation test-case management improvements.
- **2025-12-17 / 2025-12-22:** **Retell Assure** launched — Retell's own
  press release calls it "First Automated QA Solution" for voice AI,
  monitoring 100% of calls and auto-tweaking models; **Flex Mode**
  (flexible node navigation for multi-topic conversations); **AI-Assisted
  Warm Transfer** (live handoff assistant with info-exchange before
  bridging, transfer-rejection capability); country-level call blocking;
  per-call agent override; MiniMax provider (40 languages, voice cloning).
- **2026-01-22:** **AI QA Analyst** (this appears to be the changelog-page
  framing of the same Assure capability — 24/7 automatic call review,
  hallucination-rate measurement, resolution-rate tracking); alerting on
  cost spikes/success-rate drops/sentiment; conversation-flow node
  search; **Concurrency Burst** pricing ($0.10/min) — first Retell
  overage/burst line-item found this pass; **Billing Transparency**
  changes (2026-02-10): TTS and voice-engine costs separated into distinct
  line items, concurrency billed upfront and prorated by day.
- **2026-02-10:** Safety guardrails (jailbreak/instruction-bypass
  blocking); **global node return paths** (caller resumes mid-booking after
  a global-intent detour — directly analogous to our `global_intents[]`
  design goal); webhook/function test tools with real-payload testing;
  "Always Edges" (guaranteed node transitions); audio-transcription
  auto-failover (Deepgram↔Azure).
- **2026-03-19:** ChatGPT App integration (build/deploy/test agents from
  inside ChatGPT); dynamic voice speed mirroring caller pace; **A/B
  testing** (split traffic by percentage across agents/prompts/voices);
  ElevenLabs-voice v3 import support (i.e., Retell can use ElevenLabs
  voices as a TTS backend, consistent with prior research); per-agent data
  retention periods; PCAP downloads for call debugging.
- **2026-05-27:** **Agent Versioning 2.0** — multiple parallel drafts,
  version history/diffing, merge-between-versions, staging/production
  environment tags, one-click promotion; granular multilingual
  (hand-picked languages + auto-detection per call); iOS/Android
  call-screening auto-handling; custom voicemail handling (hang up or
  leave a personalized message); shareable "Voice Orb" test links.
- **2026-06-19 ("2026 Launch Week," five releases in five days):**
  **built-in CRM** (two-way real-time sync to Salesforce/HubSpot, contacts
  auto-created/updated keyed to phone number, post-call analysis becomes
  contact attributes — this is the single biggest 2026 Retell feature most
  relevant to a future outreach/CRM integration decision for Heyloo);
  **Live Call Monitoring** (real-time transcript + sentiment/latency/
  interruption scoring, auto-actions on issues, listen/whisper/takeover);
  custom multi-team dashboards; a "Colloquial Model" that rewrites agent
  phrasing in real time (~50ms) for natural cadence/fillers; "Expressive
  Mode" (automatic + manual emotion tagging).
- **2026-07-02:** **Conductor** — AI copilot that drafts and maintains
  agents, simulates every proposed change (no real dialing) before it
  reaches production, and proposes fixes from failed-call patterns.
- **2026-08-24:** **Retell Workflows** (native cross-tool orchestration —
  distinct from "Conversation Flow," this is business-process
  orchestration, not the conversation-graph compile target); an
  integration library (Slack, Google Drive, Salesforce, directly in
  dashboard); a "tool store"; GPT-5.6 and GPT Realtime 2.1 support; Spanish
  transcription via Soniox.

**Reading on direction:** Retell is pushing hard into **enterprise
call-center replacement** — QA automation (Assure), live monitoring/
takeover, CRM sync, multi-team dashboards, orchestration/integration
library — a materially different center of gravity than a pure
voice-agent-API vendor. This is good news for a company at Heyloo's stage
riding on Retell (feature velocity, an AI-authored/AI-QA'd agent lifecycle
that could eventually reduce our own manual template-authoring burden) but
is also a signal Retell's own roadmap is drifting toward selling directly
to enterprise call centers — a different buyer than Heyloo's SMB/vertical
tenants, worth watching for pricing/support-tier consequences.

### 2.2 ElevenLabs — changelog + blog synthesis

Sources: `elevenlabs.io/docs/changelog/2026/*` (fetched via search
snippets, not full pages, for March/April/June/August entries),
`elevenlabs.io/blog/introducing-agent-workflows`,
`elevenlabs.io/blog/procedures`, `elevenlabs.io/blog/elevenlabs-cli-v1`,
`elevenlabs.io/blog/introducing-agent-templates`,
`elevenlabs.io/blog/introducing-11ai`, `elevenlabs.io/blog/series-d`.

- **2025 (per prior research, re-cited for continuity):** Agent Workflows
  (visual node graph: Subagent nodes with phase-override, Agent Transfer,
  Transfer-to-Number, End Call, conditional edges) and agent Versioning
  (per-user drafts, explicit publish gate) both shipped in 2026 per the
  earlier research pass — this pass did not find evidence either predates
  2026.
- **2026-03-02:** **Workflow "say" node** — literal or LLM-generated
  message payloads inside a workflow (structural building block, not a
  new capability class).
- **2026-04-01/04-07/04-27:** **MCP tool scoping** in workflows (restrict
  which MCP tools a sub-agent may call — a real security/governance
  primitive, relevant if we ever let a tenant's agent reach an MCP tool
  surface); conversation file uploads (end users attaching images/PDFs in
  chat, not voice-relevant to Heyloo).
- **2026-05-07:** Pricing cut (see §2.3).
- **2026-06-15/06-29:** Tool-response filtering (trim tool responses
  before they reach the LLM — a latency/cost optimization we already do
  implicitly by keeping our `/voice/tools` responses lean per SYSTEM_DESIGN
  §5); **workflow phone transfers** gained optional SIP REFER
  User-to-User Information — a telephony-signaling-layer improvement for
  warm transfers.
- **2026-07-27, 2026-08-17:** (found via search index only, page content
  not independently fetched this pass — flag for follow-up if this
  timeframe becomes decision-relevant.)
- **2026-08-24:** **Procedures reach GA** (see §1.2) — task-specific
  instruction sets with a trigger, usable alongside Workflows on the same
  agent; free-form vs. structured procedure types.
- **2026-08-24 (same date, CLI v1):** **`@elevenlabs/cli` v1.0.0** —
  every API operation as a subcommand (JSON/table/YAML/CSV output,
  pagination, shell completion); `elevenlabs agents pull` materializes
  every workspace agent as a local config file, `elevenlabs agents push
  [--dry-run]` applies local changes back; branch management; local test
  running; install of ElevenLabs UI components; data-residency-region
  selection. Framed by ElevenLabs as "agents as code" — version-controlled
  configs, CI/CD-deployable, coding-agent-manageable.
- **2026-08-31:** Further changelog entry found in search index, not
  independently fetched this pass.
- **11.ai** (2025-06 alpha launch, per prior research and reconfirmed this
  pass): a voice-first personal-assistant experiment with MCP support
  (Notion, Perplexity, Linear, Salesforce, Slack). Its standalone product
  identity has since folded into the broader ElevenAgents platform — **no
  longer offered as a separate product** as of this research. Relevant only
  as a signal of ElevenLabs' MCP-first ecosystem bet, not a competing
  product to Heyloo.
- **HIPAA** (re-confirmed against current docs, unchanged from prior
  research): `elevenlabs.io/docs/eleven-agents/legal/hipaa` still states
  BAA execution is **Enterprise-tier only**, requiring **Zero Retention
  Mode**. No change found this pass — the decisive HIPAA-economics gap
  identified in the earlier research stands as of 2026-09-11.
- **Funding (re-verified, more current than prior pass):** Series D closed
  **2026-02-04**, $500M led by Sequoia (Andrew Reed joins the board), a16z
  and ICONIQ both increased their stakes with "significant super
  pro-rata," new investors Lightspeed/Evantic/BOND — $11B valuation, more
  than tripling the prior year's mark, **$781M total raised across five
  rounds** since 2022 founding. Sacra estimates ElevenLabs hit **$600M
  ARR in June 2026**, up from $330M at end-2025 — i.e., roughly 82%
  H1-2026 growth on top of an already-large base. 41% of Fortune 500 use
  the platform (unclear which product line — likely TTS/dubbing-weighted,
  not Agents-specific; flag as unverified for the Agents product
  specifically).

**Reading on direction:** ElevenLabs' 2026 Agents investment reads as
**developer-workflow-first** (CLI v1 "agents as code," MCP tool scoping,
Procedures as a modular instruction system) rather than Retell's
**operations-first** push (live monitoring, CRM sync, QA automation). Both
are converging on richer orchestration (Workflows vs. Conversation
Flow/Retell Workflows) from different starting philosophies. ElevenLabs'
capital position ($781M raised, $11B valuation, ~$600M ARR) is an order of
magnitude larger than Retell's (~$5.1M raised, ~$60M ARR as of April 2026,
triple YoY) — durability risk sits more with Retell if growth stalls, but
Retell's HIPAA/BAA economics remain the deciding factor for our dental
vertical regardless of either company's balance sheet (§2.3 and prior
research §5 both hold).

### 2.3 Pricing changes, last 12 months

**ElevenLabs — a real cut, not just repricing noise:**
2026-05-07, ElevenLabs cut Agents/API pricing by up to 20% (per
`usagepricing.com`'s tracked pricing-change entry, cross-referenced against
multiple 2026 pricing breakdowns). The flat Agents per-minute rate the
prior research pass verified at $0.08/min appears to be the **post-cut**
number — third-party sources describe the pre-cut Starter-tier example
rate as $0.10/min, consistent with "reduced by up to 20%." Subscription
tiers were also reshuffled: Starter rose $5→$6/mo (small increase),
**Scale fell $330→$299/mo**, **Business fell $1,320→$990/mo** (both
meaningful base-fee cuts, aligning with the same-page math the prior
research already verified). **Net effect for Heyloo's cost model: this
pricing cut, if it had been in place at the time of the original research
pass, only reinforces that pass's finding that the "ElevenLabs 8¢ vs.
Retell 7–14¢" headline comparison undersells Retell's competitiveness** —
i.e., ElevenLabs got *more* competitive on pure per-minute rate in 2026,
not less, and the prior conclusion (stay on Retell for HIPAA reasons, not
price) is unaffected because it was already modeled off the current $0.08
rate.

**Retell — flat headline rate, new billing-transparency and burst lines:**
No evidence found this pass of a Retell base-rate increase in the last 12
months. What changed is billing **granularity**, not the number:
2026-01-22 added a **Concurrency Burst** line at $0.10/min (a new paid
option, not a price hike on existing service), and 2026-02-10 **separated
TTS and voice-engine costs into distinct line items** plus moved
concurrency to upfront/prorated billing — this is the kind of change that
could shift where our "AI Quality Assurance" ambiguity (flagged
unresolved in the prior research doc §1.1) lands, since Retell Assure
(launched 2025-12, expanded through Retell Workflows Aug 2026) is exactly
the kind of new premium line that could explain that pricing-page item.
**This strengthens, not resolves, the prior research's call to verify the
AI-QA line item's applicability to our baseline `call_analysis` fields
before contracting** (`docs/VERIFY.md`).

### 2.4 Reliability / incident history

**Retell** (`status.retellai.com`, fetched live 2026-09-11):
- **2026-09-05, ~3 hours (4:10 PM–5:19 PM PDT):** "Web Calls and Phone
  Calls Disruption" — web and outbound calls failed entirely, inbound
  calls had connection delays; a postmortem was published. This is the
  most severe, most recent incident found for either vendor this pass and
  happened **six days before this research was run** — i.e., current, not
  historical. The status page's own "100% uptime over the past 90 days"
  banner is stale/self-contradictory as displayed (the 90-day window as
  fetched should include Sept 5) — treat the uptime banner as marketing
  copy, not a verified SLA number.
- Cross-referenced against the prior research pass's finding (a 70-min
  TTS-provider outage in July 2026, a 95-min partial inbound-call outage
  in June 2026, a 50-min batch-call failure in July 2026) — combined with
  this pass's Sept 5 finding, Retell shows **at least 4 distinct incidents
  of 50+ minutes across roughly Jun–Sep 2026**, i.e., closer to
  monthly-or-more-frequent meaningful disruptions than the "all resolved
  same-day" framing alone conveys. Third-party StatusGator aggregation
  (not independently verified, UNVERIFIED) claims "more than 48 outages"
  over ~1 year of monitoring across Retell's Website/API/Web-Call/
  Dashboard components combined — that figure almost certainly includes
  many minor/user-reported blips alongside the confirmed incidents above
  and should not be read as 48 events of Sept-5 severity.

**ElevenLabs** (`status.elevenlabs.io`, fetched live 2026-09-11 — page
showed "fully operational," full incident history required a deeper
"View history" click not accessible this session; cross-referenced via
search):
- **2026-08-24:** "Media not loading across several products" — Studio,
  Audiobooks, Image & Video, Music, Dubbing. **Agents not listed among
  affected components** in the snippet found.
- **2026-08-03, 06:39–07:13 UTC (~34 min):** upstream cloud-provider
  network issue causing elevated error rates/timeouts on **TTS and STT**
  requests — this would affect the Agents voice pipeline as a dependency,
  though the incident was filed under API/TTS/STT, not Agents directly.
- **2026-06-25:** "Agent Tool Creation and Update Does Not Save" —
  **directly an Agents-product incident** (tool config edits failing to
  persist), resolved same day.
- **2026-02-25:** partial outage affecting **ElevenAgents and
  ElevenCreative** components.
- No Agents-specific incident this pass reached the severity/duration of
  Retell's 2026-09-05 event. ElevenLabs' own marketing claims "99.999%
  effective uptime" (per a third-party aggregator summarizing the status
  page, UNVERIFIED as an independently-audited SLA figure) with incidents
  "typically resolved within 162 minutes" — no first-party SLA/uptime
  commitment page was independently opened this pass; flag for
  verification if uptime becomes a contract term.

**Reading:** Both vendors have a real, non-zero 2026 incident record;
neither publishes an audited historical uptime percentage this pass could
independently confirm. Retell's most recent incident (Sept 5) is larger
and more recent than anything found for ElevenLabs Agents specifically.
This is a data point in favor of the prior research's recommendation to
keep `VoiceProvider` as an active abstraction and to treat "Retell-specific
reliability trigger" as one of the named conditions for revisiting
dual-provider — the Sept 5 outage is exactly the kind of event that
counts, though a single 3-hour incident with a published postmortem is not
by itself a pattern requiring action.

### 2.5 Lock-in / portability — export formats, SIP

- **Neither platform offers a cross-vendor export format.** No evidence
  found on either side of an "export your agent as a portable spec" or
  standard-schema output — both platforms' agent configs are proprietary
  JSON tied to their own conversation-engine semantics (Retell's
  response-engine/Conversation-Flow node graph vs. ElevenLabs'
  `conversation_config`/Workflow JSON). This reconfirms the prior
  research's Rule-2-driven architecture: Heyloo's own canonical
  `AgentTemplate`/`states[]`/`transitions[]`/`global_intents[]` schema,
  compiled per-provider by our adapters, remains the only real portability
  layer — neither vendor is going to hand us one.
- **ElevenLabs' CLI v1 (`@elevenlabs/cli`, GA 2026-08-24) is a genuine
  DevOps/git-workflow upgrade, not a portability upgrade** — `pull`/`push`
  let a team keep ElevenLabs agent configs in version control and
  CI/CD-deploy them, materially better tooling than anything found for
  Retell this pass (no Retell CLI, Terraform provider, or "config as code"
  tool was found in this research — Retell's automation story runs through
  its REST API/SDKs and the new Conductor copilot, not a local-file
  git-managed workflow). If Heyloo ever needed to snapshot/diff/audit
  provider-side agent config outside our own DB, ElevenLabs currently has
  the better native tooling for that — worth noting as a soft point in
  ElevenLabs' favor even though it doesn't change the HIPAA-driven primary
  recommendation.
- **SIP/telephony portability is at parity and already a non-issue for
  Heyloo specifically:** both vendors support BYO SIP trunking at no
  markup (re-confirmed: `elevenlabs.io/docs/eleven-agents/phone-numbers/
  sip-trunking`, `elevenlabs.io/docs/agents-platform/phone-numbers/
  telephony/{telnyx,plivo}` for named-carrier quickstarts; Retell's "no
  charge for custom telephony" from the prior pass, unchanged). Because
  Heyloo already owns every number in Twilio (SYSTEM_DESIGN §2 diagram:
  "WE own ALL numbers in Twilio... provider switch is same-day config"),
  neither vendor's SIP story is a differentiator for us — the architecture
  decision to own numbers ourselves is what actually buys the portability,
  independent of either vendor's SIP feature depth.

---

## 3. Community signal — UNVERIFIED, directional only

Sourced from G2/Trustpilot/Capterra summary snippets and third-party 2026
review-aggregator blog posts (HappyRobot, Cekura, eesel, Coval, Ringg,
Thoughtly, aiprotivity — all vendor-adjacent content marketers, not
independent research firms; treat every number below as **UNVERIFIED**,
useful only as a directional signal, never as a cited fact in a pricing or
contract decision).

**Retell — what agencies/resellers report:**
- G2: reported **4.8/5 across 2,200+ reviews** (UNVERIFIED aggregate,
  source did not independently confirm review-count methodology).
- Recurring complaints (UNVERIFIED, aggregated across multiple review
  sites): **support is "non-existent" beyond a community Discord
  channel**; **"frequent breaking changes to the API"**; **billing
  transparency and refund-process complaints** (independently plausible
  given the Feb 2026 "Billing Transparency" changelog entry existing to
  address exactly this category); **agent management across multiple
  clients/accounts is "cumbersome"** — explicitly called out as an
  agency/multi-brand pain point, directly relevant to Heyloo's own
  agent-per-tenant-at-scale model (our own multi-tenant dashboard is
  presumably solving this problem for our tenants the way Retell's own
  dashboard apparently doesn't solve it for us as the operator — worth a
  gut-check against our admin cockpit design in SYSTEM_DESIGN §11 once
  we're at meaningful agent count).
- G2-specific complaint tally (UNVERIFIED, single source): "limited voice
  options for international support" (67 mentions), "steep learning
  curve" (46), "pricing complexity/cost for small teams" (41), "German
  voice quality" (37).
- **No native white-label/reseller platform.** Confirmed from
  `retellai.com/partners` and third-party wrapper vendors (VoiceAIWrapper,
  Vapify, Call Supplai, UponAI) that exist specifically to fill this gap —
  third-party white-label wrappers run **$29–$499/mo** on top of Retell's
  own usage costs, per one 2026 comparison piece (UNVERIFIED pricing).
  Retell staff (Evie, community post 2026-06-11) confirmed they're
  merely "open to" a creator-marketplace/commission model, not shipping
  one. **Not relevant to Heyloo's own business model** (we're a
  vertical-SaaS operator on top of Retell, not a Retell reseller), but
  relevant context for how mature Retell's own multi-tenant tooling is —
  or isn't.

**ElevenLabs — what agencies/resellers report:**
- Recurring complaint (UNVERIFIED, cited as "the single most repeated
  complaint" by one aggregator): **credits/balance "vanish on downgrade
  or cancellation"** — a billing-model gripe, not a reliability one.
- "Pricing unpredictability" and a documented gap between G2 ratings
  (higher) and Trustpilot ratings (lower), attributed by the source to
  billing complaints specifically, "not product failures."
- Day-to-day **product reliability described as good** by the same
  sources reporting the billing complaints — i.e., the complaint pattern
  is distinctly billing-shaped, not uptime-shaped, which is broadly
  consistent with §2.4's incident findings (no Agents-specific incident
  found this pass at Retell's Sept-5 severity).
- No agency/reseller-specific complaint pattern comparable to Retell's
  "multi-client management is cumbersome" was found for ElevenLabs this
  pass — plausibly because ElevenLabs' Agents product skews toward
  single-tenant enterprise/internal-tools buyers rather than agencies
  reselling voice AI as a service, a different go-to-market than Retell's
  visible agency ecosystem.

**Overall community read:** both platforms draw the same class of
complaint — **billing/transparency friction**, not raw
reliability/quality failure — which is a reasonably reassuring signal for
either as a dependency, but underscores that **whichever we use, our own
usage-ledger-as-source-of-truth decision (SYSTEM_DESIGN §3, "own usage
ledger as source of truth" under Payments) is the correct hedge against
exactly this category of vendor-side billing ambiguity**, independent of
which voice vendor we're on.

---

## Sources

Official/first-party (used for load-bearing claims):
- [ElevenLabs — Agent Templates gallery](https://elevenlabs.io/agent-templates) (fetched 2026-09-11)
- [ElevenLabs — Introducing Agent Templates (blog)](https://elevenlabs.io/blog/introducing-agent-templates)
- [ElevenLabs — HIPAA docs](https://elevenlabs.io/docs/eleven-agents/legal/hipaa) (re-fetched, unchanged from prior research)
- [ElevenLabs — Introducing Agent Workflows (blog)](https://elevenlabs.io/blog/introducing-agent-workflows)
- [ElevenLabs — Introducing Procedures (blog)](https://elevenlabs.io/blog/procedures)
- [ElevenLabs — CLI v1 (blog)](https://elevenlabs.io/blog/elevenlabs-cli-v1)
- [ElevenLabs — CLI docs](https://elevenlabs.io/docs/eleven-agents/operate/cli)
- [ElevenLabs — Introducing 11ai (blog)](https://elevenlabs.io/blog/introducing-11ai)
- [ElevenLabs — Series D announcement (blog)](https://elevenlabs.io/blog/series-d)
- [ElevenLabs — SIP trunking docs](https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking)
- [ElevenLabs — Telnyx SIP telephony docs](https://elevenlabs.io/docs/agents-platform/phone-numbers/telephony/telnyx)
- [ElevenLabs — Plivo SIP telephony docs](https://elevenlabs.io/docs/agents-platform/phone-numbers/telephony/plivo)
- [ElevenLabs status page](https://status.elevenlabs.io/) (fetched live 2026-09-11)
- [Retell AI — Platform changelog](https://www.retellai.com/changelog) (fetched live 2026-09-11)
- [Retell AI status page](https://status.retellai.com/) (fetched live 2026-09-11)
- [Retell AI — llms-full.txt documentation dump](https://docs.retellai.com/llms-full.txt) (fetched live 2026-09-11)
- [Retell AI — Revamped Template Library roadmap thread](https://community.retellai.com/t/revamped-retell-template-library/1057)
- [Retell AI — partners directory](https://www.retellai.com/partners)
- [Retell AI QA/Assure press release (GlobeNewswire, 2025-12-17)](https://www.globenewswire.com/news-release/2025/12/17/3207048/0/en/Retell-AI-Fastest-Growing-AI-Voice-Agent-Platform-Launches-First-Automated-QA-Solution-to-Accelerate-Enterprise-Adoption-of-Voice-AI.html)
- [Retell AI $40M ARR press release (GlobeNewswire, 2026-01-29)](https://www.globenewswire.com/news-release/2026/01/29/3228780/0/en/Upgraded-Retell-AI-Voice-Platform-Enables-Corporate-Call-Centers-to-Deploy-Infinite-AI-Sales-and-Support-Agents-Across-Voice-Chat-Email-and-SMS-Company-Revenue-Now-Exceeds-40M-ARR.html)
- [TechCrunch — ElevenLabs raises $500M from Sequoia at $11B valuation](https://techcrunch.com/2026/02/04/elevenlabs-raises-500m-from-sequioia-at-a-11-billion-valuation/)
- [Sacra — ElevenLabs revenue, valuation & funding](https://sacra.com/c/elevenlabs/)
- [Sacra — Retell AI at $60M/yr, up 650% YoY](https://sacra.com/research/retell-ai-60m-yr-up-650-yoy/)
- [ARR Club — Retell scales to $50M+ ARR with a team of 30](https://www.arr.club/retell/retell-scales-to-50m-arr-with-a-team-of-30-people)

Third-party 2026 coverage, explicitly UNVERIFIED where relied on (§1.2's
Retell template-content claims, §3 in full, StatusGator's aggregate
outage-count, ElevenLabs' "99.999% uptime"/"162-minute" figures, G2
mention-count tallies):
- [community.retellai.com roadmap thread](https://community.retellai.com/t/revamped-retell-template-library/1057) (staff reply is first-party; community requests are not)
- [Trillet — Retell AI White Label Alternative for Agencies](https://trillet.ai/blogs/retell-ai-white-label-alternative)
- [VoiceAIWrapper — Retell AI white label](https://voiceaiwrapper.com/uses/retell-ai-white-label)
- [StatusGator — Retell AI status aggregation](https://statusgator.com/services/retell-ai)
- [Bifrost — Is ElevenLabs Down (status aggregation)](https://www.getmaxim.ai/bifrost/provider-status/elevenlabs)
- [Cekura — ElevenLabs Review 2026](https://www.cekura.ai/blogs/elevenlabs-review)
- [Cekura — Retell AI Review 2026](https://www.cekura.ai/blogs/retell-ai-review) *(inferred from search snippet, not independently opened)*
- [eesel — Retell AI review 2026](https://www.eesel.ai/blog/retell-ai-reviews)
- [Ringg — Retell AI Reviews 2026](https://www.ringg.ai/blog/retell-ai-reviews-pricing-features-analysis)
- [UsagePricing — ElevenLabs 2026-05-07 price change entry](https://www.usagepricing.com/blueprint/activity/elevenlabs-2026-05-07-price-change)
