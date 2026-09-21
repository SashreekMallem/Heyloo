// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false —
// internal-only, same `x-internal-secret` pattern as
// api-admin-attach-retell-number/index.ts and every other api-admin-*
// function (SIGNUP-1, docs/BUILD_NOTES.md SIGNUP-1 entry).

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { completeTestCheckout } from "./handler.ts";

const logger = createLogger({ fn: "api-admin-complete-test-checkout" });
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
  const result = await completeTestCheckout(sql, body, {
    logger,
    randomSuffix: () => crypto.randomUUID().slice(0, 8),
  });
  return jsonResponse(result.body, { status: result.status });
});
