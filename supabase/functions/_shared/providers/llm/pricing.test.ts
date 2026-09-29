import { describe, expect, it } from "vitest";
import { llmCostCents } from "./pricing.ts";

describe("llmCostCents — Gemini (ai.google.dev/gemini-api/docs/pricing, Standard tier)", () => {
  it("prices gemini-3.5-flash-lite at $0.30 in / $2.50 out per 1M tokens", () => {
    const { cents, pricedAs } = llmCostCents({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    expect(pricedAs).toBe("gemini-3.5-flash-lite");
    expect(cents).toBeCloseTo(30 + 250, 8);
  });

  it("does not mistake gemini-3.5-flash-lite for gemini-3.5-flash (longest prefix wins)", () => {
    expect(
      llmCostCents({
        provider: "gemini",
        model: "gemini-3.5-flash-lite-001",
        usage: { inputTokens: 0, outputTokens: 0 },
      }).pricedAs,
    ).toBe("gemini-3.5-flash-lite");
    expect(
      llmCostCents({
        provider: "gemini",
        model: "gemini-3.5-flash",
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      }).cents,
    ).toBeCloseTo(150, 8);
  });

  it("applies the announced 2027-01-01 price change for gemini-3.8-flash", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const before = llmCostCents({
      provider: "gemini",
      model: "gemini-3.8-flash",
      usage,
      now: new Date("2026-12-31T23:59:59Z"),
    });
    const after = llmCostCents({
      provider: "gemini",
      model: "gemini-3.8-flash",
      usage,
      now: new Date("2027-01-01T00:00:00Z"),
    });
    expect(before.cents).toBeCloseTo(75 + 375, 8);
    expect(after.cents).toBeCloseTo(150 + 750, 8);
  });

  it("prices an unknown Gemini model at the pricier fallback, never at zero", () => {
    const r = llmCostCents({
      provider: "gemini",
      model: "gemini-9-future",
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    expect(r.pricedAs).toBe("gemini-3.5-flash");
    expect(r.cents).toBeGreaterThan(0);
  });
});

describe("llmCostCents — Anthropic (unchanged pre-port prices)", () => {
  it("prices Sonnet 5 at $2 / MTok input and $10 / MTok output", () => {
    const { cents, pricedAs } = llmCostCents({
      provider: "anthropic",
      model: "claude-sonnet-5",
      usage: { inputTokens: 1000, outputTokens: 200 },
    });
    expect(cents).toBeCloseTo(0.4, 8);
    expect(pricedAs).toBe("claude-sonnet-5");
  });

  it("matches dated/suffixed ids by prefix and prices Haiku 4.5 at $1 / $5", () => {
    const { cents, pricedAs } = llmCostCents({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      usage: { inputTokens: 2000, outputTokens: 1000 },
    });
    expect(pricedAs).toBe("claude-haiku-4-5");
    expect(cents).toBeCloseTo(0.7, 8);
  });

  it("falls back to Sonnet 5 pricing for an unknown model and says so", () => {
    expect(
      llmCostCents({
        provider: "anthropic",
        model: "some-future-model",
        usage: { inputTokens: 1000, outputTokens: 0 },
      }).pricedAs,
    ).toBe("claude-sonnet-5");
  });

  it("ignores negative token counts", () => {
    expect(
      llmCostCents({
        provider: "anthropic",
        model: "claude-sonnet-5",
        usage: { inputTokens: -5, outputTokens: -5 },
      }).cents,
    ).toBe(0);
  });
});
