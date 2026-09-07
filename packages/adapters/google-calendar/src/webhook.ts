/**
 * Two-way sync for Google Calendar — push notification channels
 * (`events.watch`, API_AND_FLOWS.md A.6 item 3/5). Unlike Retell/Square,
 * Google's push notification carries NO event payload at all (confirmed
 * pattern across every Google push-notification resource, matching the
 * Clover/Square "webhook carries no payload, fetch after" salvage note) —
 * only headers identifying the channel and a `resourceState`
 * (`sync`|`exists`|`not_exists`). The real diff is pulled separately via
 * `pullChanges` (events.list). Verification is NOT an HMAC-over-body
 * scheme here — it's a shared-secret `X-Goog-Channel-Token` echoed back
 * from the `token` (`clientState`) we set when registering the channel,
 * compared timing-safe (same fail-closed posture as every other adapter's
 * signature check).
 *
 * VERIFY (docs/VERIFY.md): default channel TTL corroborated by WebSearch
 * against current third-party summaries as 604800s (7 days) with no
 * documented maximum found in this pass — `developers.google.com` itself
 * was egress-blocked; confirm before relying on the renewal cadence below.
 */

import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type { CanonicalAdapterEvent } from "./adapter-types.js";
import type { GoogleCalendarClient } from "./client.js";

export const GOOGLE_CALENDAR_WATCH_DEFAULT_TTL_SECONDS = 604800;

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return nodeTimingSafeEqual(bufA, bufB);
}

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

export interface VerifyGoogleCalendarNotificationParams {
  headers: Record<string, string | null>;
  expectedChannelToken: string | undefined;
}

export type VerifyGoogleCalendarNotificationResult =
  | { valid: true; headers: GoogleCalendarNotificationHeaders }
  | { valid: false; reason: "missing_secret" | "missing_header" | "mismatch" };

export function verifyGoogleCalendarNotification(
  params: VerifyGoogleCalendarNotificationParams,
): VerifyGoogleCalendarNotificationResult {
  const parsed = extractGoogleCalendarHeaders(params.headers);
  if (!params.expectedChannelToken) return { valid: false, reason: "missing_secret" };
  if (!parsed.channelToken) return { valid: false, reason: "missing_header" };
  if (!timingSafeEqualStrings(parsed.channelToken, params.expectedChannelToken)) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true, headers: parsed };
}

/** A verified notification carries no diffable content — normalize it as a
 * generic "something changed, go pull" signal. `sync` (the channel's own
 * confirmation ping on registration) is never a real change. */
export function normalizeGoogleCalendarNotification(
  headers: GoogleCalendarNotificationHeaders,
): CanonicalAdapterEvent {
  if (headers.resourceState === "sync") {
    return { type: "unknown", externalId: headers.channelId, changes: {} };
  }
  return {
    type: "booking_changed",
    externalId: headers.resourceId,
    changes: { resourceState: headers.resourceState ?? "" },
  };
}

const zWatchResponse = z.object({
  resourceId: z.string(),
  expiration: z.string().optional(),
});

export interface RegisterWatchChannelParams {
  calendarId: string;
  channelId: string;
  webhookUrl: string;
  clientState: string;
  ttlSeconds?: number;
}

export interface RegisterWatchChannelResult {
  resourceId: string;
  /** Unix ms timestamp string, per Google's `expiration` field. */
  expiration?: string | undefined;
}

export async function registerGoogleCalendarWatchChannel(
  client: GoogleCalendarClient,
  accessToken: string,
  params: RegisterWatchChannelParams,
): Promise<RegisterWatchChannelResult> {
  if (!accessToken) {
    throw new VoiceProviderError(
      "google-calendar registerWatchChannel requires a non-empty accessToken",
      { code: "auth", provider: "google-calendar", retryable: false },
    );
  }
  const raw = await client.request<unknown>(
    "POST",
    `/calendars/${encodeURIComponent(params.calendarId)}/events/watch`,
    accessToken,
    {
      id: params.channelId,
      type: "web_hook",
      address: params.webhookUrl,
      token: params.clientState,
      params: { ttl: String(params.ttlSeconds ?? GOOGLE_CALENDAR_WATCH_DEFAULT_TTL_SECONDS) },
    },
  );
  return zWatchResponse.parse(raw);
}
