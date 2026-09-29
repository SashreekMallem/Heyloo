/**
 * SETTINGS-1: Agent → Vertical details request body. An emptied optional
 * field used to be dropped from the JSON, so the old value stayed live (an
 * owner could never remove a tow partner or menu override). Each
 * vertical's own emptied fields are now sent as `null`, which
 * `POST /api/tenant/agent/vertical-details` deletes (`mergeOverrides`).
 */

/** Optional keys the form may clear — an emptied field is sent as `null` so the route deletes it. */
const CLEARABLE_KEYS = [
  "insurances_accepted",
  "species_treated",
  "emergency_referral",
  "tow_partner",
  "vehicle_makes_serviced",
  "practice_areas",
  "consult_fee_cents",
  "rate_table",
  "delivery_radius_m",
  "min_order_cents",
  "delivery_fee_cents",
  "tax_rate_bps",
  "prep_time_minutes",
  "menu_text",
] as const;

const VERTICAL_KEYS: Record<string, ReadonlyArray<(typeof CLEARABLE_KEYS)[number]>> = {
  dental: ["insurances_accepted"],
  vet: ["species_treated", "emergency_referral"],
  auto: ["tow_partner", "vehicle_makes_serviced"],
  legal: ["practice_areas", "consult_fee_cents"],
  motel: ["rate_table"],
  restaurant: [
    "delivery_radius_m",
    "min_order_cents",
    "delivery_fee_cents",
    "tax_rate_bps",
    "prep_time_minutes",
    "menu_text",
  ],
};

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(
      (v) => typeof v === "string" && v.trim().length === 0,
    );
  }
  return false;
}

/** The request body: this vertical's emptied fields become `null` (clear). */
export function detailsRequestBody(
  vertical: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...values };
  for (const key of VERTICAL_KEYS[vertical] ?? []) {
    if (isEmptyValue(body[key])) body[key] = null;
  }
  return body;
}
