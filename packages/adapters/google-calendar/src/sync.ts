/**
 * `pullChanges` for Google Calendar — the poll-based two-way sync fallback
 * (G11) this adapter's `handleWebhook` notifications feed into: a verified
 * push notification carries no diff, so both the notification path and a
 * plain scheduled poll converge on the same `events.list?updatedMin=...`
 * call (`GET /calendars/{calendarId}/events`, `showDeleted=true`,
 * `orderBy=updated`) to actually discover what changed since the last run.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  CanonicalAdapterEvent,
  PullChangesParams,
  PullChangesResult,
} from "./adapter-types.js";
import type { GoogleCalendarClient } from "./client.js";

const zEventListItem = z.object({
  id: z.string(),
  status: z.string().optional(),
  updated: z.string().optional(),
});

const zEventListResponse = z.object({
  items: z.array(zEventListItem).optional(),
});

export async function pullGoogleCalendarChanges(
  client: GoogleCalendarClient,
  params: PullChangesParams,
): Promise<PullChangesResult> {
  const accessToken = params.connection.accessToken;
  const calendarId =
    (params.connection.metadata?.["calendarId"] as string | undefined) ?? "primary";
  if (!accessToken) {
    throw new VoiceProviderError("google-calendar pullChanges requires connection.accessToken", {
      code: "validation",
      provider: "google-calendar",
      retryable: false,
    });
  }

  const now = new Date();
  const query = new URLSearchParams({
    showDeleted: "true",
    orderBy: "updated",
    ...(params.since ? { updatedMin: params.since } : {}),
  });

  const raw = await client.request<unknown>(
    "GET",
    `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
    accessToken,
  );
  const parsed = zEventListResponse.safeParse(raw);
  const events: CanonicalAdapterEvent[] = (parsed.success ? (parsed.data.items ?? []) : []).map(
    (item) => ({
      type: "booking_changed",
      externalId: item.id,
      changes: { status: item.status ?? "unknown" },
    }),
  );

  return { events, cursor: now.toISOString() };
}
