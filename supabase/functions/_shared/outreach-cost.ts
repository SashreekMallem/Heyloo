import type { SqlClient } from "./types.ts";

/**
 * Shared cost-ledger writers for the outreach pipeline (BACKEND_SPEC §1.8/
 * §1.6, T8). Two tables, two different granularities — both get written by
 * the lead-fetch and personalization steps:
 *   - `pipeline_costs`: campaign-level accounting ledger, one row per cost
 *     EVENT (a list-fetch batch, a personalization pass) tagged by
 *     category. This is what the task's own step 1 instruction names
 *     directly ("write leads rows + pipeline_costs").
 *   - `cac_events`: per-LEAD, per-channel cost used by the CAC rollups
 *     (admin-cac, T4; admin-outreach's per-vertical CAC, T8) —
 *     `tenant_id` starts null and is filled in only once a lead actually
 *     converts (the outreach admin's "convert" action, T8), which is what
 *     lets `cac_cents = total_cost_cents / converted_tenant_count` mean
 *     anything.
 * Both are plain per-event inserts (never an upsert-and-accumulate) — a
 * lead's true acquisition cost is the SUM of every cac_events row that
 * names it, exactly like pipeline_costs already models "one row per
 * category per occurrence".
 */

export type PipelineCostCategory =
  | "list_cost"
  | "ai_personalization"
  | "sender_fee"
  | "domain_warmup"
  // OUTREACH-2: Outscraper Reviews + Anthropic classification spend for
  // the phone-complaint scoring pass (job-outreach-review-score) — added
  // via a widened `pipeline_costs_category_check` CHECK constraint,
  // 20260911140000_leads_phone_complaint_score.sql.
  | "review_scoring";

export async function recordPipelineCost(
  sql: SqlClient,
  params: {
    campaignId?: string | null;
    category: PipelineCostCategory;
    amountCents: number;
    occurredAt: Date;
  },
): Promise<void> {
  if (params.amountCents <= 0) return;
  await sql`
    insert into public.pipeline_costs (campaign_id, category, amount_cents, occurred_at)
    values (${params.campaignId ?? null}, ${params.category}, ${Math.round(params.amountCents)}, ${params.occurredAt.toISOString()}::timestamptz)
  `;
}

export type CacChannel = "cold_email" | "referral" | "organic" | "paid_ads";

export async function recordCacEvent(
  sql: SqlClient,
  params: { channel: CacChannel; leadId: string; costCents: number; occurredAt: Date },
): Promise<void> {
  if (params.costCents <= 0) return;
  await sql`
    insert into public.cac_events (channel, lead_id, cost_cents, occurred_at)
    values (${params.channel}, ${params.leadId}, ${Math.round(params.costCents)}, ${params.occurredAt.toISOString()}::timestamptz)
  `;
}
