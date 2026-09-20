// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false —
// internal-only (CALL-1, docs/BUILD_PLAN.md task 2), same `x-internal-secret`
// pattern as api-admin-provision-test-tenant/index.ts and
// api-provision/index.ts's internal call path. Never calls Twilio.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { attachRetellNumber } from "./handler.ts";

const logger = createLogger({ fn: "api-admin-attach-retell-number" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const RETELL_INBOUND_WEBHOOK_URL = requireEnv("RETELL_INBOUND_WEBHOOK_URL");
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
  const result = await attachRetellNumber(sql, body, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    inboundWebhookUrl: RETELL_INBOUND_WEBHOOK_URL,
    logger,
  });

  return jsonResponse(result.body, { status: result.status });
});
