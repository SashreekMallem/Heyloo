/**
 * DELIVERY-1: the restaurant's distance-based delivery charge, in integer
 * cents. Pure and dependency-free: the portal mirrors it for its live
 * "A 6-mile delivery costs $5.00" example
 * (`apps/web/src/lib/settings/delivery-fee.ts`, kept equal by a parity test
 * there that imports this file).
 *
 *   fee = base + ceil(per_mile * max(0, distance_miles - included_miles))
 *
 * Unset (null) parts count as 0. Distances are taken to the hundredth of a
 * mile (what `delivery_address_checks.distance_miles` stores) and the
 * per-mile part is computed in integer hundredths, so the result never
 * depends on floating-point noise (250 * 1.2 is 300.00000000000006 in IEEE
 * doubles; ceil of that would overcharge a cent). Unknown distance (the
 * address could not be located) charges the base fee only.
 */

export interface DeliveryFeePolicy {
  baseCents: number | null;
  perMileCents: number | null;
  includedMiles: number | null;
}

function nonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Miles to whole hundredths of a mile. */
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
  // ceil(perMile * extraHundredths / 100) in integers.
  const perMilePart = Math.floor((perMile * extraHundredths + 99) / 100);
  return base + perMilePart;
}
