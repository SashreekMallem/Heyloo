import { z } from "zod";
import { zCents } from "../primitives.js";

/**
 * MASTER_SPEC.md §3.5 — per-vertical `agent_configs.dynamic_variable_overrides`
 * keys, enumerated (not ad-hoc) and validated per vertical. Rendered by the
 * Settings → "Vertical details" tab (§3.10). `cancellation_policy` applies
 * to every vertical; the rest are vertical-specific and optional so a
 * tenant on a different vertical simply never sees/sends those keys.
 */
const zCancellationPolicy = z.object({
  window_hours: z.number().int().nonnegative(),
  fee_cents: zCents.optional(),
  text: z.string().max(1000),
});

/**
 * Motel deposit policy / rate table — kept byte-for-byte in sync with
 * `zMotelOverrides` in `packages/canonical-types/src/agent-template.ts`
 * (the template/compiler-side consumer of this same
 * `agent_configs.dynamic_variable_overrides` column): rates in integer
 * cents (CLAUDE.md Rule 2 — "Money in integer cents"), never dollars, and
 * a structured deposit policy rather than a bare string, since
 * `voice-inbound`'s dynamic-variable resolver needs `required`/
 * `amount_cents` to pick a safe default when a tenant hasn't configured
 * one (GAP_REGISTER §1.6 — this schema and the template's had drifted:
 * this one used to hold `rate_table` as a dollars-valued
 * `Record<string, number>` and `deposit_policy` as a bare string).
 */
const zDepositPolicy = z.object({
  required: z.boolean(),
  amount_cents: zCents.optional(),
  hold_window_hours: z.number().int().nonnegative().optional(),
  text: z.string().min(1).max(1000),
});

const zRateTableEntry = z.object({
  room_type: z.string().min(1),
  nightly_rate_cents: zCents,
});

export const verticalDetailsSchema = z.object({
  cancellation_policy: zCancellationPolicy,
  // dental
  insurances_accepted: z.array(z.string()).optional(),
  // veterinary
  species_treated: z.array(z.string()).optional(),
  emergency_referral: z.object({ name: z.string(), phone: z.string() }).optional(),
  // auto
  tow_partner: z.object({ name: z.string(), phone: z.string() }).optional(),
  vehicle_makes_serviced: z.array(z.string()).optional(),
  // legal
  practice_areas: z.array(z.string()).optional(),
  consult_fee_cents: zCents.optional(),
  // motel
  deposit_policy: zDepositPolicy.optional(),
  rate_table: z.array(zRateTableEntry).optional(),
  // restaurant — delivery_radius_m/min_order_cents/tax_rate_bps are read
  // directly by `create_order.ts` (never spoken); menu_text/
  // prep_time_minutes feed `voice-inbound`'s spoken dynamic variables.
  delivery_radius_m: z.number().int().nonnegative().optional(),
  min_order_cents: zCents.optional(),
  delivery_fee_cents: zCents.optional(),
  tax_rate_bps: z.number().int().min(0).max(10000).optional(),
  prep_time_minutes: z.number().int().nonnegative().optional(),
  menu_text: z.string().max(4000).optional(),
});

export type VerticalDetails = z.infer<typeof verticalDetailsSchema>;
