import type { LlmProviderId, LlmUsage } from "./types.ts";

/**
 * Token pricing for LLM cost accounting (COCKPIT-1 records the text agent's
 * LLM cost in `cost_events`; LLM-1 makes that provider-neutral).
 *
 * Gemini (ai.google.dev/gemini-api/docs/pricing, "Standard" paid tier, verified
 * 2026-09-29; output price INCLUDES thinking tokens, so `LlmUsage.outputTokens`
 * already sums candidate + thought tokens):
 *   gemini-3.5-flash-lite  $0.30 in / $2.50 out per 1M tokens
 *   gemini-3.8-flash / 3.7-flash / 3.6-flash  $0.75 / $3.75 through 2026-12-31,
 *                                             $1.50 / $7.50 from 2027-01-01
 *   gemini-3.5-flash       $1.50 / $9.00
 *   gemini-3.1-flash-lite  $0.25 / $1.50
 *   gemini-2.5-flash       $0.30 / $2.50    gemini-2.5-flash-lite  $0.10 / $0.40
 *   gemini-2.5-pro         $1.25 / $10.00 (prompts <= 200k tokens)
 * Anthropic (platform.claude.com/docs/en/about-claude/pricing, verified
 * 2026-09-29): Sonnet 5 / 5.5 $2 / $10, Haiku 4.5 $1 / $5, Opus 5.5 $4 / $20.
 * Context-cache and audio-input pricing are not used by any call site, so they
 * are not modeled. An unknown model is priced as the provider's fallback model
 * (deliberately the pricier of the likely defaults) rather than as zero.
 */

interface PriceStep {
  /** Cents per million tokens. */
  input: number;
  output: number;
}

interface PriceEntry extends PriceStep {
  /** Price changes announced by the vendor: from this UTC date on, use this. */
  changes?: { from: string; price: PriceStep }[];
}

const GEMINI_FLASH_3X: PriceEntry = {
  input: 75,
  output: 375,
  changes: [{ from: "2027-01-01", price: { input: 150, output: 750 } }],
};

export const GEMINI_PRICE_CENTS_PER_MTOK: Record<string, PriceEntry> = {
  "gemini-3.5-flash-lite": { input: 30, output: 250 },
  "gemini-3.8-flash": GEMINI_FLASH_3X,
  "gemini-3.7-flash": GEMINI_FLASH_3X,
  "gemini-3.6-flash": GEMINI_FLASH_3X,
  "gemini-3.5-flash": { input: 150, output: 900 },
  "gemini-3.1-flash-lite": { input: 25, output: 150 },
  "gemini-2.5-flash-lite": { input: 10, output: 40 },
  "gemini-2.5-flash": { input: 30, output: 250 },
  "gemini-2.5-pro": { input: 125, output: 1000 },
};
const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash";

export const ANTHROPIC_PRICE_CENTS_PER_MTOK: Record<string, PriceEntry> = {
  "claude-sonnet-5": { input: 200, output: 1000 },
  "claude-sonnet-5-5": { input: 200, output: 1000 },
  "claude-haiku-4-5": { input: 100, output: 500 },
  "claude-opus-5-5": { input: 400, output: 2000 },
};
const ANTHROPIC_FALLBACK_MODEL = "claude-sonnet-5";

const TABLES: Record<LlmProviderId, { table: Record<string, PriceEntry>; fallback: string }> = {
  gemini: { table: GEMINI_PRICE_CENTS_PER_MTOK, fallback: GEMINI_FALLBACK_MODEL },
  anthropic: { table: ANTHROPIC_PRICE_CENTS_PER_MTOK, fallback: ANTHROPIC_FALLBACK_MODEL },
};

function priceAt(entry: PriceEntry, now: Date): PriceStep {
  let current: PriceStep = entry;
  const day = now.toISOString().slice(0, 10);
  for (const change of [...(entry.changes ?? [])].sort((a, b) => a.from.localeCompare(b.from))) {
    if (day >= change.from) current = change.price;
  }
  return current;
}

export function llmCostCents(params: {
  provider: LlmProviderId;
  model: string;
  usage: LlmUsage;
  now?: Date;
}): { cents: number; pricedAs: string } {
  const { table, fallback } = TABLES[params.provider];
  const key = Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .find((k) => params.model.startsWith(k));
  const pricedAs = key ?? fallback;
  const price = priceAt(table[pricedAs] as PriceEntry, params.now ?? new Date());
  const cents =
    (Math.max(0, params.usage.inputTokens) * price.input +
      Math.max(0, params.usage.outputTokens) * price.output) /
    1_000_000;
  return { cents, pricedAs };
}
