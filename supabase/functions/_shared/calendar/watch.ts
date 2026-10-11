import { randomOpaqueToken, sha256Hex, timingSafeEqual } from "../crypto.ts";
import {
  type GoogleCalendarFetch,
  type GoogleCallFailure,
  stopWatchChannel,
} from "../providers/google-calendar.ts";
import type { Logger } from "../types.ts";

/**
 * CAL-1b: the Google push-notification channel of a calendar connection.
 * Google is told to POST to webhooks-pos whenever the connection's calendar
 * changes; the per-channel token it echoes back is random, and only its
 * SHA-256 hex (`adapter_connections.watch_token_hash`) is ever stored.
 *
 * Shared by the worker-tick sync leg (register, renew, stop the old channel),
 * webhooks-pos (verify a notification) and api-adapter-connect (stop on the
 * owner's disconnect).
 */

/** Requested channel lifetime: Google's documented default (7 days). */
export const CALENDAR_WATCH_TTL_SECONDS = 604_800;
/** A channel is replaced once it expires within this window (so ~6 days
 * after it was created). */
export const CALENDAR_WATCH_RENEW_BEFORE_HOURS = 24;
/** No new registration for this long after a successful one
 * (`watch_retry_at`), so an unexpectedly short lifetime from Google can never
 * turn into a watch call every minute. (A failed one backs off 1, 5, 15, 60
 * minutes, then hourly.) */
export const CALENDAR_WATCH_RENEW_MIN_INTERVAL_MINUTES = 60;
/** Per Google call made outside the sync leg (owner disconnect). */
export const CALENDAR_WATCH_STOP_TIMEOUT_MS = 4_000;

export interface NewWatchChannel {
  /** Sent as the channel `id` (a UUID: 36 chars, inside Google's 64). */
  channelId: string;
  /** Sent as the channel `token`; never stored. */
  token: string;
  /** What is stored and compared. */
  tokenHash: string;
}

export async function newWatchChannel(): Promise<NewWatchChannel> {
  const token = randomOpaqueToken(32);
  return { channelId: crypto.randomUUID(), token, tokenHash: await sha256Hex(token) };
}

/** True only when `presented` hashes to `storedHash` (timing-safe). A missing
 * token or a missing stored hash never matches (fail closed). */
export async function channelTokenMatches(
  presented: string | null,
  storedHash: string | null,
): Promise<boolean> {
  if (!presented || !storedHash) return false;
  return timingSafeEqual(await sha256Hex(presented), storedHash);
}

/**
 * Where Google delivers notifications: this project's webhooks-pos function
 * (`<SUPABASE_URL>/functions/v1/webhooks-pos/google_calendar`, the same
 * base the other functions call each other on). Google only delivers to
 * HTTPS, so anything else (local dev's http://kong:8000) returns null and
 * no channel is registered.
 */
export function googleCalendarWebhookAddress(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return `${url.origin}/functions/v1/webhooks-pos/google_calendar`;
}

export interface WatchChannelRef {
  channelId: string;
  resourceId: string;
}

export type StopChannelOutcome = "stopped" | "already_gone" | GoogleCallFailure;

/** `channels.stop`, best effort: never throws, logs a failure (the channel
 * then simply runs out on its own, and its notifications are refused as an
 * unknown channel). */
export async function stopChannelBestEffort(
  fetchImpl: GoogleCalendarFetch,
  accessToken: string,
  channel: WatchChannelRef,
  logger: Logger,
  context: Record<string, unknown>,
  timeoutMs = CALENDAR_WATCH_STOP_TIMEOUT_MS,
): Promise<StopChannelOutcome> {
  try {
    const result = await stopWatchChannel(fetchImpl, accessToken, {
      channelId: channel.channelId,
      resourceId: channel.resourceId,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (result.ok) return result.alreadyGone ? "already_gone" : "stopped";
    logger.warn("calendar_watch_stop_failed", {
      ...context,
      channel_id: channel.channelId,
      failure: result.failure,
      detail: result.detail,
    });
    return result.failure;
  } catch (err) {
    logger.warn("calendar_watch_stop_failed", {
      ...context,
      channel_id: channel.channelId,
      failure: "network",
      detail: err instanceof Error ? err.message : String(err),
    });
    return "network";
  }
}
