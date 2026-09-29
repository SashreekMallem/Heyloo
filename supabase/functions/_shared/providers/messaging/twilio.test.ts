import { describe, expect, it, vi } from "vitest";
import { hmacSha1Base64 } from "../../crypto.ts";
import {
  classifyTwilioSendFailure,
  createTwilioSmsProvider,
  mapTwilioMessageStatus,
  TWILIO_CAPABILITIES,
} from "./twilio.ts";
import type { RawWebhookRequest } from "./types.ts";
import { zCanonicalDeliveryStatus, zCanonicalInboundSms, zSendResult } from "./types.ts";

const URL = "https://ref.supabase.co/functions/v1/webhooks-sms/twilio";
const TOKEN = "auth-token";

function request(params: Record<string, string>, signature: string | null): RawWebhookRequest {
  return {
    rawBody: new URLSearchParams(params).toString(),
    url: URL,
    header: (name) => (name === "x-twilio-signature" ? signature : null),
  };
}

/** Twilio's documented scheme: URL + params sorted by key, each key+value
 * appended, HMAC-SHA1 with the Auth Token, base64. */
async function sign(params: Record<string, string>, url = URL): Promise<string> {
  let message = url;
  for (const key of Object.keys(params).sort()) message += key + params[key];
  return hmacSha1Base64(TOKEN, message);
}

function provider(fetchImpl = vi.fn()) {
  return createTwilioSmsProvider({ fetchImpl, accountSid: "AC1", authToken: TOKEN });
}

describe("Twilio adapter — send", () => {
  it("posts form-encoded To/From/Body (+ StatusCallback when given) with Basic auth", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }),
    );
    const result = await provider(fetchImpl).sendSms({
      to: "+15551234567",
      from: "+15559998888",
      body: "hi",
      idempotencyKey: "m1",
      statusCallbackUrl: `${URL}/status`,
    });
    expect(result).toEqual({ ok: true, providerMessageId: "SM1" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect((init.headers as Record<string, string>)["authorization"]).toBe(
      `Basic ${btoa("AC1:auth-token")}`,
    );
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({
      To: "+15551234567",
      From: "+15559998888",
      Body: "hi",
      StatusCallback: `${URL}/status`,
    });
  });

  it("classifies the documented permanent codes as permanent, everything else transient", () => {
    const permanent = classifyTwilioSendFailure(400, { code: 21211, message: "Invalid 'To'" });
    expect(permanent).toMatchObject({ ok: false, failure: "permanent", errorCode: "21211" });
    expect(zSendResult.safeParse(permanent).success).toBe(true);
    expect(classifyTwilioSendFailure(400, { code: 21610 })).toMatchObject({
      failure: "permanent",
    });
    expect(classifyTwilioSendFailure(500, { message: "oops" })).toMatchObject({
      failure: "transient",
      errorCode: null,
    });
    expect(classifyTwilioSendFailure(429, undefined)).toMatchObject({ failure: "transient" });
  });
});

describe("Twilio adapter — webhooks", () => {
  const inbound = { MessageSid: "SM1", From: "(555) 123-4567", To: "+15559998888", Body: "Hi" };

  it("verifies a locally computed X-Twilio-Signature over the raw form body", async () => {
    const p = provider();
    expect(await p.verifyInboundWebhook(request(inbound, await sign(inbound)))).toEqual({
      valid: true,
    });
  });

  it("rejects a tampered body, a different URL, and a missing header", async () => {
    const p = provider();
    const signature = await sign(inbound);
    expect(
      await p.verifyInboundWebhook(request({ ...inbound, Body: "tampered" }, signature)),
    ).toEqual({ valid: false, reason: "mismatch" });
    expect(await p.verifyInboundWebhook(request(inbound, await sign(inbound, `${URL}/x`)))).toEqual(
      { valid: false, reason: "mismatch" },
    );
    expect(await p.verifyInboundWebhook(request(inbound, null))).toEqual({
      valid: false,
      reason: "missing_header",
    });
  });

  it("parses an inbound message into canonical E.164 fields", () => {
    const parsed = provider().parseInbound(request({ ...inbound, SmsStatus: "received" }, null));
    expect(parsed).toEqual({
      provider: "twilio",
      eventId: "SM1",
      providerMessageId: "SM1",
      fromE164: "+15551234567",
      toE164: "+15559998888",
      body: "Hi",
      providerHandledKeyword: null,
    });
    expect(zCanonicalInboundSms.safeParse(parsed).success).toBe(true);
  });

  it("does not treat a status callback as an inbound message (and vice versa)", () => {
    const p = provider();
    const status = { MessageSid: "SM2", MessageStatus: "delivered", From: "+1", To: "+1" };
    expect(p.parseInbound(request(status, null))).toBeNull();
    expect(p.parseStatusCallback(request(inbound, null))).toBeNull();
  });

  it("maps a status callback to a canonical delivery status with a per-transition event id", () => {
    const parsed = provider().parseStatusCallback(
      request({ MessageSid: "SM2", MessageStatus: "undelivered", ErrorCode: "30034" }, null),
    );
    expect(parsed).toEqual({
      provider: "twilio",
      eventId: "SM2:undelivered",
      providerMessageId: "SM2",
      status: "undelivered",
      errorCode: "30034",
    });
    expect(zCanonicalDeliveryStatus.safeParse(parsed).success).toBe(true);
  });

  it("maps every documented MessageStatus", () => {
    expect(mapTwilioMessageStatus("accepted")).toBe("queued");
    expect(mapTwilioMessageStatus("scheduled")).toBe("queued");
    expect(mapTwilioMessageStatus("queued")).toBe("queued");
    expect(mapTwilioMessageStatus("sending")).toBe("sending");
    expect(mapTwilioMessageStatus("sent")).toBe("sent");
    expect(mapTwilioMessageStatus("delivered")).toBe("delivered");
    expect(mapTwilioMessageStatus("read")).toBe("delivered");
    expect(mapTwilioMessageStatus("undelivered")).toBe("undelivered");
    expect(mapTwilioMessageStatus("failed")).toBe("failed");
    expect(mapTwilioMessageStatus("canceled")).toBe("failed");
    expect(mapTwilioMessageStatus("received")).toBeNull();
    expect(mapTwilioMessageStatus("partially_delivered")).toBeNull();
  });

  it("acks with TwiML, escaping the reply", () => {
    expect(TWILIO_CAPABILITIES.syncWebhookReply).toBe(true);
    expect(provider().webhookAck(`Tom & Jerry's <3`)).toEqual({
      status: 200,
      contentType: "text/xml",
      body: `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Tom &amp; Jerry&apos;s &lt;3</Message></Response>`,
    });
  });
});

describe("Twilio adapter — 10DLC registration (legacy flow, unchanged requests)", () => {
  it("maps campaign statuses to canonical registration statuses", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ campaignStatus: "FAILED", failureReason: "bad" }), {
          status: 200,
        }),
    );
    const result = await provider(fetchImpl).registration?.getRegistration({
      profileId: "MG1",
      registrationRef: "CU1",
    });
    expect(result).toEqual({
      ok: true,
      registration: { kind: "10dlc", status: "failed", failureReason: "bad" },
    });
  });
});
