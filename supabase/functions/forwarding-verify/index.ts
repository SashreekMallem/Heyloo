// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true —
// authenticated tenant owner/admin (BACKEND_SPEC §7.10).
import { getSql } from "../_shared/deno/db.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { verifyForwarding } from "./handler.ts";

const logger = createLogger({ fn: "forwarding-verify" });

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

  let body: { tenant_id?: string; carrier_hint?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.tenant_id) return jsonResponse({ error: "invalid_request" }, { status: 422 });

  const claims = decodeJwtClaims(req.headers.get("authorization"));
  if (claims?.app_metadata?.tenant_id !== body.tenant_id) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const result = await verifyForwarding(
    sql,
    { tenantId: body.tenant_id, ...(body.carrier_hint ? { carrierHint: body.carrier_hint } : {}) },
    {
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      pollIntervalMs: 3_000,
      timeoutMs: 55_000, // BACKEND_SPEC §7.10 — recommend 45-60s.
    },
  );

  logger.info("forwarding_verify_complete", { tenant_id: body.tenant_id, status: result.status });
  return jsonResponse(result.body, { status: result.status });
});
