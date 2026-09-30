// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; tenant_id AND the
// caller's own user id come ONLY from the JWT (CLAUDE.md Rule 2, same
// convention as api-team-invite/index.ts). The apps/web proxy
// (`POST /api/billing/portal`) also sends `{ tenant_id }` in the body, which
// is deliberately ignored here.
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { createTenantBillingPortalSession } from "./handler.ts";

const logger = createLogger({ fn: "api-billing-portal" });
const STRIPE_SECRET_KEY = requireEnv("STRIPE_SECRET_KEY");
const APP_BASE_URL = optionalEnv("APP_BASE_URL") ?? "https://heyloo.app";

interface JwtClaims {
  sub?: string;
  app_metadata?: { tenant_id?: string };
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
  if (!claims?.app_metadata?.tenant_id || !claims.sub) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const result = await createTenantBillingPortalSession(
    sql,
    claims.app_metadata.tenant_id,
    claims.sub,
    {
      fetchImpl: fetch,
      stripeSecretKey: STRIPE_SECRET_KEY,
      returnUrl: `${APP_BASE_URL.replace(/\/+$/, "")}/dashboard/billing`,
      logger,
    },
  );

  if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
  return jsonResponse(result.body, { status: result.status });
});
