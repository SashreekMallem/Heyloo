import { describe, expect, it, vi } from "vitest";
import { toBase64 } from "../../crypto.ts";
import {
  classifyTelnyxSendFailure,
  createTelnyxSmsProvider,
  mapTelnyxMessageStatus,
  TELNYX_CAPABILITIES,
} from "./telnyx.ts";
import type { RawWebhookRequest } from "./types.ts";
import { zCanonicalDeliveryStatus, zCanonicalInboundSms, zSendResult } from "./types.ts";

const NOW_MS = Date.parse("2026-09-29T12:00:00Z");

async function keyPair() {
  const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = toBase64(await crypto.subtle.exportKey("raw", keys.publicKey));
  return { keys, publicKey };
}

/** Telnyx's documented scheme: Ed25519 over `{telnyx-timestamp}|{raw body}`,
 * base64 signature in `telnyx-signature-ed25519`. */
async function signedRequest(
  privateKey: CryptoKey,
  rawBody: string,
  timestamp = String(Math.floor(NOW_MS / 1000)),
): Promise<RawWebhookRequest> {
  const signature = toBase64(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      new TextEncoder().encode(`${timestamp}|${rawBody}`),
    ),
  );
  const headers: Record<string, string> = {
    "telnyx-signature-ed25519": signature,
    "telnyx-timestamp": timestamp,
  };
  return { rawBody, url: "https://ignored", header: (name) => headers[name] ?? null };
}

function event(eventType: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ data: { id: "evt-1", event_type: eventType, payload } });
}

const INBOUND = event("message.received", {
  id: "msg-in-1",
  direction: "inbound",
  from: { phone_number: "+15551234567" },
  to: [{ phone_number: "+18885550100" }],
  text: "Can I book?",
  autoresponse_type: null,
});

describe("Telnyx adapter — send", () => {
  it("POSTs JSON {from,to,text} with Bearer auth to /v2/messages", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: { id: "tx-1", to: [{ status: "queued" }] } }), {
          status: 200,
        }),
    );
    const provider = createTelnyxSmsProvider({
      fetchImpl,
      apiKey: "KEY",
      messagingProfileId: "prof-1",
    });
    const result = await provider.sendSms({
      to: "+15551234567",
      from: "+18885550100",
      body: "hello",
      idempotencyKey: "m1",
      statusCallbackUrl: "https://ref.supabase.co/functions/v1/webhooks-sms/telnyx/status",
    });
    expect(result).toEqual({ ok: true, providerMessageId: "tx-1" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telnyx.com/v2/messages");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer KEY");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "+18885550100",
      to: "+15551234567",
      text: "hello",
      messaging_profile_id: "prof-1",
      webhook_url: "https://ref.supabase.co/functions/v1/webhooks-sms/telnyx/status",
    });
  });

  it("classifies documented codes: opt-out/invalid-to/unverified-TF permanent, 429/5xx transient", async () => {
    const stop = classifyTelnyxSendFailure(
      403,
      { errors: [{ code: "40300", title: "Blocked", detail: "block rule" }] },
      null,
    );
    expect(stop).toMatchObject({ ok: false, failure: "permanent", errorCode: "40300" });
    expect(zSendResult.safeParse(stop).success).toBe(true);
    expect(classifyTelnyxSendFailure(400, { errors: [{ code: 40310 }] }, null)).toMatchObject({
      failure: "permanent",
      errorCode: "40310",
    });
    expect(classifyTelnyxSendFailure(403, { errors: [{ code: "40329" }] }, null)).toMatchObject({
      failure: "permanent",
    });
    expect(classifyTelnyxSendFailure(429, {}, "12")).toMatchObject({
      failure: "transient",
      retryAfterSeconds: 12,
    });
    expect(classifyTelnyxSendFailure(502, "not json", null)).toMatchObject({
      failure: "transient",
      errorCode: null,
    });
  });

  it("maps a network error to a transient failure instead of throwing", async () => {
    const provider = createTelnyxSmsProvider({
      fetchImpl: async () => {
        throw new TypeError("connection reset");
      },
      apiKey: "KEY",
    });
    const result = await provider.sendSms({
      to: "+15551234567",
      from: "+18885550100",
      body: "x",
      idempotencyKey: "m1",
    });
    expect(result).toMatchObject({ ok: false, failure: "transient", httpStatus: 0 });
  });
});

describe("Telnyx adapter — webhook signature (Ed25519)", () => {
  it("accepts a correctly signed body", async () => {
    const { keys, publicKey } = await keyPair();
    const provider = createTelnyxSmsProvider({
      fetchImpl: vi.fn(),
      apiKey: "KEY",
      publicKey,
      now: () => NOW_MS,
    });
    expect(
      await provider.verifyInboundWebhook(await signedRequest(keys.privateKey, INBOUND)),
    ).toEqual({ valid: true });
  });

  it("rejects a body altered after signing", async () => {
    const { keys, publicKey } = await keyPair();
    const provider = createTelnyxSmsProvider({
      fetchImpl: vi.fn(),
      apiKey: "K",
      publicKey,
      now: () => NOW_MS,
    });
    const signed = await signedRequest(keys.privateKey, INBOUND);
    expect(
      await provider.verifyInboundWebhook({ ...signed, rawBody: INBOUND.replace("book", "cook") }),
    ).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a signature from a different key", async () => {
    const { publicKey } = await keyPair();
    const other = await keyPair();
    const provider = createTelnyxSmsProvider({
      fetchImpl: vi.fn(),
      apiKey: "K",
      publicKey,
      now: () => NOW_MS,
    });
    expect(
      await provider.verifyInboundWebhook(await signedRequest(other.keys.privateKey, INBOUND)),
    ).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a replay older than 5 minutes even with a valid signature", async () => {
    const { keys, publicKey } = await keyPair();
    const provider = createTelnyxSmsProvider({
      fetchImpl: vi.fn(),
      apiKey: "K",
      publicKey,
      now: () => NOW_MS,
    });
    const stale = String(Math.floor(NOW_MS / 1000) - 301);
    expect(
      await provider.verifyInboundWebhook(await signedRequest(keys.privateKey, INBOUND, stale)),
    ).toEqual({ valid: false, reason: "stale_timestamp" });
  });

  it("fails closed without the public key or the headers", async () => {
    const { keys } = await keyPair();
    const noKey = createTelnyxSmsProvider({ fetchImpl: vi.fn(), apiKey: "K", now: () => NOW_MS });
    expect(await noKey.verifyInboundWebhook(await signedRequest(keys.privateKey, INBOUND))).toEqual(
      {
        valid: false,
        reason: "missing_secret",
      },
    );
    const { publicKey } = await keyPair();
    const withKey = createTelnyxSmsProvider({
      fetchImpl: vi.fn(),
      apiKey: "K",
      publicKey,
      now: () => NOW_MS,
    });
    expect(
      await withKey.verifyInboundWebhook({ rawBody: INBOUND, url: "x", header: () => null }),
    ).toEqual({ valid: false, reason: "missing_header" });
  });
});

describe("Telnyx adapter — parsing", () => {
  const provider = createTelnyxSmsProvider({ fetchImpl: vi.fn(), apiKey: "K" });
  const req = (rawBody: string): RawWebhookRequest => ({ rawBody, url: "x", header: () => null });

  it("parses message.received into the canonical inbound shape", () => {
    const parsed = provider.parseInbound(req(INBOUND));
    expect(parsed).toEqual({
      provider: "telnyx",
      eventId: "evt-1",
      providerMessageId: "msg-in-1",
      fromE164: "+15551234567",
      toE164: "+18885550100",
      body: "Can I book?",
      providerHandledKeyword: null,
    });
    expect(zCanonicalInboundSms.safeParse(parsed).success).toBe(true);
    expect(provider.parseStatusCallback(req(INBOUND))).toBeNull();
  });

  it("surfaces Telnyx's own keyword handling (autoresponse_type) so core won't double-reply", () => {
    const stop = event("message.received", {
      id: "m",
      from: { phone_number: "+15551234567" },
      to: [{ phone_number: "+18885550100" }],
      text: "STOP",
      autoresponse_type: "STOP",
    });
    expect(provider.parseInbound(req(stop))?.providerHandledKeyword).toBe("stop");
  });

  it("parses message.finalized into a canonical delivery status with the error code", () => {
    const finalized = event("message.finalized", {
      id: "tx-1",
      to: [{ phone_number: "+15551234567", status: "delivery_failed" }],
      errors: [{ code: "40008", title: "Undeliverable" }],
    });
    const parsed = provider.parseStatusCallback(req(finalized));
    expect(parsed).toEqual({
      provider: "telnyx",
      eventId: "evt-1",
      providerMessageId: "tx-1",
      status: "undelivered",
      errorCode: "40008",
    });
    expect(zCanonicalDeliveryStatus.safeParse(parsed).success).toBe(true);
    expect(provider.parseInbound(req(finalized))).toBeNull();
  });

  it("maps every documented to[].status", () => {
    expect(mapTelnyxMessageStatus("queued")).toBe("queued");
    expect(mapTelnyxMessageStatus("sending")).toBe("sending");
    expect(mapTelnyxMessageStatus("sent")).toBe("sent");
    expect(mapTelnyxMessageStatus("delivered")).toBe("delivered");
    expect(mapTelnyxMessageStatus("sending_failed")).toBe("failed");
    expect(mapTelnyxMessageStatus("delivery_failed")).toBe("undelivered");
    expect(mapTelnyxMessageStatus("delivery_unconfirmed")).toBe("sent");
    expect(mapTelnyxMessageStatus("webhook_delivered")).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(provider.parseInbound(req("not json"))).toBeNull();
    expect(provider.parseStatusCallback(req("{}"))).toBeNull();
  });

  it("acks with a bare 200 and never carries a reply", () => {
    expect(TELNYX_CAPABILITIES.syncWebhookReply).toBe(false);
    expect(provider.webhookAck("ignored")).toEqual({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
});
