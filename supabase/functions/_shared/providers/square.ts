import { timingSafeEqual } from "../crypto.js";

/**
 * T7 addition: catalog/booking/order/availability/auth REST calls (this
 * file previously implemented ONLY `handleWebhook`'s verify+normalize step,
 * per T3's explicit scope note above). Portable — no SDK, plain `fetch`,
 * mirroring the `packages/adapters/square` Node package's logic (documented
 * intentional duplication, see that package's `webhook.ts` docstring: Deno
 * cannot import a pnpm workspace package here). Base URL matches the
 * Node package's default (`SQUARE_PRODUCTION_BASE_URL`); `Square-Version`
 * pinned the same way. VERIFY (docs/VERIFY.md): identical caveats as the
 * Node package — `developer.squareup.com` was egress-blocked in this build.
 */
export const SQUARE_BASE_URL = "https://connect.squareup.com";
// VERIFY-confirmed (docs/VERIFY.md): matches packages/adapters/square/src/
// client.ts's SQUARE_API_VERSION — see that file's comment for the source
// (the official `square` npm SDK v45.1.0's own generated-client default).
const SQUARE_API_VERSION = "2026-08-19";

export type SquareFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function squareRequest(
  fetchImpl: SquareFetch,
  accessToken: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetchImpl(`${SQUARE_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "square-version": SQUARE_API_VERSION,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsedBody = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body: parsedBody };
}

export async function searchSquareCatalog(
  fetchImpl: SquareFetch,
  accessToken: string,
  cursor?: string,
) {
  return squareRequest(fetchImpl, accessToken, "POST", "/v2/catalog/search", {
    object_types: ["ITEM"],
    include_deleted_objects: false,
    ...(cursor ? { cursor } : {}),
  });
}

export async function searchSquareBookingAvailability(
  fetchImpl: SquareFetch,
  accessToken: string,
  params: { locationId: string; startAt: string; endAt: string; serviceVariationId?: string },
) {
  return squareRequest(fetchImpl, accessToken, "POST", "/v2/bookings/availability/search", {
    query: {
      filter: {
        start_at_range: { start_at: params.startAt, end_at: params.endAt },
        location_id: params.locationId,
        ...(params.serviceVariationId
          ? { segment_filters: [{ service_variation_id: params.serviceVariationId }] }
          : {}),
      },
    },
  });
}

export async function createSquareBooking(
  fetchImpl: SquareFetch,
  accessToken: string,
  params: {
    idempotencyKey: string;
    locationId: string;
    startAt: string;
    teamMemberId: string;
    serviceVariationId: string;
    customerNote: string;
  },
) {
  return squareRequest(fetchImpl, accessToken, "POST", "/v2/bookings", {
    idempotency_key: params.idempotencyKey,
    booking: {
      location_id: params.locationId,
      start_at: params.startAt,
      customer_note: params.customerNote,
      appointment_segments: [
        {
          team_member_id: params.teamMemberId,
          service_variation_id: params.serviceVariationId,
          service_variation_version: 1,
        },
      ],
    },
  });
}

/** Fulfillment shape differs pickup vs delivery vs dine-in (SYSTEM_DESIGN
 * §14 salvage note) — same mapping as `packages/adapters/square/src/
 * booking.ts`'s `buildFulfillments`. */
function buildSquareFulfillments(params: {
  fulfillmentType: "pickup" | "delivery" | "dine_in";
  customerName?: string | undefined;
  customerPhoneE164?: string | undefined;
  deliveryAddress?: Record<string, unknown> | undefined;
}): unknown[] {
  if (params.fulfillmentType === "pickup") {
    return [
      {
        type: "PICKUP",
        pickup_details: { recipient: { display_name: params.customerName ?? "Phone order" } },
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

export async function createSquareOrder(
  fetchImpl: SquareFetch,
  accessToken: string,
  params: {
    idempotencyKey: string;
    locationId: string;
    items: {
      name: string;
      qty: number;
      unitPriceCents: number;
      modifiers?: string[] | undefined;
    }[];
    fulfillmentType: "pickup" | "delivery" | "dine_in";
    customerName?: string | undefined;
    customerPhoneE164?: string | undefined;
    deliveryAddress?: Record<string, unknown> | undefined;
  },
) {
  const fulfillments = buildSquareFulfillments(params);
  return squareRequest(fetchImpl, accessToken, "POST", "/v2/orders", {
    idempotency_key: params.idempotencyKey,
    order: {
      location_id: params.locationId,
      line_items: params.items.map((item) => ({
        name: item.name,
        quantity: String(item.qty),
        base_price_money: { amount: item.unitPriceCents, currency: "USD" },
        ...(item.modifiers && item.modifiers.length > 0 ? { note: item.modifiers.join(", ") } : {}),
      })),
      ...(fulfillments.length > 0 ? { fulfillments } : {}),
    },
  });
}

/** `POST /oauth2/token`, `grant_type=refresh_token` — API_AND_FLOWS.md A.6. */
export async function refreshSquareToken(
  fetchImpl: SquareFetch,
  params: { clientId: string; clientSecret: string; refreshToken: string },
) {
  const res = await fetchImpl(`${SQUARE_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/json", "square-version": SQUARE_API_VERSION },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    }),
  });
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

/**
 * Square webhook signature verification + canonical normalization
 * (`/webhooks-pos/square` — BACKEND_SPEC §7.6, T3's assigned "wire Square
 * salvage-shape as the first handleWebhook"). Scheme carried forward from
 * the legacy repo's `CLOVER_CRUD_DOCUMENTATION.md` salvage note
 * (HMAC-SHA256(notificationUrl + rawBody), base64) — originally flagged as
 * an unconfirmed "starting hypothesis" pending Square's current docs
 * (egress to which was blocked during that build). **Confirmed by
 * LIVE-MINE-FIXES** (docs/BUILD_NOTES.md LIVE-MINE-EDGE item 3,
 * docs/LEGACY_LIVE_FINDINGS.md § Edge Functions): the live legacy
 * `square-webhook` edge function (15 production redeploys, read-only via
 * the Supabase Management API) implements the identical algorithm, message
 * construction, and header name against real production traffic — no
 * further re-verification needed before relying on this. This
 * implementation is already stronger than legacy's: it uses
 * `timingSafeEqual` and fails closed on a missing secret, whereas legacy's
 * caller silently allowed traffic through when the secret env var was
 * unset. Square's webhook body carries only the changed object's id/type
 * per BACKEND_SPEC (matching the Clover pattern) — the adapter fetches the
 * full object separately (left as a Wave-3 TODO here since
 * `syncCatalog`/`pushOrder` etc. are T7 scope per
 * packages/adapters/README.md; this file implements ONLY `handleWebhook`'s
 * verify+normalize step, per this task's explicit scope).
 */

export interface SquareVerifyParams {
  rawBody: string;
  signatureHeader: string | null | undefined;
  notificationUrl: string;
  signatureKey: string | undefined;
}

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function verifySquareSignature(
  params: SquareVerifyParams,
): Promise<{ valid: boolean; reason?: "missing_secret" | "missing_header" | "mismatch" }> {
  const { rawBody, signatureHeader, notificationUrl, signatureKey } = params;
  if (!signatureKey) return { valid: false, reason: "missing_secret" };
  if (!signatureHeader) return { valid: false, reason: "missing_header" };

  const expected = await hmacSha256Base64(signatureKey, notificationUrl + rawBody);
  if (!timingSafeEqual(expected, signatureHeader.trim())) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true };
}

export interface CanonicalPosWebhookEvent {
  type: "booking_changed" | "order_changed" | "auth_revoked" | "unknown";
  external_id: string | null;
  changes: Record<string, unknown>;
}

/** Normalizes a Square webhook notification into the canonical shape every
 * adapter's `handleWebhook` must return (BACKEND_SPEC §7.6 "Shared side
 * effects across all adapters"). Square's notification envelope carries
 * `type` (e.g. `order.updated`, `oauth.authorization.revoked`) and
 * `data.id`/`data.object` — VERIFY exact field names (docs/VERIFY.md). */
export function normalizeSquareWebhook(payload: Record<string, unknown>): CanonicalPosWebhookEvent {
  const eventType = typeof payload["type"] === "string" ? (payload["type"] as string) : "";
  const data = (payload["data"] ?? {}) as Record<string, unknown>;
  const externalId = typeof data["id"] === "string" ? (data["id"] as string) : null;

  if (eventType.startsWith("oauth.authorization.revoked")) {
    return { type: "auth_revoked", external_id: externalId, changes: data };
  }
  if (eventType.startsWith("order.")) {
    return { type: "order_changed", external_id: externalId, changes: data };
  }
  if (eventType.startsWith("booking.")) {
    return { type: "booking_changed", external_id: externalId, changes: data };
  }
  return { type: "unknown", external_id: externalId, changes: data };
}
