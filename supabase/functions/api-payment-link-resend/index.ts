// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; this function
// additionally checks the JWT's own app_metadata.tenant_id against the
// body-supplied tenant_id (never trusts the body alone, CLAUDE.md Rule 2 —
// same convention as api-a2p-register/index.ts) before touching anything.
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { resendPaymentLink } from "./handler.ts";

const logger = createLogger({ fn: "api-payment-link-resend" });
const STRIPE_SECRET_KEY = requireEnv("STRIPE_SECRET_KEY");
const PAYMENT_LINK_SUCCESS_URL =
  optionalEnv("PAYMENT_LINK_SUCCESS_URL") ?? "https://heyloo.app/pay/success";
const PAYMENT_LINK_CANCEL_URL =
  optionalEnv("PAYMENT_LINK_CANCEL_URL") ?? "https://heyloo.app/pay/cancelled";

interface JwtClaims {
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

  let body: { tenant_id?: string; payment_link_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  const { tenant_id: tenantId, payment_link_id: paymentLinkId } = body;
  if (!tenantId || !paymentLinkId) {
    return jsonResponse({ error: "missing_tenant_id_or_payment_link_id" }, { status: 422 });
  }

  const claims = decodeJwtClaims(req.headers.get("authorization"));
  if (claims?.app_metadata?.tenant_id !== tenantId) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const result = await resendPaymentLink(sql, tenantId, paymentLinkId, {
    fetchImpl: fetch,
    stripeSecretKey: STRIPE_SECRET_KEY,
    successUrl: PAYMENT_LINK_SUCCESS_URL,
    cancelUrl: PAYMENT_LINK_CANCEL_URL,
    logger,
  });
  if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
  return jsonResponse(result.body, { status: result.status });
});
