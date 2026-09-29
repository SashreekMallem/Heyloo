import type { ResendFetch } from "../resend.ts";
import { sendEmail } from "../resend.ts";
import type {
  EmailProvider,
  EmailSendRequest,
  MessagingProviderCapabilities,
  SendResult,
} from "./types.ts";
import { failure } from "./types.ts";

/**
 * Resend email adapter (docs/design/MESSAGING_PROVIDERS.md). Email needs no
 * carrier approval — only a verified sending domain — which is why it is
 * the always-available fallback for owner alerts while SMS registration is
 * pending.
 *
 * Rule 1 (fetched 2026-09-29, docs/VERIFY.md MESSAGING-1):
 * resend.com/docs/api-reference/errors — error `name`s and statuses used
 * below. Errors come back as `{name, message, statusCode}`.
 */

export const RESEND_CAPABILITIES: MessagingProviderCapabilities = {
  sms: false,
  email: true,
  deliveryReceipts: false, // Resend has Svix-signed email webhooks; not consumed yet.
  syncWebhookReply: false,
  nativeOptOutHandling: false,
  senderKinds: [],
  senderRegistrationApi: false,
};

/** Rejections retrying cannot fix: malformed/invalid request, domain not
 * verified (`validation_error` 403), idempotency key reused with a
 * different payload. */
const PERMANENT_NAMES = new Set([
  "validation_error",
  "missing_required_field",
  "missing_required_parameter",
  "invalid_parameter",
  "invalid_attachment",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "email_above_quota",
]);

/** Quota exhaustion: the account is fine, the send window isn't. Park the
 * message instead of burning retries. */
const DEFERRED_NAMES: Record<string, number> = {
  daily_quota_exceeded: 60 * 60,
  monthly_quota_exceeded: 6 * 60 * 60,
};

export function classifyResendFailure(httpStatus: number, error: unknown): SendResult {
  const name = (error as { name?: unknown } | undefined)?.name;
  const message = (error as { message?: unknown } | undefined)?.message;
  const code = typeof name === "string" ? name : null;
  const detail = typeof message === "string" ? message : `resend_http_${httpStatus}`;
  if (code && PERMANENT_NAMES.has(code)) return failure("permanent", httpStatus, code, detail);
  if (code && DEFERRED_NAMES[code] !== undefined) {
    return failure("deferred", httpStatus, code, detail, DEFERRED_NAMES[code]);
  }
  return failure("transient", httpStatus, code, detail);
}

export interface ResendMessagingConfig {
  fetchImpl: ResendFetch;
  apiKey: string;
}

export function createResendEmailProvider(config: ResendMessagingConfig): EmailProvider {
  return {
    id: "resend",
    capabilities: RESEND_CAPABILITIES,
    async sendEmail(request: EmailSendRequest): Promise<SendResult> {
      let result: Awaited<ReturnType<typeof sendEmail>>;
      try {
        result = await sendEmail(
          config.fetchImpl,
          config.apiKey,
          {
            from: request.from,
            to: request.to,
            subject: request.subject,
            html: request.html,
            text: request.text,
            ...(request.replyTo ? { reply_to: request.replyTo } : {}),
          },
          { idempotencyKey: request.idempotencyKey },
        );
      } catch (err) {
        return failure("transient", 0, null, `resend_network_error:${String(err)}`);
      }
      if (result.ok) {
        // Resend always returns an id on success; the fallback keeps the
        // canonical "non-empty id" contract if it ever doesn't.
        return { ok: true, providerMessageId: result.id ?? `resend:${request.idempotencyKey}` };
      }
      return classifyResendFailure(result.status, result.error);
    },
  };
}
