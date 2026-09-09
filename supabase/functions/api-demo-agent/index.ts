// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false —
// public marketing-site flow (BACKEND_SPEC §7.8); rate-limiting/CAPTCHA is
// the marketing-site layer's job per spec, not this function's.
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import {
  ConfirmDemoRequestSchema,
  CreateDemoRequestSchema,
} from "../_shared/schemas/demo-agent.ts";
import { handleConfirmDemo, handleCreateDemo } from "./handler.ts";

const logger = createLogger({ fn: "api-demo-agent" });
const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = optionalEnv("ANTHROPIC_DEMO_MODEL") ?? "claude-3-5-haiku-20241022";
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const DEMO_AGENT_ID = requireEnv("DEMO_AGENT_ID");
const DEMO_PHONE_E164 = requireEnv("DEMO_PHONE_E164");

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

  const createParsed = CreateDemoRequestSchema.safeParse(body);
  if (!createParsed.success) {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  const result = await handleCreateDemo(sql, createParsed.data, deps);
  return jsonResponse(result.body, { status: result.status });
});
