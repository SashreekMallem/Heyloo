# LLM providers

LLM-1, 2026-09-29. Every LLM feature in Heyloo goes through one provider-neutral
port. The owner chose Google Gemini; Anthropic stays available as a second
adapter behind the same port. Core code never sees a vendor payload.

## What uses an LLM

| Feature | Function | Call shape | Tier |
|---|---|---|---|
| SMS + web-chat text agent (tool calling) | `_shared/text-agent/engine.ts` (via `webhooks-sms`, `webhooks-twilio-sms`, `api-text-chat`) | `chat` | quality |
| Menu import from text / URL / photo / PDF | `api-menu-import` | `generateJson` (+ image/PDF bytes) | fast (text), vision (file) |
| "Build a demo from my website" summary | `api-demo-agent` (create) | `generateJson` | fast |
| Per-lead research summary (bulk) | `job-outreach-personalize` | `batch.submit` | fast |
| Cold-email opening line | `job-outreach-personalize-collect` | `batch.get` + `generateText` | quality |
| Phone-complaint review scoring | `job-outreach-review-score` | `generateJson` | fast |
| Outreach reply intent | `webhooks-outreach` | `generateJson` | fast |

Voice calls are not here: the live call LLM is inside Retell.

## Layout

```
supabase/functions/_shared/providers/llm/
  types.ts        the port: LlmClient, canonical request/response/error types
  gemini.ts       Gemini adapter (generateContent + Batch API), zod-validated
  anthropic.ts    Anthropic adapter (Messages + Message Batches)
  http.ts         shared transport: per-attempt timeout, retry/backoff, no vendor knowledge
  registry.ts     LLM_PROVIDER selection, env wiring, fail-closed resolution
  pricing.ts      per-model token prices (with source URLs) for cost_events
  test-support.ts port-level fake for call-site tests (test only)
  *.test.ts       adapter tests (recorded-shape fixtures), contract tests, registry, pricing
supabase/functions/_shared/deno/llm.ts        Deno glue: build the client from env, lazily
supabase/functions/_shared/outreach-llm.ts    reply-intent + review-score prompts on the port
```

Only files under `providers/llm/` read a vendor's field names (`candidates`,
`functionCall`, `usageMetadata`, `tool_use`, ...). Call sites see:

```ts
interface LlmClient {
  provider: "gemini" | "anthropic";
  modelFor(tier): string;
  generateText(req):  Promise<LlmResult<{ text, finishReason, usage, model }>>;
  generateJson(req):  Promise<LlmResult<{ json, text, usage, model }>>;   // schema in, parsed value out
  chat(req):          Promise<LlmResult<{ text, toolCalls, stopReason, assistantMessage, usage, model }>>;
  batch: { submit(...), get(batchId) };                                    // bulk, async, discounted
}
```

Input to `generateText` / `generateJson` is a string or an array of parts, where a
part is text or `{kind: "media", mimeType, dataBase64}` (image or PDF bytes).
`chat` takes canonical messages (`user`, `assistant` with `toolCalls`, `tool`
with `results`) and canonical tool definitions (`{name, description,
inputSchema}`). Nothing throws: every method resolves to `{ok: true, ...}` or
`{ok: false, error: {kind, status, message, retryable}}`.

Error kinds: `auth`, `payment`, `rate_limited`, `invalid_request`, `blocked`,
`truncated`, `timeout`, `unavailable`, `bad_response`. Both adapters retry
`rate_limited`, `timeout` and `unavailable` (408 / 429 / 5xx / network) with
exponential backoff and jitter, honoring `Retry-After` (capped 5s); never
`auth`, `payment`, `invalid_request` or `blocked`. Each call site sets its own
`timeoutMs` / `maxRetries` (the text agent: 6s per attempt, one retry, inside its
8s turn ceiling; menu import: 15s, one retry, inside the web proxy's 20s).

## Choosing a provider

`LLM_PROVIDER` = `gemini` | `anthropic`.

- Unset: Gemini. Usable when `GEMINI_API_KEY` is set.
- `anthropic`: only when explicitly chosen; needs `ANTHROPIC_API_KEY`.
- A missing key, or an unrecognized `LLM_PROVIDER`, resolves to "not configured".
  There is no silent fallback to the other vendor, and nothing reads an LLM key at
  module load (`requireEnv` is never used for LLM keys), so a missing key can
  never crash a function on cold start.

Models are chosen by tier from env, never named at a call site:

| Tier | Gemini env (default) | Anthropic env (default) |
|---|---|---|
| fast | `GEMINI_MODEL` (`gemini-3.5-flash-lite`) | `ANTHROPIC_MODEL` (`claude-haiku-4-5`) |
| quality | `GEMINI_MODEL_QUALITY` (= `GEMINI_MODEL`) | `ANTHROPIC_MODEL_QUALITY` (`claude-sonnet-5`) |
| vision | `GEMINI_MODEL_VISION` (= `GEMINI_MODEL`) | `ANTHROPIC_MODEL_VISION` (`claude-sonnet-5`) |

`gemini-3.5-flash-lite` is a stable, multimodal, function-calling model priced at
$0.30 in / $2.50 out per 1M tokens (ai.google.dev/gemini-api/docs/models and
/pricing, 2026-09-29). If booking judgment in the text agent needs more, set
`GEMINI_MODEL_QUALITY=gemini-3.8-flash` ($0.75 / $3.75 through 2026-12-31, then
$1.50 / $7.50) with no code change.

## "AI not configured" — what the owner sees

| Surface | Without a usable provider |
|---|---|
| Menu import page | Red notice: "AI isn't configured yet, so menu import can't read your menu (missing GEMINI_API_KEY)..." (edge answer: 503 `ai_not_configured` with `missing`) |
| Menu import, key rejected / no credit | "The AI service isn't accepting requests right now..." (503 `ai_unavailable`) |
| Web chat (`api-text-chat`) | 503 `ai_not_configured` |
| SMS text agent | archive-only: STOP/HELP/waitlist replies still work, other messages are stored, no AI reply |
| Demo "build from my website" | 503 `ai_not_configured`; the page says it isn't available and points to the business-type demo |
| Outreach crons (`job-outreach-*`) | 200 `{skipped: "not_configured", missing: [...]}`, logged as `job_skipped_not_configured` |
| Reply classification | replies stay unclassified (the admin "unclassified" queue) |

## Behavior kept across the migration

- Text agent: same tools (`toolsForChannel`), same authorization in
  `tool-router.ts` (`lookup_customer` scoped to the caller, `transfer_call` never
  offered), disclosure prepended in code on the first reply, customer text only
  ever passed as a `user` message, owner text still fenced inside the system
  prompt, 4-iteration tool budget, graceful fallback reply on any LLM error.
- Untrusted text (scraped sites, reviews, replies, menus) is still framed as
  data in every system prompt; review snippets are still substring-checked by
  the caller; every extraction result is still zod-validated by the caller.
- Cost accounting: each text-agent call still writes an idempotent
  `cost_events` estimate row, now with `provider` = the vendor id and tokens from
  `LlmUsage` (Gemini output tokens include reasoning tokens, which are billed as
  output). Prices and source URLs: `providers/llm/pricing.ts`, docs/VERIFY.md.
- Outreach research still uses the vendor's batch API; batch ids carry their
  vendor (`batches/...` Gemini, `msgbatch_...` Anthropic) so a provider switch
  never strands an in-flight batch.

## Adding another provider

1. `providers/llm/<vendor>.ts` implementing `LlmClient` (validate every response
   with zod; classify errors with `classifyStatus`; keep vendor fields inside).
2. Add the id to `LLM_PROVIDER_IDS`, a branch in `registry.ts`, a price table in
   `pricing.ts`.
3. Add it to `contract.test.ts`'s wire list: the same assertions must pass.
4. Document the endpoint/auth/limits you verified in docs/VERIFY.md.
