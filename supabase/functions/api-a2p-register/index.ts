// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true —
// authenticated tenant owner, OR triggered internally by the provisioning
// saga (service_role) — same auth convention as api-provision/index.ts.
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { registerA2p } from "./handler.ts";

const logger = createLogger({ fn: "api-a2p-register" });
const TWILIO_ACCOUNT_SID = requireEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = requireEnv("TWILIO_AUTH_TOKEN");
const TWILIO_A2P_BRAND_SID = requireEnv("TWILIO_A2P_BRAND_SID");
const A2P_PRIVACY_POLICY_URL = requireEnv("A2P_PRIVACY_POLICY_URL");
const A2P_TERMS_URL = requireEnv("A2P_TERMS_URL");
const A2P_INTERNAL_SECRET = requireEnv("A2P_INTERNAL_SECRET");

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

  let body: { tenant_id?: string; action?: "register" | "refresh" };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  const tenantId = body.tenant_id;
  if (!tenantId) return jsonResponse({ error: "missing_tenant_id" }, { status: 422 });

  const internalSecret = req.headers.get("x-internal-secret");
  const isInternalCall = !!internalSecret && internalSecret === A2P_INTERNAL_SECRET;
  if (!isInternalCall) {
    const claims = decodeJwtClaims(req.headers.get("authorization"));
    if (claims?.app_metadata?.tenant_id !== tenantId || claims.app_metadata?.role !== "owner") {
      return jsonResponse({ error: "forbidden" }, { status: 403 });
    }
  }

  const sql = getSql();
  const result = await registerA2p(sql, tenantId, body.action, {
    twilioFetch: fetch,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    platformBrandSid: TWILIO_A2P_BRAND_SID,
    privacyPolicyUrl: A2P_PRIVACY_POLICY_URL,
    termsAndConditionsUrl: A2P_TERMS_URL,
    logger,
  });

  if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
  return jsonResponse({ a2p_status: result.a2p_status, campaign_sid: result.campaign_sid });
});
