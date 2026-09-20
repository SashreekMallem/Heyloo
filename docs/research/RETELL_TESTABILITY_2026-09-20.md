# Retell AI — Automated End-to-End Testability (2026-09-20)

Research date 2026-09-20. Read-only. Sources: live `docs.retellai.com` pages
fetched via WebFetch this pass (cited per row) plus `docs/research/deep-dive/B_retell_capabilities.md`
(2026-09-11 sweep) and `packages/adapters/retell` source.

## 1. Capability matrix

| # | Capability | Endpoint / mechanism | Verified? | URL |
|---|---|---|---|---|
| 1a | Outbound phone call creation | `POST /v2/create-phone-call` — required `from_number`, `to_number` (E.164); optional `override_agent_id`, `override_agent_version`, `agent_override`, `metadata`, `retell_llm_dynamic_variables` (string values), `custom_sip_headers`, `ignore_e164_validation` | **Verified** | `docs.retellai.com/api-references/create-phone-call` |
| 1b | Target any phone number | `to_number` — no allowlist field in the docs; KYC (Persona/automatic) is a prerequisite for outbound calling on the account, not per-destination | **Verified** (account-level KYC gate only) | `docs.retellai.com/accounts/kyc` (per deep-dive sweep) |
| 1c | Fetch one call's result (transcript/recording/analysis) | `GET /v2/get-call/{call_id}` → `transcript`, `transcript_object`, `transcript_with_tool_calls`, `recording_url`, `scrubbed_recording_url`, `public_log_url`, `call_analysis` (`call_summary`, `user_sentiment`, `call_successful`, `custom_analysis_data`), `call_cost`, `llm_token_usage` | **Verified** | `docs.retellai.com/api-references/get-call` |
| 1d | Query many calls | `POST /v3/list-calls` — `filter_criteria` incl. `call_id`, `batch_call_id`, `call_status`, `call_type`, `metadata`, `dynamic_variables`, `tool_calls`, `custom_analysis_data`; plus `limit`/`skip`/`pagination_key`/`sort_order` | **Verified** | `docs.retellai.com/api-references/list-calls` |
| 1e | Webhook events | `call_started` (not fired if never connected), `call_ended`, `call_analyzed` (carries `call_analysis` — **not** included in `call_ended`), configurable via agent `webhook_events`; HMAC-SHA256 `X-Retell-Signature` over raw body | **Verified** (deep-dive sweep, cross-checked) | `docs.retellai.com/features/webhook-overview` |
| 2 | Web call + headless join | `POST /v3/create-web-call` → `{call_id, access_token, transport: "gateway", ice_servers, expires_at}`; joined client-side via `retell-client-js-sdk`'s `RetellWebClient`/`createWebCall()`, which requires a real browser: `getUserMedia`/microphone permission over a secure context (HTTPS or `localhost`), `audio.captureDeviceId`/`playbackDeviceId`, and a user-gesture to start audio playback. **No server-side/Node.js usage is documented anywhere.** | **Verified** (create-web-call endpoint + SDK browser requirement); **not officially documented for Playwright/headless Chromium specifically** — inferred from the SDK needing real WebRTC/mic APIs, which headless Chromium does provide (via `--use-fake-device-for-media-stream`/fake audio input), so it is plausible but Retell publishes no guidance or support statement for this use case | `docs.retellai.com/api-references/create-web-call`, `docs.retellai.com/deploy/web-call` |
| 3a | Native simulation/testing — 4-tier stack | (1) LLM Playground (dashboard, manual/AI-simulated chat, ungraded), (2) Simulation testing (saved graded test cases), (3) **Batch testing** — CI-fit, full API, (4) Web/Phone call testing (real audio, dashboard) | **Verified** (tiers) / dashboard-only claim for tiers 1,2,4 **not independently confirmed this pass** (test-overview page didn't state API-vs-dashboard explicitly when re-fetched) | `docs.retellai.com/test/test-overview` |
| 3b | Batch-test API (the CI path) | `POST /create-test-case-definition` → `POST /create-batch-test` (`test_case_definition_ids[1..1000]`, `response_engine`) → `{test_case_batch_job_id, status, pass_count, fail_count, error_count, total_count}` → `GET /v2/list-test-runs/{batch_job_id}` → per-case `{status: pending\|in_progress\|pass\|fail\|error, transcript_snapshot, result_explanation}` | **Verified**, and already implemented in `packages/adapters/retell/src/tests-api.ts` | `docs.retellai.com/api-references/create-batch-test`, `.../list-test-runs` |
| 3c | Testing pricing | Text/chat testing ≈ $0.001–$0.05/message; web/phone call testing ≈ $0.07–$0.31/min (same as production) + phone adds ≈ $0.015/min telephony + $2/mo number; **no discounted/sandbox tier** — "Testing an agent bills at the same rates as production" | **Verified** | `docs.retellai.com/test/testing-pricing` |
| 4a | Text-mode chat (create-chat) | `POST /create-chat` — required `agent_id`; optional `agent_version`, `metadata`, `retell_llm_dynamic_variables`; response `{chat_id, chat_status, transcript, message_with_tool_calls, chat_analysis}` | **Verified** | `docs.retellai.com/api-references/create-chat` |
| 4b | Drive the chat (create-chat-completion) | `POST /create-chat-completion` — `chat_id`, `content` (the "user" turn text) → returns new `messages[]` including tool invocations/results | **Verified** | `docs.retellai.com/api-references/create-chat-completion` |
| 4c | Chat fires the same custom-tool webhook, same payload shape as voice | Deep-dive sweep documents Chat agents as sharing prompt/tools/KB with voice agents ("headless — no first-party chat UI"); the general custom-function page (`/build/single-multi-prompt/custom-function`) documents the tool webhook body as `{name, call, args}` and explicitly says the `call` object's `from_number`/`to_number`/`direction` are present on **phone** calls and **absent on web calls** — chat's shape (a `chat` object vs a `call` object, or an absent `call` field) is **not explicitly documented on the pages fetched this pass** | **Unverified** — the "same webhook, same payload shape" claim is plausible (same tool-calling plumbing) but no fetched page states it outright for chat specifically | `docs.retellai.com/build/single-multi-prompt/custom-function` (payload shape only), chat/voice sharing per `docs/research/deep-dive/B_retell_capabilities.md` row "Agent types" |
| 5a | Re-point an existing number to a different agent | `PATCH /update-phone-number/{phone_number}` — **no** `inbound_agent_id`/`outbound_agent_id` fields anymore (deprecated 2026-03-31); current fields are weighted arrays `inbound_agents`/`outbound_agents`/`inbound_sms_agents`/`outbound_sms_agents` (`{agent_id, agent_version, weight}`), plus `inbound_webhook_url` | **Verified** | `docs.retellai.com/api-references/update-phone-number` |
| 5b | Per-call agent override via inbound webhook | Inbound webhook response can set `reject`, `override_agent_id`, `override_agent_version`, `dynamic_variables`, `metadata`, `agent_override` (session-scoped only) | **Verified** | `docs.retellai.com/features/inbound-call-webhook` |
| 6a | Rate limits | Call creation: 1000/10s + 60 4xx/min budget; list endpoints: 30/10s; general CRUD: 100/10s; LLM/agent playground: 8/2s — all per org+route | **Verified** | `docs.retellai.com/get-started/sdk` (rate-limits section) |
| 6b | Concurrency | 20 concurrent calls/workspace by default (pay-as-you-go); purchasable increases | **Verified** | `docs.retellai.com/deploy/concurrency` |

## 2. Adapter code cross-check (`packages/adapters/retell`)

The adapter currently implements: `POST /v2/create-phone-call` (`outbound.ts`), `POST /import-phone-number`
(`numbers.ts`), `POST /create-agent` / `/create-conversation-flow` / `/create-retell-llm` (`agents.ts`), and the
full batch-test loop `POST /create-test-case-definition` → `POST /create-batch-test` → `GET /v2/list-test-runs/{id}`
(`tests-api.ts`) — all now independently confirmed against current docs above.

**Endpoints referenced in code comments but not implemented/callable in this package** (so not directly
cross-checkable from code, only from docs fetched this pass): `GET /v2/get-call` (mentioned in a `call-events.ts`
comment as future reconciliation work, no client method yet) — confirmed above from docs directly.
**Not present in the adapter at all**: `list-calls`, `create-web-call`, `create-chat`/`create-chat-completion`,
`update-phone-number`. None of these is something the code "relies on" that docs failed to confirm — the docs
confirmed all of them cleanly. The one field the adapter's own code flags as genuinely unconfirmed against a live
account is `transcript_snapshot`'s internal turn-array key (`tests-api.ts` tries
`transcript_with_tool_calls`/`transcript_object`/`turns`/`transcript` defensively and fails loudly if none match) —
the SDK types this field `unknown` by design and no fetched doc page shows a worked example payload, so this
remains genuinely open pending a live batch-test run.

## 3. Verdict

**Can run without a human on a phone, today, with real Retell API calls:**
- **Chat/text path** (`create-chat` + `create-chat-completion`): exercises the real agent LLM, the real prompt/tool
  config, and (per the deep-dive sweep) the same tool set as voice — but the exact tool-webhook payload shape for
  chat vs. phone (presence/absence/shape of the `call` object) is not confirmed from docs; a live smoke test against
  our own `/voice/tools` webhook is needed to nail this down before relying on it as a stand-in for voice.
- **Outbound phone calls to a real destination number** (`create-phone-call`), fully scriptable (dynamic variables,
  agent override, metadata), with results retrievable via `get-call`/`list-calls` and the `call_started`/`call_ended`/
  `call_analyzed` webhooks — but this still requires *something* to answer the call. A second Retell agent, a SIP
  softphone, or another automated answering endpoint can play that role without a literal human, but a live human is
  not required by any Retell mechanism.
- **Retell's own batch-test API** (`create-test-case-definition`/`create-batch-test`/`list-test-runs`) is the
  cleanest zero-human, CI-gateable loop: it runs an LLM-simulated caller against the real agent config and grades
  pass/fail, with mocking available for most tool types (not MCP tools, not built-in actions) — already wired into
  `packages/adapters/retell/src/tests-api.ts`.
- **Web calls** (`create-web-call`) return a browser access token but the only documented join path is the browser
  JS SDK requiring real WebRTC/mic APIs — a Playwright-driven headless Chromium could plausibly join and play
  scripted audio (headless Chromium supports fake-media-stream flags), but Retell publishes no guidance, example, or
  support commitment for this; treat it as an unofficial, unverified path, not a documented one.

**Still needs a human on a phone (or an equivalent live-audio endpoint) for:**
- End-to-end verification of real telephony behavior that only phone-call testing exercises: DTMF/IVR navigation,
  live transfers, voicemail/IVR detection — the docs state only *phone call testing* (not web call testing) covers
  these, and phone/web call testing both bill at full production rates with no sandbox tier.
- Real-world audio-quality/ASR robustness (accents, background noise, phone-line degradation) that a scripted or
  simulated caller cannot approximate.

## Sources
- `docs.retellai.com/api-references/create-phone-call`
- `docs.retellai.com/api-references/get-call`
- `docs.retellai.com/api-references/list-calls`
- `docs.retellai.com/api-references/create-web-call`
- `docs.retellai.com/deploy/web-call`
- `docs.retellai.com/api-references/update-phone-number`
- `docs.retellai.com/features/inbound-call-webhook`
- `docs.retellai.com/features/webhook-overview`
- `docs.retellai.com/api-references/create-chat`
- `docs.retellai.com/api-references/create-chat-completion`
- `docs.retellai.com/build/single-multi-prompt/custom-function`
- `docs.retellai.com/test/test-overview`
- `docs.retellai.com/test/testing-pricing`
- `docs.retellai.com/api-references/create-batch-test`
- `docs.retellai.com/api-references/list-test-runs`
- `docs.retellai.com/get-started/sdk` (rate limits)
- `docs.retellai.com/deploy/concurrency`
- `docs/research/deep-dive/B_retell_capabilities.md` (2026-09-11 sweep, for chat/voice tool-sharing and webhook-event-type context)
- `packages/adapters/retell/src/{outbound,numbers,agents,tests-api,call-events,client}.ts`
