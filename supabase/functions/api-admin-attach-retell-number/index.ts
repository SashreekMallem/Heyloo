// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false —
// internal-only (CALL-1, docs/BUILD_PLAN.md task 2), same `x-internal-secret`
// pattern as api-admin-provision-test-tenant/index.ts and
// api-provision/index.ts's internal call path. Never calls Twilio.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { attachRetellNumber, inspectRetellConfig } from "./handler.ts";
import { inventoryRetellAccount } from "./inventory.ts";

const logger = createLogger({ fn: "api-admin-attach-retell-number" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const RETELL_INBOUND_WEBHOOK_URL = requireEnv("RETELL_INBOUND_WEBHOOK_URL");
const PROVISION_INTERNAL_SECRET = requireEnv("PROVISION_INTERNAL_SECRET");

// RETELLCFG: the endpoints this platform configures on Retell, for the
// read-only `inventory` action's URL classification. Deliberately NOT
// `requireEnv`: a missing optional var must never take down the attach
// action. `RETELL_INBOUND_WEBHOOK_URL` (required above) is always
// `https://<ref>.supabase.co/functions/v1/voice-inbound`, so its parent path
// is this project's functions base; the explicit secrets win when set.
// `||`, not `??`: an empty-string secret counts as unset (requireEnv's rule).
const FUNCTIONS_BASE = RETELL_INBOUND_WEBHOOK_URL.replace(/\/[^/]*\/?$/, "");
const EXPECTED_RETELL_URLS = {
  voice_events: optionalEnv("VOICE_EVENTS_WEBHOOK_URL") || `${FUNCTIONS_BASE}/voice-events`,
  voice_tools: optionalEnv("VOICE_TOOLS_WEBHOOK_URL") || `${FUNCTIONS_BASE}/voice-tools`,
  voice_inbound: RETELL_INBOUND_WEBHOOK_URL,
};
// RETELLCFG-REVIEW: the project host comes from the platform-injected
// `SUPABASE_URL` (always `https://<ref>.supabase.co`), so a custom domain on
// the inbound webhook secret cannot make this project's own functions look
// like "another Supabase project". Parsed defensively: a malformed value
// must never stop the attach action from booting.
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
const PROJECT_HOST =
  hostOf(optionalEnv("SUPABASE_URL")) ?? hostOf(RETELL_INBOUND_WEBHOOK_URL) ?? "";
// RETELLCFG-REVIEW: Retell ids that only a deployment secret points at. The
// public demo web-call agent is referenced by nothing else, so without this
// it would be listed as an unreferenced agent to delete.
const ENV_RETELL_REFERENCES = { DEMO_AGENT_ID: optionalEnv("DEMO_AGENT_ID") };

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

  // CALL-5: `action: "inspect"` is a read-only sibling behind the SAME
  // `x-internal-secret` check above — see handler.ts's inspectRetellConfig
  // doc comment for why it lives here rather than a separate function.
  if (
    typeof body === "object" &&
    body !== null &&
    (body as { action?: unknown }).action === "inspect"
  ) {
    const result = await inspectRetellConfig(sql, body, {
      retellFetch: fetch,
      retellApiKey: RETELL_API_KEY,
      logger,
    });
    return jsonResponse(result.body, { status: result.status });
  }

  // RETELLCFG: `action: "inventory"` — read-only, account-wide listing of
  // every Retell agent / number / LLM / flow and every URL they call, with
  // stale-URL findings and the unreferenced-agent cleanup list (inventory.ts).
  if (
    typeof body === "object" &&
    body !== null &&
    (body as { action?: unknown }).action === "inventory"
  ) {
    const result = await inventoryRetellAccount(sql, {
      retellFetch: fetch,
      retellApiKey: RETELL_API_KEY,
      logger,
      expected: EXPECTED_RETELL_URLS,
      projectHost: PROJECT_HOST,
      envReferences: ENV_RETELL_REFERENCES,
    });
    return jsonResponse(result.body, { status: result.status });
  }

  const result = await attachRetellNumber(sql, body, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    inboundWebhookUrl: RETELL_INBOUND_WEBHOOK_URL,
    logger,
  });

  return jsonResponse(result.body, { status: result.status });
});
