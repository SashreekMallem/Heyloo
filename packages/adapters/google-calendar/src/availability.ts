/**
 * `checkAvailability` for Google Calendar — `POST /freeBusy` (more
 * efficient than reading raw events for scheduling purposes, per
 * API_AND_FLOWS.md A.6). A "slot" here is a canonical FREE window: this
 * function returns the BUSY ranges Google reports, inverted against the
 * requested window, so callers see the same "available slots" shape every
 * other adapter returns.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  AdapterConnectionCredentials,
  CanonicalAvailabilitySlot,
  CheckAvailabilityParams,
  CheckAvailabilityResult,
} from "./adapter-types.js";
import type { GoogleCalendarClient } from "./client.js";

const zFreeBusyResponse = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z.array(z.object({ start: z.string(), end: z.string() })).optional(),
      errors: z.array(z.unknown()).optional(),
    }),
  ),
});

function invertBusyRanges(
  windowStart: string,
  windowEnd: string,
  busy: { start: string; end: string }[],
): CanonicalAvailabilitySlot[] {
  const sorted = [...busy].sort((a, b) => a.start.localeCompare(b.start));
  const free: CanonicalAvailabilitySlot[] = [];
  let cursor = windowStart;

  for (const range of sorted) {
    if (range.start > cursor) {
      free.push({ startAt: cursor, endAt: range.start });
    }
    if (range.end > cursor) cursor = range.end;
  }
  if (cursor < windowEnd) {
    free.push({ startAt: cursor, endAt: windowEnd });
  }
  return free;
}

export async function checkGoogleCalendarAvailability(
  client: GoogleCalendarClient,
  connection: AdapterConnectionCredentials,
  params: CheckAvailabilityParams,
): Promise<CheckAvailabilityResult> {
  const accessToken = connection.accessToken;
  const calendarId = params.resourceExternalId ?? connection.metadata?.["calendarId"] ?? "primary";
  if (!accessToken) {
    throw new VoiceProviderError(
      "google-calendar checkAvailability requires connection.accessToken",
      {
        code: "validation",
        provider: "google-calendar",
        retryable: false,
      },
    );
  }

  const raw = await client.request<unknown>("POST", "/freeBusy", accessToken, {
    timeMin: params.startAt,
    timeMax: params.endAt,
    items: [{ id: calendarId }],
  });
  const parsed = zFreeBusyResponse.safeParse(raw);
  if (!parsed.success) return { slots: [] };

  const entry = parsed.data.calendars[String(calendarId)];
  const busy = entry?.busy ?? [];
  return {
    slots: invertBusyRanges(params.startAt, params.endAt, busy).map((slot) => ({
      ...slot,
      resourceExternalId: String(calendarId),
    })),
  };
}
