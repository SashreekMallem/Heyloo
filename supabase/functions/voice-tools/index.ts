// Deno entrypoint (excluded from ../tsconfig.json). This is the hot path
// (BACKEND_SPEC §7.2, SYSTEM_DESIGN §5): p50 <200ms, p95 <500ms, hard abort
// at 1.5s -> graceful fallback, never silence and never a non-200 for a
// business-logic failure. verify_jwt is false in supabase/config.toml —
// auth is the Retell HMAC signature verified below.
import { ToolCircuitBreaker } from "../_shared/circuit-breaker.ts";
import { runInBackground } from "../_shared/deno/background.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { fallbackEnvelope, jsonResponse } from "../_shared/responses.ts";
import { verifyRetellSignature } from "../_shared/retell-signature.ts";
import { withTimeout } from "../_shared/timeout.ts";
import { recordToolStat } from "../_shared/tool-stats.ts";
import { dispatchTool, isKnownTool, validateEnvelope } from "./handler.ts";

// Re-exported so `withTimeout`'s actual race/rejection/no-dangling-timer
// behavior can be asserted from `_shared/timeout.test.ts` — this file itself
// is excluded from tsconfig.json/Vitest (Deno entrypoint), see that test
// file's coverage of the race this hot path relies on.
export { withTimeout };

const logger = createLogger({ fn: "voice-tools" });
const RETELL_WEBHOOK_SIGNING_SECRET = requireEnv("RETELL_WEBHOOK_SIGNING_SECRET");
const STRIPE_SECRET_KEY = optionalEnv("STRIPE_SECRET_KEY") ?? "";
const PAYMENT_LINK_SUCCESS_URL =
  optionalEnv("PAYMENT_LINK_SUCCESS_URL") ?? "https://heyloo.app/pay/success";
const PAYMENT_LINK_CANCEL_URL =
  optionalEnv("PAYMENT_LINK_CANCEL_URL") ?? "https://heyloo.app/pay/cancelled";
// restaurant.md Finding B4 / VERIFY-12 — unset until a Geocodio key is
// provisioned; `create_order`'s address-save step no-ops without it.
const GEOCODE_API_KEY = optionalEnv("GEOCODE_API_KEY");
// FIX_REQUESTS.md — the base URL the dental-intake link is built against
// (create_booking.ts, dental-only, best-effort post-booking side effect).
const APP_BASE_URL = optionalEnv("APP_BASE_URL") ?? "https://heyloo.app";

// Module-scope — survives across invocations on the same warm instance
// (SYSTEM_DESIGN §5's per-tool rolling-window circuit breaker).
const breaker = new ToolCircuitBreaker();

const HARD_ABORT_MS = 1_500;
// EDGE_AUDIT M2: comfortably under HARD_ABORT_MS so the DB itself kills a
// hung query's server-side work at (or before) the same moment the caller
// gets the fallback envelope — see `_shared/deno/db.ts`'s `getSql` docstring
// for why this is a real, server-enforced GUC and not just another JS-level
// race.
const STATEMENT_TIMEOUT_MS = 1_200;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const rawBody = await req.text();
  const verification = await verifyRetellSignature({
    rawBody,
    header: req.headers.get("x-retell-signature"),
    secret: RETELL_WEBHOOK_SIGNING_SECRET,
    now: new Date(),
  });
  if (!verification.valid) {
    logger.warn("voice_tools_signature_rejected", { reason: verification.reason });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const envelope = validateEnvelope(parsedBody);
  if (!envelope.success) {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  const { call_id, name, args } = envelope.data;

  // Circuit open (or an unrecognized tool name) short-circuits to the
  // graceful fallback immediately — no DB round trip at all.
  if (!isKnownTool(name) || breaker.isOpen(name)) {
    if (breaker.isOpen(name)) {
      logger.warn("voice_tools_circuit_open", { tool: name, call_id });
    }
    return jsonResponse(fallbackEnvelope());
  }

  const sql = getSql({ statementTimeoutMs: STATEMENT_TIMEOUT_MS });
  const startedAt = Date.now();
  let success = true;
  let errorType: string | undefined;
  let responseBody: unknown;

  try {
    responseBody = await withTimeout(
      dispatchTool(
        {
          sql,
          logger,
          paymentLink: {
            fetchImpl: fetch,
            stripeSecretKey: STRIPE_SECRET_KEY,
            successUrl: PAYMENT_LINK_SUCCESS_URL,
            cancelUrl: PAYMENT_LINK_CANCEL_URL,
          },
          dentalIntake: { appBaseUrl: APP_BASE_URL },
          ...(GEOCODE_API_KEY ? { geocode: { fetchImpl: fetch, apiKey: GEOCODE_API_KEY } } : {}),
        },
        call_id,
        name,
        args,
      ),
      HARD_ABORT_MS,
    );
  } catch (err) {
    success = false;
    errorType = err instanceof Error ? err.message : String(err);
    logger.error("voice_tools_dispatch_error", { tool: name, call_id, error: errorType });
    responseBody = fallbackEnvelope();
  }

  const latencyMs = Date.now() - startedAt;
  if (success) breaker.recordSuccess(name);
  else breaker.recordFailure(name);

  runInBackground(
    () =>
      recordToolStat(sql, {
        tenantId: null,
        toolName: name,
        callId: call_id,
        latencyMs,
        success,
        errorType,
      }),
    (e) => logger.error("voice_tools_stat_emit_failed", { error: String(e) }),
  );

  // Never a non-200 for a business-logic failure (BACKEND_SPEC §7.2) —
  // only the auth/parse failures above return non-200.
  return jsonResponse(responseBody);
});
