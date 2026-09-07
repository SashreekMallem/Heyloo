/**
 * `checkAvailability` for Square Bookings — `POST
 * /v2/bookings/availability/search` (API_AND_FLOWS.md A.6). Requires a
 * `location_id` (from the connection's stored metadata, set at connect
 * time) and a start/end range; optionally scoped to one service variation.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  AdapterConnectionCredentials,
  CanonicalAvailabilitySlot,
  CheckAvailabilityParams,
  CheckAvailabilityResult,
} from "./adapter-types.js";
import type { SquareClient } from "./client.js";

const zAvailability = z.object({
  start_at: z.string(),
  location_id: z.string().optional(),
  appointment_segments: z.array(z.object({ team_member_id: z.string().optional() })).optional(),
});

const zAvailabilitySearchResponse = z.object({
  availabilities: z.array(zAvailability).optional(),
});

export async function checkSquareAvailability(
  client: SquareClient,
  connection: AdapterConnectionCredentials,
  params: CheckAvailabilityParams,
): Promise<CheckAvailabilityResult> {
  const accessToken = connection.accessToken;
  const locationId = connection.metadata?.["locationId"];
  if (!accessToken || typeof locationId !== "string") {
    throw new VoiceProviderError(
      "square checkAvailability requires connection.accessToken and metadata.locationId",
      { code: "validation", provider: "square", retryable: false },
    );
  }

  const body: Record<string, unknown> = {
    query: {
      filter: {
        start_at_range: { start_at: params.startAt, end_at: params.endAt },
        location_id: locationId,
        ...(params.resourceExternalId
          ? { segment_filters: [{ service_variation_id: params.resourceExternalId }] }
          : {}),
      },
    },
  };

  const raw = await client.request<unknown>(
    "POST",
    "/v2/bookings/availability/search",
    accessToken,
    body,
  );
  const parsed = zAvailabilitySearchResponse.safeParse(raw);
  if (!parsed.success) return { slots: [] };

  const slots: CanonicalAvailabilitySlot[] = (parsed.data.availabilities ?? []).map((a) => ({
    startAt: a.start_at,
    endAt: a.start_at,
    resourceExternalId: a.appointment_segments?.[0]?.team_member_id,
  }));
  return { slots };
}
