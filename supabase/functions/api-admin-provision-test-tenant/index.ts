// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false —
// internal-only (CALL-1, docs/BUILD_PLAN.md task 1): auth is a shared
// `x-internal-secret` header compared timing-safe against
// `PROVISION_INTERNAL_SECRET`, the SAME secret + comparison pattern
// `api-provision/index.ts`'s internal (service_role) call path already
// uses — never a Supabase-issued user JWT. This function is never meant to
// be called by an end user or a tenant's own browser.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { provisionTestTenant } from "./handler.ts";

const logger = createLogger({ fn: "api-admin-provision-test-tenant" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const VOICE_TOOLS_WEBHOOK_URL = requireEnv("VOICE_TOOLS_WEBHOOK_URL");
const PROVISION_INTERNAL_SECRET = requireEnv("PROVISION_INTERNAL_SECRET");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const providedSecret = req.headers.get("x-internal-secret");
  if (!providedSecret || !timingSafeEqual(providedSecret, PROVISION_INTERNAL_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const sql = getSql();
  const result = await provisionTestTenant(sql, body, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    voiceToolsWebhookUrl: VOICE_TOOLS_WEBHOOK_URL,
    logger,
  });

  return jsonResponse(result.body, { status: result.status });
});
