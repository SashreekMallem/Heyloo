// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; tenant_id comes
// ONLY from the JWT's own app_metadata (CLAUDE.md Rule 2), never a body
// param — this endpoint takes no body at all. Same
// decode-claims-then-require-tenant_id shape as api-menu-import/index.ts.

import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handleTenantTestCall } from "./handler.ts";

const logger = createLogger({ fn: "api-tenant-test-call" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");

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
  if (!claims?.app_metadata?.tenant_id) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const result = await handleTenantTestCall(sql, claims.app_metadata.tenant_id, {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    logger,
  });

  return jsonResponse(result.body, { status: result.status });
});
