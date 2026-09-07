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
  deposit_policy: z.string().max(1000).optional(),
  rate_table: z.record(z.string(), z.number()).optional(),
  // restaurant
  delivery_radius_m: z.number().nonnegative().optional(),
  min_order_cents: zCents.optional(),
});

export type VerticalDetails = z.infer<typeof verticalDetailsSchema>;
