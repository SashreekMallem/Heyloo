// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; the authenticated
// user's id (`sub`) is what this function trusts, never a body-supplied user
// id (same convention as api-checkout / api-adapter-connect). handler.ts then
// requires an owner/admin membership.
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handleBillingPortal } from "./handler.ts";

const logger = createLogger({ fn: "api-billing-portal" });
// Read at request time, never `requireEnv` at module load (OPS-1/OPS-5): an
// unset Stripe key answers a clean 503 instead of an opaque WORKER_ERROR.
const STRIPE_SECRET_KEY = optionalEnv("STRIPE_SECRET_KEY");
const APP_BASE_URL = optionalEnv("APP_BASE_URL") ?? "https://heyloo.app";

function decodeSub(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const parts = authHeader.slice("Bearer ".length).split(".");
    const payload = JSON.parse(atob(parts[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")) as {
      sub?: string;
    };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const userId = decodeSub(req.headers.get("authorization"));
  if (!userId) return jsonResponse({ error: "unauthorized" }, { status: 401 });

  if (!STRIPE_SECRET_KEY) {
    logger.error("api_billing_portal_stripe_not_configured");
    return jsonResponse({ error: "not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const result = await handleBillingPortal(getSql(), userId, body, {
    stripeFetch: fetch,
    stripeSecretKey: STRIPE_SECRET_KEY,
    appBaseUrl: APP_BASE_URL,
    logger,
  });
  if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
  return jsonResponse(result.body);
});
