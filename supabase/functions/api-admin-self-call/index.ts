// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt false —
// internal-only (SELFCALL-1), same `x-internal-secret` pattern every other
// `api-admin-*` function already uses. Never callable by a tenant/browser.

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runSelfCall } from "./handler.ts";

const logger = createLogger({ fn: "api-admin-self-call" });
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

  const result = await runSelfCall(getSql(), body, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    logger,
  });

  return jsonResponse(result.body, { status: result.status });
});
