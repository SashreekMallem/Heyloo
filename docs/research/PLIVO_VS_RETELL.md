# Plivo vs Retell — voice platform comparison (parked decision)

Date: 2026-09-29. Status: **parked** — owner wants to revisit. Decision so far: launch on Retell; revisit Plivo once the open questions below are answered by Plivo sales or a hands-on test.

Sources are listed at the end. Anything marked UNCONFIRMED was not stated on an official page.

## 1. What Plivo offers

Plivo is mainly a telephony company (numbers, calls, SIP trunking, audio streaming, messaging) that now also sells AI voice agents three ways:

1. **AI Agent Studio (no-code voice agent)** — Plivo hosts the whole agent (speech-to-text, AI, voice, orchestration). Agents are node graphs ("flows").
   It is **programmable**: the Agents API (`https://api.plivo.com/v1/Account/{auth_id}/AgentFlow/`) supports create, update, publish, pause, resume, delete, and run history with logs. Documented in Plivo's official CLI repo (`docs/COMMANDS.md`, `agents-skill/SKILL.md`, CLI v1.1.0, 2026-09-18), **not** in the main docs site index (`/docs/llms.txt`). Sub-account credentials are not supported for this API (master account only).
2. **Programmable AI agents** — Plivo carries the call and streams audio over WebSocket; we build the agent with LiveKit or Pipecat and our own STT/LLM/TTS.
3. **SIP trunking (Zentrunk) for other AI platforms** — Plivo as the phone line under Retell, Vapi, ElevenLabs, LiveKit or xAI (`/docs/voice-agents/sip-trunking/overview`).

## 2. Agent Studio node schemas (fetched by the owner from the live Agents API, schema_version 1.0.0+ef661840c7df)

- **`agent_node`** ("AI Agent (voice, task-based)", Plivo's recommended voice node): `instructions`, `instruction_attachments` (files), `intents` (name, instructions, optional speech), `first_response`, `allow_greeting_interruption`, `initial_wait_time`, `agent_tasks.variables` (typed slots: text, name, email, phone, choice, date, currency, boolean, address, number, dob, dtmf; `optional`, `confirm_if_known`, `known_value`), `agent_tasks.extract_only`, `confirm_announcement`, `max_restarts`, and `actions` of type `HTTP` (tool name, description, method, url, headers, body template, `http_function_schema`, `http_timeout_ms`, `http_retry_limit`, auth via `{{secrets.NAME}}`), `CUSTOM_CODE`, or `EXECUTE_ACTION`.
  **No voice, language or LLM-model field** in the schema.
- **`start`**: triggers `call`, `message`, `http` (API-triggered, with `payload_format`), `outbound_call`, `destination`, `transfer_conversation`, `call_hangup`, and others. `events.hangup` = webhook URL on hang-up. `record_start` / `record_stop` = spoken recording notices. `call_hangup_flow` references a "PHLO flow", so agent flows are PHLOs.
- **`ai_agent_call`** (older voice node): instructions, completion criteria, human-handoff and no-response instructions and timeout, intents, actions (EXECUTE_ACTION, EXTRACT_VARIABLES, CUSTOM_CODE). Outcomes: conversation_complete, human_handoff (labelled "No Response"), inequipped_to_serve, error.
- **`call_forward`**: forwards to numbers or SIP endpoints. Outcomes: completed, no_answer, busy_rejected, failed.
- **`http_request`**: calls an external API; response fields are usable later in the flow as node variables.
- Variable templating: `{{Start.message.from}}`, `{{Start.call.header1}}`, `{{Start.outbound_call.to}}`. Per Plivo, the full list of trigger fields is not published.
- **Number assignment**: `POST /v1/Account/{auth_id}/Number/{number}/` accepts `app_id` ("Application to assign (or Zentrunk inbound trunk_id)"). There is no documented agent-flow or PHLO assignment, so attaching a number to an agent through the API is UNCONFIRMED.

## 3. What Heyloo uses Retell for, and Plivo Agent Studio support

Key: ✅ yes · ⚠️ possible, done differently · ❓ not documented · ❌ no

| Heyloo today (Retell) | Plivo Agent Studio |
|---|---|
| Hosted STT + LLM + TTS | ✅ |
| Create, update, publish and delete an agent per tenant via API | ✅ Agents API |
| Compiler: conversation-flow, multi-prompt and single-prompt for 8 verticals, global intents | ⚠️ different graph format; compiler rewrite |
| Verbatim, non-interruptible disclosure opening | ✅ `first_response` + `allow_greeting_interruption=false` (verbatim delivery to confirm on a live call) |
| Mid-call tools to `/voice-tools` (availability, booking, lookup, message) | ✅ HTTP actions with function schema, timeout and retries |
| Filler speech during tool execution | ❓ |
| Intake and custom questions | ✅ typed task variables |
| **Dynamic context injection** (~35 per-call variables via the pre-answer `call_inbound` webhook) | ⚠️ no pre-answer hook. Per-business values go into each tenant's flow at publish (republish on settings change). Per-call values come from an HTTP step at call start plus `{{var}}` / `known_value`. Templating inside `instructions` is UNCONFIRMED, and the step adds latency before the greeting unless the agent greets first. |
| Warm transfer with fallback to take-message | ✅ `call_forward` outcomes |
| Outbound calls with variables (lead callback) | ✅ `outbound_call` / `http` trigger |
| Voicemail detection | ✅ (Voice API machine detection) |
| Recording with notice | ✅ (stereo ❓) |
| Transcript | ❓ |
| Post-call summary, sentiment, success, 12-way classification | ⚠️ in-call extraction ✅; summary and classification ❓ (we could run Gemini on the transcript if we get it) |
| Call-ended webhook | ✅ `events.hangup` (payload ❓) |
| Minutes and hang-up reasons for billing | ⚠️ from Plivo CDRs, different enum |
| Itemized per-call cost | ❓ (telephony part via CDR) |
| Spanish (es-419) | ❓ no language field |
| Voice and model choice | ❓ no field |
| Browser web calls (home demo, scrape demo, portal test call, widget, E2E) | ❓ likely missing: no web-voice trigger |
| Batch or simulation tests via API | ⚠️ runs API ✅; simulation API ❓ |
| Buy and release numbers | ✅ |
| Attach a number to a tenant's agent via API | ❓ number API takes `app_id` / trunk only |
| Webhook authenticity | ⚠️ shared secret header via `{{secrets.NAME}}` instead of HMAC over the raw body |
| SMS | ❌ Enterprise plan only (Plivo sign-up screen: "Messaging — Enterprise Plan") |
| HIPAA BAA (dental) | ⚠️ Enterprise only (from $1,000/month) |

Tally: about 12 ✅, 8 ⚠️, 9 ❓, 1 ❌.

**Blocking unknowns to ask Plivo sales:**
1. Browser (WebRTC) calls into an agent flow.
2. Assigning a number to an agent flow via API.
3. Transcript and recording URL in the hang-up webhook or run API.
4. Per-agent voice, language (Spanish) and LLM selection.

Also ask: whether `{{variables}}` work inside `agent_node.instructions`, and Enterprise pricing and concurrency.

## 4. Cost per minute (US inbound, from the official price pages on 2026-09-29)

| Component | Retell (today) | Plivo Agent Studio |
|---|---|---|
| Voice infrastructure / orchestration | $0.055 | $0.03 ("voice models, transcription, orchestration") |
| TTS | $0.015 (Retell voices) | included |
| LLM | $0.0128 (GPT-4.1 mini) | bring your own; estimated ~$0.0096 (Gemini 3.5 Flash Lite at Retell's resale rate, likely lower direct) |
| Telephony | $0.015 | $0.0028 |
| **Total** | **≈ $0.098/min** | **≈ $0.042/min** |
| Number | $2/month | $0.50/month (from earlier research; not on the pricing page) |
| Concurrency | first 20 free, then $8/month each | included free (per pricing page) |
| HIPAA | "Custom BAA" | Enterprise, from $1,000/month |

A full switch saves about $0.055/min (~57%), roughly $550 per 10,000 minutes. Moving only the phone line to Plivo (keeping Retell's AI) saves about $0.012/min.

## 5. Gross margin per customer (price cards from `platform_settings`, all included minutes used)

Costs counted: call minutes, number, and a standard Stripe card fee (about 2.9% + 30¢). Fixed costs, texting and labour are excluded.

| Vertical | Price | Included min | Retell margin | Plivo margin | Extra per month |
|---|---|---|---|---|---|
| restaurant | $249 | 500 | 76.5% | 88.3% | $29.20 |
| vet | $349 | 500 | 82.4% | 90.8% | $29.20 |
| motel | $299 | 400 | 83.2% | 91.2% | $23.66 |
| auto / generic | $299 | 300 | 86.5% | 92.6% | $18.12 |
| dental | $349 | 350 | 86.6% | 92.6% | $20.89 |
| legal | $399 | 300 | 89.2% | 93.7% | $18.12 |
| real_estate | $349 | 150 | 92.2% | 95.0% | $9.81 |

At half the included minutes: Retell 86–94%, Plivo 92–96%. Overage minutes (30–45¢): Retell 67–78%, Plivo 86–91%. If Plivo Enterprise ($1,000/month) is needed, the switch breaks even at about 18,000 minutes a month (about 50 customers).

## 6. Effort estimate

If the four blocking unknowns resolve favourably: about 2–3 months for one engineer. Main items:
- a Plivo flow compiler for 8 verticals;
- a numbers adapter;
- `/voice-tools` accepting Plivo HTTP actions;
- hang-up and post-call ingestion (plus our own Gemini analysis);
- replacing the 5 browser-call surfaces;
- renaming Retell-specific columns;
- collapsing the duplicated Deno Retell stack (`supabase/functions/_shared/providers/retell.ts`, `compiler/template-compiler.ts`, `provisioning/compile-and-publish.ts`), which is worth doing regardless.

## Sources

- Plivo SIP trunking for voice agents: https://www.plivo.com/docs/voice-agents/sip-trunking/overview
- Plivo docs index: https://www.plivo.com/docs/llms.txt
- Plivo CLI v1.1.0 release: https://github.com/plivo/plivo-cli/releases/tag/v1.1.0
- Plivo CLI command reference and Agents API skill: https://github.com/plivo/plivo-cli (`docs/COMMANDS.md`, `agents-skill/SKILL.md`)
- Plivo AI agents page: https://www.plivo.com/ai-agents/
- Plivo pricing: https://www.plivo.com/pricing/
- Plivo account phone numbers API: https://plivo.com/docs/numbers/account-phone-numbers
- Retell pricing: https://www.retellai.com/pricing
- Heyloo Retell dependency inventory: research workflow of 2026-09-29 (summarised in section 3)
