import { describe, expect, it } from "vitest";
import type { SqlClient } from "../types.ts";
import { anthropicCostCents, recordTextAgentLlmCost } from "./llm-cost.ts";

describe("anthropicCostCents", () => {
  it("prices Sonnet 5 at $2 / MTok input and $10 / MTok output", () => {
    // 1,000 in + 200 out = $0.002 + $0.002 = $0.004 = 0.4 cents
    const { cents, pricedAs } = anthropicCostCents("claude-sonnet-5", {
      input_tokens: 1000,
      output_tokens: 200,
    });
    expect(cents).toBeCloseTo(0.4, 8);
    expect(pricedAs).toBe("claude-sonnet-5");
  });

  it("matches dated/suffixed model ids by prefix and prices Haiku 4.5 at $1 / $5", () => {
    const { cents, pricedAs } = anthropicCostCents("claude-haiku-4-5-20251001", {
      input_tokens: 2000,
      output_tokens: 1000,
    });
    expect(pricedAs).toBe("claude-haiku-4-5");
    expect(cents).toBeCloseTo(0.7, 8); // $0.002 + $0.005
  });

  it("falls back to Sonnet 5 pricing for an unknown model and says so", () => {
    expect(
      anthropicCostCents("some-future-model", { input_tokens: 1000, output_tokens: 0 }).pricedAs,
    ).toBe("claude-sonnet-5");
  });
});

describe("recordTextAgentLlmCost", () => {
  it("writes an idempotent estimate row and never throws", async () => {
    const calls: { text: string; values: unknown[] }[] = [];
    const ok = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join(" "), values });
      return Promise.resolve([]);
    }) as SqlClient;
    await recordTextAgentLlmCost(ok, {
      tenantId: "t1",
      model: "claude-sonnet-5",
      usage: { input_tokens: 1000, output_tokens: 200 },
      channel: "sms",
      externalRef: "ref-1",
    });
    expect(calls[0]?.text).toContain("on conflict (provider, product, external_ref)");
    expect(calls[0]?.values).toContain("ref-1");

    const errors: unknown[] = [];
    const bad = (() => Promise.reject(new Error("db down"))) as unknown as SqlClient;
    await expect(
      recordTextAgentLlmCost(
        bad,
        {
          tenantId: "t1",
          model: "claude-sonnet-5",
          usage: { input_tokens: 1, output_tokens: 1 },
          channel: "web_chat",
          externalRef: "ref-2",
        },
        (e) => errors.push(e),
      ),
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
