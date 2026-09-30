// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false —
// public marketing-site flow (BACKEND_SPEC §7.8). Per-visitor rate limiting is
// the marketing-site layer's job (apps/web's `/api/demo/*` routes apply per-IP
// limits), but the bare function URL is public too, so this function enforces
// its own database-backed ceilings (SEC-04): a global hourly cap on new demo
// sessions and one token mint per session (`_shared/demo-mint-limit.ts`).
// Three request shapes:
// create (scrape), confirm (mint a token), instant (a business type picked on
// the marketing site).
//
// DEMO-2: only RETELL_API_KEY (and the database) are required at boot. The
// instant demo needs nothing else; the LLM key (GEMINI_API_KEY, LLM-1) is used by
// the scrape "create" flow alone, DEMO_AGENT_ID by the scrape "confirm" flow (and as the
// `auto` instant fallback), DEMO_PHONE_E164 only to show a phone fallback. A
// missing optional one used to crash the whole function at module load
// (WORKER_ERROR), taking the instant demo down with it; now the flow that needs
// it answers a clean 503 `not_configured` instead.
import {
  claimDemoSessionMint,
  demoSessionCeilingReached,
  releaseDemoSessionMint,
} from "../_shared/demo-mint-limit.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { resolveLlmFromEnv } from "../_shared/deno/llm.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { SafeFetchError, safeFetchText } from "../_shared/safe-fetch.ts";
import {
  ConfirmDemoRequestSchema,
  CreateDemoRequestSchema,
  InstantDemoRequestSchema,
} from "../_shared/schemas/demo-agent.ts";
import { handleConfirmDemo, handleCreateDemo, handleInstantDemo } from "./handler.ts";

const logger = createLogger({ fn: "api-demo-agent" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
// An empty secret counts as unset (`optionalEnv` alone would return "").
const DEMO_AGENT_ID = optionalEnv("DEMO_AGENT_ID") || undefined;
const DEMO_PHONE_E164 = optionalEnv("DEMO_PHONE_E164") || undefined;

const SCRAPE_TIMEOUT_MS = 10_000;

async function fetchUrl(url: string): Promise<string | null> {
  // SSRF-1: the URL is anonymous-visitor input (verify_jwt false), so it goes
  // through safeFetchText (public targets only, redirects re-validated, 5 MB /
  // 10 s caps). A blocked or failed fetch is "no site text", as before.
  try {
    const res = await safeFetchText(url, { timeoutMs: SCRAPE_TIMEOUT_MS });
    return res.ok ? res.text : null;
  } catch (err) {
    if (err instanceof SafeFetchError) logger.warn("demo_scrape_blocked", { code: err.code });
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const sql = getSql();
  const deps = {
    llm: resolveLlmFromEnv(),
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    demoAgentId: DEMO_AGENT_ID,
    demoPhoneE164: DEMO_PHONE_E164,
    fetchUrl,
    logger,
  };

  const confirmParsed = ConfirmDemoRequestSchema.safeParse(body);
  if (confirmParsed.success) {
    const sessionId = confirmParsed.data.demo_session_id;
    const claim = await claimDemoSessionMint(sql, sessionId);
    if (claim === "taken") return jsonResponse({ error: "demo_already_started" }, { status: 409 });
    try {
      const result = await handleConfirmDemo(sql, confirmParsed.data, deps);
      if (claim === "claimed" && result.status !== 200)
        await releaseDemoSessionMint(sql, sessionId);
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      if (claim === "claimed") await releaseDemoSessionMint(sql, sessionId).catch(() => undefined);
      throw error;
    }
  }

  // The instant shape is recognised by `instant: true`; a `vertical` outside
  // the allowlist is then a 400, never a fall-through to the scrape flow.
  const isInstant =
    typeof body === "object" && body !== null && (body as { instant?: unknown }).instant === true;
  if (isInstant) {
    const instantParsed = InstantDemoRequestSchema.safeParse(body);
    if (!instantParsed.success) return jsonResponse({ error: "invalid_request" }, { status: 400 });
    if (await demoSessionCeilingReached(sql)) {
      return jsonResponse({ error: "rate_limited" }, { status: 429 });
    }
    const result = await handleInstantDemo(sql, instantParsed.data, deps);
    return jsonResponse(result.body, { status: result.status });
  }

  const createParsed = CreateDemoRequestSchema.safeParse(body);
  if (!createParsed.success) {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  if (await demoSessionCeilingReached(sql)) {
    return jsonResponse({ error: "rate_limited" }, { status: 429 });
  }
  const result = await handleCreateDemo(sql, createParsed.data, deps);
  return jsonResponse(result.body, { status: result.status });
});
