import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeSquareWebhook, verifySquareWebhookSignature } from "./webhook.js";

const NOTIFICATION_URL = "https://example.com/functions/v1/webhooks-pos/square";
const SIGNATURE_KEY = "test-signature-key";

function sign(rawBody: string): string {
  return createHmac("sha256", SIGNATURE_KEY)
    .update(NOTIFICATION_URL + rawBody, "utf8")
    .digest("base64");
}

describe("verifySquareWebhookSignature", () => {
  it("accepts a correctly-signed payload", () => {
    const rawBody = JSON.stringify({ type: "order.updated", data: { id: "order_1" } });
    const result = verifySquareWebhookSignature({
      rawBody,
      signatureHeader: sign(rawBody),
      notificationUrl: NOTIFICATION_URL,
      signatureKey: SIGNATURE_KEY,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a tampered body", () => {
    const rawBody = JSON.stringify({ type: "order.updated", data: { id: "order_1" } });
    const signature = sign(rawBody);
    const tampered = JSON.stringify({ type: "order.updated", data: { id: "order_2" } });
    const result = verifySquareWebhookSignature({
      rawBody: tampered,
      signatureHeader: signature,
      notificationUrl: NOTIFICATION_URL,
      signatureKey: SIGNATURE_KEY,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("fails closed on a missing signature header", () => {
    const result = verifySquareWebhookSignature({
      rawBody: "{}",
      signatureHeader: null,
      notificationUrl: NOTIFICATION_URL,
      signatureKey: SIGNATURE_KEY,
    });
    expect(result).toEqual({ valid: false, reason: "missing_header" });
  });

  it("fails closed on a missing signing secret (never skip verification)", () => {
    const result = verifySquareWebhookSignature({
      rawBody: "{}",
      signatureHeader: "anything",
      notificationUrl: NOTIFICATION_URL,
      signatureKey: undefined,
    });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });

  it("rejects a signature computed with the wrong notification URL", () => {
    const rawBody = JSON.stringify({ type: "order.updated", data: { id: "order_1" } });
    const wrongUrlSignature = createHmac("sha256", SIGNATURE_KEY)
      .update(`https://attacker.example.com${rawBody}`, "utf8")
      .digest("base64");
    const result = verifySquareWebhookSignature({
      rawBody,
      signatureHeader: wrongUrlSignature,
      notificationUrl: NOTIFICATION_URL,
      signatureKey: SIGNATURE_KEY,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });
});

describe("normalizeSquareWebhook", () => {
  it("normalizes an oauth revocation event", () => {
    const event = normalizeSquareWebhook({
      type: "oauth.authorization.revoked",
      data: { id: "merchant_1", object: { reason: "merchant_revoked" } },
    });
    expect(event).toEqual({
      type: "auth_revoked",
      externalId: "merchant_1",
      changes: { reason: "merchant_revoked" },
    });
  });

  it("normalizes an order change event", () => {
    const event = normalizeSquareWebhook({
      type: "order.updated",
      data: { id: "order_1", object: { state: "COMPLETED" } },
    });
    expect(event.type).toBe("order_changed");
    expect(event.externalId).toBe("order_1");
  });

  it("normalizes a booking change event", () => {
    const event = normalizeSquareWebhook({
      type: "booking.created",
      data: { id: "booking_1" },
    });
    expect(event.type).toBe("booking_changed");
  });

  it("falls back to unknown for an unrecognized event type, never throwing", () => {
    const event = normalizeSquareWebhook({ type: "something.else", data: { id: "x" } });
    expect(event.type).toBe("unknown");
  });

  it("falls back to unknown on a payload that fails schema validation", () => {
    const event = normalizeSquareWebhook("not even an object");
    expect(event).toEqual({ type: "unknown", externalId: null, changes: {} });
  });
});
