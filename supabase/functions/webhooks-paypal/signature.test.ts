import { describe, expect, it } from "vitest";
import { extractPayPalWebhookHeaders, verifyPayPalWebhookSignature } from "./signature.ts";

function fullHeaders(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    "paypal-transmission-id": "tx1",
    "paypal-transmission-time": "2026-09-10T00:00:00Z",
    "paypal-cert-url": "https://api.paypal.com/cert",
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-transmission-sig": "sig",
    ...overrides,
  });
}

describe("extractPayPalWebhookHeaders", () => {
  it("reads all five PAYPAL-* transmission headers", () => {
    const headers = extractPayPalWebhookHeaders(fullHeaders());
    expect(headers).toEqual({
      transmissionId: "tx1",
      transmissionTime: "2026-09-10T00:00:00Z",
      certUrl: "https://api.paypal.com/cert",
      authAlgo: "SHA256withRSA",
      transmissionSig: "sig",
    });
  });

  it("returns null for any missing header", () => {
    const headers = extractPayPalWebhookHeaders(new Headers());
    expect(headers.transmissionId).toBeNull();
  });
});

describe("verifyPayPalWebhookSignature", () => {
  const baseParams = {
    fetchImpl: async () =>
      new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 }),
    baseUrl: "https://api.sandbox.paypal.com",
    accessToken: "tok",
    webhookId: "WH-ID",
    headers: extractPayPalWebhookHeaders(fullHeaders()),
    webhookEvent: { id: "evt1" },
  };

  it("fails closed when no webhook_id is configured", async () => {
    const result = await verifyPayPalWebhookSignature({ ...baseParams, webhookId: undefined });
    expect(result).toEqual({ valid: false, reason: "missing_webhook_id" });
  });

  it("fails closed when any transmission header is missing", async () => {
    const result = await verifyPayPalWebhookSignature({
      ...baseParams,
      headers: extractPayPalWebhookHeaders(fullHeaders({ "paypal-transmission-sig": "" })),
    });
    expect(result).toEqual({ valid: false, reason: "missing_headers" });
  });

  it("fails when the verify API call itself errors", async () => {
    const result = await verifyPayPalWebhookSignature({
      ...baseParams,
      fetchImpl: async () => new Response("{}", { status: 500 }),
    });
    expect(result).toEqual({ valid: false, reason: "verify_call_failed" });
  });

  it("fails when verification_status is not SUCCESS", async () => {
    const result = await verifyPayPalWebhookSignature({
      ...baseParams,
      fetchImpl: async () =>
        new Response(JSON.stringify({ verification_status: "FAILURE" }), { status: 200 }),
    });
    expect(result).toEqual({ valid: false, reason: "not_success" });
  });

  it("succeeds when PayPal returns verification_status SUCCESS", async () => {
    const result = await verifyPayPalWebhookSignature(baseParams);
    expect(result).toEqual({ valid: true });
  });

  it("posts the exact PAYPAL-* headers as the documented body field names", async () => {
    let capturedBody: unknown;
    await verifyPayPalWebhookSignature({
      ...baseParams,
      fetchImpl: async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 });
      },
    });
    expect(capturedBody).toMatchObject({
      transmission_id: "tx1",
      transmission_time: "2026-09-10T00:00:00Z",
      cert_url: "https://api.paypal.com/cert",
      auth_algo: "SHA256withRSA",
      transmission_sig: "sig",
      webhook_id: "WH-ID",
      webhook_event: { id: "evt1" },
    });
  });
});
