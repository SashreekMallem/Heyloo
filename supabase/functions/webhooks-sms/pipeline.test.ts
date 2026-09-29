import { describe, expect, it, vi } from "vitest";
import { hmacSha1Base64, toBase64 } from "../_shared/crypto.ts";
import type { ProviderResolution } from "../_shared/providers/messaging/registry.ts";
import { createTelnyxSmsProvider } from "../_shared/providers/messaging/telnyx.ts";
import { createTwilioSmsProvider } from "../_shared/providers/messaging/twilio.ts";
import type {
  CanonicalInboundSms,
  RawWebhookRequest,
  SmsProvider,
} from "../_shared/providers/messaging/types.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import {
  applyDeliveryStatus,
  handleSmsWebhook,
  parseSmsWebhookRoute,
  processInboundSms,
  publicWebhookUrl,
} from "./handler.ts";

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

type Call = { text: string; values: unknown[] };

function makeSql(fixtures: Record<string, unknown[]> = {}): { sql: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const TENANT_NUMBER = { "from public.phone_numbers": [{ tenant_id: "t1", id: "pn1" }] };
const NEW_EVENT = { "insert into public.webhook_events": [{ id: "we1" }] };

const TELNYX_SMS: CanonicalInboundSms = {
  provider: "telnyx",
  eventId: "evt-1",
  providerMessageId: "msg-1",
  fromE164: "+15551234567",
  toE164: "+18885550100",
  body: "STOP",
  providerHandledKeyword: null,
};

describe("processInboundSms — provider-neutral behavior", () => {
  it("resolves the tenant from a dedicated SMS sender before voice numbers", async () => {
    const { sql, calls } = makeSql({
      "from public.messaging_senders": [{ tenant_id: "t9", id: null }],
    });
    await processInboundSms(sql, { ...TELNYX_SMS, body: "hello" });
    const lookup = calls[0];
    expect(lookup?.text).toContain("from public.messaging_senders");
    expect(lookup?.text).toContain("from public.phone_numbers");
    expect(lookup?.text).toContain("order by priority");
    const archive = calls.find((c) => c.text.includes("insert into public.messages_inbound"));
    expect(archive?.values).toEqual(expect.arrayContaining(["t9", "telnyx", "msg-1"]));
  });

  it("queued mode: records the opt-out and QUEUES the STOP confirmation (no TwiML channel)", async () => {
    const { sql, calls } = makeSql({
      ...TENANT_NUMBER,
      "insert into public.messages_outbound": [{ id: "reply-1" }],
    });
    const result = await processInboundSms(sql, TELNYX_SMS, undefined, { replyMode: "queued" });
    expect(result.replyKind).toBe("stop");
    expect(calls.some((c) => c.text.includes("sms_opt_out = true"))).toBe(true);
    const queued = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(queued?.values).toEqual(expect.arrayContaining(["t1", "+15551234567", "sms_reply"]));
    expect(queued?.values).toContainEqual({
      body: expect.stringContaining("unsubscribed"),
      compliance: "stop",
    });
    const enqueue = calls.find((c) => c.text.includes("pgmq.send"));
    expect(enqueue?.values[1]).toEqual({ message_id: "reply-1" });
  });

  it("never double-replies when the provider already handled the keyword, but still records opt-out", async () => {
    const { sql, calls } = makeSql(TENANT_NUMBER);
    // Telnyx's own classifier flagged free text as an opt-out.
    const result = await processInboundSms(
      sql,
      { ...TELNYX_SMS, body: "please stop texting me", providerHandledKeyword: "stop" },
      undefined,
      { replyMode: "queued" },
    );
    expect(result).toEqual({});
    expect(calls.some((c) => c.text.includes("sms_opt_out = true"))).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  // Telnyx sets `autoresponse_type` whenever a keyword MATCHES, and its
  // developer docs say it sends no auto-reply unless one is configured —
  // so a provider-matched HELP/START must still be answered by us.
  it("still answers HELP when the provider matched the keyword (no documented default HELP reply)", async () => {
    const { sql, calls } = makeSql({
      ...TENANT_NUMBER,
      "insert into public.messages_outbound": [{ id: "reply-2" }],
    });
    const result = await processInboundSms(
      sql,
      { ...TELNYX_SMS, body: "HELP", providerHandledKeyword: "help" },
      undefined,
      { replyMode: "queued" },
    );
    expect(result.replyKind).toBe("help");
    const queued = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(queued?.values).toContainEqual({
      body: expect.stringContaining("Reply STOP"),
      compliance: "help",
    });
  });

  it("records the opt-in AND confirms START when the provider matched the keyword", async () => {
    const { sql, calls } = makeSql({
      ...TENANT_NUMBER,
      "insert into public.messages_outbound": [{ id: "reply-3" }],
    });
    const result = await processInboundSms(
      sql,
      { ...TELNYX_SMS, body: "START", providerHandledKeyword: "start" },
      undefined,
      { replyMode: "queued" },
    );
    expect(result.replyKind).toBe("start");
    expect(calls.some((c) => c.text.includes("set sms_opt_out = false"))).toBe(true);
    const queued = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(queued?.values).toContainEqual({
      body: expect.stringContaining("resubscribed"),
      compliance: "start",
    });
  });
});

describe("applyDeliveryStatus", () => {
  const base = {
    provider: "telnyx" as const,
    eventId: "e",
    providerMessageId: "m1",
    errorCode: null,
  };

  it("marks delivered only from a non-terminal state", async () => {
    const { sql, calls } = makeSql({ "update public.messages_outbound": [{ id: "row1" }] });
    expect(await applyDeliveryStatus(sql, { ...base, status: "delivered" })).toBe("updated");
    expect(calls[0]?.text).toContain("status = 'delivered', delivered_at = now()");
    expect(calls[0]?.text).toContain("status in ('queued', 'sent')");
  });

  it("records a carrier failure with the provider's code", async () => {
    const { sql, calls } = makeSql({ "update public.messages_outbound": [{ id: "row1" }] });
    await applyDeliveryStatus(sql, { ...base, status: "undelivered", errorCode: "40008" });
    expect(calls[0]?.values).toContain("telnyx:delivery_undelivered:40008");
  });

  it("ignores intermediate states (the worker already wrote 'sent')", async () => {
    const { sql, calls } = makeSql();
    expect(await applyDeliveryStatus(sql, { ...base, status: "sending" })).toBe("ignored");
    expect(calls).toHaveLength(0);
  });
});

describe("routes", () => {
  it("parses provider and kind from the function path", () => {
    expect(parseSmsWebhookRoute("/functions/v1/webhooks-sms/telnyx")).toEqual({
      providerId: "telnyx",
      kind: "inbound",
    });
    expect(parseSmsWebhookRoute("/webhooks-sms/twilio/status")).toEqual({
      providerId: "twilio",
      kind: "status",
    });
    expect(parseSmsWebhookRoute("/webhooks-sms")).toBeNull();
    expect(parseSmsWebhookRoute("/webhooks-sms/twilio/other")).toBeNull();
  });

  it("rebuilds the public URL a URL-signing provider signed", () => {
    expect(
      publicWebhookUrl(
        "https://ref.supabase.co/functions/v1/webhooks-sms/",
        { providerId: "twilio", kind: "status" },
        "?a=1",
      ),
    ).toBe("https://ref.supabase.co/functions/v1/webhooks-sms/twilio/status?a=1");
  });
});

// ---------------------------------------------------------------------------
// Full pipeline with the REAL adapters and locally computed signatures.
// ---------------------------------------------------------------------------

const TWILIO_URL = "https://ref.supabase.co/functions/v1/webhooks-sms/twilio";
const AUTH_TOKEN = "twilio-auth-token";

async function signedTwilioRequest(params: Record<string, string>): Promise<RawWebhookRequest> {
  let message = TWILIO_URL;
  for (const key of Object.keys(params).sort()) message += key + params[key];
  const signature = await hmacSha1Base64(AUTH_TOKEN, message);
  return {
    rawBody: new URLSearchParams(params).toString(),
    url: TWILIO_URL,
    header: (name) => (name.toLowerCase() === "x-twilio-signature" ? signature : null),
  };
}

function ok(provider: SmsProvider): ProviderResolution<SmsProvider> {
  return { ok: true, provider };
}

describe("handleSmsWebhook", () => {
  const twilio = createTwilioSmsProvider({
    fetchImpl: vi.fn(),
    accountSid: "AC1",
    authToken: AUTH_TOKEN,
  });

  it("fails closed with 503 when the provider isn't configured", async () => {
    const { sql, calls } = makeSql();
    const response = await handleSmsWebhook(
      { sql, logger: silentLogger, runInBackground: vi.fn() },
      {
        ok: false,
        reason: "provider_not_configured",
        providerId: "telnyx",
        missing: ["TELNYX_API_KEY"],
      },
      { rawBody: "{}", url: "https://x", header: () => null },
    );
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("rejects a bad signature with 401 before touching the database", async () => {
    const { sql, calls } = makeSql();
    const request = await signedTwilioRequest({
      MessageSid: "SM1",
      From: "+15551234567",
      To: "+15559998888",
      Body: "hi",
    });
    const response = await handleSmsWebhook(
      { sql, logger: silentLogger, runInBackground: vi.fn() },
      ok(twilio),
      { ...request, rawBody: `${request.rawBody}&Extra=1` },
    );
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("Twilio: replies inline with TwiML exactly as before (sync reply capability)", async () => {
    const { sql, calls } = makeSql({ ...NEW_EVENT, ...TENANT_NUMBER });
    const request = await signedTwilioRequest({
      MessageSid: "SM1",
      From: "+15551234567",
      To: "+15559998888",
      Body: "STOP",
      SmsStatus: "received",
    });
    const runInBackground = vi.fn();
    const response = await handleSmsWebhook(
      { sql, logger: silentLogger, runInBackground },
      ok(twilio),
      request,
    );
    expect(response.status).toBe(200);
    expect(response.contentType).toBe("text/xml");
    expect(response.body).toContain("<Message>You&apos;ve been unsubscribed");
    expect(runInBackground).not.toHaveBeenCalled();
    const dedup = calls.find((c) => c.text.includes("insert into public.webhook_events"));
    expect(dedup?.values.slice(0, 2)).toEqual(["twilio_sms", "SM1"]);
    // The reply went out in the response — nothing queued.
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  it("Twilio: a redelivered message is acked without reprocessing", async () => {
    const { sql, calls } = makeSql(); // webhook_events insert returns no row => duplicate
    const request = await signedTwilioRequest({
      MessageSid: "SM1",
      From: "+15551234567",
      To: "+15559998888",
      Body: "STOP",
    });
    const response = await handleSmsWebhook(
      { sql, logger: silentLogger, runInBackground: vi.fn() },
      ok(twilio),
      request,
    );
    expect(response.body).toBe(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    expect(calls.some((c) => c.text.includes("sms_opt_out"))).toBe(false);
  });

  it("Twilio: a status callback updates the row and is deduped per (message, status)", async () => {
    const { sql, calls } = makeSql({
      ...NEW_EVENT,
      "update public.messages_outbound": [{ id: "r" }],
    });
    const request = await signedTwilioRequest({
      MessageSid: "SM9",
      MessageStatus: "undelivered",
      ErrorCode: "30034",
    });
    const response = await handleSmsWebhook(
      { sql, logger: silentLogger, runInBackground: vi.fn() },
      ok(twilio),
      request,
    );
    expect(response.status).toBe(200);
    const dedup = calls.find((c) => c.text.includes("insert into public.webhook_events"));
    expect(dedup?.values.slice(0, 2)).toEqual(["twilio_sms_status", "SM9:undelivered"]);
    const update = calls.find((c) => c.text.includes("update public.messages_outbound"));
    expect(update?.values).toContain("twilio:delivery_undelivered:30034");
  });

  it("Telnyx: verifies Ed25519, fast-acks with a bare 200, and queues the reply in the background", async () => {
    const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicKey = toBase64(await crypto.subtle.exportKey("raw", keys.publicKey));
    const nowMs = Date.parse("2026-09-29T12:00:00Z");
    const telnyx = createTelnyxSmsProvider({
      fetchImpl: vi.fn(),
      apiKey: "KEY",
      publicKey,
      now: () => nowMs,
    });
    const rawBody = JSON.stringify({
      data: {
        id: "evt-42",
        event_type: "message.received",
        payload: {
          id: "msg-42",
          from: { phone_number: "+15551234567" },
          to: [{ phone_number: "+18885550100" }],
          text: "HELP",
          autoresponse_type: null,
        },
      },
    });
    const timestamp = String(Math.floor(nowMs / 1000));
    const signature = toBase64(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        keys.privateKey,
        new TextEncoder().encode(`${timestamp}|${rawBody}`),
      ),
    );
    const headers: Record<string, string> = {
      "telnyx-signature-ed25519": signature,
      "telnyx-timestamp": timestamp,
    };
    const { sql, calls } = makeSql({
      ...NEW_EVENT,
      "from public.messaging_senders": [{ tenant_id: "t1", id: null }],
      "insert into public.messages_outbound": [{ id: "reply-9" }],
    });
    const tasks: Array<() => Promise<void>> = [];
    const response = await handleSmsWebhook(
      { sql, logger: silentLogger, runInBackground: (task) => tasks.push(task) },
      ok(telnyx),
      { rawBody, url: "https://ignored", header: (name) => headers[name.toLowerCase()] ?? null },
    );
    expect(response).toEqual({ status: 200, contentType: "application/json", body: "{}" });
    expect(tasks).toHaveLength(1);
    // Nothing but the dedup insert happens before the ack.
    expect(calls.map((c) => c.text).filter((t) => !t.includes("webhook_events"))).toHaveLength(0);

    await tasks[0]?.();
    const queued = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(queued?.values).toContainEqual({
      body: expect.stringContaining("Reply STOP"),
      compliance: "help",
    });
    expect(calls.some((c) => c.text.includes("set processed_at = now()"))).toBe(true);
  });

  it("Telnyx: a keyword Telnyx matched (autoresponse_type HELP) still gets our HELP answer", async () => {
    const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicKey = toBase64(await crypto.subtle.exportKey("raw", keys.publicKey));
    const nowMs = Date.parse("2026-09-29T12:00:00Z");
    const telnyx = createTelnyxSmsProvider({
      fetchImpl: vi.fn(),
      apiKey: "KEY",
      publicKey,
      now: () => nowMs,
    });
    // Shape per developers.telnyx.com advanced-opt-in-out: uppercase value.
    const rawBody = JSON.stringify({
      data: {
        id: "evt-43",
        event_type: "message.received",
        payload: {
          id: "msg-43",
          from: { phone_number: "+15551234567" },
          to: [{ phone_number: "+18885550100" }],
          text: "help",
          autoresponse_type: "HELP",
        },
      },
    });
    const timestamp = String(Math.floor(nowMs / 1000));
    const signature = toBase64(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        keys.privateKey,
        new TextEncoder().encode(`${timestamp}|${rawBody}`),
      ),
    );
    const headers: Record<string, string> = {
      "telnyx-signature-ed25519": signature,
      "telnyx-timestamp": timestamp,
    };
    const { sql, calls } = makeSql({
      ...NEW_EVENT,
      "from public.messaging_senders": [{ tenant_id: "t1", id: null }],
      "insert into public.messages_outbound": [{ id: "reply-10" }],
    });
    const tasks: Array<() => Promise<void>> = [];
    const response = await handleSmsWebhook(
      { sql, logger: silentLogger, runInBackground: (task) => tasks.push(task) },
      ok(telnyx),
      { rawBody, url: "https://ignored", header: (name) => headers[name.toLowerCase()] ?? null },
    );
    expect(response.status).toBe(200);
    await tasks[0]?.();
    const queued = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(queued?.values).toContainEqual({
      body: expect.stringContaining("Reply STOP"),
      compliance: "help",
    });
  });
});
