import { describe, expect, it } from "vitest";
import {
  createShopmonkeyAppointment,
  findShopmonkeyCustomerByPhone,
  listShopmonkeyLaborRates,
  normalizeShopmonkeyWebhook,
  verifyShopmonkeyWebhookSignature,
} from "./shopmonkey.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SECRET = "shopmonkey-secret";

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("verifyShopmonkeyWebhookSignature", () => {
  it("accepts a correctly-signed payload", async () => {
    const body = JSON.stringify({ event: "appointment.updated", data: { id: "apt_1" } });
    const signature = await hmacSha256Hex(SECRET, body);
    const result = await verifyShopmonkeyWebhookSignature({
      rawBody: body,
      signatureHeader: signature,
      signingSecret: SECRET,
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a tampered body (fail closed)", async () => {
    const body = JSON.stringify({ event: "appointment.updated", data: { id: "apt_1" } });
    const signature = await hmacSha256Hex(SECRET, body);
    const result = await verifyShopmonkeyWebhookSignature({
      rawBody: `${body}x`,
      signatureHeader: signature,
      signingSecret: SECRET,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("fails closed on a missing signing secret", async () => {
    const result = await verifyShopmonkeyWebhookSignature({
      rawBody: "{}",
      signatureHeader: "anything",
      signingSecret: undefined,
    });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });
});

describe("normalizeShopmonkeyWebhook", () => {
  it("normalizes an appointment change", () => {
    expect(
      normalizeShopmonkeyWebhook({ event: "appointment.updated", data: { id: "apt_1" } }),
    ).toEqual({
      type: "booking_changed",
      external_id: "apt_1",
      changes: { id: "apt_1" },
    });
  });

  it("normalizes an uninstall/revocation event", () => {
    expect(
      normalizeShopmonkeyWebhook({ event: "app.uninstalled", data: { id: "shop_1" } }).type,
    ).toBe("auth_revoked");
  });
});

describe("Shopmonkey REST calls", () => {
  it("listShopmonkeyLaborRates hits GET /laborrate with a Bearer token", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedAuth = String(
        (init?.headers as Record<string, string> | undefined)?.["authorization"],
      );
      return jsonResponse({ data: [] });
    }) as any;
    const result = await listShopmonkeyLaborRates(fetchImpl, "key_1");
    expect(result.ok).toBe(true);
    expect(capturedUrl).toContain("/laborrate");
    expect(capturedAuth).toBe("Bearer key_1");
  });

  it("findShopmonkeyCustomerByPhone encodes the phone as a query param", async () => {
    let capturedUrl = "";
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ data: [] });
    }) as any;
    await findShopmonkeyCustomerByPhone(fetchImpl, "key_1", "+15551234567");
    expect(capturedUrl).toContain("phone=%2B15551234567");
  });

  it("createShopmonkeyAppointment carries the idempotency reference field", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ id: "appt_1" });
    }) as any;
    await createShopmonkeyAppointment(fetchImpl, "key_1", {
      customerId: "cust_1",
      startAt: "2026-09-10T14:00:00Z",
      endAt: "2026-09-10T15:00:00Z",
      idempotencyKey: "call_1:slot_1",
    });
    expect(captured.externalReference).toBe("call_1:slot_1");
  });
});
