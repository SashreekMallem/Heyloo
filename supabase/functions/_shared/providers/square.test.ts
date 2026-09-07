import { describe, expect, it } from "vitest";
import {
  createSquareBooking,
  createSquareOrder,
  normalizeSquareWebhook,
  refreshSquareToken,
  searchSquareBookingAvailability,
  searchSquareCatalog,
  verifySquareSignature,
} from "./square.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SIGNATURE_KEY = "test-square-signature-key";
const NOTIFICATION_URL = "https://heyloo.example.com/functions/v1/webhooks-pos/square";
const BODY = JSON.stringify({ type: "order.updated", data: { id: "order_abc" } });

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

describe("verifySquareSignature", () => {
  it("accepts a validly-signed notification", async () => {
    const signature = await hmacSha256Base64(SIGNATURE_KEY, NOTIFICATION_URL + BODY);
    const result = await verifySquareSignature({
      rawBody: BODY,
      signatureHeader: signature,
      notificationUrl: NOTIFICATION_URL,
      signatureKey: SIGNATURE_KEY,
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejects when the signature key is missing (fail closed)", async () => {
    const signature = await hmacSha256Base64(SIGNATURE_KEY, NOTIFICATION_URL + BODY);
    const result = await verifySquareSignature({
      rawBody: BODY,
      signatureHeader: signature,
      notificationUrl: NOTIFICATION_URL,
      signatureKey: undefined,
    });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });

  it("rejects a missing signature header", async () => {
    const result = await verifySquareSignature({
      rawBody: BODY,
      signatureHeader: null,
      notificationUrl: NOTIFICATION_URL,
      signatureKey: SIGNATURE_KEY,
    });
    expect(result).toEqual({ valid: false, reason: "missing_header" });
  });

  it("rejects a tampered body", async () => {
    const signature = await hmacSha256Base64(SIGNATURE_KEY, NOTIFICATION_URL + BODY);
    const result = await verifySquareSignature({
      rawBody: `${BODY}tampered`,
      signatureHeader: signature,
      notificationUrl: NOTIFICATION_URL,
      signatureKey: SIGNATURE_KEY,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });
});

describe("normalizeSquareWebhook", () => {
  it("normalizes an order event", () => {
    expect(normalizeSquareWebhook({ type: "order.updated", data: { id: "order_abc" } })).toEqual({
      type: "order_changed",
      external_id: "order_abc",
      changes: { id: "order_abc" },
    });
  });

  it("normalizes an oauth revocation event", () => {
    expect(
      normalizeSquareWebhook({ type: "oauth.authorization.revoked", data: { id: "merchant_1" } }),
    ).toEqual({ type: "auth_revoked", external_id: "merchant_1", changes: { id: "merchant_1" } });
  });

  it("normalizes a booking event", () => {
    expect(normalizeSquareWebhook({ type: "booking.created", data: { id: "booking_1" } })).toEqual({
      type: "booking_changed",
      external_id: "booking_1",
      changes: { id: "booking_1" },
    });
  });

  it("falls back to unknown for an unrecognized event type", () => {
    expect(normalizeSquareWebhook({ type: "something.else", data: {} })).toEqual({
      type: "unknown",
      external_id: null,
      changes: {},
    });
  });
});

describe("Square REST calls (T7 additions)", () => {
  it("searchSquareCatalog posts the documented object_types/cursor shape", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ objects: [] });
    }) as any;
    const result = await searchSquareCatalog(fetchImpl, "token", "cursor_1");
    expect(result.ok).toBe(true);
    expect(captured).toEqual({
      object_types: ["ITEM"],
      include_deleted_objects: false,
      cursor: "cursor_1",
    });
  });

  it("searchSquareBookingAvailability posts the documented filter shape", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ availabilities: [] });
    }) as any;
    await searchSquareBookingAvailability(fetchImpl, "token", {
      locationId: "loc_1",
      startAt: "2026-09-10T00:00:00Z",
      endAt: "2026-09-11T00:00:00Z",
    });
    expect(captured.query.filter.location_id).toBe("loc_1");
  });

  it("createSquareBooking carries the idempotency_key and required Booking fields", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ booking: { id: "booking_1" } });
    }) as any;
    const result = await createSquareBooking(fetchImpl, "token", {
      idempotencyKey: "call_1:slot_1",
      locationId: "loc_1",
      startAt: "2026-09-10T14:00:00Z",
      teamMemberId: "team_1",
      serviceVariationId: "svc_1",
      customerNote: "Jane Doe +15551234567",
    });
    expect(result.ok).toBe(true);
    expect(captured.idempotency_key).toBe("call_1:slot_1");
    expect(captured.booking.appointment_segments[0]).toEqual({
      team_member_id: "team_1",
      service_variation_id: "svc_1",
      service_variation_version: 1,
    });
  });

  it("createSquareOrder builds a DELIVERY fulfillment for a delivery order", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ order: { id: "order_1" } });
    }) as any;
    await createSquareOrder(fetchImpl, "token", {
      idempotencyKey: "order_1",
      locationId: "loc_1",
      items: [{ name: "Burger", qty: 1, unitPriceCents: 899 }],
      fulfillmentType: "delivery",
      customerName: "Jane Doe",
      customerPhoneE164: "+15551234567",
      deliveryAddress: { line1: "42 Oak St" },
    });
    expect(captured.order.fulfillments[0].type).toBe("DELIVERY");
    expect(captured.order.fulfillments[0].delivery_details.recipient.phone_number).toBe(
      "+15551234567",
    );
  });

  it("refreshSquareToken posts the refresh_token grant and surfaces a non-2xx as !ok (never throws)", async () => {
    const fetchImpl = (async () => jsonResponse({ type: "invalid_grant" }, 401)) as any;
    const result = await refreshSquareToken(fetchImpl, {
      clientId: "c1",
      clientSecret: "s1",
      refreshToken: "r1",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });
});
