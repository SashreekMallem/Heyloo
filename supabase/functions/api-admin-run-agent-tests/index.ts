// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false —
// internal-only (CALL-1, docs/BUILD_PLAN.md task 3), same `x-internal-secret`
// pattern as the other two api-admin-* functions this task adds.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runAgentTests, simulateInboundCall } from "./handler.ts";

const logger = createLogger({ fn: "api-admin-run-agent-tests" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
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

  // CALL-9: `action: "simulate"` is a read-only sibling behind the SAME
  // `x-internal-secret` check above — same pattern as `api-admin-attach-
  // retell-number`'s own `action: "inspect"` (CALL-5). Proves the pre-call
  // DB lookup live without needing a signed Retell `call_inbound` request.
  if (
    typeof body === "object" &&
    body !== null &&
    (body as { action?: unknown }).action === "simulate"
  ) {
    const result = await simulateInboundCall(sql, body, {
      retellFetch: fetch,
      retellApiKey: RETELL_API_KEY,
      logger,
    });
    return jsonResponse(result.body, { status: result.status });
  }

  const result = await runAgentTests(sql, body, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    logger,
  });

  return jsonResponse(result.body, { status: result.status });
});
