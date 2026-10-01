// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt = true
// (config.toml) — Supabase verifies the bearer JWT before this code runs;
// `tenant_id` comes ONLY from the JWT's own `app_metadata`, never a body param
// (CLAUDE.md Rule 2) — this endpoint takes no body at all, same shape as
// `api-tenant-agent-publish`. Role gated to owner/admin: only they can edit
// the business address this geocodes.

import { getSql } from "../_shared/deno/db.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handleBusinessLocation } from "./handler.ts";

const logger = createLogger({ fn: "api-tenant-business-location" });

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
  // DELIVERY-1: the keyless US Census Geocoder (fixed host; the address is
  // only a query parameter, so no safe-fetch needed).
  const result = await handleBusinessLocation(sql, tenantId, { fetchImpl: fetch, logger });
  return jsonResponse(result.body, { status: result.status });
});
