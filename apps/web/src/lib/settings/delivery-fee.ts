/**
 * DELIVERY-1: the portal's copy of the restaurant delivery-fee formula, for
 * the live "A 6-mile delivery costs $5.00" example under the settings
 * inputs. MUST stay identical to
 * `supabase/functions/_shared/delivery-fee.ts#computeDeliveryFeeCents` (what
 * the voice agent actually charges); `delivery-fee.test.ts` imports that file
 * and compares both on the same cases.
 *
 *   fee = base + ceil(per_mile * max(0, distance_miles - included_miles))
 *
 * Unset parts count as 0; integer cents; distance to the hundredth of a mile.
 */

import { parseHundredths } from "./business-address";

export interface DeliveryFeePolicy {
  baseCents: number | null;
  perMileCents: number | null;
  includedMiles: number | null;
}

function nonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function hundredths(miles: number): number {
  return Math.round(miles * 100);
}

export function computeDeliveryFeeCents(
  policy: DeliveryFeePolicy,
  distanceMiles: number | null | undefined,
): number {
  const base = Math.round(nonNegative(policy.baseCents));
  if (distanceMiles === null || distanceMiles === undefined || !Number.isFinite(distanceMiles)) {
    return base;
  }
  const perMile = Math.round(nonNegative(policy.perMileCents));
  const extraHundredths = Math.max(
    0,
    hundredths(nonNegative(distanceMiles)) - hundredths(nonNegative(policy.includedMiles)),
  );
  const perMilePart = Math.floor((perMile * extraHundredths + 99) / 100);
  return base + perMilePart;
}

/** Distance used for the live fee example when no radius is set. */
export const EXAMPLE_MILES = 6;

/** "4.50" -> 450 (hundredths), or null when blank or invalid. */
function hundredthsOrNull(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) return null;
  const parsed = parseHundredths(value);
  return parsed.ok ? parsed.hundredths : null;
}

/**
 * The settings page's live example ("A 6-mile delivery costs $5.00"), from
 * the form's dollar/mile strings: priced at the radius when one is set (the
 * farthest delivery), else at 6 miles. Null when no fee is entered.
 */
export function deliveryFeeExample(values: {
  delivery_radius_miles?: string | undefined;
  delivery_fee_base?: string | undefined;
  delivery_fee_per_mile?: string | undefined;
  delivery_fee_included_miles?: string | undefined;
}): string | null {
  const base = hundredthsOrNull(values.delivery_fee_base);
  const perMile = hundredthsOrNull(values.delivery_fee_per_mile);
  const included = hundredthsOrNull(values.delivery_fee_included_miles);
  if (base === null && perMile === null) return null;
  const radius = hundredthsOrNull(values.delivery_radius_miles);
  const miles = radius !== null && radius > 0 ? radius / 100 : EXAMPLE_MILES;
  const fee = computeDeliveryFeeCents(
    {
      baseCents: base,
      perMileCents: perMile,
      includedMiles: included === null ? null : included / 100,
    },
    miles,
  );
  return `A ${miles}-mile delivery costs ${formatDollars(fee)}.`;
}

/** Integer cents -> "$5.00". */
export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
