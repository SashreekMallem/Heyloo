// Deno entrypoint (excluded from ../tsconfig.json). This is the hot path
// (BACKEND_SPEC §7.2, SYSTEM_DESIGN §5): p50 <200ms, p95 <500ms, per-tool
// budgets with a graceful fallback (`toolBudget` in handler.ts), never
// silence and never a non-200 for a business-logic failure. verify_jwt is
// false in supabase/config.toml — auth is the Retell HMAC signature
// verified below.
import { ToolCircuitBreaker } from "../_shared/circuit-breaker.ts";
import { runInBackground } from "../_shared/deno/background.ts";
import { getSql, isDbConnectionWarm, markDbConnectionUsed } from "../_shared/deno/db.ts";
import { optionalEnv, requireRetellWebhookKey } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { fallbackEnvelope, jsonResponse } from "../_shared/responses.ts";
import { verifyRetellSignature } from "../_shared/retell-signature.ts";
import { withTimeout } from "../_shared/timeout.ts";
import {
  recordToolStat,
  resolveTelemetryTenantId,
  roundMs,
  serverTimingHeader,
  type ToolStageTimings,
} from "../_shared/tool-stats.ts";
import {
  countsAsBreakerFailure,
  type DispatchDeps,
  dispatchTool,
  isKnownTool,
  resolveEnvelopeCallId,
  toolBudget,
  validateEnvelope,
} from "./handler.ts";

// Re-exported so `withTimeout`'s actual race/rejection/no-dangling-timer
// behavior can be asserted from `_shared/timeout.test.ts` — this file itself
// is excluded from tsconfig.json/Vitest (Deno entrypoint), see that test
// file's coverage of the race this hot path relies on.
export { withTimeout };

const logger = createLogger({ fn: "voice-tools" });
const RETELL_WEBHOOK_SIGNING_SECRET = requireRetellWebhookKey();
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
// HOTPATH: the AWS region this isolate runs in, set by the Edge Runtime
// (supabase.com/docs/guides/functions/regional-invocation: "SB_REGION: The
// AWS region function was invoked"). Recorded on every tool_health row.
const SB_REGION = optionalEnv("SB_REGION") ?? null;

// Module-scope — survives across invocations on the same warm instance
// (SYSTEM_DESIGN §5's per-tool rolling-window circuit breaker).
const breaker = new ToolCircuitBreaker();

// EDGE_AUDIT M2: server-side per-statement cap, under every per-tool budget
// (`toolBudget`) so the DB itself kills a hung statement — see
// `_shared/deno/db.ts`'s `getSql` docstring for why this is a real,
// server-enforced GUC and not just another JS-level race.
const STATEMENT_TIMEOUT_MS = 1_200;

// HOTPATH stage attribution (see `ToolStageTimings`): per-isolate state.
const ISOLATE_STARTED_AT = performance.now();
let isolateSeq = 0;
let prevTelemetryMs: number | null = null;

const defer: NonNullable<DispatchDeps["defer"]> = (label, task) =>
  runInBackground(task, (e) =>
    logger.error("voice_tools_deferred_task_failed", { task: label, error: String(e) }),
  );

Deno.serve(async (req: Request) => {
  const t0 = performance.now();
  isolateSeq += 1;
  const seq = isolateSeq;
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }
  const dbWarm = isDbConnectionWarm();

  const rawBody = await req.text();
  const tBody = performance.now();
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
  const tVerify = performance.now();

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
  const { name, args, call } = envelope.data;
  const call_id = resolveEnvelopeCallId(envelope.data);
  if (!call_id) {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }

  // Circuit open (or an unrecognized tool name) short-circuits to the
  // graceful fallback immediately — no DB round trip at all.
  if (!isKnownTool(name) || breaker.isOpen(name)) {
    if (breaker.isOpen(name)) {
      logger.warn("voice_tools_circuit_open", { tool: name, call_id });
    }
    return jsonResponse(fallbackEnvelope());
  }

  const sql = getSql({ statementTimeoutMs: STATEMENT_TIMEOUT_MS, profile: "hot_path" });
  const budget = toolBudget(name);
  const tParse = performance.now();
  let success = true;
  let errorType: string | undefined;
  let responseBody: unknown;
  // CALL-2 fix: `dispatchTool` fills this in once it resolves a real
  // tenant, so the `tool_health` row below is tagged correctly instead of
  // always `tenant_id: null` regardless of whether resolution succeeded.
  // HOTPATH: it also reports the context/tool stage timings and outcome.
  const telemetry: NonNullable<DispatchDeps["telemetry"]> = {
    tenantId: null,
    contextMs: null,
    toolMs: null,
  };

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
          telemetry,
          now: () => performance.now(),
          defer,
          budget,
        },
        call_id,
        name,
        args,
        call,
      ),
      budget.hardAbortMs,
    );
    markDbConnectionUsed();
  } catch (err) {
    success = false;
    errorType = err instanceof Error ? err.message : String(err);
    logger.error("voice_tools_dispatch_error", { tool: name, call_id, error: errorType });
    responseBody = fallbackEnvelope();
  }

  const tDone = performance.now();
  if (success && !countsAsBreakerFailure(telemetry.outcome)) breaker.recordSuccess(name);
  else breaker.recordFailure(name);

  const stages: ToolStageTimings = {
    v: 1,
    region: SB_REGION,
    isolate_seq: seq,
    isolate_age_ms: roundMs(t0 - ISOLATE_STARTED_AT),
    db_warm: dbWarm,
    body_ms: roundMs(tBody - t0),
    verify_ms: roundMs(tVerify - tBody),
    parse_ms: roundMs(tParse - tVerify),
    context_ms: telemetry.contextMs == null ? null : roundMs(telemetry.contextMs),
    tool_ms: telemetry.toolMs == null ? null : roundMs(telemetry.toolMs),
    total_ms: roundMs(tDone - t0),
    budget_ms: budget.budgetMs,
    outcome: success
      ? (telemetry.outcome ?? "ok")
      : errorType === "tool_call_timeout"
        ? "timeout"
        : "error",
    prev_telemetry_ms: prevTelemetryMs,
  };

  // Telemetry never delays the answer: the insert is scheduled here and
  // kept alive by `EdgeRuntime.waitUntil` after the response is returned.
  runInBackground(
    async () => {
      const startedAt = performance.now();
      await recordToolStat(sql, {
        // OPS-5 (docs/BUILD_NOTES.md): tags the health row with the
        // per-call `heyloo_tenant_id` dynamic variable when present (every
        // batch-test scenario sets it) instead of the resolved
        // `telemetry.tenantId` alone — see resolveTelemetryTenantId's own
        // docstring for why the latter can be stale for a batch-test call
        // specifically. No-op for a real call.
        tenantId: resolveTelemetryTenantId(telemetry.tenantId, call),
        toolName: name,
        callId: call_id,
        // Dispatch time only — the historical meaning of latency_ms.
        latencyMs: Math.round(tDone - tParse),
        success,
        errorType,
        stages,
      });
      prevTelemetryMs = roundMs(performance.now() - startedAt);
    },
    (e) => logger.error("voice_tools_stat_emit_failed", { error: String(e) }),
  );

  // Never a non-200 for a business-logic failure (BACKEND_SPEC §7.2) —
  // only the auth/parse failures above return non-200.
  return jsonResponse(responseBody, { headers: { "server-timing": serverTimingHeader(stages) } });
});
