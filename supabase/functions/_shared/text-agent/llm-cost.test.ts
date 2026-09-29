import { describe, expect, it } from "vitest";
import type { SqlClient } from "../types.ts";
import { recordTextAgentLlmCost } from "./llm-cost.ts";

function recordingSql(): { sql: SqlClient; calls: { text: string; values: unknown[] }[] } {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(" "), values });
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

describe("recordTextAgentLlmCost", () => {
  it("writes an idempotent Gemini estimate row priced from the docs table", async () => {
    const { sql, calls } = recordingSql();
    await recordTextAgentLlmCost(sql, {
      tenantId: "t1",
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      usage: { inputTokens: 1000, outputTokens: 200 },
      channel: "sms",
      externalRef: "ref-1",
    });
    expect(calls[0]?.text).toContain("on conflict (provider, product, external_ref)");
    expect(calls[0]?.values).toContain("ref-1");
    expect(calls[0]?.values).toContain("gemini");
    expect(calls[0]?.values).toContain("gemini-3.5-flash-lite");
    // 1,000 in x $0.30/M + 200 out x $2.50/M = $0.0003 + $0.0005 = 0.08 cents
    const cents = calls[0]?.values.find((v) => typeof v === "number" && v > 0 && v < 1);
    expect(cents).toBeCloseTo(0.08, 8);
    const raw = calls[0]?.values.find((v) => typeof v === "object" && v !== null) as {
      input_tokens: number;
      output_tokens: number;
      priced_as: string;
      channel: string;
    };
    expect(raw).toEqual({
      input_tokens: 1000,
      output_tokens: 200,
      priced_as: "gemini-3.5-flash-lite",
      channel: "sms",
    });
  });

  it("records the vendor id for an Anthropic-configured deploy too", async () => {
    const { sql, calls } = recordingSql();
    await recordTextAgentLlmCost(sql, {
      tenantId: "t1",
      provider: "anthropic",
      model: "claude-sonnet-5",
      usage: { inputTokens: 1000, outputTokens: 200 },
      channel: "web_chat",
      externalRef: "ref-a",
    });
    expect(calls[0]?.values).toContain("anthropic");
    expect(calls[0]?.values.find((v) => typeof v === "number" && v > 0 && v < 1)).toBeCloseTo(
      0.4,
      8,
    );
  });

  it("never throws when the ledger write fails", async () => {
    const errors: unknown[] = [];
    const bad = (() => Promise.reject(new Error("db down"))) as unknown as SqlClient;
    await expect(
      recordTextAgentLlmCost(
        bad,
        {
          tenantId: "t1",
          provider: "gemini",
          model: "gemini-3.5-flash-lite",
          usage: { inputTokens: 1, outputTokens: 1 },
          channel: "web_chat",
          externalRef: "ref-2",
        },
        (e) => errors.push(e),
      ),
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
