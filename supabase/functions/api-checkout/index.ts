// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; the authenticated
// user's id (`sub`) is what this function trusts, never a body-supplied
// user id (BACKEND_SPEC §7.9-adjacent auth convention).
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handleCheckout } from "./handler.ts";

const logger = createLogger({ fn: "api-checkout" });
// SIGNUP-1 (docs/BUILD_NOTES.md): read optionally, not via `requireEnv` —
// Stripe is not configured on this platform yet, and `requireEnv` throws at
// module load (Deno cold-start), which crashed EVERY invocation of this
// function with an opaque `WORKER_ERROR` before a single line of request
// handling ran — including `handleCheckout`'s own graceful
// `stripe_not_configured` check below `platform_settings.price_card_<vertical>`,
// which could never be reached. Fails closed at request time instead (never
// calls Stripe without a real key), with a clean, logged, user-facing error.
const STRIPE_SECRET_KEY = optionalEnv("STRIPE_SECRET_KEY");
const CHECKOUT_SUCCESS_URL = optionalEnv("CHECKOUT_SUCCESS_URL");
const CHECKOUT_CANCEL_URL = optionalEnv("CHECKOUT_CANCEL_URL");

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

  if (!STRIPE_SECRET_KEY || !CHECKOUT_SUCCESS_URL || !CHECKOUT_CANCEL_URL) {
    logger.error("api_checkout_stripe_not_configured_at_request");
    return jsonResponse({ error: "stripe_not_configured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const sql = getSql();
  const result = await handleCheckout(sql, userId, body, {
    stripeFetch: fetch,
    stripeSecretKey: STRIPE_SECRET_KEY,
    successUrl: CHECKOUT_SUCCESS_URL,
    cancelUrl: CHECKOUT_CANCEL_URL,
    randomSuffix: () => crypto.randomUUID().slice(0, 8),
    logger,
  });

  if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status });
  return jsonResponse({ tenant_id: result.tenant_id, checkout_url: result.checkout_url });
});
