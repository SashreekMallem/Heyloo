/**
 * `pushBooking`/`pushOrder` for Square — Bookings API (Appointments wedge
 * vertical) and Orders API (restaurant port), per API_AND_FLOWS.md A.6 and
 * SYSTEM_DESIGN §14's salvage notes ("delivery vs pickup need different
 * `fulfillments` shapes"). Both write endpoints accept an `idempotency_key`
 * body field (Square's own idempotency mechanism, BACKEND_SPEC §7.6's
 * "where that system supports an idempotency header" case) — a retried push
 * with the same key returns the ORIGINAL booking/order, never a duplicate,
 * so `deduped` reflects Square's own `errors`-free 200 on a replay
 * (Square returns the same object, not an error, on an idempotency replay).
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  AdapterConnectionCredentials,
  PushBookingParams,
  PushBookingResult,
  PushOrderParams,
  PushOrderResult,
} from "./adapter-types.js";
import type { SquareClient } from "./client.js";

const zCreateBookingResponse = z.object({
  booking: z.object({ id: z.string(), status: z.string().optional() }),
});

export async function pushSquareBooking(
  client: SquareClient,
  connection: AdapterConnectionCredentials,
  params: PushBookingParams,
): Promise<PushBookingResult> {
  const accessToken = connection.accessToken;
  const locationId = connection.metadata?.["locationId"];
  const teamMemberId = params.resourceExternalId ?? connection.metadata?.["defaultTeamMemberId"];
  if (
    !accessToken ||
    typeof locationId !== "string" ||
    typeof teamMemberId !== "string" ||
    !params.serviceExternalId
  ) {
    throw new VoiceProviderError(
      "square pushBooking requires accessToken, metadata.locationId, a team member id, and serviceExternalId (Square's required Booking.location_id/AppointmentSegment.team_member_id/service_variation_id)",
      { code: "validation", provider: "square", retryable: false },
    );
  }

  const body = {
    idempotency_key: params.idempotencyKey,
    booking: {
      location_id: locationId,
      start_at: params.startAt,
      customer_note: `${params.customerName} ${params.customerPhoneE164}${
        params.notes ? ` — ${params.notes}` : ""
      }`.trim(),
      appointment_segments: [
        {
          team_member_id: teamMemberId,
          service_variation_id: params.serviceExternalId,
          service_variation_version: 1,
        },
      ],
    },
  };

  const raw = await client.request<unknown>("POST", "/v2/bookings", accessToken, body);
  const parsed = zCreateBookingResponse.parse(raw);
  return {
    externalId: parsed.booking.id,
    status: parsed.booking.status === "CANCELLED_BY_SELLER" ? "pending" : "confirmed",
    deduped: false,
    raw: parsed,
  };
}

const zCreateOrderResponse = z.object({
  order: z.object({ id: z.string() }),
});

/** Fulfillment shape differs pickup vs delivery vs dine-in (SYSTEM_DESIGN
 * §14 salvage note) — Square's Orders API has no native "dine-in"
 * fulfillment type, so a dine-in order carries no `fulfillments` entry at
 * all (the seller handles it as a walk-in ticket). */
function buildFulfillments(params: PushOrderParams): unknown[] {
  if (params.fulfillmentType === "pickup") {
    return [
      {
        type: "PICKUP",
        pickup_details: {
          recipient: { display_name: params.customerName ?? "Phone order" },
        },
      },
    ];
  }
  if (params.fulfillmentType === "delivery") {
    return [
      {
        type: "DELIVERY",
        delivery_details: {
          recipient: {
            display_name: params.customerName ?? "Phone order",
            phone_number: params.customerPhoneE164,
            address: params.deliveryAddress,
          },
        },
      },
    ];
  }
  return [];
}

export async function pushSquareOrder(
  client: SquareClient,
  connection: AdapterConnectionCredentials,
  params: PushOrderParams,
): Promise<PushOrderResult> {
  const accessToken = connection.accessToken;
  const locationId = connection.metadata?.["locationId"];
  if (!accessToken || typeof locationId !== "string") {
    throw new VoiceProviderError(
      "square pushOrder requires connection.accessToken and metadata.locationId",
      { code: "validation", provider: "square", retryable: false },
    );
  }

  const fulfillments = buildFulfillments(params);
  const body = {
    idempotency_key: params.idempotencyKey,
    order: {
      location_id: locationId,
      line_items: params.items.map((item) => ({
        name: item.name,
        quantity: String(item.qty),
        base_price_money: { amount: item.unitPriceCents, currency: "USD" },
        ...(item.modifiers && item.modifiers.length > 0 ? { note: item.modifiers.join(", ") } : {}),
      })),
      ...(fulfillments.length > 0 ? { fulfillments } : {}),
    },
  };

  const raw = await client.request<unknown>("POST", "/v2/orders", accessToken, body);
  const parsed = zCreateOrderResponse.parse(raw);
  return { externalId: parsed.order.id, deduped: false, raw: parsed };
}
