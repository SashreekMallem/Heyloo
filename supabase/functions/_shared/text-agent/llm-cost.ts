import { llmCostCents } from "../providers/llm/pricing.ts";
import type { LlmProviderId, LlmUsage } from "../providers/llm/types.ts";
import type { SqlClient } from "../types.ts";

/**
 * Cost capture for the text agent's own LLM calls (COCKPIT-1, made
 * provider-neutral by LLM-1). SMS / web-chat turns are answered by
 * `text-agent/engine.ts` calling the LLM port directly (not Retell), so nothing
 * in Retell's per-call `call_cost` ever covers them. Each successful response
 * carries token usage (`LlmUsage`: input and output tokens, output including
 * reasoning tokens); the cost is those tokens at the model's published per-MTok
 * price (`providers/llm/pricing.ts` holds the table and its source URLs, e.g.
 * ai.google.dev/gemini-api/docs/pricing for Gemini). Prompt-cache tokens are
 * not used by this engine, so they are not priced. Recorded as an `estimate`
 * cost_events row (provider = the LLM vendor id, unit 'unit' = one API request)
 * keyed by a fresh external_ref, so it enters the tenant's margin as
 * LLM/messaging cost.
 */

/** Never throws: a cost-ledger failure must not break (or retry) a customer reply. */
export async function recordTextAgentLlmCost(
  sql: SqlClient,
  params: {
    tenantId: string;
    provider: LlmProviderId;
    model: string;
    usage: LlmUsage;
    channel: "sms" | "web_chat";
    externalRef: string;
  },
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    const { cents, pricedAs } = llmCostCents({
      provider: params.provider,
      model: params.model,
      usage: params.usage,
    });
    await sql`
      insert into public.cost_events (
        tenant_id, call_id, provider, product, quantity, unit, unit_cost_cents,
        total_cost_cents, raw, source, external_ref, occurred_at
      ) values (
        ${params.tenantId}, null, ${params.provider}, ${params.model}, 1, 'unit', null, ${cents},
        ${{ input_tokens: params.usage.inputTokens, output_tokens: params.usage.outputTokens, priced_as: pricedAs, channel: params.channel }}::jsonb,
        'estimate', ${params.externalRef}, now()
      )
      on conflict (provider, product, external_ref) where external_ref is not null do nothing
    `;
  } catch (err) {
    onError?.(err);
  }
}
