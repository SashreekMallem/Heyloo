import { z } from "zod";
import { normalizeE164 } from "../../phone.ts";
import type { TwilioFetch } from "../twilio.ts";
import {
  addPhoneNumberToMessagingService,
  createA2pCampaign,
  createMessagingService,
  getA2pCampaign,
  sendSms as twilioSendSms,
} from "../twilio.ts";
import { verifyTwilioSignature } from "./twilio-signature.ts";
import type {
  CanonicalDeliveryStatus,
  CanonicalInboundSms,
  DeliveryStatus,
  MessagingProviderCapabilities,
  RawWebhookRequest,
  SenderRegistration,
  SenderRegistrationApi,
  SendResult,
  SmsProvider,
  SmsSendRequest,
  WebhookAck,
  WebhookVerification,
} from "./types.ts";
import { failure } from "./types.ts";

/**
 * Twilio Programmable Messaging adapter (docs/design/MESSAGING_PROVIDERS.md).
 * The ONLY place Twilio messaging field names (`MessageSid`, `Body`,
 * `MessageStatus`, `ErrorCode`, `campaignStatus`, ...) are read. Wraps the
 * pre-existing plain-fetch REST client (`../twilio.ts`) and signature
 * verifier (`./twilio-signature.ts`) with unchanged request shapes; the
 * only additive change is an optional `StatusCallback` when the platform
 * has a public status-webhook URL configured.
 *
 * Rule 1 (fetched 2026-09-29, docs/VERIFY.md MESSAGING-1):
 * - twilio.com/docs/messaging/api/message-resource — `StatusCallback`,
 *   status values `queued, sending, sent, failed, delivered, undelivered,
 *   receiving, received, accepted, scheduled, read, partially_delivered,
 *   canceled`, failed-create body `{code, message, more_info, status}`.
 * - twilio.com/docs/usage/webhooks/webhooks-security — form params sorted
 *   alphabetically and appended to the URL, HMAC-SHA1 keyed by the Auth
 *   Token (what `verifyTwilioSignature` implements).
 */

export const TWILIO_CAPABILITIES: MessagingProviderCapabilities = {
  sms: true,
  email: false,
  deliveryReceipts: true,
  // TwiML `<Message>` in the webhook response IS the reply — kept exactly
  // as before this adapter existed.
  syncWebhookReply: true,
  // Twilio's default opt-out handling blocks sends after STOP (error 21610),
  // but our own STOP/START/HELP replies are what go out today (TwiML), so
  // the pipeline keeps replying itself; `providerHandledKeyword` is null.
  nativeOptOutHandling: true,
  senderKinds: ["10dlc", "toll_free", "short_code"],
  senderRegistrationApi: true,
};

/** Twilio inbound-SMS webhook form fields (moved unchanged from the former
 * `_shared/schemas/twilio-sms.ts`). Only the fields we read are required;
 * everything else Twilio sends is passthrough. */
export const TwilioInboundSmsSchema = z
  .object({
    MessageSid: z.string().min(1),
    From: z.string().min(1),
    To: z.string().min(1),
    Body: z.string().default(""),
    NumMedia: z.string().optional(),
  })
  .passthrough();

export const TwilioStatusCallbackSchema = z
  .object({
    MessageSid: z.string().min(1),
    MessageStatus: z.string().min(1),
    ErrorCode: z.string().optional(),
  })
  .passthrough();

export function formParamsToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

function formParams(request: RawWebhookRequest): Record<string, string> {
  return formParamsToObject(new URLSearchParams(request.rawBody));
}

/** Twilio `code`s on a message-create rejection that retrying cannot fix —
 * moved unchanged from the worker (H1 fix, docs/BUILD_NOTES.md). */
const PERMANENT_TWILIO_ERROR_CODES = new Set([
  21211, // Invalid 'To' Phone Number
  21614, // 'To' number is not a valid, SMS-capable mobile number
  21408, // Permission to send to this region has not been enabled
  21610, // Recipient has replied STOP (opt-out desync defense-in-depth)
]);

export function classifyTwilioSendFailure(httpStatus: number, body: unknown): SendResult {
  const code = (body as { code?: unknown } | undefined)?.code;
  const message = (body as { message?: unknown } | undefined)?.message;
  const detail = typeof message === "string" ? message : `twilio_http_${httpStatus}`;
  if (typeof code === "number" && PERMANENT_TWILIO_ERROR_CODES.has(code)) {
    return failure("permanent", httpStatus, String(code), detail);
  }
  return failure("transient", httpStatus, typeof code === "number" ? String(code) : null, detail);
}

/** Twilio `MessageStatus` -> canonical. Inbound-direction values
 * (`receiving`/`received`) and ones with no canonical meaning for a 1:1 SMS
 * return null (ignored). */
export function mapTwilioMessageStatus(status: string): DeliveryStatus | null {
  switch (status) {
    case "accepted":
    case "scheduled":
    case "queued":
      return "queued";
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
    case "read":
      return "delivered";
    case "undelivered":
      return "undelivered";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return null;
  }
}

function twiml(replyBody?: string): string {
  return replyBody
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(replyBody)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
  );
}

/** Legacy 10DLC campaign flow (moved from `api-a2p-register/handler.ts`,
 * unchanged requests). NOTE: registers per-tenant campaigns against ONE
 * shared platform brand — carriers require a brand per end business for
 * ISVs (docs/design/MESSAGING_PROVIDERS.md "Carrier registration"), so this
 * path is kept for parity but is not the recommended one. */
export function mapTwilioCampaignStatus(status: string | undefined): SenderRegistration["status"] {
  const normalized = (status ?? "").toUpperCase();
  if (["APPROVED", "VERIFIED", "SUCCESS"].includes(normalized)) return "verified";
  if (["FAILED", "DECLINED", "REJECTED"].includes(normalized)) return "failed";
  return "in_review";
}

function registrationApi(config: TwilioMessagingConfig): SenderRegistrationApi {
  const { fetchImpl, accountSid, authToken } = config;
  const errorCode = (body: unknown): string | null => {
    const code = (body as { code?: unknown } | undefined)?.code;
    return typeof code === "number" || typeof code === "string" ? String(code) : null;
  };
  return {
    kind: "10dlc",
    async createMessagingProfile({ friendlyName }) {
      const res = await createMessagingService(fetchImpl, accountSid, authToken, friendlyName);
      const sid = (res.body as { sid?: unknown } | undefined)?.sid;
      if (!res.ok || typeof sid !== "string") {
        return { ok: false, httpStatus: res.status, errorCode: errorCode(res.body) };
      }
      return { ok: true, profileId: sid };
    },
    async attachNumber({ profileId, providerNumberId }) {
      const res = await addPhoneNumberToMessagingService(
        fetchImpl,
        accountSid,
        authToken,
        profileId,
        providerNumberId,
      );
      if (!res.ok) return { ok: false, httpStatus: res.status, errorCode: errorCode(res.body) };
      return { ok: true, providerNumberId };
    },
    async submitRegistration({ profileId, brandRef, business }) {
      const res = await createA2pCampaign(fetchImpl, accountSid, authToken, profileId, {
        brandRegistrationSid: brandRef,
        description: `Automated phone answering and appointment booking for ${business.businessName}, a ${business.vertical.replace("_", " ")} business.`,
        messageFlow:
          "Customers speak with our AI phone assistant and give verbal consent during the call before receiving any SMS booking confirmation, reminder, or reply.",
        usAppToPersonUsecase: "CUSTOMER_CARE",
        hasEmbeddedLinks: true,
        hasEmbeddedPhone: true,
        privacyPolicyUrl: business.privacyPolicyUrl,
        termsAndConditionsUrl: business.termsUrl,
        sampleMessages: [
          "You're confirmed for Tue 2:00 PM at Joe's Auto. Reply STOP to opt out.",
          "A slot opened up for your requested time — reply YES to book it.",
        ],
      });
      const body = res.body as { sid?: unknown; campaignStatus?: unknown } | undefined;
      if (!res.ok || typeof body?.sid !== "string") {
        return { ok: false, httpStatus: res.status, errorCode: errorCode(res.body) };
      }
      return {
        ok: true,
        registrationRef: body.sid,
        registration: {
          kind: "10dlc",
          status: mapTwilioCampaignStatus(
            typeof body.campaignStatus === "string" ? body.campaignStatus : undefined,
          ),
          failureReason: null,
        },
      };
    },
    async getRegistration({ profileId, registrationRef }) {
      const res = await getA2pCampaign(
        fetchImpl,
        accountSid,
        authToken,
        profileId,
        registrationRef,
      );
      if (!res.ok) return { ok: false, httpStatus: res.status, errorCode: errorCode(res.body) };
      const body = res.body as { campaignStatus?: unknown; failureReason?: unknown } | undefined;
      const status = mapTwilioCampaignStatus(
        typeof body?.campaignStatus === "string" ? body.campaignStatus : undefined,
      );
      return {
        ok: true,
        registration: {
          kind: "10dlc",
          status,
          failureReason:
            status === "failed"
              ? typeof body?.failureReason === "string"
                ? body.failureReason
                : "rejected"
              : null,
        },
      };
    },
  };
}

export interface TwilioMessagingConfig {
  fetchImpl: TwilioFetch;
  accountSid: string;
  authToken: string;
}

export function createTwilioSmsProvider(config: TwilioMessagingConfig): SmsProvider {
  return {
    id: "twilio",
    capabilities: TWILIO_CAPABILITIES,

    async sendSms(request: SmsSendRequest): Promise<SendResult> {
      // Twilio's Messages API has no idempotency-key header; duplicate
      // protection is the worker's own terminal-status check.
      const result = await twilioSendSms(config.fetchImpl, config.accountSid, config.authToken, {
        to: request.to,
        from: request.from,
        body: request.body,
        ...(request.statusCallbackUrl ? { statusCallback: request.statusCallbackUrl } : {}),
      });
      const sid = (result.body as { sid?: unknown } | undefined)?.sid;
      if (result.ok && typeof sid === "string" && sid.length > 0) {
        return { ok: true, providerMessageId: sid };
      }
      return classifyTwilioSendFailure(result.status, result.body);
    },

    async verifyInboundWebhook(request: RawWebhookRequest): Promise<WebhookVerification> {
      const result = await verifyTwilioSignature({
        url: request.url,
        formParams: formParams(request),
        authToken: config.authToken,
        signatureHeader: request.header("x-twilio-signature"),
      });
      return result.valid ? { valid: true } : { valid: false, reason: result.reason ?? "mismatch" };
    },

    parseInbound(request: RawWebhookRequest): CanonicalInboundSms | null {
      const params = formParams(request);
      // A status callback carries MessageStatus for OUR outbound message;
      // an inbound message carries SmsStatus/MessageStatus = "received".
      const status = params["MessageStatus"] ?? params["SmsStatus"];
      if (status !== undefined && status !== "received") return null;
      const parsed = TwilioInboundSmsSchema.safeParse(params);
      if (!parsed.success) return null;
      const fromE164 = normalizeE164(parsed.data.From);
      const toE164 = normalizeE164(parsed.data.To);
      if (!fromE164 || !toE164) return null;
      return {
        provider: "twilio",
        eventId: parsed.data.MessageSid,
        providerMessageId: parsed.data.MessageSid,
        fromE164,
        toE164,
        body: parsed.data.Body,
        providerHandledKeyword: null,
      };
    },

    parseStatusCallback(request: RawWebhookRequest): CanonicalDeliveryStatus | null {
      const parsed = TwilioStatusCallbackSchema.safeParse(formParams(request));
      if (!parsed.success) return null;
      const status = mapTwilioMessageStatus(parsed.data.MessageStatus);
      if (!status) return null;
      return {
        provider: "twilio",
        // One callback per status transition per message.
        eventId: `${parsed.data.MessageSid}:${parsed.data.MessageStatus}`,
        providerMessageId: parsed.data.MessageSid,
        status,
        errorCode: parsed.data.ErrorCode ? parsed.data.ErrorCode : null,
      };
    },

    webhookAck(replyBody?: string): WebhookAck {
      return { status: 200, contentType: "text/xml", body: twiml(replyBody) };
    },

    registration: registrationApi(config),
  };
}
