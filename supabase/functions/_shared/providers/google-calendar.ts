/**
 * Google Calendar REST calls + push-notification verify/normalize
 * (BACKEND_SPEC §7.6, API_AND_FLOWS.md A.6 "Google Calendar (generic
 * calendar adapter, G10)"). Portable — plain `fetch`, mirroring `packages/
 * adapters/google-calendar`'s Node package logic (documented intentional
 * duplication — Deno can't import a pnpm workspace package here).
 *
 * VERIFY (docs/VERIFY.md): default watch-channel TTL (604800s / 7 days)
 * needs confirming before relying on the renewal cadence in production
 * (the code reads the granted `expiration` back and renews from that).
 *
 * CAL-1 (Rule 1, fetched 2026-10-11):
 *  - freeBusy: developers.google.com/workspace/calendar/api/v3/reference/
 *    freebusy/query — `POST /freeBusy` with `timeMin`/`timeMax` (RFC3339) and
 *    `items[{id}]`; the response is `calendars.<id>.busy[{start,end}]` (start
 *    inclusive, end exclusive) plus per-calendar `errors[{domain,reason}]`
 *    (`groupTooBig`, `tooManyCalendarsRequested`, `notFound`,
 *    `internalError`, "additional reasons may be added"). The page states no
 *    maximum time range; this module never asks for more than
 *    `GOOGLE_FREEBUSY_MAX_RANGE_DAYS` per request anyway. Accepted scopes:
 *    calendar.freebusy (narrowest), calendar.events.freebusy,
 *    calendar.readonly, calendar.
 *  - Scopes: developers.google.com/workspace/calendar/api/auth —
 *    calendar.freebusy "View your availability in your calendars",
 *    calendar.events "View and edit events on all your calendars".
 *  - Token responses: developers.google.com/identity/protocols/oauth2/
 *    web-server — `access_token`, `expires_in`, `refresh_token` (offline
 *    only), `scope` (space-delimited granted scopes; users may decline
 *    individual scopes), `token_type`; a revoked/expired refresh token is
 *    `invalid_grant`.
 *
 * CAL-1b push notifications (Rule 1, fetched 2026-10-11):
 *  - events.watch: developers.google.com/workspace/calendar/api/v3/reference/
 *    events/watch — `POST /calendars/{calendarId}/events/watch` with
 *    `{id, type: "web_hook", address, token?, params: {ttl}}` (ttl in
 *    seconds as a string, default 604800). Answer: `api#channel`
 *    `{kind, id, resourceId, resourceUri, token?, expiration?}`, expiration
 *    a Unix time in ms ("long", so it may arrive as a JSON string). Accepted
 *    scopes include calendar.events (which Heyloo already asks for).
 *  - channels.stop: .../v3/reference/channels/stop — `POST /channels/stop`
 *    with `{id, resourceId}`; empty body on success. Only the same user from
 *    the same OAuth client can stop a channel that user created.
 *  - Push guide: developers.google.com/workspace/calendar/api/guides/push —
 *    notifications have NO body; headers X-Goog-Channel-ID, -Message-Number
 *    (1 for `sync`), -Resource-ID, -Resource-State (`sync` | `exists` |
 *    `not_exists`), -Resource-URI are always sent, -Channel-Token when set,
 *    -Channel-Expiration when defined. Channel id <= 64 chars and unique per
 *    project; token <= 256 chars; the address must be HTTPS with a valid
 *    certificate; 200/201/202/204/102 count as delivered. Channels are never
 *    renewed automatically: a new channel (new id) is created before the
 *    old one expires, and both may be active for a while. The `sync`
 *    message can arrive before the watch call returns.
 * Every Google body is Zod-validated here; callers only see canonical
 * shapes (busy intervals, granted scopes, a channel, a failure kind).
 */

import { z } from "zod";

export const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_WATCH_DEFAULT_TTL_SECONDS = 604800;

export type GoogleCalendarFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function googleCalendarRequest(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetchImpl(`${GOOGLE_CALENDAR_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsedBody = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body: parsedBody };
}

export async function refreshGoogleToken(
  fetchImpl: GoogleCalendarFetch,
  params: { clientId: string; clientSecret: string; refreshToken: string; signal?: AbortSignal },
) {
  const res = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
    ...(params.signal ? { signal: params.signal } : {}),
  });
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

// ---------------------------------------------------------------------------
// CAL-1: OAuth scopes and token responses (Zod-validated)
// ---------------------------------------------------------------------------

const SCOPE_PREFIX = "https://www.googleapis.com/auth/";

/** What Heyloo asks for: `calendar.events` (the existing booking push adds,
 * moves and deletes Heyloo's own events) and `calendar.freebusy` (busy times
 * only, never event details). Replaces the broad `auth/calendar`. */
export const GOOGLE_CALENDAR_OAUTH_SCOPES = [
  `${SCOPE_PREFIX}calendar.events`,
  `${SCOPE_PREFIX}calendar.freebusy`,
] as const;

/** Any of these lets freeBusy run (the freeBusy reference's scope list). */
const FREEBUSY_CAPABLE_SCOPES = new Set([
  `${SCOPE_PREFIX}calendar.freebusy`,
  `${SCOPE_PREFIX}calendar.events.freebusy`,
  `${SCOPE_PREFIX}calendar.readonly`,
  `${SCOPE_PREFIX}calendar`,
]);
/** Any of these lets the booking push write events. */
const EVENT_WRITE_SCOPES = new Set([`${SCOPE_PREFIX}calendar.events`, `${SCOPE_PREFIX}calendar`]);

export type GoogleCalendarPermission = "busy_times" | "events";

/** Google lets the user untick individual scopes on the consent screen; this
 * names what the granted set (`scope`, space-delimited) is missing. */
export function missingGoogleCalendarPermissions(
  grantedScopes: readonly string[],
): GoogleCalendarPermission[] {
  const granted = new Set(grantedScopes);
  const missing: GoogleCalendarPermission[] = [];
  if (![...FREEBUSY_CAPABLE_SCOPES].some((s) => granted.has(s))) missing.push("busy_times");
  if (![...EVENT_WRITE_SCOPES].some((s) => granted.has(s))) missing.push("events");
  return missing;
}

const zGoogleTokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

const zGoogleTokenError = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

export interface GoogleTokenGrant {
  accessToken: string;
  expiresInSeconds: number;
  /** Present on the first authorization-code exchange (offline access) and,
   * rarely, on a refresh that rotates it. */
  refreshToken?: string;
  /** Space-split `scope`; `null` when Google sent no `scope` field. */
  grantedScopes: string[] | null;
}

/**
 * - `invalid_grant`: the refresh token / code is expired or revoked — the
 *   owner must reconnect.
 * - `client_config`: Google refused OUR client (wrong id/secret/redirect) —
 *   not the tenant's fault; never marks their connection broken.
 * - `transient`: 5xx / 429 / network / timeout — try again later.
 * - `invalid_response`: a 2xx body that does not match the documented shape.
 */
export type GoogleTokenFailure =
  | "invalid_grant"
  | "client_config"
  | "transient"
  | "invalid_response";

export type GoogleTokenOutcome =
  | { ok: true; grant: GoogleTokenGrant }
  | { ok: false; failure: GoogleTokenFailure; status: number | null; detail: string };

function clipDetail(text: string): string {
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** Classifies a raw token-endpoint answer (`refreshGoogleToken`'s shape). */
export function parseGoogleTokenResponse(result: {
  ok: boolean;
  status: number;
  body: unknown;
}): GoogleTokenOutcome {
  if (result.ok) {
    const parsed = zGoogleTokenResponse.safeParse(result.body);
    if (!parsed.success) {
      return {
        ok: false,
        failure: "invalid_response",
        status: result.status,
        detail: "token response did not match the documented shape",
      };
    }
    const scope = parsed.data.scope?.trim();
    return {
      ok: true,
      grant: {
        accessToken: parsed.data.access_token,
        expiresInSeconds: parsed.data.expires_in,
        ...(parsed.data.refresh_token ? { refreshToken: parsed.data.refresh_token } : {}),
        grantedScopes: scope === undefined ? null : scope.split(/\s+/).filter(Boolean),
      },
    };
  }
  const error = zGoogleTokenError.safeParse(result.body);
  const code = error.success ? error.data.error : "unknown_error";
  const detail = clipDetail(`token endpoint ${result.status} ${code}`);
  if (code === "invalid_grant") {
    return { ok: false, failure: "invalid_grant", status: result.status, detail };
  }
  if (result.status >= 500 || result.status === 429) {
    return { ok: false, failure: "transient", status: result.status, detail };
  }
  return { ok: false, failure: "client_config", status: result.status, detail };
}

async function tokenRequest(
  run: () => Promise<{ ok: boolean; status: number; body: unknown }>,
  signal?: AbortSignal,
): Promise<GoogleTokenOutcome> {
  try {
    return parseGoogleTokenResponse(await run());
  } catch (err) {
    return {
      ok: false,
      failure: "transient",
      status: null,
      detail: signal?.aborted ? "token request timed out" : clipDetail(`network: ${String(err)}`),
    };
  }
}

/** `refreshGoogleToken`, classified and Zod-validated. Never throws. */
export function refreshGoogleAccessToken(
  fetchImpl: GoogleCalendarFetch,
  params: { clientId: string; clientSecret: string; refreshToken: string; signal?: AbortSignal },
): Promise<GoogleTokenOutcome> {
  return tokenRequest(() => refreshGoogleToken(fetchImpl, params), params.signal);
}

/** The OAuth callback's authorization-code exchange, classified and
 * Zod-validated. Never throws. `redirectUri` must equal the one sent on the
 * authorization request. */
export function exchangeGoogleAuthCode(
  fetchImpl: GoogleCalendarFetch,
  params: { clientId: string; clientSecret: string; redirectUri: string; code: string },
): Promise<GoogleTokenOutcome> {
  return tokenRequest(async () => {
    const res = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        redirect_uri: params.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    const body = await res.json().catch(() => undefined);
    return { ok: res.ok, status: res.status, body };
  });
}

// ---------------------------------------------------------------------------
// CAL-1: freeBusy (several calendars per request, Zod-validated)
// ---------------------------------------------------------------------------

/** Never ask Google for more than this many days in one request (the
 * reference states no limit; long ranges are chunked by the caller —
 * `chunkTimeRange`). */
export const GOOGLE_FREEBUSY_MAX_RANGE_DAYS = 30;
/** `calendarExpansionMax`'s documented maximum; more items is a caller bug. */
export const GOOGLE_FREEBUSY_MAX_ITEMS = 50;

/** A busy interval as UTC ISO instants, `[start, end)`. */
export interface GoogleBusyInterval {
  start: string;
  end: string;
}

/**
 * - `auth`: 401, or a 403 that is not a usage limit (token revoked or the
 *   scope was taken away) — the owner must reconnect.
 * - `rate_limited`: 429, or 403 `usageLimits` (rateLimitExceeded, ...).
 * - `server`: 5xx. `network`: no answer (timeout, DNS, reset).
 * - `request_rejected`: any other non-2xx (e.g. a 400 for the time range).
 * - `calendar_error`: a 200 whose calendar entry carries `errors[]`, or has
 *   no entry at all — NEVER read as "free".
 * - `invalid_response`: a 200 body that does not match the documented shape.
 */
export type FreeBusyFailure =
  | "auth"
  | "rate_limited"
  | "server"
  | "network"
  | "request_rejected"
  | "calendar_error"
  | "invalid_response";

export type FreeBusyResult =
  | { ok: true; calendars: Record<string, GoogleBusyInterval[]> }
  | { ok: false; failure: FreeBusyFailure; status: number | null; detail: string };

const zFreeBusyResponse = z.object({ calendars: z.record(z.string(), z.unknown()) });
const zFreeBusyCalendar = z.object({
  busy: z.array(z.object({ start: z.string(), end: z.string() })),
  errors: z.array(z.object({ domain: z.string().optional(), reason: z.string() })).optional(),
});
const zGoogleApiError = z.object({
  error: z.object({
    errors: z
      .array(z.object({ domain: z.string().optional(), reason: z.string().optional() }))
      .optional(),
    status: z.string().optional(),
  }),
});

const USAGE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
]);

/** A Calendar API call's failure kind, shared by freeBusy, events.watch and
 * channels.stop (`calendar_error` is freeBusy's own per-calendar case). */
export type GoogleCallFailure = Exclude<FreeBusyFailure, "calendar_error">;

function classifyGoogleHttpFailure(status: number, body: unknown): GoogleCallFailure {
  if (status === 401) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status === 403) {
    const parsed = zGoogleApiError.safeParse(body);
    const reasons = parsed.success ? (parsed.data.error.errors ?? []) : [];
    const usageLimited = reasons.some(
      (r) => r.domain === "usageLimits" || (r.reason ? USAGE_LIMIT_REASONS.has(r.reason) : false),
    );
    return usageLimited ? "rate_limited" : "auth";
  }
  return "request_rejected";
}

function toInstant(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `POST /freeBusy` for one or more calendars over `[timeMin, timeMax)`.
 * Never throws. Any per-calendar `errors[]`, or a requested calendar missing
 * from the answer, fails the WHOLE result (`calendar_error`): an unreadable
 * calendar must never look free.
 *
 * VERIFY (docs/VERIFY.md CAL-1): when the request id is `primary`, the
 * response is expected to be keyed `primary` too; if Google keys a
 * single-calendar answer by the account's email instead, the one returned
 * entry is used.
 */
export async function freeBusyQuery(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  params: { items: readonly string[]; timeMin: string; timeMax: string; signal?: AbortSignal },
): Promise<FreeBusyResult> {
  const items = [...new Set(params.items)];
  if (items.length === 0 || items.length > GOOGLE_FREEBUSY_MAX_ITEMS) {
    return {
      ok: false,
      failure: "request_rejected",
      status: null,
      detail: `freeBusy needs 1-${GOOGLE_FREEBUSY_MAX_ITEMS} calendars, got ${items.length}`,
    };
  }
  let status: number;
  let body: unknown;
  try {
    const res = await fetchImpl(`${GOOGLE_CALENDAR_BASE_URL}/freeBusy`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        items: items.map((id) => ({ id })),
      }),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    status = res.status;
    body = await res.json().catch(() => undefined);
    if (params.signal?.aborted) throw new Error("aborted");
    if (!res.ok) {
      return {
        ok: false,
        failure: classifyGoogleHttpFailure(status, body),
        status,
        detail: clipDetail(`freeBusy ${status}`),
      };
    }
  } catch (err) {
    return {
      ok: false,
      failure: "network",
      status: null,
      detail: params.signal?.aborted ? "freeBusy timed out" : clipDetail(`network: ${String(err)}`),
    };
  }

  const parsed = zFreeBusyResponse.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      failure: "invalid_response",
      status,
      detail: "freeBusy body has no calendars map",
    };
  }
  const returned = parsed.data.calendars;
  const returnedKeys = Object.keys(returned);
  const calendars: Record<string, GoogleBusyInterval[]> = {};
  for (const id of items) {
    const raw =
      returned[id] ??
      (items.length === 1 && returnedKeys.length === 1
        ? returned[returnedKeys[0] as string]
        : undefined);
    if (raw === undefined) {
      return {
        ok: false,
        failure: "calendar_error",
        status,
        detail: clipDetail(`calendar ${id} missing from the freeBusy answer`),
      };
    }
    const entry = zFreeBusyCalendar.safeParse(raw);
    if (!entry.success) {
      return {
        ok: false,
        failure: "invalid_response",
        status,
        detail: clipDetail(`calendar ${id} entry did not match the documented shape`),
      };
    }
    const errors = entry.data.errors ?? [];
    if (errors.length > 0) {
      return {
        ok: false,
        failure: "calendar_error",
        status,
        detail: clipDetail(`calendar ${id}: ${errors.map((e) => e.reason).join(",")}`),
      };
    }
    const intervals: GoogleBusyInterval[] = [];
    for (const busy of entry.data.busy) {
      const start = toInstant(busy.start);
      const end = toInstant(busy.end);
      if (start === null || end === null) {
        return {
          ok: false,
          failure: "invalid_response",
          status,
          detail: clipDetail(`calendar ${id} has an unreadable busy time`),
        };
      }
      if (end <= start) continue; // an empty interval blocks nothing
      intervals.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
    calendars[id] = intervals;
  }
  return { ok: true, calendars };
}

/** Deterministic, Google-legal (`a`-`v`,`0`-`9`) event id derived from an
 * idempotency key — Google's own "already exists" 409 on a retried insert
 * IS this adapter's idempotency guarantee (matches `packages/adapters/
 * google-calendar/src/booking.ts`'s `toGoogleEventId`). */
export function toGoogleEventId(idempotencyKey: string): string {
  const hashHex = Array.from(idempotencyKey)
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(8, "0");
  const mapped = hashHex.replace(
    /[0-9a-f]/g,
    (c) => "0123456789abcdefghijklmnopqrstuv"[parseInt(c, 16)] ?? "a",
  );
  return `gcal${mapped}`;
}

export async function insertCalendarEvent(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  params: {
    calendarId: string;
    idempotencyKey: string;
    summary: string;
    description: string;
    startAt: string;
    endAt: string;
  },
) {
  return googleCalendarRequest(
    fetchImpl,
    accessToken,
    "POST",
    `/calendars/${encodeURIComponent(params.calendarId)}/events`,
    {
      id: toGoogleEventId(params.idempotencyKey),
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startAt },
      end: { dateTime: params.endAt },
    },
  );
}

export async function getCalendarEvent(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  calendarId: string,
  eventId: string,
) {
  return googleCalendarRequest(
    fetchImpl,
    accessToken,
    "GET",
    `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
  );
}

export async function listCalendarEvents(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  calendarId: string,
  updatedMin?: string,
) {
  const query = new URLSearchParams({
    showDeleted: "true",
    orderBy: "updated",
    ...(updatedMin ? { updatedMin } : {}),
  });
  return googleCalendarRequest(
    fetchImpl,
    accessToken,
    "GET",
    `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
  );
}

// ---------------------------------------------------------------------------
// CAL-1b: push notifications — events.watch, channels.stop, the headers
// ---------------------------------------------------------------------------

/** The push guide's documented limits. */
export const GOOGLE_CHANNEL_ID_MAX_LENGTH = 64;
export const GOOGLE_CHANNEL_TOKEN_MAX_LENGTH = 256;

export type GoogleCallResult<T> =
  | ({ ok: true } & T)
  | { ok: false; failure: GoogleCallFailure; status: number | null; detail: string };

export interface GoogleWatchChannel {
  channelId: string;
  /** Opaque id of the watched resource; needed to stop the channel and
   * echoed as `X-Goog-Resource-ID` on every notification. */
  resourceId: string;
  /** When Google expires the channel (UTC ISO), or null when the answer did
   * not say (the caller then assumes the requested ttl). */
  expiresAt: string | null;
}

const zWatchResponse = z.object({
  kind: z.string().optional(),
  id: z.string().min(1),
  resourceId: z.string().min(1),
  resourceUri: z.string().optional(),
  token: z.string().optional(),
  expiration: z.union([z.string().regex(/^\d{1,16}$/), z.number().int().nonnegative()]).optional(),
});

async function googleCall(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  path: string,
  body: unknown,
  label: string,
  signal: AbortSignal | undefined,
): Promise<
  | { ok: true; status: number; body: unknown }
  | { ok: false; failure: GoogleCallFailure; status: number | null; detail: string }
> {
  try {
    const res = await fetchImpl(`${GOOGLE_CALENDAR_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    const parsed = await res.json().catch(() => undefined);
    if (signal?.aborted) throw new Error("aborted");
    if (!res.ok) {
      return {
        ok: false,
        failure: classifyGoogleHttpFailure(res.status, parsed),
        status: res.status,
        detail: clipDetail(`${label} ${res.status}`),
      };
    }
    return { ok: true, status: res.status, body: parsed };
  } catch (err) {
    return {
      ok: false,
      failure: "network",
      status: null,
      detail: signal?.aborted ? `${label} timed out` : clipDetail(`network: ${String(err)}`),
    };
  }
}

/**
 * `POST /calendars/{calendarId}/events/watch`: asks Google to POST a
 * notification to `address` whenever an event of that calendar changes.
 * `token` is echoed back as `X-Goog-Channel-Token` (the caller stores only
 * its hash). Never throws; the answer is Zod-validated and must name the
 * channel we asked for.
 */
export async function watchCalendarEvents(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  params: {
    calendarId: string;
    channelId: string;
    address: string;
    token: string;
    ttlSeconds?: number;
    signal?: AbortSignal;
  },
): Promise<GoogleCallResult<{ channel: GoogleWatchChannel }>> {
  if (
    params.channelId.length < 1 ||
    params.channelId.length > GOOGLE_CHANNEL_ID_MAX_LENGTH ||
    params.token.length < 1 ||
    params.token.length > GOOGLE_CHANNEL_TOKEN_MAX_LENGTH ||
    !params.address.startsWith("https://")
  ) {
    return {
      ok: false,
      failure: "request_rejected",
      status: null,
      detail: "watch channel id, token or address outside the documented limits",
    };
  }
  const answer = await googleCall(
    fetchImpl,
    accessToken,
    `/calendars/${encodeURIComponent(params.calendarId)}/events/watch`,
    {
      id: params.channelId,
      type: "web_hook",
      address: params.address,
      token: params.token,
      params: { ttl: String(params.ttlSeconds ?? GOOGLE_CALENDAR_WATCH_DEFAULT_TTL_SECONDS) },
    },
    "events.watch",
    params.signal,
  );
  if (!answer.ok) return answer;
  const parsed = zWatchResponse.safeParse(answer.body);
  if (!parsed.success || parsed.data.id !== params.channelId) {
    return {
      ok: false,
      failure: "invalid_response",
      status: answer.status,
      detail: "events.watch answer did not match the documented channel shape",
    };
  }
  const expirationMs = parsed.data.expiration === undefined ? null : Number(parsed.data.expiration);
  return {
    ok: true,
    channel: {
      channelId: parsed.data.id,
      resourceId: parsed.data.resourceId,
      expiresAt:
        expirationMs !== null && Number.isFinite(expirationMs) && expirationMs > 0
          ? new Date(expirationMs).toISOString()
          : null,
    },
  };
}

/**
 * `POST /channels/stop`. A 404 means the channel is already gone (expired
 * or stopped before) and counts as stopped. Never throws.
 */
export async function stopWatchChannel(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  params: { channelId: string; resourceId: string; signal?: AbortSignal },
): Promise<GoogleCallResult<{ alreadyGone: boolean }>> {
  const answer = await googleCall(
    fetchImpl,
    accessToken,
    "/channels/stop",
    { id: params.channelId, resourceId: params.resourceId },
    "channels.stop",
    params.signal,
  );
  if (answer.ok) return { ok: true, alreadyGone: false };
  if (answer.status === 404) return { ok: true, alreadyGone: true };
  return answer;
}

/** A push notification as read from its headers (it has no body). */
export interface GoogleCalendarNotification {
  channelId: string;
  /** `X-Goog-Channel-Token`, or null when the request carried none. */
  channelToken: string | null;
  resourceId: string;
  /** `sync` = the channel was just created (no change); anything else
   * (`exists`, `not_exists`, or a state added later) = something changed. */
  resourceState: string;
  /** `X-Goog-Message-Number`, digits only; unique per channel. */
  messageNumber: string;
}

const zNotificationHeaders = z.object({
  channelId: z.string().min(1).max(GOOGLE_CHANNEL_ID_MAX_LENGTH),
  channelToken: z.string().min(1).max(GOOGLE_CHANNEL_TOKEN_MAX_LENGTH).nullable(),
  resourceId: z.string().min(1).max(1024),
  resourceState: z.string().min(1).max(64),
  messageNumber: z.string().regex(/^\d{1,20}$/),
});

/**
 * Reads and validates a notification's headers (`get` = a case-insensitive
 * header lookup such as `Headers#get`). `invalid` when a header the push
 * guide says is always sent is missing or malformed. Verifying the channel
 * token and resource id against the stored channel is the caller's job.
 */
export function parseGoogleCalendarNotification(
  get: (name: string) => string | null,
): { ok: true; notification: GoogleCalendarNotification } | { ok: false; reason: "invalid" } {
  const parsed = zNotificationHeaders.safeParse({
    channelId: get("x-goog-channel-id"),
    channelToken: get("x-goog-channel-token"),
    resourceId: get("x-goog-resource-id"),
    resourceState: get("x-goog-resource-state"),
    messageNumber: get("x-goog-message-number"),
  });
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return { ok: true, notification: parsed.data };
}
