/**
 * Google Calendar REST calls + push-notification verify/normalize
 * (BACKEND_SPEC §7.6, API_AND_FLOWS.md A.6 "Google Calendar (generic
 * calendar adapter, G10)"). Portable — plain `fetch`, mirroring `packages/
 * adapters/google-calendar`'s Node package logic (documented intentional
 * duplication — Deno can't import a pnpm workspace package here).
 *
 * VERIFY (docs/VERIFY.md): `developers.google.com` was egress-blocked in
 * this build; endpoint paths/fields are WebSearch-corroborated, not a
 * first-party fetch. Default watch-channel TTL (604800s / 7 days) needs
 * confirming before relying on the renewal cadence in production.
 */

import { timingSafeEqual } from "../crypto.js";

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
  params: { clientId: string; clientSecret: string; refreshToken: string },
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
  });
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

export async function freeBusyQuery(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  params: { calendarId: string; timeMin: string; timeMax: string },
) {
  return googleCalendarRequest(fetchImpl, accessToken, "POST", "/freeBusy", {
    timeMin: params.timeMin,
    timeMax: params.timeMax,
    items: [{ id: params.calendarId }],
  });
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

export async function registerWatchChannel(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  params: {
    calendarId: string;
    channelId: string;
    webhookUrl: string;
    clientState: string;
    ttlSeconds?: number;
  },
) {
  return googleCalendarRequest(
    fetchImpl,
    accessToken,
    "POST",
    `/calendars/${encodeURIComponent(params.calendarId)}/events/watch`,
    {
      id: params.channelId,
      type: "web_hook",
      address: params.webhookUrl,
      token: params.clientState,
      params: { ttl: String(params.ttlSeconds ?? GOOGLE_CALENDAR_WATCH_DEFAULT_TTL_SECONDS) },
    },
  );
}

// ---------------------------------------------------------------------------
// Push notification verify/normalize — NOT an HMAC-over-body scheme (Google
// sends no diffable payload at all); verification is a shared-secret
// `X-Goog-Channel-Token` echoed back from the `clientState` we registered.
// ---------------------------------------------------------------------------

export interface GoogleCalendarNotificationHeaders {
  channelId: string | null;
  channelToken: string | null;
  resourceId: string | null;
  resourceState: string | null;
}

export function extractGoogleCalendarHeaders(
  headers: Record<string, string | null>,
): GoogleCalendarNotificationHeaders {
  const get = (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null;
  return {
    channelId: get("X-Goog-Channel-ID"),
    channelToken: get("X-Goog-Channel-Token"),
    resourceId: get("X-Goog-Resource-ID"),
    resourceState: get("X-Goog-Resource-State"),
  };
}

export type VerifyGoogleCalendarNotificationResult =
  | { valid: true; headers: GoogleCalendarNotificationHeaders }
  | { valid: false; reason: "missing_secret" | "missing_header" | "mismatch" };

export function verifyGoogleCalendarNotification(params: {
  headers: Record<string, string | null>;
  expectedChannelToken: string | undefined;
}): VerifyGoogleCalendarNotificationResult {
  const parsed = extractGoogleCalendarHeaders(params.headers);
  if (!params.expectedChannelToken) return { valid: false, reason: "missing_secret" };
  if (!parsed.channelToken) return { valid: false, reason: "missing_header" };
  if (!timingSafeEqual(parsed.channelToken, params.expectedChannelToken)) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true, headers: parsed };
}

export interface CanonicalPosWebhookEvent {
  type: "booking_changed" | "order_changed" | "auth_revoked" | "unknown";
  external_id: string | null;
  changes: Record<string, unknown>;
}

export function normalizeGoogleCalendarNotification(
  headers: GoogleCalendarNotificationHeaders,
): CanonicalPosWebhookEvent {
  if (headers.resourceState === "sync") {
    return { type: "unknown", external_id: headers.channelId, changes: {} };
  }
  return {
    type: "booking_changed",
    external_id: headers.resourceId,
    changes: { resourceState: headers.resourceState ?? "" },
  };
}
