/**
 * `pushBooking` for Google Calendar — `events.insert`
 * (`POST /calendars/{calendarId}/events`), `events.patch`/`events.update`
 * for reschedule/cancel (API_AND_FLOWS.md A.6). There is no native "order"
 * concept for a calendar, so `pushOrder` is intentionally unimplemented —
 * `IntegrationAdapter.pushOrder` is optional for exactly this reason.
 *
 * Idempotency: Google's Events API accepts a client-supplied `id` on
 * insert (must match `^[a-v0-9]{5,1024}$` — Google's own base32hex-like
 * event-id charset restriction, VERIFY exact regex against current docs).
 * We derive a Google-legal event id from the booking idempotency key so a
 * retried push (Retell tool-call retry, worker redelivery) hits Google's
 * OWN "already exists" 409 rather than creating a duplicate event — that
 * 409 is treated as `deduped: true` and the existing event is fetched.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  AdapterConnectionCredentials,
  PushBookingParams,
  PushBookingResult,
} from "./adapter-types.js";
import type { GoogleCalendarClient } from "./client.js";

const zEventResponse = z.object({ id: z.string(), status: z.string().optional() });

/** Google event ids must be lowercase base32hex-ish (`a`-`v`, `0`-`9`),
 * 5-1024 chars. Map our idempotency key (arbitrary text, e.g.
 * `call_id:slot_start_iso`) into that charset deterministically. */
export function toGoogleEventId(idempotencyKey: string): string {
  const hashHex = Array.from(idempotencyKey)
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(8, "0");
  const mapped = hashHex.replace(
    /[0-9a-f]/g,
    (c) => "0123456789abcdefghijklmnopqrstuv"[parseInt(c, 16)] ?? "a",
  );
  // "gcal" prefix (all chars within Google's a-v0-9 charset) disambiguates
  // this adapter's synthetic ids from any human-created event id.
  return `gcal${mapped}`;
}

export async function pushGoogleCalendarBooking(
  client: GoogleCalendarClient,
  connection: AdapterConnectionCredentials,
  params: PushBookingParams,
): Promise<PushBookingResult> {
  const accessToken = connection.accessToken;
  const calendarId = (connection.metadata?.["calendarId"] as string | undefined) ?? "primary";
  if (!accessToken) {
    throw new VoiceProviderError("google-calendar pushBooking requires connection.accessToken", {
      code: "validation",
      provider: "google-calendar",
      retryable: false,
    });
  }

  const eventId = toGoogleEventId(params.idempotencyKey);
  const body = {
    id: eventId,
    summary: `${params.customerName} — ${params.notes ?? "Booking"}`,
    description: `Phone: ${params.customerPhoneE164}${params.customerEmail ? `\nEmail: ${params.customerEmail}` : ""}${params.notes ? `\nNotes: ${params.notes}` : ""}`,
    start: { dateTime: params.startAt },
    end: { dateTime: params.endAt },
  };

  try {
    const raw = await client.request<unknown>(
      "POST",
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      accessToken,
      body,
    );
    const parsed = zEventResponse.parse(raw);
    return { externalId: parsed.id, status: "confirmed", deduped: false, raw: parsed };
  } catch (cause) {
    if (cause instanceof VoiceProviderError && cause.httpStatus === 409) {
      // Deterministic event id already exists — this IS our idempotency
      // guarantee (a retried push, never a real double-booking, since the
      // id is derived from call_id+slot).
      const raw = await client.request<unknown>(
        "GET",
        `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
        accessToken,
      );
      const parsed = zEventResponse.parse(raw);
      return { externalId: parsed.id, status: "confirmed", deduped: true, raw: parsed };
    }
    throw cause;
  }
}

export async function cancelGoogleCalendarBooking(
  client: GoogleCalendarClient,
  connection: AdapterConnectionCredentials,
  idempotencyKey: string,
): Promise<void> {
  const accessToken = connection.accessToken;
  const calendarId = (connection.metadata?.["calendarId"] as string | undefined) ?? "primary";
  if (!accessToken) {
    throw new VoiceProviderError("google-calendar cancelBooking requires connection.accessToken", {
      code: "validation",
      provider: "google-calendar",
      retryable: false,
    });
  }
  const eventId = toGoogleEventId(idempotencyKey);
  await client.request(
    "PATCH",
    `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    accessToken,
    { status: "cancelled" },
  );
}
