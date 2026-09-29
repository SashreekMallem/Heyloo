import { ANTHROPIC_BATCH_ID_PATTERN, createAnthropicClient } from "./anthropic.ts";
import {
  createGeminiClient,
  GEMINI_BATCH_ID_PATTERN,
  GEMINI_SAFETY_THRESHOLDS,
  type GeminiSafetyThreshold,
} from "./gemini.ts";
import type { LlmTransport } from "./http.ts";
import type { LlmProviderId, LlmResolution, LlmTier } from "./types.ts";
import { isLlmProviderId } from "./types.ts";

/**
 * Picks the LLM provider (docs/design/LLM_PROVIDERS.md). `LLM_PROVIDER` =
 * `gemini` | `anthropic`. Unset means Gemini (usable when `GEMINI_API_KEY` is
 * set); Anthropic is used ONLY when explicitly chosen. Fails CLOSED and never
 * throws: a missing key, or an unrecognized `LLM_PROVIDER`, resolves to
 * `{ok: false, reason, missing}` so a feature can report a clear "AI not
 * configured" state instead of crashing at module load (no `requireEnv` for LLM
 * keys anywhere). There is no silent fallback to the other vendor.
 *
 * Env (each documented in .env.example):
 *   LLM_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL, GEMINI_MODEL_QUALITY,
 *   GEMINI_MODEL_VISION, GEMINI_THINKING_HEADROOM_TOKENS, GEMINI_SAFETY_THRESHOLD,
 *   ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_MODEL_QUALITY, ANTHROPIC_MODEL_VISION.
 */

export type EnvGetter = (name: string) => string | undefined;

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

function modelsFromEnv(
  env: EnvGetter,
  prefix: "GEMINI" | "ANTHROPIC",
): Partial<Record<LlmTier, string>> {
  const base = nonEmpty(env(`${prefix}_MODEL`));
  const quality = nonEmpty(env(`${prefix}_MODEL_QUALITY`)) ?? base;
  const vision = nonEmpty(env(`${prefix}_MODEL_VISION`)) ?? base;
  return {
    ...(base ? { fast: base } : {}),
    ...(quality ? { quality } : {}),
    ...(vision ? { vision } : {}),
  };
}

/** The provider id `LLM_PROVIDER` names (Gemini when unset). May be an
 * unrecognized value — `resolveLlm` then fails closed. */
export function selectedLlmProvider(env: EnvGetter): string {
  return nonEmpty(env("LLM_PROVIDER"))?.toLowerCase() ?? "gemini";
}

function buildProvider(id: LlmProviderId, env: EnvGetter, transport: LlmTransport): LlmResolution {
  if (id === "gemini") {
    const apiKey = nonEmpty(env("GEMINI_API_KEY"));
    if (!apiKey) {
      return { ok: false, reason: "not_configured", providerId: id, missing: ["GEMINI_API_KEY"] };
    }
    const headroomRaw = nonEmpty(env("GEMINI_THINKING_HEADROOM_TOKENS"));
    const headroom = headroomRaw === undefined ? Number.NaN : Number(headroomRaw);
    const threshold = nonEmpty(env("GEMINI_SAFETY_THRESHOLD"))?.toUpperCase();
    return {
      ok: true,
      client: createGeminiClient({
        apiKey,
        transport,
        models: modelsFromEnv(env, "GEMINI"),
        ...(Number.isInteger(headroom) && headroom >= 0
          ? { thinkingHeadroomTokens: headroom }
          : {}),
        ...(GEMINI_SAFETY_THRESHOLDS.includes(threshold as GeminiSafetyThreshold)
          ? { safetyThreshold: threshold as GeminiSafetyThreshold }
          : {}),
      }),
    };
  }
  const apiKey = nonEmpty(env("ANTHROPIC_API_KEY"));
  if (!apiKey) {
    return { ok: false, reason: "not_configured", providerId: id, missing: ["ANTHROPIC_API_KEY"] };
  }
  return {
    ok: true,
    client: createAnthropicClient({ apiKey, transport, models: modelsFromEnv(env, "ANTHROPIC") }),
  };
}

export function resolveLlm(env: EnvGetter, transport: LlmTransport): LlmResolution {
  const id = selectedLlmProvider(env);
  if (!isLlmProviderId(id)) {
    return { ok: false, reason: "unknown_provider", providerId: id, missing: [] };
  }
  return buildProvider(id, env, transport);
}

/** Which vendor issued a batch id (ids are self-describing), so a batch
 * submitted before a provider switch is still collected from its own vendor. */
export function batchIdProvider(batchId: string): LlmProviderId | null {
  if (GEMINI_BATCH_ID_PATTERN.test(batchId)) return "gemini";
  if (ANTHROPIC_BATCH_ID_PATTERN.test(batchId)) return "anthropic";
  return null;
}

/** The client that can read `batchId` — its issuing vendor, when configured. */
export function resolveLlmForBatch(
  env: EnvGetter,
  transport: LlmTransport,
  batchId: string,
): LlmResolution {
  const issuer = batchIdProvider(batchId);
  return issuer ? buildProvider(issuer, env, transport) : resolveLlm(env, transport);
}

/** JSON body for the HTTP "AI not configured" answer (HTTP 503) — names the
 * missing env vars so the portal / owner can act on it. */
export function aiNotConfiguredBody(state: {
  reason: "not_configured" | "unknown_provider";
  providerId: string;
  missing: readonly string[];
}): { error: "ai_not_configured"; provider: string; reason: string; missing: string[] } {
  return {
    error: "ai_not_configured",
    provider: state.providerId,
    reason: state.reason,
    missing: [...state.missing],
  };
}
