/**
 * Canonical messaging types (SMS + email) — the provider-neutral contract
 * every messaging adapter (`supabase/functions/_shared/providers/messaging/*`)
 * maps its own payloads into and out of (CLAUDE.md Rule 2: core code sees
 * only these shapes, never a Twilio/Telnyx/Resend field name).
 *
 * The Deno edge runtime cannot import this package, so
 * `supabase/functions/_shared/providers/messaging/types.ts` mirrors these
 * schemas and a Vitest parity test there diffs the two (same convention as
 * `_shared/schemas/voice-tools.test.ts` for the tool contracts).
 *
 * Design: docs/design/MESSAGING_PROVIDERS.md.
 */

import { z } from "zod";
import { E164_PATTERN } from "./primitives.js";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const MESSAGING_CHANNELS = ["sms", "email"] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

/** SMS providers with an adapter today. Adding one = one adapter file plus
 * one entry here (and in the Deno mirror); no core change. */
export const SMS_PROVIDER_IDS = ["telnyx", "twilio"] as const;
export type SmsProviderId = (typeof SMS_PROVIDER_IDS)[number];
export const zSmsProviderId = z.enum(SMS_PROVIDER_IDS);

/** Email providers with an adapter today: an HTTP API (`resend`) or the
 * owner's own mailbox over SMTP with implicit TLS (`smtp`). */
export const EMAIL_PROVIDER_IDS = ["resend", "smtp"] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDER_IDS)[number];
export const zEmailProviderId = z.enum(EMAIL_PROVIDER_IDS);

// ---------------------------------------------------------------------------
// Outbound send
// ---------------------------------------------------------------------------

const zE164String = z.string().regex(E164_PATTERN, "must be E.164 format, e.g. +15551234567");

export const zSmsSendRequest = z.object({
  to: zE164String,
  from: zE164String,
  /** Rendered body. Carriers segment it; 1600 chars is the common provider cap. */
  body: z.string().min(1).max(1600),
  /** `messages_outbound.id` — passed to providers that honor an idempotency key. */
  idempotencyKey: z.string().min(1).max(256),
  /** Where the provider should POST delivery receipts, when it supports per-message URLs. */
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

/** Permanent = retrying cannot help (bad recipient, opted out, sender not
 * allowed). Transient = retry with backoff, dead-letter after max attempts.
 * Deferred = the provider is fine but refuses for now (daily/monthly quota):
 * park the message for `retryAfterSeconds` without spending an attempt. */
export const SEND_FAILURE_CLASSES = ["permanent", "transient", "deferred"] as const;
export type SendFailureClass = (typeof SEND_FAILURE_CLASSES)[number];

export const zSendResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), providerMessageId: z.string().min(1) }),
  z.object({
    ok: z.literal(false),
    failure: z.enum(SEND_FAILURE_CLASSES),
    httpStatus: z.number().int(),
    /** Provider's own error code, stringified (Twilio `21211`, Telnyx `40300`, Resend `validation_error`). */
    errorCode: z.string().nullable(),
    detail: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
]);
export type SendResult = z.infer<typeof zSendResult>;

// ---------------------------------------------------------------------------
// Inbound + delivery status (webhooks)
// ---------------------------------------------------------------------------

/** Compliance keyword a provider says it matched and acted on (block rule
 * added/removed). It does NOT mean the provider replied: core records the
 * opt-out state, skips only its own STOP confirmation (the provider's block
 * would reject it), and still answers HELP and START itself. */
export const INBOUND_KEYWORD_CLASSES = ["stop", "start", "help"] as const;
export type InboundKeywordClass = (typeof INBOUND_KEYWORD_CLASSES)[number];

export const zCanonicalInboundSms = z.object({
  provider: zSmsProviderId,
  /** Dedup key for `webhook_events` (unique per provider event). */
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
  provider: zSmsProviderId,
  eventId: z.string().min(1),
  providerMessageId: z.string().min(1),
  status: z.enum(DELIVERY_STATUSES),
  errorCode: z.string().nullable(),
});
export type CanonicalDeliveryStatus = z.infer<typeof zCanonicalDeliveryStatus>;

// ---------------------------------------------------------------------------
// Senders + carrier registration
// ---------------------------------------------------------------------------

/** US A2P sender types. Every one needs carrier approval before it can send
 * to US handsets: 10DLC = TCR brand + campaign, toll_free = toll-free
 * verification, short_code = carrier short-code application. */
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

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface MessagingProviderCapabilities {
  readonly sms: boolean;
  readonly email: boolean;
  /** Provider posts delivery receipts core can map to `CanonicalDeliveryStatus`. */
  readonly deliveryReceipts: boolean;
  /** The inbound-webhook HTTP response itself can carry the reply (Twilio
   * TwiML). When false, replies go out as ordinary queued sends. */
  readonly syncWebhookReply: boolean;
  /** Provider enforces STOP itself (blocks later sends, may auto-reply). */
  readonly nativeOptOutHandling: boolean;
  /** Sender kinds this adapter can send from. */
  readonly senderKinds: readonly SenderKind[];
  /** Adapter can submit/poll carrier registration by API. */
  readonly senderRegistrationApi: boolean;
}

// ---------------------------------------------------------------------------
// Owner notifications
// ---------------------------------------------------------------------------

/** Events that alert the business owner (not the caller). */
export const OWNER_ALERT_KINDS = [
  "message_taken",
  "new_booking",
  "new_order",
  "urgent_call",
  "missed_transfer",
  "line_ready",
] as const;
export type OwnerAlertKind = (typeof OWNER_ALERT_KINDS)[number];
