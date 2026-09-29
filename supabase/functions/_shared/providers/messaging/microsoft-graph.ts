import { z } from "zod";
import { isSafeAddress, parseMailbox } from "./smtp-message.ts";
import type {
  EmailProvider,
  EmailSendRequest,
  MessagingFetch,
  MessagingProviderCapabilities,
  SendResult,
} from "./types.ts";
import { failure as canonicalFailure, zEmailSendRequest } from "./types.ts";

/**
 * Microsoft Graph email adapter: sends owner alerts, customer email and the
 * Supabase Auth emails (`auth-send-email`) from ONE Microsoft 365 mailbox
 * over HTTPS (docs/SETUP_EMAIL_MICROSOFT.md, docs/design/MESSAGING_PROVIDERS.md).
 * HTTPS only, because Supabase Edge Functions cannot open outgoing SMTP
 * connections on ports 25/587.
 *
 * Selected with `EMAIL_PROVIDER=microsoft_graph`; configured by
 * `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` and the shared
 * `EMAIL_FROM_ADDRESS` (the sending mailbox's UPN, optionally with a display
 * name: `Heyloo <ms@heycuey.com>`). Fails CLOSED like every adapter: a
 * missing or invalid value leaves the provider "not configured" and nothing
 * is ever reported as sent.
 *
 * Rule 1 (fetched 2026-09-29, docs/VERIFY.md EMAIL-MSGRAPH):
 * - learn.microsoft.com/graph/api/user-sendmail — app-only
 *   `POST /users/{id | userPrincipalName}/sendMail`, Application permission
 *   `Mail.Send`; JSON body `{message, saveToSentItems}`; `202 Accepted` with
 *   an empty body (delivery is NOT confirmed by the 202: "subject to Exchange
 *   Online limitations and throttling");
 * - learn.microsoft.com/entra/identity-platform/v2-oauth2-client-creds-grant-flow —
 *   `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, form
 *   body `client_id`, `scope=https://graph.microsoft.com/.default`,
 *   `client_secret`, `grant_type=client_credentials`; success
 *   `{token_type, expires_in, access_token}`, error `{error, error_description,
 *   error_codes}`; no refresh tokens in this flow, so "refresh" = a new request;
 * - learn.microsoft.com/graph/throttling — `429 Too Many Requests` with a
 *   `Retry-After` header (seconds); back off by that delay.
 *
 * Body strategy (Graph takes ONE body per message in JSON format): the
 * request's `html` is sent as `contentType: "HTML"`. Every HTML body in this
 * repo is a simple, self-contained layout whose links are also printed as
 * plain text, so it reads correctly in text-only clients. If a caller passes
 * an empty `html`, its `text` is sent as `contentType: "Text"` instead. A true
 * multipart/alternative would need the base64 MIME form of sendMail; that is
 * deliberately not used (docs/design/MESSAGING_PROVIDERS.md).
 *
 * Delivery caveats worth knowing: sendMail has no idempotency key, so a
 * request that times out AFTER Graph accepted it and is then retried can
 * deliver twice; and `saveToSentItems: false` keeps system mail out of the
 * mailbox's Sent Items.
 */

export const MICROSOFT_GRAPH_CAPABILITIES: MessagingProviderCapabilities = {
  sms: false,
  email: true,
  deliveryReceipts: false, // 202 = accepted only; bounces arrive in the mailbox, not here.
  syncWebhookReply: false,
  nativeOptOutHandling: false,
  senderKinds: [],
  senderRegistrationApi: false,
};

export const MS_TOKEN_HOST = "https://login.microsoftonline.com";
export const MS_GRAPH_HOST = "https://graph.microsoft.com";
export const MS_GRAPH_SCOPE = `${MS_GRAPH_HOST}/.default`;

/** A cached token is dropped this long before Microsoft says it expires. */
export const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;
/** Retry-After bounds and the default when Graph sends none on a 429/503. */
const MAX_RETRY_AFTER_SECONDS = 60 * 60;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
/** Outgoing-request timeouts. Small on purpose: the Supabase Auth email hook
 * has a 5 s budget, and the worker retries anything that times out. */
export const DEFAULT_GRAPH_TIMEOUTS = { tokenMs: 2500, sendMs: 2500 } as const;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)+$/;

export const zMsGraphConfig = z.object({
  // A directory (tenant) ID GUID, or a verified domain such as
  // heycuey.onmicrosoft.com. Both go into a URL path, hence the strict shapes.
  tenantId: z
    .string()
    .trim()
    .refine((v) => GUID.test(v) || TENANT_DOMAIN.test(v), {
      message: "must be the Directory (tenant) ID GUID from the Entra app overview",
    }),
  clientId: z
    .string()
    .trim()
    .refine((v) => GUID.test(v), {
      message: "must be the Application (client) ID GUID from the Entra app overview",
    }),
  // Not trimmed: a secret is opaque. Paste the secret VALUE, not the secret ID.
  clientSecret: z.string().min(1).max(512),
  /** The sending mailbox: userPrincipalName / primary address. */
  mailbox: z.string().refine(isSafeAddress, { message: "must be a plain ASCII address" }),
  displayName: z.string().max(200).nullable(),
});
export type MsGraphConfig = z.infer<typeof zMsGraphConfig>;

export type MsGraphConfigResult =
  | { ok: true; config: MsGraphConfig }
  | { ok: false; missing: string[] };

const ENV_FOR_FIELD: Record<string, string> = {
  tenantId: "MS_TENANT_ID",
  clientId: "MS_CLIENT_ID",
  clientSecret: "MS_CLIENT_SECRET",
  mailbox: "EMAIL_FROM_ADDRESS",
  displayName: "EMAIL_FROM_ADDRESS",
};

/**
 * Reads and validates the `MS_*` variables plus `EMAIL_FROM_ADDRESS`
 * (`RESEND_FROM_ADDRESS` still honoured, like the registry). Unset ones are
 * reported by name, invalid ones as `NAME (why)` — never the secret's value.
 */
export function parseMsGraphEnv(env: (name: string) => string | undefined): MsGraphConfigResult {
  const fromRaw = (env("EMAIL_FROM_ADDRESS") || env("RESEND_FROM_ADDRESS") || "").trim();
  const missing: string[] = [];
  if (!(env("MS_TENANT_ID") ?? "").trim()) missing.push("MS_TENANT_ID");
  if (!(env("MS_CLIENT_ID") ?? "").trim()) missing.push("MS_CLIENT_ID");
  if (!env("MS_CLIENT_SECRET")) missing.push("MS_CLIENT_SECRET");
  if (!fromRaw) missing.push("EMAIL_FROM_ADDRESS");
  if (missing.length > 0) return { ok: false, missing };

  const mailbox = parseMailbox(fromRaw);
  if (!mailbox) {
    return {
      ok: false,
      missing: [
        "EMAIL_FROM_ADDRESS (must be the sending mailbox, like ms@yourdomain.com or Name <ms@yourdomain.com>)",
      ],
    };
  }
  const parsed = zMsGraphConfig.safeParse({
    tenantId: env("MS_TENANT_ID") ?? "",
    clientId: env("MS_CLIENT_ID") ?? "",
    clientSecret: env("MS_CLIENT_SECRET") ?? "",
    mailbox: mailbox.address,
    displayName: mailbox.name,
  });
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    missing: parsed.error.issues.map((issue) => {
      const name = ENV_FOR_FIELD[String(issue.path[0])] ?? "MS_*";
      return `${name} (${issue.message})`;
    }),
  };
}

// ---------------------------------------------------------------------------
// Token acquisition (client credentials), cached in module scope
// ---------------------------------------------------------------------------

export interface CachedToken {
  accessToken: string;
  /** epoch ms after which the token must not be used (already skewed). */
  usableUntil: number;
}

export interface GraphTokenCache {
  tokens: Map<string, CachedToken>;
  /** In-flight token requests, so concurrent sends share one round trip. */
  pending: Map<string, Promise<TokenResult>>;
}

/** Module scope: survives across requests within one warm Edge Function
 * isolate, which is what keeps the token round trip off the hot path. */
const MODULE_TOKEN_CACHE: GraphTokenCache = { tokens: new Map(), pending: new Map() };

export function clearGraphTokenCache(cache: GraphTokenCache = MODULE_TOKEN_CACHE): void {
  cache.tokens.clear();
  cache.pending.clear();
}

const zTokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
});

const zTokenError = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
  error_codes: z.array(z.number()).optional(),
});

type SendFailure = Extract<SendResult, { ok: false }>;

/** `failure()` from the port, typed as the failure arm of `SendResult`. */
function fail(...args: Parameters<typeof canonicalFailure>): SendFailure {
  return canonicalFailure(...args) as SendFailure;
}

type TokenOutcome = { ok: true; accessToken: string } | { ok: false; result: SendFailure };
export type TokenResult =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; result: SendFailure };

export interface GraphAdapterOptions {
  fetchImpl: MessagingFetch;
  config: MsGraphConfig;
  timeouts?: { tokenMs: number; sendMs: number };
  now?: () => number;
  /** Correlation id for `client-request-id` (tests pin it). */
  requestId?: () => string;
  cache?: GraphTokenCache;
}

function cacheKey(config: MsGraphConfig): string {
  return `${config.tenantId.toLowerCase()}|${config.clientId.toLowerCase()}`;
}

/** Replaces the secret and any access token that ended up in a string. */
function redact(text: string, ...secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** First line only, bounded: an AADSTS message carries a trace id block after
 * the first line that is noise in an owner-facing reason. */
function firstLine(text: string, max = 240): string {
  const line = text.split(/\r?\n/)[0] ?? "";
  return line.trim().slice(0, max);
}

async function fetchWithTimeout(
  fetchImpl: MessagingFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** `Retry-After`: delay-seconds, or an HTTP-date (RFC 9110 10.2.3). */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  let seconds: number;
  if (/^\d+$/.test(value)) seconds = Number(value);
  else {
    const at = Date.parse(value);
    if (Number.isNaN(at)) return undefined;
    seconds = Math.ceil((at - nowMs) / 1000);
  }
  if (!Number.isFinite(seconds) || seconds < 1) return 1;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Microsoft identity platform token failures -> canonical classes. */
function classifyTokenFailure(
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
  nowMs: number,
  secret: string,
): SendFailure {
  const parsed = zTokenError.safeParse(body);
  const err = parsed.success ? parsed.data : {};
  const codes = err.error_codes ?? [];
  const aadsts = codes.length > 0 ? `AADSTS${codes[0]}` : null;
  const description = redact(firstLine(err.error_description ?? ""), secret);
  const suffix = [aadsts, description].filter(Boolean).join(": ");

  if (status === 429 || status === 503) {
    return fail(
      "deferred",
      status,
      "ms_token_throttled",
      `Microsoft sign-in is throttling requests; will retry. ${suffix}`,
      parseRetryAfter(retryAfterHeader, nowMs) ?? DEFAULT_RETRY_AFTER_SECONDS,
    );
  }
  if (status >= 500) {
    return fail(
      "transient",
      status,
      "ms_token_unavailable",
      `Microsoft sign-in is temporarily unavailable. ${suffix}`,
    );
  }
  // 4xx from the token endpoint: the app credentials or tenant are wrong.
  let code = "ms_token_rejected";
  let reason = "Microsoft rejected the app sign-in.";
  // The specific AADSTS codes come first; `invalid_client` is the generic bucket.
  if (aadsts === "AADSTS7000222") {
    code = "ms_secret_expired";
    reason =
      "The Entra client secret has expired. Create a new client secret in Entra (App registrations > the app > Certificates & secrets) and update the MS_CLIENT_SECRET secret.";
  } else if (aadsts === "AADSTS700016") {
    code = "ms_app_not_found";
    reason =
      "No app with MS_CLIENT_ID exists in that tenant. Check MS_CLIENT_ID and MS_TENANT_ID against the app's Overview page in Entra.";
  } else if (aadsts === "AADSTS7000215" || err.error === "invalid_client") {
    code = "ms_invalid_client";
    reason =
      "Microsoft rejected the app credentials: MS_CLIENT_SECRET is wrong (paste the secret VALUE, not the secret ID), expired, or belongs to a different app. Create a new client secret in Entra and update the MS_CLIENT_SECRET secret.";
  } else if (aadsts === "AADSTS90002" || aadsts === "AADSTS900023") {
    code = "ms_tenant_not_found";
    reason = "MS_TENANT_ID is not a valid Microsoft 365 directory (tenant) ID.";
  }
  return fail("permanent", status, code, `${reason} ${suffix}`.trim());
}

async function requestToken(
  options: Required<Omit<GraphAdapterOptions, "cache">>,
): Promise<TokenResult> {
  const { config, fetchImpl, timeouts, now } = options;
  const body = new URLSearchParams({
    client_id: config.clientId,
    scope: MS_GRAPH_SCOPE,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
  });
  let res: Response;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${MS_TOKEN_HOST}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
      },
      timeouts.tokenMs,
    );
  } catch (err) {
    return {
      ok: false,
      result: fail(
        "transient",
        0,
        isAbort(err) ? "ms_token_timeout" : "ms_token_network_error",
        isAbort(err)
          ? "Microsoft sign-in did not answer in time."
          : `Could not reach Microsoft sign-in: ${redact(String(err), config.clientSecret)}`,
      ),
    };
  }
  const json = await readJson(res);
  if (!res.ok) {
    return {
      ok: false,
      result: classifyTokenFailure(
        res.status,
        json,
        res.headers.get("retry-after"),
        now(),
        config.clientSecret,
      ),
    };
  }
  const parsed = zTokenResponse.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      result: fail(
        "transient",
        res.status,
        "ms_token_malformed",
        "Microsoft sign-in returned an unexpected response.",
      ),
    };
  }
  return { ok: true, accessToken: parsed.data.access_token, expiresIn: parsed.data.expires_in };
}

// ---------------------------------------------------------------------------
// sendMail
// ---------------------------------------------------------------------------

const zGraphError = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
});

/**
 * Graph `sendMail` failure -> canonical classes:
 * - 403: `permanent`, with the owner-facing fix (no Mail.Send access for this
 *   mailbox: the Exchange RBAC role assignment or admin consent is missing, or
 *   the mailbox is outside the app's RBAC scope);
 * - 404: `permanent`, the sending mailbox does not exist / has no licence;
 * - 429 / 503: `deferred` for `Retry-After` (the worker parks it);
 * - other 5xx, 408, network and timeouts: `transient`;
 * - 400 and other 4xx: `permanent` (bad recipient, message too large, ...).
 */
export function classifyGraphSendFailure(
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
  nowMs: number,
  mailbox: string,
): SendFailure {
  const parsed = zGraphError.safeParse(body);
  const graphCode = parsed.success ? (parsed.data.error?.code ?? null) : null;
  const graphMessage = parsed.success ? firstLine(parsed.data.error?.message ?? "") : "";
  const tail = [graphCode, graphMessage].filter(Boolean).join(": ");
  const make = (
    kind: "permanent" | "transient" | "deferred",
    code: string,
    detail: string,
    retryAfter?: number,
  ) => fail(kind, status, code, `${detail}${tail ? ` (${tail})` : ""}`, retryAfter);

  if (status === 403) {
    return make(
      "permanent",
      "ms_forbidden",
      `Microsoft refused to send as ${mailbox}. The app has no Mail.Send access for this mailbox: either the Exchange RBAC for Applications role assignment "Application Mail.Send" is missing or was scoped to a different mailbox, or (if you use the Mail.Send application permission instead) admin consent was not granted. See docs/SETUP_EMAIL_MICROSOFT.md.`,
    );
  }
  if (status === 404) {
    return make(
      "permanent",
      "ms_mailbox_not_found",
      `Microsoft could not find the sending mailbox ${mailbox}. EMAIL_FROM_ADDRESS must be the mailbox's own user principal name and the mailbox needs an Exchange Online licence.`,
    );
  }
  if (status === 429 || status === 503) {
    return make(
      "deferred",
      status === 429 ? "ms_throttled" : "ms_unavailable",
      status === 429
        ? "Microsoft is throttling this mailbox; will retry."
        : "Microsoft Graph is temporarily unavailable; will retry.",
      parseRetryAfter(retryAfterHeader, nowMs) ?? DEFAULT_RETRY_AFTER_SECONDS,
    );
  }
  if (status >= 500 || status === 408 || status === 409 || status === 423) {
    return make("transient", "ms_temporary_failure", "Microsoft Graph had a temporary problem.");
  }
  if (status === 401) {
    return make(
      "permanent",
      "ms_unauthorized",
      "Microsoft Graph rejected a freshly issued token. Check that the app is in the same tenant as MS_TENANT_ID and that the app still has Mail.Send access (Exchange RBAC role assignment or admin consent).",
    );
  }
  return make("permanent", "ms_bad_request", "Microsoft Graph rejected the message.");
}

/** Rewrites the token cache entry once we know how long the token lives. */
function storeToken(
  cache: GraphTokenCache,
  config: MsGraphConfig,
  accessToken: string,
  expiresInSeconds: number,
  nowMs: number,
): void {
  const usableUntil = nowMs + expiresInSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS;
  if (usableUntil > nowMs) cache.tokens.set(cacheKey(config), { accessToken, usableUntil });
}

export function createMicrosoftGraphEmailProvider(options: GraphAdapterOptions): EmailProvider {
  const resolved = {
    fetchImpl: options.fetchImpl,
    config: options.config,
    timeouts: options.timeouts ?? DEFAULT_GRAPH_TIMEOUTS,
    now: options.now ?? (() => Date.now()),
    requestId: options.requestId ?? (() => crypto.randomUUID()),
  };
  const cache = options.cache ?? MODULE_TOKEN_CACHE;
  const { config } = resolved;
  const sendUrl = `${MS_GRAPH_HOST}/v1.0/users/${encodeURIComponent(config.mailbox)}/sendMail`;

  async function token(forceRefresh: boolean): Promise<TokenOutcome> {
    const nowMs = resolved.now();
    if (forceRefresh) cache.tokens.delete(cacheKey(config));
    const cached = cache.tokens.get(cacheKey(config));
    if (cached) {
      if (cached.usableUntil > nowMs) return { ok: true, accessToken: cached.accessToken };
      cache.tokens.delete(cacheKey(config));
    }
    const key = cacheKey(config);
    const inFlight = cache.pending.get(key);
    if (inFlight) return inFlight;
    const started = requestToken(resolved).then((result) => {
      if (result.ok) {
        storeToken(cache, config, result.accessToken, result.expiresIn, resolved.now());
      }
      return result;
    });
    cache.pending.set(key, started);
    try {
      return await started;
    } finally {
      cache.pending.delete(key);
    }
  }

  async function post(accessToken: string, payload: string, clientRequestId: string) {
    return await fetchWithTimeout(
      resolved.fetchImpl,
      sendUrl,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "client-request-id": clientRequestId,
        },
        body: payload,
      },
      resolved.timeouts.sendMs,
    );
  }

  return {
    id: "microsoft_graph",
    capabilities: MICROSOFT_GRAPH_CAPABILITIES,
    async sendEmail(request: EmailSendRequest): Promise<SendResult> {
      const parsed = zEmailSendRequest.safeParse(request);
      if (!parsed.success) {
        return fail("permanent", 0, "invalid_request", `invalid_request: ${parsed.error.message}`);
      }
      const req = parsed.data;
      const from = parseMailbox(req.from);
      if (!from) {
        return fail(
          "permanent",
          0,
          "invalid_from_address",
          "invalid_from_address: EMAIL_FROM_ADDRESS must be the sending mailbox, like ms@yourdomain.com or Name <ms@yourdomain.com>",
        );
      }
      // The app is scoped to ONE mailbox. Never try to send as another one.
      if (from.address.toLowerCase() !== config.mailbox.toLowerCase()) {
        return fail(
          "permanent",
          0,
          "from_not_sending_mailbox",
          `from_not_sending_mailbox: this provider sends only as ${config.mailbox}`,
        );
      }
      const to = parseMailbox(req.to);
      const replyTo = req.replyTo ? parseMailbox(req.replyTo) : null;
      if (!to || (req.replyTo && !replyTo)) {
        return fail(
          "permanent",
          0,
          "invalid_recipient",
          "invalid_recipient: not a plain ASCII address",
        );
      }

      const useHtml = req.html.trim().length > 0;
      const displayName = from.name ?? config.displayName;
      const clientRequestId = resolved.requestId();
      const payload = JSON.stringify({
        message: {
          subject: req.subject,
          body: { contentType: useHtml ? "HTML" : "Text", content: useHtml ? req.html : req.text },
          toRecipients: [{ emailAddress: { address: to.address } }],
          ...(displayName
            ? { from: { emailAddress: { address: config.mailbox, name: displayName } } }
            : {}),
          ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo.address } }] } : {}),
        },
        saveToSentItems: false,
      });

      let refreshed = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const tokenResult = await token(attempt > 0);
        if (!tokenResult.ok) return tokenResult.result;
        let res: Response;
        try {
          res = await post(tokenResult.accessToken, payload, clientRequestId);
        } catch (err) {
          return isAbort(err)
            ? fail("transient", 0, "ms_timeout", "Microsoft Graph did not answer in time.")
            : fail(
                "transient",
                0,
                "ms_network_error",
                `Could not reach Microsoft Graph: ${redact(String(err), config.clientSecret, tokenResult.accessToken)}`,
              );
        }
        if (res.status === 202) {
          // 202 has no body and no message id; Graph echoes our request id.
          return {
            ok: true,
            providerMessageId: `msgraph:${res.headers.get("request-id") ?? clientRequestId}`,
          };
        }
        if (res.status === 401 && !refreshed) {
          // Token revoked or rotated under us: get a new one and retry ONCE.
          refreshed = true;
          continue;
        }
        return classifyGraphSendFailure(
          res.status,
          await readJson(res),
          res.headers.get("retry-after"),
          resolved.now(),
          config.mailbox,
        );
      }
      // Unreachable (the loop returns on every path); keeps the type total.
      return fail("transient", 0, "ms_unexpected", "Microsoft Graph send did not complete.");
    },
  };
}
