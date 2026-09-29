import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { MessagingRegistryConfig } from "../_shared/providers/messaging/registry.ts";
import { createMessagingRegistry } from "../_shared/providers/messaging/registry.ts";
import { createTwilioSmsProvider } from "../_shared/providers/messaging/twilio.ts";
import type {
  EmailProvider,
  EmailSendRequest,
  SendResult,
  SmsProvider,
  SmsProviderId,
  SmsSendRequest,
} from "../_shared/providers/messaging/types.ts";
import type { SqlClient } from "../_shared/types.ts";
import { buildOutboundDeps } from "./deps.ts";
import type { OutboundDeps } from "./handler.ts";
import {
  OUTBOUND_NOT_CONFIGURED_PARK_SECONDS,
  ParkMessageError,
  processOutboundMessage,
  runOutboundWorker,
  sweepNotConfiguredOutbound,
} from "./handler.ts";

const logger = createLogger();

type Call = { text: string; values: unknown[] };

function makeSql(fixtures: Record<string, unknown[]>): { sql: SqlClient; calls: Call[] } {
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

const NOW = "2026-09-29T12:00:00.000Z";

const BASE_MESSAGE = {
  id: "msg_1",
  tenant_id: "t1",
  channel: "sms",
  recipient: "+15551234567",
  template_key: "booking_confirmation",
  payload: { start_local: "Tue 2:00 PM" },
  status: "queued",
  parent_message_id: null,
  related_call_id: null,
  related_booking_id: null,
  related_order_id: null,
  created_at: NOW,
};

// Fixture keys — each matches exactly one query shape in handler.ts /
// owner-alerts.ts (the mock returns the first key contained in the SQL).
const MESSAGE = "from public.messages_outbound where id";
const CUSTOMERS = "from public.customers";
const ROUTE = "public.messaging_senders ms";
const CONTACT = "public.agent_configs ac";

const VERIFIED_TELNYX_SENDER = {
  a2p_status: "verified",
  sms_provider: null,
  sender_e164: "+18885550100",
  sender_provider: "telnyx",
  sender_status: "verified",
  primary_e164: "+15559998888",
};
const PENDING_LEGACY = {
  a2p_status: "pending_verification",
  sms_provider: null,
  sender_e164: null,
  sender_provider: null,
  sender_status: null,
  primary_e164: "+15559998888",
};
const OWNER = {
  transfer_number: "+15550001111",
  delivery: null,
  owner_email: "owner@example.com",
};

function fakeSms(id: SmsProviderId, result?: SendResult) {
  const sendSms = vi.fn(
    async (_req: SmsSendRequest): Promise<SendResult> =>
      result ?? { ok: true, providerMessageId: `${id}-msg-1` },
  );
  const provider: SmsProvider = {
    id,
    capabilities: {
      sms: true,
      email: false,
      deliveryReceipts: true,
      syncWebhookReply: false,
      nativeOptOutHandling: true,
      senderKinds: ["toll_free"],
      senderRegistrationApi: false,
    },
    sendSms,
    verifyInboundWebhook: async () => ({ valid: true }),
    parseInbound: () => null,
    parseStatusCallback: () => null,
    webhookAck: () => ({ status: 200, contentType: "application/json", body: "{}" }),
  };
  return { provider, sendSms };
}

function fakeEmail(result?: SendResult) {
  const sendEmail = vi.fn(
    async (_req: EmailSendRequest): Promise<SendResult> =>
      result ?? { ok: true, providerMessageId: "email-1" },
  );
  const provider: EmailProvider = {
    id: "resend",
    capabilities: {
      sms: false,
      email: true,
      deliveryReceipts: false,
      syncWebhookReply: false,
      nativeOptOutHandling: false,
      senderKinds: [],
      senderRegistrationApi: false,
    },
    sendEmail,
  };
  return { provider, sendEmail };
}

function makeDeps(
  config: Partial<MessagingRegistryConfig> = {},
  extra: Partial<OutboundDeps> = {},
): OutboundDeps {
  return {
    registry: createMessagingRegistry({
      smsDefault: "telnyx",
      emailDefault: "resend",
      sms: {},
      email: {},
      emailFromAddress: "Heyloo <alerts@heyloo.app>",
      ...config,
    }),
    logger,
    ...extra,
  };
}

describe("processOutboundMessage — customer SMS", () => {
  it("skips a message already in a terminal (sent) state", async () => {
    const { sql } = makeSql({ [MESSAGE]: [{ ...BASE_MESSAGE, status: "sent" }] });
    expect(await processOutboundMessage(sql, "msg_1", makeDeps())).toBe("skipped_terminal");
  });

  it("skips and marks failed when the customer has opted out of SMS", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql, calls } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [CUSTOMERS]: [{ sms_opt_out: true }],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const outcome = await processOutboundMessage(
      sql,
      "msg_1",
      makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } }),
    );
    expect(outcome).toBe("skipped_opt_out");
    expect(telnyx.sendSms).not.toHaveBeenCalled();
    expect(
      calls.some(
        (c) => c.text.includes("update public.messages_outbound") && c.text.includes("sms_opt_out"),
      ),
    ).toBe(true);
  });

  it("never sends an empty body for a template key with no renderer", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql, calls } = makeSql({
      [MESSAGE]: [{ ...BASE_MESSAGE, template_key: "order" }],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const outcome = await processOutboundMessage(
      sql,
      "msg_1",
      makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } }),
    );
    expect(outcome).toBe("failed");
    expect(telnyx.sendSms).not.toHaveBeenCalled();
    expect(calls.some((c) => c.values.includes("empty_rendered_body:order"))).toBe(true);
  });

  it("sends from the tenant's verified messaging sender through that sender's provider", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql, calls } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps(
      { sms: { telnyx: { configured: true, provider: telnyx.provider } } },
      { statusWebhookBaseUrl: "https://ref.supabase.co/functions/v1/webhooks-sms/" },
    );
    const outcome = await processOutboundMessage(sql, "msg_1", deps);
    expect(outcome).toBe("sent");
    expect(telnyx.sendSms).toHaveBeenCalledWith({
      to: "+15551234567",
      from: "+18885550100",
      body: "You're confirmed for Tue 2:00 PM. Reply STOP to opt out.",
      idempotencyKey: "msg_1",
      statusCallbackUrl: "https://ref.supabase.co/functions/v1/webhooks-sms/telnyx/status",
    });
    const update = calls.find((c) => c.text.includes("status = 'sent'"));
    expect(update?.values).toEqual(expect.arrayContaining(["telnyx-msg-1", "telnyx"]));
    expect(update?.text).toContain("sent_via = 'sms'");
  });

  it("per-number provider wins over the tenant override and the platform default", async () => {
    const telnyx = fakeSms("telnyx");
    const twilio = fakeSms("twilio");
    const { sql } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [ROUTE]: [{ ...VERIFIED_TELNYX_SENDER, sender_provider: "twilio", sms_provider: "telnyx" }],
    });
    const deps = makeDeps({
      sms: {
        telnyx: { configured: true, provider: telnyx.provider },
        twilio: { configured: true, provider: twilio.provider },
      },
    });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    expect(twilio.sendSms).toHaveBeenCalledTimes(1);
    expect(telnyx.sendSms).not.toHaveBeenCalled();
  });

  it("legacy tenants (no messaging_senders row) send from the primary number when A2P is verified", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [ROUTE]: [{ ...PENDING_LEGACY, a2p_status: "verified" }],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    expect(telnyx.sendSms.mock.calls[0]?.[0].from).toBe("+15559998888");
  });

  it("reroutes a customer text to the owner's email while texting isn't approved", async () => {
    const email = fakeEmail();
    const telnyx = fakeSms("telnyx");
    const { sql, calls } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [ROUTE]: [PENDING_LEGACY],
      [CONTACT]: [OWNER],
    });
    const deps = makeDeps({
      sms: { telnyx: { configured: true, provider: telnyx.provider } },
      email: { resend: { configured: true, provider: email.provider } },
    });
    const outcome = await processOutboundMessage(sql, "msg_1", deps);
    expect(outcome).toBe("rerouted_email");
    expect(telnyx.sendSms).not.toHaveBeenCalled();
    const sent = email.sendEmail.mock.calls[0]?.[0];
    expect(sent?.to).toBe("owner@example.com");
    expect(sent?.from).toBe("Heyloo <alerts@heyloo.app>");
    expect(sent?.idempotencyKey).toBe("msg_1");
    expect(sent?.subject).toContain("+15551234567");
    expect(sent?.text).toContain("You're confirmed for Tue 2:00 PM");
    const update = calls.find((c) => c.text.includes("status = 'sent'"));
    expect(update?.text).toContain("sent_via = 'email'");
  });

  it("respects an owner who turned email notifications off (records why instead of emailing)", async () => {
    const email = fakeEmail();
    const { sql, calls } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [ROUTE]: [PENDING_LEGACY],
      [CONTACT]: [{ ...OWNER, delivery: { sms_enabled: true, email_enabled: false } }],
    });
    const deps = makeDeps({ email: { resend: { configured: true, provider: email.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("failed");
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(calls.some((c) => c.values.includes("sms_pending_verification"))).toBe(true);
  });

  it("parks (provider_not_configured) when the tenant can text but that provider has no secrets", async () => {
    const { sql } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: false, missing: ["TELNYX_API_KEY"] } } });
    const err = await processOutboundMessage(sql, "msg_1", deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ParkMessageError);
    expect((err as ParkMessageError).reason).toBe("provider_not_configured");
    expect((err as ParkMessageError).createdAt).toBe(NOW);
  });

  it("throws (never swallows) on a transient provider failure so the queue retries", async () => {
    const telnyx = fakeSms("telnyx", {
      ok: false,
      failure: "transient",
      httpStatus: 503,
      errorCode: null,
      detail: "unavailable",
    });
    const { sql, calls } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    await expect(processOutboundMessage(sql, "msg_1", deps)).rejects.toThrow(
      "telnyx_send_transient_failure:503",
    );
    expect(calls.some((c) => c.text.includes("status = 'failed'"))).toBe(false);
  });

  it("marks failed without throwing on a permanent provider rejection", async () => {
    const telnyx = fakeSms("telnyx", {
      ok: false,
      failure: "permanent",
      httpStatus: 400,
      errorCode: "40310",
      detail: "Invalid 'to' address",
    });
    const { sql, calls } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("failed");
    expect(calls.some((c) => c.values.includes("telnyx:40310:Invalid 'to' address"))).toBe(true);
  });

  it("answers an inbound text even before carrier approval (no reroute for replies)", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql } = makeSql({
      [MESSAGE]: [
        {
          ...BASE_MESSAGE,
          template_key: "sms_reply",
          payload: { body: "Hi!", compliance: "help" },
        },
      ],
      [ROUTE]: [{ ...VERIFIED_TELNYX_SENDER, sender_status: "in_review" }],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    expect(telnyx.sendSms.mock.calls[0]?.[0].body).toBe("Hi!");
  });

  it("sends the STOP confirmation even though the customer is now opted out", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql } = makeSql({
      [MESSAGE]: [
        {
          ...BASE_MESSAGE,
          template_key: "sms_reply",
          payload: { body: "You've been unsubscribed.", compliance: "stop" },
        },
      ],
      [CUSTOMERS]: [{ sms_opt_out: true }],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
  });

  it("answers HELP even when the customer is opted out (as the TwiML path always did)", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql } = makeSql({
      [MESSAGE]: [
        {
          ...BASE_MESSAGE,
          template_key: "sms_reply",
          payload: { body: "Heyloo AI assistant. Reply STOP to unsubscribe.", compliance: "help" },
        },
      ],
      [CUSTOMERS]: [{ sms_opt_out: true }],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    expect(telnyx.sendSms).toHaveBeenCalledTimes(1);
  });

  it("still blocks a non-compliance reply (AI text) to an opted-out customer", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql } = makeSql({
      [MESSAGE]: [{ ...BASE_MESSAGE, template_key: "text_agent_reply", payload: { body: "Hi" } }],
      [CUSTOMERS]: [{ sms_opt_out: true }],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("skipped_opt_out");
    expect(telnyx.sendSms).not.toHaveBeenCalled();
  });

  it("normalizes a non-E.164 recipient before the opt-out lookup and the provider call", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql, calls } = makeSql({
      [MESSAGE]: [{ ...BASE_MESSAGE, recipient: "(555) 123-4567" }],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    const optOut = calls.find((c) => c.text.includes(CUSTOMERS));
    expect(optOut?.values).toContain("+15551234567");
    expect(telnyx.sendSms.mock.calls[0]?.[0].to).toBe("+15551234567");
    expect(telnyx.sendSms.mock.calls[0]?.[0].from).toBe("+18885550100");
  });

  it("fails (never sends) when the recipient can't be normalized to E.164", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql, calls } = makeSql({
      [MESSAGE]: [{ ...BASE_MESSAGE, recipient: "not-a-phone" }],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("failed");
    expect(telnyx.sendSms).not.toHaveBeenCalled();
    expect(calls.some((c) => c.values.includes("invalid_recipient_phone"))).toBe(true);
  });

  it("never reroutes a one-time verification code to the owner's email", async () => {
    const email = fakeEmail();
    const { sql, calls } = makeSql({
      [MESSAGE]: [
        { ...BASE_MESSAGE, template_key: "chat_phone_verification", payload: { code: "123456" } },
      ],
      [ROUTE]: [PENDING_LEGACY],
      [CONTACT]: [OWNER],
    });
    const deps = makeDeps({ email: { resend: { configured: true, provider: email.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("failed");
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(calls.some((c) => c.values.includes("sms_pending_verification"))).toBe(true);
  });

  it("keeps Twilio's request shape unchanged when Twilio is the provider", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }),
    );
    const twilio = createTwilioSmsProvider({ fetchImpl, accountSid: "AC1", authToken: "tok" });
    const { sql } = makeSql({
      [MESSAGE]: [BASE_MESSAGE],
      [ROUTE]: [{ ...VERIFIED_TELNYX_SENDER, sender_provider: "twilio" }],
    });
    const deps = makeDeps({ sms: { twilio: { configured: true, provider: twilio } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("To")).toBe("+15551234567");
    expect(form.get("From")).toBe("+18885550100");
    expect(form.get("StatusCallback")).toBeNull();
  });
});

describe("processOutboundMessage — email", () => {
  it("sends to the row's own recipient with an HTML-escaped body", async () => {
    const email = fakeEmail();
    const { sql } = makeSql({
      [MESSAGE]: [
        {
          ...BASE_MESSAGE,
          channel: "email",
          recipient: "owner@example.com",
          template_key: "support_ticket_update",
          payload: { body: "<script>x</script> & more" },
        },
      ],
    });
    const deps = makeDeps({ email: { resend: { configured: true, provider: email.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    const sent = email.sendEmail.mock.calls[0]?.[0];
    expect(sent?.to).toBe("owner@example.com");
    expect(sent?.html).toBe("<p>&lt;script&gt;x&lt;/script&gt; &amp; more</p>");
    expect(sent?.text).toBe("<script>x</script> & more");
  });

  it("parks (provider_not_configured) when no email provider is configured", async () => {
    const { sql } = makeSql({
      [MESSAGE]: [
        { ...BASE_MESSAGE, channel: "email", recipient: "o@example.com", template_key: "reminder" },
      ],
    });
    const err = await processOutboundMessage(sql, "msg_1", makeDeps()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ParkMessageError);
  });

  it("parks a quota-deferred send for the provider's retry-after instead of burning retries", async () => {
    const email = fakeEmail({
      ok: false,
      failure: "deferred",
      httpStatus: 429,
      errorCode: "daily_quota_exceeded",
      detail: "quota",
      retryAfterSeconds: 3600,
    });
    const { sql } = makeSql({
      [MESSAGE]: [
        { ...BASE_MESSAGE, channel: "email", recipient: "o@example.com", template_key: "reminder" },
      ],
    });
    const deps = makeDeps({ email: { resend: { configured: true, provider: email.provider } } });
    const err = (await processOutboundMessage(sql, "msg_1", deps).catch(
      (e: unknown) => e,
    )) as ParkMessageError;
    expect(err).toBeInstanceOf(ParkMessageError);
    expect(err.reason).toBe("resend:daily_quota_exceeded");
    expect(err.retryAfterSeconds).toBe(3600);
  });

  it("marks failed (never silently drops) for a not-yet-implemented channel like push", async () => {
    const { sql } = makeSql({ [MESSAGE]: [{ ...BASE_MESSAGE, channel: "push" }] });
    expect(await processOutboundMessage(sql, "msg_1", makeDeps())).toBe("failed");
  });
});

describe("processOutboundMessage — owner alerts", () => {
  const TAKE_MESSAGE = {
    ...BASE_MESSAGE,
    recipient: "+15550001111",
    template_key: "take_message",
    payload: { caller_name: "Jordan", caller_phone: "+15551234567", message_text: "Call me" },
  };

  it("texts the alert phone AND fans out an idempotent email copy when both are on", async () => {
    const telnyx = fakeSms("telnyx");
    const email = fakeEmail();
    const { sql, calls } = makeSql({
      [MESSAGE]: [TAKE_MESSAGE],
      [CONTACT]: [OWNER],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
      "insert into public.messages_outbound": [{ id: "child_1" }],
    });
    const deps = makeDeps({
      sms: { telnyx: { configured: true, provider: telnyx.provider } },
      email: { resend: { configured: true, provider: email.provider } },
    });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    expect(telnyx.sendSms.mock.calls[0]?.[0].to).toBe("+15550001111");
    const fanOut = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(fanOut?.text).toContain("on conflict (parent_message_id, channel)");
    expect(fanOut?.values).toEqual(expect.arrayContaining(["owner@example.com", "msg_1"]));
    const enqueue = calls.find((c) => c.text.includes("pgmq.send"));
    expect(enqueue?.values[1]).toEqual({ message_id: "child_1" });
  });

  it("emails the owner instead when texting isn't approved yet (never dropped)", async () => {
    const telnyx = fakeSms("telnyx");
    const email = fakeEmail();
    const { sql } = makeSql({
      [MESSAGE]: [TAKE_MESSAGE],
      [CONTACT]: [OWNER],
      [ROUTE]: [PENDING_LEGACY],
    });
    const deps = makeDeps({
      sms: { telnyx: { configured: true, provider: telnyx.provider } },
      email: { resend: { configured: true, provider: email.provider } },
    });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("rerouted_email");
    expect(telnyx.sendSms).not.toHaveBeenCalled();
    const sent = email.sendEmail.mock.calls[0]?.[0];
    expect(sent?.to).toBe("owner@example.com");
    expect(sent?.subject).toBe("New message from Jordan");
  });

  it("uses the notification email and skips SMS when the owner chose email only", async () => {
    const telnyx = fakeSms("telnyx");
    const email = fakeEmail();
    const { sql } = makeSql({
      [MESSAGE]: [TAKE_MESSAGE],
      [CONTACT]: [
        {
          ...OWNER,
          delivery: {
            sms_enabled: false,
            email_enabled: true,
            notification_email: "desk@example.com",
          },
        },
      ],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({
      sms: { telnyx: { configured: true, provider: telnyx.provider } },
      email: { resend: { configured: true, provider: email.provider } },
    });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    expect(telnyx.sendSms).not.toHaveBeenCalled();
    expect(email.sendEmail.mock.calls[0]?.[0].to).toBe("desk@example.com");
  });

  it("texts the configured alert phone rather than the transfer number", async () => {
    const telnyx = fakeSms("telnyx");
    const { sql } = makeSql({
      [MESSAGE]: [TAKE_MESSAGE],
      [CONTACT]: [
        {
          ...OWNER,
          delivery: { sms_enabled: true, email_enabled: false, alert_phone: "(555) 222-3333" },
        },
      ],
      [ROUTE]: [VERIFIED_TELNYX_SENDER],
    });
    const deps = makeDeps({ sms: { telnyx: { configured: true, provider: telnyx.provider } } });
    expect(await processOutboundMessage(sql, "msg_1", deps)).toBe("sent");
    expect(telnyx.sendSms.mock.calls[0]?.[0].to).toBe("+15552223333");
  });

  it("records owner_alerts_disabled when the owner turned both channels off", async () => {
    const { sql, calls } = makeSql({
      [MESSAGE]: [TAKE_MESSAGE],
      [CONTACT]: [{ ...OWNER, delivery: { sms_enabled: false, email_enabled: false } }],
    });
    expect(await processOutboundMessage(sql, "msg_1", makeDeps())).toBe("failed");
    expect(calls.some((c) => c.values.includes("owner_alerts_disabled"))).toBe(true);
  });

  it("delivers a fan-out email copy directly, without re-planning", async () => {
    const email = fakeEmail();
    const { sql } = makeSql({
      [MESSAGE]: [
        {
          ...TAKE_MESSAGE,
          id: "child_1",
          channel: "email",
          recipient: "owner@example.com",
          parent_message_id: "msg_1",
        },
      ],
    });
    const deps = makeDeps({ email: { resend: { configured: true, provider: email.provider } } });
    expect(await processOutboundMessage(sql, "child_1", deps)).toBe("sent");
    expect(email.sendEmail.mock.calls[0]?.[0].to).toBe("owner@example.com");
  });
});

// OPS-8: retry/dead-letter/park writes never strand the rest of the batch.
describe("runOutboundWorker", () => {
  const row = (over: { msgId: number; readCt: number; messageId: string }) => ({
    msg_id: over.msgId,
    read_ct: over.readCt,
    enqueued_at: "now",
    vt: "now",
    message: { message_id: over.messageId },
  });

  function dlqReason(calls: Call[]): string | undefined {
    const dlqCall = calls.find(
      (c) =>
        c.text.includes("pgmq.send") && String(c.values[0]).includes("messages_outbound_queue_dlq"),
    );
    const payload = dlqCall?.values.find(
      (v) => typeof v === "object" && v !== null && "reason" in (v as object),
    ) as { reason: string } | undefined;
    return payload?.reason;
  }

  it("dead-letters with a recorded reason once max attempts is reached", async () => {
    const batch = [row({ msgId: 1, readCt: 5, messageId: "msg_1" })];
    const calls: Call[] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("pgmq.read")) return batch;
      if (text.includes(MESSAGE)) throw new Error("telnyx_send_transient_failure:503");
      return [];
    }) as SqlClient;

    const result = await runOutboundWorker(sql, makeDeps());

    expect(result.processed).toBe(0);
    expect(result.dead_lettered).toBe(1);
    expect(dlqReason(calls)).toContain("max_attempts_exceeded");
    expect(dlqReason(calls)).toContain("telnyx_send_transient_failure");
  });

  it("never crashes the batch even when the dead-letter write itself throws", async () => {
    const batch = [
      row({ msgId: 1, readCt: 5, messageId: "msg_1" }),
      row({ msgId: 2, readCt: 5, messageId: "msg_2" }),
    ];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.read")) return batch;
      if (text.includes(MESSAGE)) throw new Error("transient");
      if (text.includes("pgmq.archive") && values[1] === 1) throw new Error("db_blip");
      return [];
    }) as SqlClient;

    const result = await runOutboundWorker(sql, makeDeps());
    expect(result.dead_lettered).toBe(1);
  });

  function parkSql(createdAt: string) {
    const calls: Call[] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("pgmq.read")) return [row({ msgId: 7, readCt: 1, messageId: "msg_1" })];
      if (text.includes(MESSAGE)) {
        return [
          {
            ...BASE_MESSAGE,
            channel: "email",
            recipient: "o@example.com",
            template_key: "reminder",
            created_at: createdAt,
          },
        ];
      }
      return [];
    }) as SqlClient;
    return { sql, calls };
  }

  it("parks a young provider_not_configured message: delayed re-enqueue, no retry spent", async () => {
    const { sql, calls } = parkSql(NOW);
    const result = await runOutboundWorker(sql, makeDeps(), () => Date.parse(NOW) + 60_000);
    expect(result.parked).toBe(1);
    expect(result.dead_lettered).toBe(0);
    const resend = calls.find(
      (c) => c.text.includes("pgmq.send") && c.text.includes("::integer") && c.values.length === 3,
    );
    expect(resend?.values[2]).toBe(15 * 60);
    expect(calls.some((c) => c.text.includes("pgmq.delete") && c.values[1] === 7)).toBe(true);
    expect(dlqReason(calls)).toBeUndefined();
  });

  it("dead-letters a parked message with reason provider_not_configured once past the window", async () => {
    const { sql, calls } = parkSql(NOW);
    const later = Date.parse(NOW) + (OUTBOUND_NOT_CONFIGURED_PARK_SECONDS + 60) * 1000;
    const result = await runOutboundWorker(sql, makeDeps(), () => later);
    expect(result.dead_lettered).toBe(1);
    expect(dlqReason(calls)).toBe("provider_not_configured");
    const statusUpdate = calls.find(
      (c) => c.text.includes("update public.messages_outbound") && c.values.includes("msg_1"),
    );
    expect(statusUpdate?.values).toContain("provider_not_configured");
  });

  it("enqueues stranded rows (never enqueued, < 24h old) before reading the batch", async () => {
    const calls: Call[] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("with stranded as"))
        return [
          { id: "m1", msg_id: 1 },
          { id: "m2", msg_id: 2 },
        ];
      return [];
    }) as SqlClient;
    const result = await runOutboundWorker(sql, makeDeps());
    expect(result.stranded_enqueued).toBe(2);
    const sweep = calls.find((c) => c.text.includes("with stranded as"));
    expect(sweep?.text).toContain("'pending_verification'");
    expect(sweep?.text).toContain("interval '24 hours'");
    expect(sweep?.text).toContain("not exists");
    // The sweep runs before pgmq.read.
    const sweepIdx = calls.findIndex((c) => c.text.includes("with stranded as"));
    const readIdx = calls.findIndex((c) => c.text.includes("pgmq.read"));
    expect(sweepIdx).toBeLessThan(readIdx);
  });
});

describe("sweepNotConfiguredOutbound", () => {
  it("dead-letters, with reason provider_not_configured, only messages older than the park window", async () => {
    const staleMessage = { msg_id: 1, message: { message_id: "m1" } };
    const calls: Call[] = [];
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      if (text.includes("pgmq.q_messages_outbound_queue")) return [staleMessage];
      return [];
    }) as SqlClient;

    const result = await sweepNotConfiguredOutbound(sql);

    expect(result.dead_lettered).toBe(1);
    const staleQuery = calls.find((c) => c.text.includes("pgmq.q_messages_outbound_queue"));
    expect(staleQuery?.values).toContain(OUTBOUND_NOT_CONFIGURED_PARK_SECONDS);
    const statusUpdate = calls.find(
      (c) => c.text.includes("update public.messages_outbound") && c.values.includes("m1"),
    );
    expect(statusUpdate?.text).toContain("status = 'failed'");
    expect(statusUpdate?.text).toContain("provider_not_configured");
  });

  it("never calls pgmq.read — a peek only, so a not-configured tick never bumps read_ct", async () => {
    const calls: string[] = [];
    const sql = (async (strings: TemplateStringsArray) => {
      calls.push(strings.join(" "));
      return [];
    }) as SqlClient;
    await sweepNotConfiguredOutbound(sql);
    expect(calls.some((t) => t.includes("pgmq.read"))).toBe(false);
  });

  it("leaves nothing to dead-letter when the queue has no stale messages", async () => {
    const sql = (async () => []) as SqlClient;
    expect((await sweepNotConfiguredOutbound(sql)).dead_lettered).toBe(0);
  });
});

describe("buildOutboundDeps", () => {
  const fetchImpl = vi.fn();

  it("reports every missing name when no provider can send (OPS-8 sweep path)", () => {
    const result = buildOutboundDeps(() => undefined, fetchImpl, logger);
    expect(result.configured).toBe(false);
    if (!result.configured) {
      expect(result.missing).toEqual(
        expect.arrayContaining([
          "TELNYX_API_KEY",
          "TWILIO_ACCOUNT_SID",
          "RESEND_API_KEY",
          "EMAIL_FROM_ADDRESS",
        ]),
      );
    }
  });

  it("runs with email alone — Twilio is no longer required for email to send", () => {
    const env: Record<string, string> = {
      RESEND_API_KEY: "re_key",
      RESEND_FROM_ADDRESS: "alerts@heyloo.app",
      WEBHOOKS_SMS_BASE_URL: "https://ref.supabase.co/functions/v1/webhooks-sms",
    };
    const result = buildOutboundDeps((name) => env[name], fetchImpl, logger);
    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.deps.registry.resolveEmail().ok).toBe(true);
      expect(result.deps.registry.resolveSms().ok).toBe(false);
      expect(result.deps.statusWebhookBaseUrl).toBe(env["WEBHOOKS_SMS_BASE_URL"]);
    }
  });
});
