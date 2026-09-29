import { z } from "zod";
import { fromBase64 } from "../../crypto.ts";
import { normalizeE164 } from "../../phone.ts";
import type {
  CanonicalDeliveryStatus,
  CanonicalInboundSms,
  DeliveryStatus,
  InboundKeywordClass,
  MessagingFetch,
  MessagingProviderCapabilities,
  RawWebhookRequest,
  SendResult,
  SmsProvider,
  SmsSendRequest,
  WebhookAck,
  WebhookVerification,
} from "./types.ts";
import { failure } from "./types.ts";

/**
 * Telnyx Messaging adapter (docs/design/MESSAGING_PROVIDERS.md) — the
 * platform's first SMS provider while the Twilio account is blocked. The
 * ONLY place Telnyx field names are read.
 *
 * Rule 1 (fetched 2026-09-29, docs/VERIFY.md MESSAGING-1):
 * - developers.telnyx.com/docs/messaging/messages/send-message —
 *   `POST https://api.telnyx.com/v2/messages`, `Authorization: Bearer`,
 *   JSON `{from, to, text, messaging_profile_id?, webhook_url?,
 *   use_profile_webhooks?}` (E.164, text up to 1,600 chars), success
 *   `{data: {id, to: [{status}], ...}}`, error `{errors: [{code, title,
 *   detail}]}`, 429 with `retry-after`. No idempotency header documented.
 * - .../receiving-webhooks — `data.event_type` `message.received` (inbound;
 *   `data.payload.{id, from.phone_number, to[].phone_number, text}`),
 *   `message.sent` / `message.finalized` (outbound; `to[].status` one of
 *   `queued, sending, sent, delivered, sending_failed, delivery_failed,
 *   delivery_unconfirmed`); Ed25519 signature in `telnyx-signature-ed25519`
 *   over `"{telnyx-timestamp}|{raw body}"`, base64 public key from the
 *   portal, reject timestamps older than 5 minutes, 2xx within 2 s.
 * - .../advanced-opt-in-out — "When a user sends an opt-in, opt-out, or
 *   help keyword, the inbound message webhook includes an
 *   `autoresponse_type` field" (STOP/START/HELP). That marks a keyword
 *   MATCH (block rule added/removed), not a reply: the same page says
 *   Telnyx sends no auto-reply unless one is configured. Sends to an
 *   opted-out number fail with 40300.
 * - .../error-codes — API-time 403xx codes used in `PERMANENT_CODES`.
 */

const TELNYX_API_BASE = "https://api.telnyx.com/v2";
const SIGNATURE_TOLERANCE_SECONDS = 300;

export const TELNYX_CAPABILITIES: MessagingProviderCapabilities = {
  sms: true,
  email: false,
  deliveryReceipts: true,
  // Telnyx wants a bare 2xx within 2 s; replies are separate API sends.
  syncWebhookReply: false,
  nativeOptOutHandling: true,
  senderKinds: ["toll_free", "10dlc"],
  // Toll-free verification / 10DLC have APIs, but submission is done in the
  // Telnyx portal for now (see MESSAGING_PROVIDERS.md); not automated here.
  senderRegistrationApi: false,
};

/** API-time rejections retrying cannot fix. Recipient-level: opted out,
 * invalid/unroutable destination. Sender-level: number not on a profile,
 * profile disabled, toll-free not verified/provisioned, destination not
 * whitelisted — fixing those is a config change, not a retry. */
const PERMANENT_CODES = new Set([
  "40001", // not routable (landline)
  "40300", // blocked: recipient replied STOP
  "40305", // invalid 'from' (not on a messaging profile)
  "40310", // invalid 'to'
  "40312", // messaging profile disabled
  "40329", // toll-free not verified
  "40330", // toll-free not provisioned for messaging
  "40331", // no whitelisted destinations on profile
]);

const zTelnyxError = z.object({
  errors: z
    .array(
      z
        .object({
          code: z.union([z.string(), z.number()]).optional(),
          title: z.string().optional(),
          detail: z.string().optional(),
        })
        .passthrough(),
    )
    .min(1),
});

export function classifyTelnyxSendFailure(
  httpStatus: number,
  body: unknown,
  retryAfterHeader: string | null,
): SendResult {
  const parsed = zTelnyxError.safeParse(body);
  const first = parsed.success ? parsed.data.errors[0] : undefined;
  const code = first?.code !== undefined ? String(first.code) : null;
  const detail = first?.detail ?? first?.title ?? `telnyx_http_${httpStatus}`;
  if (code && PERMANENT_CODES.has(code)) return failure("permanent", httpStatus, code, detail);
  if (httpStatus === 429) {
    const retryAfter = Number(retryAfterHeader);
    return failure(
      "transient",
      httpStatus,
      code,
      detail,
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined,
    );
  }
  return failure("transient", httpStatus, code, detail);
}

/** Telnyx `to[].status` -> canonical. */
export function mapTelnyxMessageStatus(status: string): DeliveryStatus | null {
  switch (status) {
    case "queued":
      return "queued";
    case "sending":
      return "sending";
    case "sent":
    case "delivery_unconfirmed": // carrier never confirmed; best known state is "sent"
      return "sent";
    case "delivered":
      return "delivered";
    case "delivery_failed":
      return "undelivered";
    case "sending_failed":
      return "failed";
    default:
      return null;
  }
}

const zPhoneRef = z.object({ phone_number: z.string().min(1) }).passthrough();

const zTelnyxEvent = z.object({
  data: z
    .object({
      id: z.string().min(1),
      event_type: z.string().min(1),
      payload: z
        .object({
          id: z.string().min(1),
          from: zPhoneRef.optional(),
          to: z.array(zPhoneRef.extend({ status: z.string().optional() })).optional(),
          text: z.string().nullable().optional(),
          autoresponse_type: z.string().nullable().optional(),
          errors: z
            .array(z.object({ code: z.union([z.string(), z.number()]).optional() }).passthrough())
            .optional(),
        })
        .passthrough(),
    })
    .passthrough(),
});

function parseEvent(request: RawWebhookRequest): z.infer<typeof zTelnyxEvent> | null {
  let json: unknown;
  try {
    json = JSON.parse(request.rawBody);
  } catch {
    return null;
  }
  const parsed = zTelnyxEvent.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function keywordClass(value: string | null | undefined): InboundKeywordClass | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "stop" || normalized === "start" || normalized === "help"
    ? normalized
    : null;
}

async function verifyEd25519(
  publicKeyB64: string,
  signatureB64: string,
  message: string,
): Promise<boolean> {
  const publicKey = fromBase64(publicKeyB64);
  const signature = fromBase64(signatureB64);
  if (publicKey.byteLength !== 32 || signature.byteLength !== 64) return false;
  const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, [
    "verify",
  ]);
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    signature,
    new TextEncoder().encode(message),
  );
}

export interface TelnyxMessagingConfig {
  fetchImpl: MessagingFetch;
  apiKey: string;
  /** Base64 Ed25519 public key (Mission Control -> Keys & Credentials). */
  publicKey?: string;
  /** Sent with every message when set; otherwise the number's own profile applies. */
  messagingProfileId?: string;
  /** Injectable clock (ms) for the replay-window check. */
  now?: () => number;
}

export function createTelnyxSmsProvider(config: TelnyxMessagingConfig): SmsProvider {
  const now = config.now ?? (() => Date.now());
  return {
    id: "telnyx",
    capabilities: TELNYX_CAPABILITIES,

    async sendSms(request: SmsSendRequest): Promise<SendResult> {
      let res: Response;
      try {
        res = await config.fetchImpl(`${TELNYX_API_BASE}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            from: request.from,
            to: request.to,
            text: request.body,
            ...(config.messagingProfileId
              ? { messaging_profile_id: config.messagingProfileId }
              : {}),
            ...(request.statusCallbackUrl ? { webhook_url: request.statusCallbackUrl } : {}),
          }),
        });
      } catch (err) {
        return failure("transient", 0, null, `telnyx_network_error:${String(err)}`);
      }
      const body = (await res.json().catch(() => undefined)) as unknown;
      const id = (body as { data?: { id?: unknown } } | undefined)?.data?.id;
      if (res.ok && typeof id === "string" && id.length > 0) {
        return { ok: true, providerMessageId: id };
      }
      return classifyTelnyxSendFailure(res.status, body, res.headers.get("retry-after"));
    },

    async verifyInboundWebhook(request: RawWebhookRequest): Promise<WebhookVerification> {
      if (!config.publicKey) return { valid: false, reason: "missing_secret" };
      const signature = request.header("telnyx-signature-ed25519");
      const timestamp = request.header("telnyx-timestamp");
      if (!signature || !timestamp) return { valid: false, reason: "missing_header" };
      const ts = Number(timestamp);
      if (!Number.isFinite(ts)) return { valid: false, reason: "malformed" };
      if (Math.abs(now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) {
        return { valid: false, reason: "stale_timestamp" };
      }
      try {
        const ok = await verifyEd25519(
          config.publicKey,
          signature.trim(),
          `${timestamp}|${request.rawBody}`,
        );
        return ok ? { valid: true } : { valid: false, reason: "mismatch" };
      } catch {
        return { valid: false, reason: "malformed" };
      }
    },

    parseInbound(request: RawWebhookRequest): CanonicalInboundSms | null {
      const event = parseEvent(request);
      if (event?.data.event_type !== "message.received") return null;
      const payload = event.data.payload;
      const fromE164 = normalizeE164(payload.from?.phone_number);
      const toE164 = normalizeE164(payload.to?.[0]?.phone_number);
      if (!fromE164 || !toE164) return null;
      return {
        provider: "telnyx",
        eventId: event.data.id,
        providerMessageId: payload.id,
        fromE164,
        toE164,
        body: payload.text ?? "",
        providerHandledKeyword: keywordClass(payload.autoresponse_type),
      };
    },

    parseStatusCallback(request: RawWebhookRequest): CanonicalDeliveryStatus | null {
      const event = parseEvent(request);
      if (!event) return null;
      if (event.data.event_type !== "message.sent" && event.data.event_type !== "message.finalized")
        return null;
      const payload = event.data.payload;
      const status = mapTelnyxMessageStatus(payload.to?.[0]?.status ?? "");
      if (!status) return null;
      const code = payload.errors?.[0]?.code;
      return {
        provider: "telnyx",
        eventId: event.data.id,
        providerMessageId: payload.id,
        status,
        errorCode: code !== undefined ? String(code) : null,
      };
    },

    webhookAck(): WebhookAck {
      return { status: 200, contentType: "application/json", body: "{}" };
    },
  };
}
