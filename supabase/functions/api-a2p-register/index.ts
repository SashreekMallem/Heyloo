// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true —
// authenticated tenant owner, OR triggered internally by the provisioning
// saga (x-internal-secret) — same auth convention as api-provision/index.ts.
//
// MESSAGING-1: every provider/registration env var is OPTIONAL at module
// scope (the old module-scope requireEnv crashed cold start on any deploy
// without Twilio A2P secrets); the handler answers 503/501 honestly instead.
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { buildMessagingRegistryFromEnv } from "../_shared/providers/messaging/registry.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { registerA2p } from "./handler.ts";

const logger = createLogger({ fn: "api-a2p-register" });
const REGISTRY = buildMessagingRegistryFromEnv((name) => Deno.env.get(name), fetch);
const A2P_INTERNAL_SECRET = optionalEnv("A2P_INTERNAL_SECRET");

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
  const isInternalCall =
    !!internalSecret &&
    !!A2P_INTERNAL_SECRET &&
    timingSafeEqual(internalSecret, A2P_INTERNAL_SECRET);
  if (!isInternalCall) {
    const claims = decodeJwtClaims(req.headers.get("authorization"));
    if (claims?.app_metadata?.tenant_id !== tenantId || claims.app_metadata?.role !== "owner") {
      return jsonResponse({ error: "forbidden" }, { status: 403 });
    }
  }

  const result = await registerA2p(getSql(), tenantId, body.action, {
    registry: REGISTRY,
    brandRef: optionalEnv("TWILIO_A2P_BRAND_SID") ?? null,
    privacyPolicyUrl: optionalEnv("A2P_PRIVACY_POLICY_URL") ?? null,
    termsAndConditionsUrl: optionalEnv("A2P_TERMS_URL") ?? null,
    logger,
  });

  if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
  return jsonResponse({ a2p_status: result.a2p_status, campaign_sid: result.campaign_sid });
});
