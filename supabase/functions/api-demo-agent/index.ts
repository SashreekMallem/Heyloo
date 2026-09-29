// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false —
// public marketing-site flow (BACKEND_SPEC §7.8); rate-limiting/CAPTCHA is
// the marketing-site layer's job per spec, not this function's (apps/web's
// `/api/demo/*` routes call it with per-IP limits). Three request shapes:
// create (scrape), confirm (mint a token), instant (a business type picked on
// the marketing site).
//
// DEMO-2: only RETELL_API_KEY (and the database) are required at boot. The
// instant demo needs nothing else; ANTHROPIC_API_KEY is used by the scrape
// "create" flow alone, DEMO_AGENT_ID by the scrape "confirm" flow (and as the
// `auto` instant fallback), DEMO_PHONE_E164 only to show a phone fallback. A
// missing optional one used to crash the whole function at module load
// (WORKER_ERROR), taking the instant demo down with it; now the flow that needs
// it answers a clean 503 `not_configured` instead.
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import {
  ConfirmDemoRequestSchema,
  CreateDemoRequestSchema,
  InstantDemoRequestSchema,
} from "../_shared/schemas/demo-agent.ts";
import { handleConfirmDemo, handleCreateDemo, handleInstantDemo } from "./handler.ts";

const logger = createLogger({ fn: "api-demo-agent" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
// An empty secret counts as unset (`optionalEnv` alone would return "").
const ANTHROPIC_API_KEY = optionalEnv("ANTHROPIC_API_KEY") || undefined;
const ANTHROPIC_MODEL = optionalEnv("ANTHROPIC_DEMO_MODEL") || "claude-3-5-haiku-20241022";
const DEMO_AGENT_ID = optionalEnv("DEMO_AGENT_ID") || undefined;
const DEMO_PHONE_E164 = optionalEnv("DEMO_PHONE_E164") || undefined;

const SCRAPE_TIMEOUT_MS = 10_000;

async function fetchUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
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
    anthropicFetch: fetch,
    anthropicApiKey: ANTHROPIC_API_KEY,
    anthropicModel: ANTHROPIC_MODEL,
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    demoAgentId: DEMO_AGENT_ID,
    demoPhoneE164: DEMO_PHONE_E164,
    fetchUrl,
    logger,
  };

  const confirmParsed = ConfirmDemoRequestSchema.safeParse(body);
  if (confirmParsed.success) {
    const result = await handleConfirmDemo(sql, confirmParsed.data, deps);
    return jsonResponse(result.body, { status: result.status });
  }

  // The instant shape is recognised by `instant: true`; a `vertical` outside
  // the allowlist is then a 400, never a fall-through to the scrape flow.
  const isInstant =
    typeof body === "object" && body !== null && (body as { instant?: unknown }).instant === true;
  if (isInstant) {
    const instantParsed = InstantDemoRequestSchema.safeParse(body);
    if (!instantParsed.success) return jsonResponse({ error: "invalid_request" }, { status: 400 });
    const result = await handleInstantDemo(sql, instantParsed.data, deps);
    return jsonResponse(result.body, { status: result.status });
  }

  const createParsed = CreateDemoRequestSchema.safeParse(body);
  if (!createParsed.success) {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  const result = await handleCreateDemo(sql, createParsed.data, deps);
  return jsonResponse(result.body, { status: result.status });
});
