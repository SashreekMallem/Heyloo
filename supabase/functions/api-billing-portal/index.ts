// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; tenant_id comes ONLY
// from the JWT's own app_metadata (CLAUDE.md Rule 2), never from the body.
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handleBillingPortal } from "./handler.ts";

const logger = createLogger({ fn: "api-billing-portal" });
const STRIPE_SECRET_KEY = optionalEnv("STRIPE_SECRET_KEY");
// Where the portal's "return" link goes: the tenant billing page.
const BILLING_PORTAL_RETURN_URL = optionalEnv("BILLING_PORTAL_RETURN_URL");

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
  const tenantId = claims?.app_metadata?.tenant_id;
  if (!claims?.sub || !tenantId) return jsonResponse({ error: "forbidden" }, { status: 403 });

  if (!STRIPE_SECRET_KEY || !BILLING_PORTAL_RETURN_URL) {
    logger.error("api_billing_portal_not_configured");
    return jsonResponse({ error: "stripe_not_configured" }, { status: 500 });
  }

  const result = await handleBillingPortal(getSql(), claims.sub, tenantId, {
    stripeFetch: fetch,
    stripeSecretKey: STRIPE_SECRET_KEY,
    returnUrl: BILLING_PORTAL_RETURN_URL,
    logger,
  });
  if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
  return jsonResponse({ url: result.url });
});
