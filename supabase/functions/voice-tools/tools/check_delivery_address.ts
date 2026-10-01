import type { z } from "zod";
import { checkDeliveryAddress, type DeliveryCheckStatus } from "../../_shared/delivery-distance.ts";
import type { CensusFetch } from "../../_shared/providers/census-geocode.ts";
import type { CheckDeliveryAddressArgsSchema } from "../../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";

type Args = z.infer<typeof CheckDeliveryAddressArgsSchema>;

/** Mirrors canonical-types `CheckDeliveryAddressResult`. */
export interface CheckDeliveryAddressResult {
  status: DeliveryCheckStatus;
  matched_address?: string;
  unit?: string;
  distance_miles?: number;
  radius_miles?: number;
  delivery_fee_cents?: number;
  delivery_minimum_cents?: number;
  message: string;
}

export interface CheckDeliveryAddressDeps {
  logger: Logger;
  /** Census Geocoder transport; absent = the lookup is reported unavailable. */
  census?: { fetchImpl: CensusFetch; timeoutMs?: number } | undefined;
}

export const NOT_FOUND_MESSAGE =
  "Address not found. Ask the caller to repeat or spell the address once; if it is still " +
  "not found, take the order anyway and say the restaurant will confirm the address.";
export const UNVERIFIED_MESSAGE = "Continue; the restaurant will confirm the address.";

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function miles(value: number): string {
  return `${Number(value.toFixed(1))} mi`;
}

/**
 * DELIVERY-1 `check_delivery_address`: as soon as a caller gives a NEW
 * delivery address, locate it (US Census Geocoder) and check it against the
 * restaurant's delivery radius, so a bad or too-far address is caught while
 * the caller is still on the line instead of after the order is read back.
 * Read-only for the caller's data; it records a `delivery_address_checks` row
 * that `create_order` reuses for the same street in the same call. The
 * tenant is the verified call context's, never an argument.
 */
export async function checkDeliveryAddressTool(
  sql: SqlClient,
  ctx: CallContext,
  args: Args,
  deps: CheckDeliveryAddressDeps,
): Promise<CheckDeliveryAddressResult> {
  const unit = args.unit ? { unit: args.unit } : {};
  if (!deps.census) {
    deps.logger.warn("check_delivery_address_no_geocoder", { tenant_id: ctx.tenantId });
    return { status: "lookup_unavailable", ...unit, message: UNVERIFIED_MESSAGE };
  }

  const check = await checkDeliveryAddress(
    sql,
    { tenantId: ctx.tenantId, providerCallId: ctx.retellCallId },
    { street: args.street, city: args.city, state: args.state, zip: args.zip },
    {
      fetchImpl: deps.census.fetchImpl,
      ...(deps.census.timeoutMs !== undefined ? { timeoutMs: deps.census.timeoutMs } : {}),
      logger: deps.logger,
    },
  );

  const located = {
    ...(check.matchedAddress ? { matched_address: check.matchedAddress } : {}),
    ...unit,
    ...(check.distanceMiles !== null ? { distance_miles: check.distanceMiles } : {}),
    ...(check.radiusMiles !== null
      ? { radius_miles: Math.round(check.radiusMiles * 100) / 100 }
      : {}),
  };
  const minimum =
    check.minOrderCents !== null && check.minOrderCents > 0
      ? { delivery_minimum_cents: check.minOrderCents }
      : {};

  switch (check.status) {
    case "in_range": {
      const fee = check.deliveryFeeCents;
      const parts = ["Read the matched address back in a few words to confirm it."];
      parts.push(
        fee > 0
          ? `In the read-back say "Delivery is ${dollars(fee)}" and include it in the total.`
          : "Delivery is free.",
      );
      if (check.minOrderCents !== null && check.minOrderCents > 0) {
        parts.push(`Delivery orders need at least ${dollars(check.minOrderCents)} of food.`);
      }
      return {
        status: "in_range",
        ...located,
        delivery_fee_cents: fee,
        ...minimum,
        message: parts.join(" "),
      };
    }
    case "out_of_range":
      return {
        status: "out_of_range",
        ...located,
        message:
          `Too far for delivery (${miles(check.distanceMiles ?? 0)}, limit ` +
          `${miles(check.radiusMiles ?? 0)}): apologize and offer pickup instead. Never argue ` +
          "about the distance or offer a discount for it.",
      };
    case "not_found":
      return { status: "not_found", ...unit, ...minimum, message: NOT_FOUND_MESSAGE };
    default:
      return { status: check.status, ...located, ...minimum, message: UNVERIFIED_MESSAGE };
  }
}
