/**
 * `syncCatalog` for Google Calendar. A generic calendar has no
 * services/menu/labor-rate catalog — the closest analogue is the set of
 * calendars the connected account has write access to (each one models a
 * `resources.type = 'staff'|'room'` in Heyloo terms, e.g. one calendar per
 * stylist/room). `calendarList.list` (`GET /users/me/calendarList`) is the
 * cheapest read for that.
 */

import { z } from "zod";
import type { CanonicalCatalogItem, SyncCatalogResult } from "./adapter-types.js";
import type { GoogleCalendarClient } from "./client.js";

const zCalendarListEntry = z.object({
  id: z.string(),
  summary: z.string().optional(),
  primary: z.boolean().optional(),
  accessRole: z.string().optional(),
});

const zCalendarListResponse = z.object({
  items: z.array(zCalendarListEntry).optional(),
  nextPageToken: z.string().optional(),
});

export async function syncGoogleCalendarCatalog(
  client: GoogleCalendarClient,
  accessToken: string,
): Promise<SyncCatalogResult> {
  const items: CanonicalCatalogItem[] = [];
  let pageToken: string | undefined;

  do {
    const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : "";
    const raw = await client.request<unknown>("GET", `/users/me/calendarList${query}`, accessToken);
    const parsed = zCalendarListResponse.safeParse(raw);
    if (!parsed.success) break;

    for (const entry of parsed.data.items ?? []) {
      // Only calendars this connection can actually write bookings to are
      // useful as a "resource" — a read-only subscribed calendar isn't.
      if (entry.accessRole !== "owner" && entry.accessRole !== "writer") continue;
      items.push({
        externalId: entry.id,
        name: entry.summary ?? entry.id,
        active: true,
        raw: entry,
      });
    }
    pageToken = parsed.data.nextPageToken;
  } while (pageToken);

  return { items };
}
