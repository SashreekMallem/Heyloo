// Deno-only glue (excluded from ../../tsconfig.json). Builds the LLM client from
// env — lazily, per request, and never throwing: a missing key resolves to
// `{ok: false, missing}` so the feature answers "AI not configured" instead of
// crashing the isolate at module load (task LLM-1).
import { resolveLlm, resolveLlmForBatch } from "../providers/llm/registry.ts";
import type { LlmResolution } from "../providers/llm/types.ts";

const env = (name: string): string | undefined => Deno.env.get(name) ?? undefined;

export function resolveLlmFromEnv(): LlmResolution {
  return resolveLlm(env, { fetchImpl: fetch });
}

export function resolveLlmForBatchFromEnv(batchId: string): LlmResolution {
  return resolveLlmForBatch(env, { fetchImpl: fetch }, batchId);
}
