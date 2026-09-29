import { z } from "zod";
import type { SmtpConnector, SmtpTimeouts } from "./smtp-client.ts";
import {
  connectDenoTls,
  DEFAULT_SMTP_TIMEOUTS,
  SmtpError,
  sendSmtpMessage,
} from "./smtp-client.ts";
import { buildMimeMessage, messageIdFor, parseMailbox } from "./smtp-message.ts";
import type {
  EmailProvider,
  EmailSendRequest,
  MessagingProviderCapabilities,
  SendResult,
} from "./types.ts";
import { failure, zEmailSendRequest } from "./types.ts";

/**
 * SMTP email adapter: sends owner alerts and system mail from the owner's
 * OWN domain mailbox (Google Workspace, Zoho, any provider with an
 * implicit-TLS submission port) instead of a transactional-email API
 * (MSG-3, docs/design/MESSAGING_PROVIDERS.md, docs/SETUP_EMAIL.md).
 *
 * Selected with `EMAIL_PROVIDER=smtp`; configured by `SMTP_HOST`,
 * `SMTP_PORT` (default 465), `SMTP_USERNAME`, `SMTP_PASSWORD` and the shared
 * `EMAIL_FROM_ADDRESS`. Fails CLOSED like every adapter: a missing or invalid
 * value leaves the provider "not configured" (the registry then parks the
 * message; nothing is ever reported as sent).
 *
 * Rule 1 (fetched 2026-09-29, docs/VERIFY.md MSG-3):
 * - supabase.com/docs/guides/functions/limits: "Outgoing connections to
 *   ports 25 and 587 are not allowed" in Edge Functions, hence implicit TLS
 *   only (port 465) and a hard rejection of 25/587 here rather than a
 *   runtime hang;
 * - RFC 5321/4954/8314/5322 for the protocol and message format
 *   (smtp-client.ts, smtp-message.ts).
 */

export const SMTP_CAPABILITIES: MessagingProviderCapabilities = {
  sms: false,
  email: true,
  deliveryReceipts: false, // SMTP acceptance only; bounces arrive in the mailbox, not here.
  syncWebhookReply: false,
  nativeOptOutHandling: false,
  senderKinds: [],
  senderRegistrationApi: false,
};

export const SMTP_DEFAULT_PORT = 465;
/** Outgoing ports Supabase Edge Functions refuse to connect to. */
export const SMTP_BLOCKED_PORTS: readonly number[] = [25, 587];

const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

export const zSmtpConfig = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(HOSTNAME, "must be a bare host name such as smtp.gmail.com (no scheme, path or port)"),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .refine((port) => !SMTP_BLOCKED_PORTS.includes(port), {
      message:
        "outgoing ports 25 and 587 are blocked in Supabase Edge Functions; use an implicit-TLS port (465)",
    }),
  username: z.string().min(1).max(320),
  // Not trimmed: a password is opaque. Paste app passwords WITHOUT the spaces
  // Google displays (docs/SETUP_EMAIL.md).
  password: z.string().min(1).max(1024),
});
export type SmtpConfig = z.infer<typeof zSmtpConfig>;

export type SmtpConfigResult = { ok: true; config: SmtpConfig } | { ok: false; missing: string[] };

const ENV_FOR_FIELD: Record<string, string> = {
  host: "SMTP_HOST",
  port: "SMTP_PORT",
  username: "SMTP_USERNAME",
  password: "SMTP_PASSWORD",
};

/**
 * Reads and validates the `SMTP_*` variables. Unset ones are reported by
 * name; invalid ones as `NAME (why)` (never the secret's value), so both
 * surface through the registry's `missing()` list into the worker's
 * `not_configured` response and logs.
 */
export function parseSmtpEnv(env: (name: string) => string | undefined): SmtpConfigResult {
  const raw = {
    host: env("SMTP_HOST") ?? "",
    port: env("SMTP_PORT")?.trim() || String(SMTP_DEFAULT_PORT),
    username: env("SMTP_USERNAME") ?? "",
    password: env("SMTP_PASSWORD") ?? "",
  };
  const missing: string[] = [];
  for (const field of ["host", "username", "password"] as const) {
    if (!raw[field].trim()) missing.push(ENV_FOR_FIELD[field] as string);
  }
  if (!/^\d+$/.test(raw.port)) {
    missing.push("SMTP_PORT (must be a whole number, e.g. 465)");
  }
  if (missing.length > 0) return { ok: false, missing };

  const parsed = zSmtpConfig.safeParse({ ...raw, port: Number(raw.port) });
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    missing: parsed.error.issues.map((issue) => {
      const name = ENV_FOR_FIELD[String(issue.path[0])] ?? "SMTP_*";
      return `${name} (${issue.message})`;
    }),
  };
}

/**
 * SMTP outcome -> the canonical failure classes the worker acts on:
 * - `auth` (credentials rejected) and `permanent` 5xx, and our own `config`
 *   problems: permanent, the row is marked failed at once with the reason;
 * - `quota` (the mailbox's daily sending limit): deferred one hour, so the
 *   worker parks the message instead of burning retry attempts;
 * - 4xx replies, timeouts, network and protocol errors: transient, retried
 *   with backoff and dead-lettered after the worker's attempt limit.
 */
export function classifySmtpFailure(err: unknown): SendResult {
  if (!(err instanceof SmtpError)) {
    return failure(
      "transient",
      0,
      "smtp_unexpected_error",
      `smtp_unexpected_error: ${String(err)}`,
    );
  }
  const status = err.code ?? 0;
  const code = (fallback: string) => (err.code ? `smtp_${err.code}` : fallback);
  switch (err.kind) {
    case "auth":
      return failure("permanent", status, "smtp_auth_failed", err.message);
    case "permanent":
      return failure("permanent", status, code("smtp_rejected"), err.message);
    case "config":
      return failure("permanent", status, "smtp_config_error", err.message);
    case "quota":
      return failure("deferred", status, code("smtp_quota"), err.message, 60 * 60);
    case "transient":
      return failure("transient", status, code("smtp_temporary_failure"), err.message);
    case "timeout":
      return failure("transient", status, "smtp_timeout", err.message);
    case "network":
      return failure("transient", status, "smtp_network_error", err.message);
    case "protocol":
      return failure("transient", status, "smtp_protocol_error", err.message);
  }
}

export interface SmtpEmailProviderConfig {
  config: SmtpConfig;
  /** Socket factory; defaults to `Deno.connectTls`. Tests inject a fake server. */
  connect?: SmtpConnector;
  timeouts?: SmtpTimeouts;
  now?: () => Date;
  /** MIME boundary generator (tests pin it). */
  boundary?: () => string;
}

function defaultBoundary(): string {
  return `heyloo_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function createSmtpEmailProvider(options: SmtpEmailProviderConfig): EmailProvider {
  const connect = options.connect ?? connectDenoTls;
  const now = options.now ?? (() => new Date());
  const boundary = options.boundary ?? defaultBoundary;

  return {
    id: "smtp",
    capabilities: SMTP_CAPABILITIES,
    async sendEmail(request: EmailSendRequest): Promise<SendResult> {
      const parsed = zEmailSendRequest.safeParse(request);
      if (!parsed.success) {
        return failure(
          "permanent",
          0,
          "invalid_request",
          `invalid_request: ${parsed.error.message}`,
        );
      }
      const req = parsed.data;
      const from = parseMailbox(req.from);
      if (!from) {
        return failure(
          "permanent",
          0,
          "invalid_from_address",
          "invalid_from_address: EMAIL_FROM_ADDRESS must be an ASCII address like alerts@yourdomain.com or Name <alerts@yourdomain.com>",
        );
      }
      const to = parseMailbox(req.to);
      const replyTo = req.replyTo ? parseMailbox(req.replyTo) : null;
      if (!to || (req.replyTo && !replyTo)) {
        return failure(
          "permanent",
          0,
          "invalid_recipient",
          "invalid_recipient: not a plain ASCII address",
        );
      }

      const domain = from.address.slice(from.address.lastIndexOf("@") + 1);
      const messageId = messageIdFor(req.idempotencyKey, domain);
      let message: string;
      try {
        message = buildMimeMessage({
          from,
          to,
          ...(replyTo ? { replyTo } : {}),
          subject: req.subject,
          text: req.text,
          html: req.html,
          messageId,
          date: now(),
          boundary: boundary(),
        });
      } catch (err) {
        return failure("permanent", 0, "invalid_message", `invalid_message: ${String(err)}`);
      }

      try {
        await sendSmtpMessage({
          connect,
          server: {
            hostname: options.config.host,
            port: options.config.port,
            username: options.config.username,
            password: options.config.password,
            clientName: domain,
          },
          envelope: { from: from.address, to: to.address },
          message,
          timeouts: options.timeouts ?? DEFAULT_SMTP_TIMEOUTS,
        });
      } catch (err) {
        return classifySmtpFailure(err);
      }
      // SMTP acceptance carries no provider id of its own; the Message-ID we
      // generated is the id the receiving mailbox will show.
      return { ok: true, providerMessageId: messageId };
    },
  };
}
