import { composeAuthEmails, zAuthEmailHookPayload } from "../_shared/auth-email/compose.ts";
import type { MessagingRegistry } from "../_shared/providers/messaging/registry.ts";
import type { SendResult } from "../_shared/providers/messaging/types.ts";
import { verifyStandardWebhook } from "../_shared/standard-webhooks.ts";
import { withTimeout } from "../_shared/timeout.ts";
import type { Logger } from "../_shared/types.ts";

/**
 * Supabase Auth Send Email Hook (`auth-send-email`, EMAIL-MSGRAPH).
 *
 * Supabase Auth POSTs every auth email here instead of sending it itself:
 * signup confirmation, recovery, invite, magic link, email change, the
 * reauthentication code (and the security notifications when enabled). We
 * verify the Standard Webhooks signature over the RAW body first (fail
 * closed), render the email (`_shared/auth-email/compose.ts`) and send it
 * through the SAME messaging `EmailProvider` port as every other email, so
 * Microsoft Graph, SMTP or Resend all work.
 *
 * Rule 1 (docs/VERIFY.md EMAIL-MSGRAPH), supabase.com/docs/guides/auth/
 * auth-hooks and .../send-email-hook (fetched 2026-09-29):
 * - "HTTP Hooks should complete in 5 seconds"; 20 KB payload limit;
 * - "An empty response with a status code of 200 is taken as a successful
 *   response"; errors are `{"error": {"http_code": <n>, "message": "..."}}`;
 * - Auth retries recoverable errors (429, 503) up to three times with a
 *   two-second back-off, all inside ONE 5-second budget ("total time budget of
 *   5s including all retry requests"; with our 4.2 s send deadline a retry
 *   rarely fits, which is fine: the user can request the email again), so
 *   those statuses are used ONLY for problems a retry can fix (provider
 *   throttling, a slow provider); a permanent failure or a
 *   misconfiguration answers 500 so a signup does not wait through retries
 *   that cannot succeed.
 *
 * The error `message` Auth may surface to the end user is deliberately
 * generic; the owner-facing reason (expired secret, mailbox out of scope, ...)
 * goes to the logger only, which is where operators look (and Sentry, when
 * enabled). Tokens, hashes and links are never logged.
 */

/** Auth allows 5 s per hook call; leave headroom for Auth's own overhead. */
export const DEFAULT_SEND_DEADLINE_MS = 4200;
const MAX_BODY_BYTES = 64 * 1024;

export interface AuthSendEmailDeps {
  /** `SEND_EMAIL_HOOK_SECRET`, exactly as stored (`v1,whsec_...`). */
  hookSecret: string | undefined;
  registry: Pick<MessagingRegistry, "resolveEmail" | "emailFromAddress" | "missing">;
  logger: Logger;
  now: () => Date;
  sendDeadlineMs?: number;
}

export interface AuthSendEmailRequest {
  method: string;
  rawBody: string;
  header(name: string): string | null;
}

export interface AuthSendEmailResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

function hookError(
  status: number,
  message: string,
  headers?: Record<string, string>,
): AuthSendEmailResponse {
  return {
    status,
    body: { error: { http_code: status, message } },
    ...(headers ? { headers } : {}),
  };
}

const SUCCESS: AuthSendEmailResponse = { status: 200, body: {} };

type SendFailure = Extract<SendResult, { ok: false }>;

function failureResponse(failed: SendFailure): AuthSendEmailResponse {
  if (failed.failure === "deferred") {
    return hookError(
      429,
      "The email provider is rate limiting; please try again shortly.",
      failed.retryAfterSeconds ? { "retry-after": String(failed.retryAfterSeconds) } : undefined,
    );
  }
  if (failed.failure === "transient") {
    return hookError(503, "The email provider is temporarily unavailable.");
  }
  return hookError(500, "The email could not be sent.");
}

export async function handleAuthSendEmail(
  deps: AuthSendEmailDeps,
  request: AuthSendEmailRequest,
): Promise<AuthSendEmailResponse> {
  const { logger } = deps;
  if (request.method !== "POST") return hookError(405, "Method not allowed.");
  if (request.rawBody.length > MAX_BODY_BYTES) return hookError(413, "Payload too large.");

  // 1. Signature over the RAW body, before any parsing. Fail closed.
  const verification = await verifyStandardWebhook({
    rawBody: request.rawBody,
    header: request.header,
    secret: deps.hookSecret,
    now: deps.now(),
  });
  if (!verification.valid) {
    if (verification.reason === "missing_secret") {
      logger.error("auth_send_email_not_configured", { missing: ["SEND_EMAIL_HOOK_SECRET"] });
      return hookError(500, "The send email hook is not configured.");
    }
    logger.warn("auth_send_email_bad_signature", { reason: verification.reason });
    return hookError(401, "Invalid webhook signature.");
  }

  // 2. Parse and validate the payload at the boundary.
  let json: unknown;
  try {
    json = JSON.parse(request.rawBody);
  } catch {
    return hookError(400, "Body is not valid JSON.");
  }
  const parsed = zAuthEmailHookPayload.safeParse(json);
  if (!parsed.success) {
    logger.warn("auth_send_email_bad_payload", { issues: parsed.error.issues.length });
    return hookError(400, "Unexpected hook payload.");
  }
  const payload = parsed.data;
  const action = payload.email_data.email_action_type;

  // 3. Render.
  const composed = composeAuthEmails(payload);
  if (!composed.ok) {
    logger.warn("auth_send_email_cannot_compose", { action, reason: composed.reason });
    return hookError(400, "The email could not be prepared.");
  }

  // 4. Provider (same port as every other email). Fail closed if unconfigured.
  const resolution = deps.registry.resolveEmail();
  const from = deps.registry.emailFromAddress;
  if (!resolution.ok || !from) {
    logger.error("auth_send_email_provider_not_configured", {
      action,
      provider: resolution.ok ? null : resolution.providerId,
      missing: resolution.ok ? ["EMAIL_FROM_ADDRESS"] : resolution.missing,
    });
    return hookError(500, "Email sending is not configured.");
  }
  const provider = resolution.provider;
  const webhookId = request.header("webhook-id") ?? "";

  // 5. Send (two emails for a Secure Email Change), inside the hook's budget.
  let results: SendResult[];
  try {
    results = await withTimeout(
      Promise.all(
        composed.emails.map((email) =>
          provider.sendEmail({
            to: email.to,
            from,
            subject: email.subject,
            html: email.html,
            text: email.text,
            idempotencyKey: `auth-email:${webhookId}:${email.slot}`.slice(0, 256),
          }),
        ),
      ),
      deps.sendDeadlineMs ?? DEFAULT_SEND_DEADLINE_MS,
      () => new Error("auth_send_email_deadline"),
    );
  } catch (err) {
    logger.error("auth_send_email_send_error", {
      action,
      provider: provider.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return hookError(503, "The email provider did not answer in time.");
  }

  const failures: Array<{ slot: string; failed: SendFailure }> = [];
  results.forEach((result, index) => {
    if (!result.ok)
      failures.push({ slot: composed.emails[index]?.slot ?? "primary", failed: result });
  });
  if (failures.length === 0) {
    logger.info("auth_send_email_sent", {
      action,
      provider: provider.id,
      user_id: payload.user.id,
      count: results.length,
    });
    return SUCCESS;
  }

  for (const { slot, failed } of failures) {
    logger.error("auth_send_email_failed", {
      action,
      slot,
      provider: provider.id,
      user_id: payload.user.id,
      failure: failed.failure,
      http_status: failed.httpStatus,
      error_code: failed.errorCode,
      detail: failed.detail,
    });
  }
  // Worst failure wins: a permanent one (retry cannot help) over a deferred
  // one over a transient one.
  const rank = { permanent: 0, deferred: 1, transient: 2 } as const;
  const worst = [...failures].sort((a, b) => rank[a.failed.failure] - rank[b.failed.failure])[0];
  return failureResponse((worst as (typeof failures)[number]).failed);
}
