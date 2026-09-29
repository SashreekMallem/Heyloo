import type { SqlClient } from "./types.ts";

/**
 * Per-call provider cost capture (COCKPIT-1).
 *
 * Retell reports cost on the `call_ended` AND `call_analyzed` webhooks and on
 * GET /v2/get-call/{call_id} as `call_cost` (docs.retellai.com/api-references/
 * get-call, verified 2026-09-29): every monetary value is in US CENTS —
 * `product_costs[].cost` (cents for the call), `product_costs[].unit_price`
 * (cents PER SECOND), `combined_cost` (cents), `total_duration_seconds`.
 * Values are fractional (e.g. `4.5653262`), so `cost_events.total_cost_cents`
 * is `numeric` and only `call_logs.cost_cents` is a rounded integer.
 *
 * Every write here is an idempotent upsert keyed by
 * `(call_id, provider, product, is_transfer_leg_cost)`, so the same
 * `call_cost` arriving via call_ended, call_analyzed and a get-call backfill
 * is recorded exactly once — never double counted.
 *
 * `cost_source` provenance: NULL on `call_logs` means "unknown"; 0 with a
 * source means "the provider reported a zero-cost call" (Retell reports
 * `combined_cost: 0, product_costs: []` for `error_user_not_joined` web calls).
 */

export type CallCostSource = "retell_call_ended" | "retell_call_analyzed" | "retell_get_call";

export interface RetellProductCostInput {
  product: string;
  cost: number;
  unit_price?: number | undefined;
  is_transfer_leg_cost?: boolean | undefined;
}

export interface RetellCallCostInput {
  combined_cost?: number | undefined;
  product_costs?: RetellProductCostInput[] | undefined;
}

export interface CostLine {
  product: string;
  /** Fractional US cents, exactly as the provider reported. */
  totalCostCents: number;
  isTransferLeg: boolean;
  /** 'minute' = time-metered (unitCostCents is cents per MINUTE); 'unit' = flat per-call charge. */
  unit: "minute" | "unit" | null;
  quantity: number | null;
  unitCostCents: number | null;
  raw: unknown;
}

function finiteNonNegative(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Normalize Retell `product_costs[]` into cost_events lines. A product whose
 * `cost` equals its `unit_price` is a flat per-call charge (e.g. Retell's
 * `gpt_5_6_terra_text_testing`: cost 2.08 == unit_price 2.08); anything else
 * is time-metered at `unit_price` cents/second. Same rule as the SQL backfill
 * in migration 20260929180000.
 */
export function toCostLines(callCost: RetellCallCostInput | undefined): CostLine[] {
  const lines: CostLine[] = [];
  for (const item of callCost?.product_costs ?? []) {
    const cost = finiteNonNegative(item.cost);
    if (cost === null || !item.product) continue;
    const unitPrice = finiteNonNegative(item.unit_price);
    let unit: CostLine["unit"] = null;
    let quantity: number | null = null;
    let unitCostCents: number | null = null;
    if (unitPrice !== null && unitPrice > 0) {
      const ratio = cost / unitPrice;
      if (Math.abs(ratio - 1) <= 0.01) {
        unit = "unit";
        quantity = 1;
        unitCostCents = unitPrice;
      } else {
        unit = "minute";
        quantity = ratio / 60;
        unitCostCents = unitPrice * 60;
      }
    }
    lines.push({
      product: item.product,
      totalCostCents: cost,
      isTransferLeg: item.is_transfer_leg_cost === true,
      unit,
      quantity,
      unitCostCents,
      raw: item,
    });
  }
  return lines;
}

/** Integer cents for `call_logs.cost_cents`: the provider's `combined_cost`
 * when reported, else the sum of the itemized lines. */
export function combinedCostCents(callCost: RetellCallCostInput | undefined): number | null {
  if (!callCost) return null;
  const combined = finiteNonNegative(callCost.combined_cost);
  if (combined !== null) return Math.round(combined);
  const lines = toCostLines(callCost);
  return Math.round(lines.reduce((sum, l) => sum + l.totalCostCents, 0));
}

export interface RecordCallCostParams {
  tenantId: string;
  callId: string;
  occurredAt: string;
  callCost: RetellCallCostInput | undefined;
  source: CallCostSource;
}

export interface RecordCallCostResult {
  recorded: boolean;
  costCents: number | null;
  lineCount: number;
}

/**
 * Upsert every itemized cost line for the call and stamp
 * `call_logs.cost_cents` + `cost_source`. A call without any `call_cost`
 * object is left NULL (unknown) rather than fabricated as 0.
 */
export async function recordCallCost(
  sql: SqlClient,
  params: RecordCallCostParams,
): Promise<RecordCallCostResult> {
  if (!params.callCost) return { recorded: false, costCents: null, lineCount: 0 };
  const lines = toCostLines(params.callCost);

  for (const line of lines) {
    await sql`
      insert into public.cost_events (
        tenant_id, call_id, provider, product, is_transfer_leg_cost,
        quantity, unit, unit_cost_cents, total_cost_cents, raw, source, occurred_at
      ) values (
        ${params.tenantId}, ${params.callId}, 'retell', ${line.product}, ${line.isTransferLeg},
        ${line.quantity}, ${line.unit}, ${line.unitCostCents}, ${line.totalCostCents},
        ${line.raw}::jsonb, ${params.source}, ${params.occurredAt}
      )
      on conflict (call_id, provider, product, is_transfer_leg_cost)
        where call_id is not null and external_ref is null
      do update set
        quantity = excluded.quantity,
        unit = excluded.unit,
        unit_cost_cents = excluded.unit_cost_cents,
        total_cost_cents = excluded.total_cost_cents,
        raw = excluded.raw,
        source = excluded.source
    `;
  }

  const fallbackCents = combinedCostCents(params.callCost) ?? 0;
  const updated = await sql<{ cost_cents: number | null }>`
    update public.call_logs
    set cost_cents = coalesce(
          (select round(sum(total_cost_cents))::int from public.cost_events where call_id = ${params.callId}),
          ${fallbackCents}
        ),
        cost_source = ${params.source}
    where id = ${params.callId}
    returning cost_cents
  `;
  return {
    recorded: true,
    costCents: updated[0]?.cost_cents ?? fallbackCents,
    lineCount: lines.length,
  };
}
