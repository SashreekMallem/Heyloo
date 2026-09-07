import { describe, expect, it } from "vitest";
import { normalizeSquareWebhook, verifySquareSignature } from "./square.js";

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
