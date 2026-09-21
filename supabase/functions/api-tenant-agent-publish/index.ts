// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true
// (default — not listed in config.toml's `[functions.*]` overrides, same
// as `api-tenant-test-call`'s own precedent) — Supabase verifies the
// bearer JWT before this code runs; `tenant_id` comes ONLY from the JWT's
// own `app_metadata`, never a body param (CLAUDE.md Rule 2) — this
// endpoint takes no body at all, same shape as `api-tenant-test-call`.
// Role gated to owner/admin (PUBLISH-1's own brief) — a member with a
// lesser role can view the agent tabs but not trigger a live republish.

import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handlePublishAgent } from "./handler.ts";

const logger = createLogger({ fn: "api-tenant-agent-publish" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
// Same three webhook URLs `api-provision`/`api-admin-provision-test-tenant`
// already require — already-set secrets on this project (CALL-5/PARITY-1),
// nothing new to configure.
const VOICE_TOOLS_WEBHOOK_URL = requireEnv("VOICE_TOOLS_WEBHOOK_URL");
const VOICE_EVENTS_WEBHOOK_URL = requireEnv("VOICE_EVENTS_WEBHOOK_URL");
const RETELL_INBOUND_WEBHOOK_URL = requireEnv("RETELL_INBOUND_WEBHOOK_URL");

interface JwtClaims {
  app_metadata?: { tenant_id?: string; role?: string };
}

function decodeJwtClaims(authHeader: string | null): JwtClaims | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const parts = authHeader.slice("Bearer ".length).split(".");
    return JSON.parse(atob(parts[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")) as JwtClaims;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const claims = decodeJwtClaims(req.headers.get("authorization"));
  const tenantId = claims?.app_metadata?.tenant_id;
  const role = claims?.app_metadata?.role;
  if (!tenantId || (role !== "owner" && role !== "admin")) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const result = await handlePublishAgent(sql, tenantId, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    voiceToolsWebhookUrl: VOICE_TOOLS_WEBHOOK_URL,
    eventsWebhookUrl: VOICE_EVENTS_WEBHOOK_URL,
    retellInboundWebhookUrl: RETELL_INBOUND_WEBHOOK_URL,
    logger,
  });

  return jsonResponse(result.body, { status: result.status });
});
