import { z } from "zod";

/**
 * Messaging provider port (docs/design/MESSAGING_PROVIDERS.md).
 *
 * Every SMS/email vendor is one adapter file in this directory implementing
 * `SmsProvider` or `EmailProvider`. Core code (the `messages_outbound`
 * worker, the inbound/status webhook, owner alerts, A2P/toll-free
 * registration) depends ONLY on the types below — never on a vendor field
 * name (CLAUDE.md Rule 2). Switching SMS vendor is a config change:
 * `SMS_PROVIDER` env (platform default), `tenants.sms_provider` (tenant
 * override) or `messaging_senders.provider` (per-number, wins).
 *
 * The Zod schemas mirror `packages/canonical-types/src/messaging.ts`
 * (Deno cannot import that package); `canonical-parity.test.ts` diffs them.
 */

const E164 = /^\+[1-9]\d{1,14}$/;
const zE164String = z.string().regex(E164);

export const SMS_PROVIDER_IDS = ["telnyx", "twilio"] as const;
export type SmsProviderId = (typeof SMS_PROVIDER_IDS)[number];
export const EMAIL_PROVIDER_IDS = ["resend"] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDER_IDS)[number];

export function isSmsProviderId(value: unknown): value is SmsProviderId {
  return typeof value === "string" && (SMS_PROVIDER_IDS as readonly string[]).includes(value);
}
export function isEmailProviderId(value: unknown): value is EmailProviderId {
  return typeof value === "string" && (EMAIL_PROVIDER_IDS as readonly string[]).includes(value);
}

export const SEND_FAILURE_CLASSES = ["permanent", "transient", "deferred"] as const;
export type SendFailureClass = (typeof SEND_FAILURE_CLASSES)[number];

export const zSmsSendRequest = z.object({
  to: zE164String,
  from: zE164String,
  body: z.string().min(1).max(1600),
  idempotencyKey: z.string().min(1).max(256),
  statusCallbackUrl: z.url().optional(),
});
export type SmsSendRequest = z.infer<typeof zSmsSendRequest>;

export const zEmailSendRequest = z.object({
  to: z.email(),
  from: z.string().min(3),
  subject: z.string().min(1).max(998),
  html: z.string(),
  text: z.string(),
  idempotencyKey: z.string().min(1).max(256),
  replyTo: z.email().optional(),
});
export type EmailSendRequest = z.infer<typeof zEmailSendRequest>;

export const zSendResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), providerMessageId: z.string().min(1) }),
  z.object({
    ok: z.literal(false),
    failure: z.enum(SEND_FAILURE_CLASSES),
    httpStatus: z.number().int(),
    errorCode: z.string().nullable(),
    detail: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
]);
export type SendResult = z.infer<typeof zSendResult>;

export const INBOUND_KEYWORD_CLASSES = ["stop", "start", "help"] as const;
export type InboundKeywordClass = (typeof INBOUND_KEYWORD_CLASSES)[number];

export const zCanonicalInboundSms = z.object({
  provider: z.enum(SMS_PROVIDER_IDS),
  eventId: z.string().min(1),
  providerMessageId: z.string().min(1),
  fromE164: zE164String,
  toE164: zE164String,
  body: z.string(),
  providerHandledKeyword: z.enum(INBOUND_KEYWORD_CLASSES).nullable(),
});
export type CanonicalInboundSms = z.infer<typeof zCanonicalInboundSms>;

export const DELIVERY_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "undelivered",
  "failed",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const zCanonicalDeliveryStatus = z.object({
  provider: z.enum(SMS_PROVIDER_IDS),
  eventId: z.string().min(1),
  providerMessageId: z.string().min(1),
  status: z.enum(DELIVERY_STATUSES),
  errorCode: z.string().nullable(),
});
export type CanonicalDeliveryStatus = z.infer<typeof zCanonicalDeliveryStatus>;

export const SENDER_KINDS = ["toll_free", "10dlc", "short_code"] as const;
export type SenderKind = (typeof SENDER_KINDS)[number];

export const SENDER_REGISTRATION_STATUSES = [
  "not_submitted",
  "submitted",
  "in_review",
  "verified",
  "failed",
] as const;
export type SenderRegistrationStatus = (typeof SENDER_REGISTRATION_STATUSES)[number];

export const zSenderRegistration = z.object({
  kind: z.enum(SENDER_KINDS),
  status: z.enum(SENDER_REGISTRATION_STATUSES),
  failureReason: z.string().nullable(),
});
export type SenderRegistration = z.infer<typeof zSenderRegistration>;

export interface MessagingProviderCapabilities {
  readonly sms: boolean;
  readonly email: boolean;
  readonly deliveryReceipts: boolean;
  readonly syncWebhookReply: boolean;
  readonly nativeOptOutHandling: boolean;
  readonly senderKinds: readonly SenderKind[];
  readonly senderRegistrationApi: boolean;
}

export const OWNER_ALERT_KINDS = [
  "message_taken",
  "new_booking",
  "urgent_call",
  "missed_transfer",
] as const;
export type OwnerAlertKind = (typeof OWNER_ALERT_KINDS)[number];

// ---------------------------------------------------------------------------
// Port interfaces (functions-side only — they carry behavior, not data)
// ---------------------------------------------------------------------------

export type MessagingFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A raw inbound HTTP request, exactly as received. `url` is the PUBLIC URL
 * the provider called (some signature schemes sign it), not the runtime's
 * internal one. Header lookup is case-insensitive. */
export interface RawWebhookRequest {
  rawBody: string;
  url: string;
  header(name: string): string | null;
}

export type WebhookVerification =
  | { valid: true }
  | {
      valid: false;
      reason: "missing_secret" | "missing_header" | "mismatch" | "stale_timestamp" | "malformed";
    };

/** The HTTP response a provider expects back from our webhook. */
export interface WebhookAck {
  status: number;
  contentType: string;
  body: string;
}

export interface SmsProvider {
  readonly id: SmsProviderId;
  readonly capabilities: MessagingProviderCapabilities;
  sendSms(request: SmsSendRequest): Promise<SendResult>;
  /** Signature check on the RAW body, first thing, fail closed. */
  verifyInboundWebhook(request: RawWebhookRequest): Promise<WebhookVerification>;
  /** `null` when this webhook isn't an inbound message (or is malformed). */
  parseInbound(request: RawWebhookRequest): CanonicalInboundSms | null;
  /** `null` when this webhook isn't a delivery receipt (or is malformed). */
  parseStatusCallback(request: RawWebhookRequest): CanonicalDeliveryStatus | null;
  /** The provider's expected HTTP ack. `replyBody` is honored only when
   * `capabilities.syncWebhookReply`; otherwise callers queue the reply. */
  webhookAck(replyBody?: string): WebhookAck;
  /** Optional carrier-registration API (see `SenderRegistrationApi`). */
  readonly registration?: SenderRegistrationApi;
}

export interface EmailProvider {
  readonly id: EmailProviderId;
  readonly capabilities: MessagingProviderCapabilities;
  sendEmail(request: EmailSendRequest): Promise<SendResult>;
}

/** Carrier registration steps expressed provider-neutrally: a "messaging
 * profile" is the unit a registration attaches to (Twilio Messaging
 * Service, Telnyx messaging profile), numbers join it, and a registration
 * (10DLC campaign / toll-free verification) is submitted against it. */
export interface RegistrationBusinessDetails {
  businessName: string;
  vertical: string;
  privacyPolicyUrl: string;
  termsUrl: string;
}

export type RegistrationStepResult<T> =
  | ({ ok: true } & T)
  | { ok: false; httpStatus: number; errorCode: string | null };

export interface SenderRegistrationApi {
  readonly kind: SenderKind;
  createMessagingProfile(input: {
    friendlyName: string;
  }): Promise<RegistrationStepResult<{ profileId: string }>>;
  attachNumber(input: {
    profileId: string;
    providerNumberId: string;
  }): Promise<RegistrationStepResult<{ providerNumberId: string }>>;
  submitRegistration(input: {
    profileId: string;
    brandRef: string;
    business: RegistrationBusinessDetails;
  }): Promise<
    RegistrationStepResult<{ registrationRef: string; registration: SenderRegistration }>
  >;
  getRegistration(input: {
    profileId: string;
    registrationRef: string;
  }): Promise<RegistrationStepResult<{ registration: SenderRegistration }>>;
}

/** Shared helper: the canonical mapping every adapter's HTTP-level failure
 * falls back to when it has no provider-specific code to go on. 429 and 5xx
 * are always worth retrying; everything else defaults to transient too
 * (misclassifying permanent as transient only costs retries before the
 * same dead-letter; the reverse would drop a message without retry). */
export function failure(
  kind: SendFailureClass,
  httpStatus: number,
  errorCode: string | null,
  detail: string,
  retryAfterSeconds?: number,
): SendResult {
  return {
    ok: false,
    failure: kind,
    httpStatus,
    errorCode,
    detail: detail.slice(0, 500),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}
