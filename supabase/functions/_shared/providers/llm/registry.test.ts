import { describe, expect, it } from "vitest";
import type { LlmTransport } from "./http.ts";
import {
  aiNotConfiguredBody,
  batchIdProvider,
  resolveLlm,
  resolveLlmForBatch,
  selectedLlmProvider,
} from "./registry.ts";

const transport: LlmTransport = { fetchImpl: async () => new Response("{}") };
const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

describe("resolveLlm — provider selection (docs/design/LLM_PROVIDERS.md)", () => {
  it("defaults to Gemini when GEMINI_API_KEY is set and LLM_PROVIDER is unset", () => {
    const r = resolveLlm(envOf({ GEMINI_API_KEY: "g" }), transport);
    expect(r.ok && r.client.provider).toBe("gemini");
  });

  it("does NOT fall back to Anthropic just because an Anthropic key exists", () => {
    const r = resolveLlm(envOf({ ANTHROPIC_API_KEY: "a" }), transport);
    expect(r).toEqual({
      ok: false,
      reason: "not_configured",
      providerId: "gemini",
      missing: ["GEMINI_API_KEY"],
    });
  });

  it("uses Anthropic only when LLM_PROVIDER=anthropic (case-insensitive) and its key is set", () => {
    const r = resolveLlm(
      envOf({ LLM_PROVIDER: "Anthropic", ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" }),
      transport,
    );
    expect(r.ok && r.client.provider).toBe("anthropic");
  });

  it("fails closed, naming the key, when the chosen provider has none — no silent switch to the other vendor", () => {
    expect(
      resolveLlm(envOf({ LLM_PROVIDER: "anthropic", GEMINI_API_KEY: "g" }), transport),
    ).toEqual({
      ok: false,
      reason: "not_configured",
      providerId: "anthropic",
      missing: ["ANTHROPIC_API_KEY"],
    });
    expect(
      resolveLlm(envOf({ LLM_PROVIDER: "gemini", ANTHROPIC_API_KEY: "a" }), transport),
    ).toMatchObject({
      ok: false,
      missing: ["GEMINI_API_KEY"],
    });
  });

  it("treats blank/whitespace keys as unset and rejects an unknown LLM_PROVIDER", () => {
    expect(resolveLlm(envOf({ GEMINI_API_KEY: "   " }), transport)).toMatchObject({ ok: false });
    expect(resolveLlm(envOf({ LLM_PROVIDER: "openai", GEMINI_API_KEY: "g" }), transport)).toEqual({
      ok: false,
      reason: "unknown_provider",
      providerId: "openai",
      missing: [],
    });
  });

  it("never throws with an empty environment", () => {
    expect(() => resolveLlm(envOf({}), transport)).not.toThrow();
    expect(selectedLlmProvider(envOf({}))).toBe("gemini");
  });
});

describe("resolveLlm — model ids from env", () => {
  it("uses the documented stable default (gemini-3.5-flash-lite) for every tier when nothing is set", () => {
    const r = resolveLlm(envOf({ GEMINI_API_KEY: "g" }), transport);
    if (!r.ok) throw new Error("expected ok");
    expect(r.client.modelFor("fast")).toBe("gemini-3.5-flash-lite");
    expect(r.client.modelFor("quality")).toBe("gemini-3.5-flash-lite");
    expect(r.client.modelFor("vision")).toBe("gemini-3.5-flash-lite");
  });

  it("GEMINI_MODEL sets the base; QUALITY and VISION default to it and can be overridden separately", () => {
    const r = resolveLlm(
      envOf({
        GEMINI_API_KEY: "g",
        GEMINI_MODEL: "gemini-3.6-flash",
        GEMINI_MODEL_VISION: "gemini-3.8-flash",
      }),
      transport,
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.client.modelFor("fast")).toBe("gemini-3.6-flash");
    expect(r.client.modelFor("quality")).toBe("gemini-3.6-flash");
    expect(r.client.modelFor("vision")).toBe("gemini-3.8-flash");
  });

  it("reads ANTHROPIC_MODEL* for the Anthropic adapter", () => {
    const r = resolveLlm(
      envOf({
        LLM_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "a",
        ANTHROPIC_MODEL_QUALITY: "claude-opus-5-5",
      }),
      transport,
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.client.modelFor("quality")).toBe("claude-opus-5-5");
    expect(r.client.modelFor("fast")).toBe("claude-haiku-4-5");
  });
});

describe("batch routing", () => {
  it("identifies the issuing vendor from the batch id", () => {
    expect(batchIdProvider("batches/123456789")).toBe("gemini");
    expect(batchIdProvider("msgbatch_01AbC")).toBe("anthropic");
    expect(batchIdProvider("mystery")).toBeNull();
  });

  it("collects a batch from its own vendor even after LLM_PROVIDER switched", () => {
    const env = envOf({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" });
    const anthropicBatch = resolveLlmForBatch(env, transport, "msgbatch_01abc");
    expect(anthropicBatch.ok && anthropicBatch.client.provider).toBe("anthropic");
    const geminiBatch = resolveLlmForBatch(env, transport, "batches/9");
    expect(geminiBatch.ok && geminiBatch.client.provider).toBe("gemini");
  });

  it("reports the issuing vendor's missing key rather than using the wrong vendor", () => {
    const r = resolveLlmForBatch(envOf({ GEMINI_API_KEY: "g" }), transport, "msgbatch_01abc");
    expect(r).toMatchObject({ ok: false, providerId: "anthropic", missing: ["ANTHROPIC_API_KEY"] });
  });
});

describe("aiNotConfiguredBody", () => {
  it("names the provider and the env vars to set", () => {
    expect(
      aiNotConfiguredBody({
        reason: "not_configured",
        providerId: "gemini",
        missing: ["GEMINI_API_KEY"],
      }),
    ).toEqual({
      error: "ai_not_configured",
      provider: "gemini",
      reason: "not_configured",
      missing: ["GEMINI_API_KEY"],
    });
  });
});
