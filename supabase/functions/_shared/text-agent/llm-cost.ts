import type { SqlClient } from "../types.ts";

/**
 * Cost capture for the text agent's own Anthropic Messages calls (COCKPIT-1).
 * SMS / web-chat turns are answered by `text-agent/engine.ts` calling
 * Anthropic directly (not Retell), so nothing in Retell's per-call
 * `call_cost` ever covers them. Each successful API response carries
 * `usage.{input_tokens, output_tokens}`; the cost is those tokens at the
 * model's published per-MTok price (platform.claude.com/docs/en/about-claude/
 * pricing, verified 2026-09-29: Claude Sonnet 5 / 5.5 $2 in / $10 out,
 * Haiku 4.5 $1 / $5, Opus 5.5 $4 / $20). Prompt-cache tokens are not used by
 * this engine, so they are not priced. Recorded as an `estimate` cost_events
 * row (provider 'anthropic', unit 'unit' = one API request) keyed by a fresh
 * external_ref, so it enters the tenant's margin as LLM/messaging cost.
 */

/** US cents per million tokens. */
export const ANTHROPIC_PRICE_CENTS_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 200, output: 1000 },
  "claude-sonnet-5-5": { input: 200, output: 1000 },
  "claude-haiku-4-5": { input: 100, output: 500 },
  "claude-opus-5-5": { input: 400, output: 2000 },
};
const FALLBACK_MODEL = "claude-sonnet-5";

export function anthropicCostCents(
  model: string,
  usage: { input_tokens: number; output_tokens: number },
): { cents: number; pricedAs: string } {
  const key = Object.keys(ANTHROPIC_PRICE_CENTS_PER_MTOK)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  const pricedAs = key ?? FALLBACK_MODEL;
  const price = ANTHROPIC_PRICE_CENTS_PER_MTOK[pricedAs] as { input: number; output: number };
  const cents =
    (Math.max(0, usage.input_tokens) * price.input +
      Math.max(0, usage.output_tokens) * price.output) /
    1_000_000;
  return { cents, pricedAs };
}

/** Never throws: a cost-ledger failure must not break (or retry) a customer reply. */
export async function recordTextAgentLlmCost(
  sql: SqlClient,
  params: {
    tenantId: string;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
    channel: "sms" | "web_chat";
    externalRef: string;
  },
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    const { cents, pricedAs } = anthropicCostCents(params.model, params.usage);
    await sql`
      insert into public.cost_events (
        tenant_id, call_id, provider, product, quantity, unit, unit_cost_cents,
        total_cost_cents, raw, source, external_ref, occurred_at
      ) values (
        ${params.tenantId}, null, 'anthropic', ${params.model}, 1, 'unit', null, ${cents},
        ${{ input_tokens: params.usage.input_tokens, output_tokens: params.usage.output_tokens, priced_as: pricedAs, channel: params.channel }}::jsonb,
        'estimate', ${params.externalRef}, now()
      )
      on conflict (provider, product, external_ref) where external_ref is not null do nothing
    `;
  } catch (err) {
    onError?.(err);
  }
}
