import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeShopmonkeyWebhook, verifyShopmonkeyWebhookSignature } from "./webhook.js";

const SECRET = "signing-secret";

function sign(rawBody: string): string {
  return createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");
}

describe("verifyShopmonkeyWebhookSignature", () => {
  it("accepts a correctly-signed payload", () => {
    const rawBody = JSON.stringify({ event: "appointment.updated", data: { id: "apt_1" } });
    const result = verifyShopmonkeyWebhookSignature({
      rawBody,
      signatureHeader: sign(rawBody),
      signingSecret: SECRET,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a tampered body", () => {
    const rawBody = JSON.stringify({ event: "appointment.updated", data: { id: "apt_1" } });
    const signature = sign(rawBody);
    const tampered = JSON.stringify({ event: "appointment.updated", data: { id: "apt_2" } });
    const result = verifyShopmonkeyWebhookSignature({
      rawBody: tampered,
      signatureHeader: signature,
      signingSecret: SECRET,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("fails closed on a missing header", () => {
    const result = verifyShopmonkeyWebhookSignature({
      rawBody: "{}",
      signatureHeader: null,
      signingSecret: SECRET,
    });
    expect(result).toEqual({ valid: false, reason: "missing_header" });
  });

  it("fails closed on a missing signing secret (never skip verification)", () => {
    const result = verifyShopmonkeyWebhookSignature({
      rawBody: "{}",
      signatureHeader: "anything",
      signingSecret: undefined,
    });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });
});

describe("normalizeShopmonkeyWebhook", () => {
  it("normalizes a revocation/uninstall event", () => {
    const event = normalizeShopmonkeyWebhook({ event: "app.uninstalled", data: { id: "shop_1" } });
    expect(event.type).toBe("auth_revoked");
  });

  it("normalizes an appointment change event", () => {
    const event = normalizeShopmonkeyWebhook({
      event: "appointment.updated",
      data: { id: "apt_1" },
    });
    expect(event).toEqual({
      type: "booking_changed",
      externalId: "apt_1",
      changes: { id: "apt_1" },
    });
  });

  it("falls back to unknown for an unrecognized event, never throwing", () => {
    expect(normalizeShopmonkeyWebhook({ event: "something.else" }).type).toBe("unknown");
    expect(normalizeShopmonkeyWebhook("not an object")).toEqual({
      type: "unknown",
      externalId: null,
      changes: {},
    });
  });
});
