/**
 * `checkAvailability` for ezyVet. No single documented "search availability"
 * endpoint was found for the shop-schedule read (API_AND_FLOWS.md A.6 flags
 * this endpoint as TBD) — this build reads the resource's existing booked
 * appointments in the window (`GET /appointment`) and inverts them into
 * free slots, the same shape every other adapter here returns. VERIFY
 * (docs/VERIFY.md) exact query-parameter names for the time-range/resource
 * filter before relying on this for a live schedule.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  AdapterConnectionCredentials,
  CanonicalAvailabilitySlot,
  CheckAvailabilityParams,
  CheckAvailabilityResult,
} from "./adapter-types.js";
import type { EzyVetClient } from "./client.js";

const zAppointment = z.object({
  start_time: z.union([z.string(), z.number()]),
  end_time: z.union([z.string(), z.number()]),
});

const zAppointmentListResponse = z.object({
  items: z.array(zAppointment).optional(),
});

function toIso(value: string | number): string {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : value;
}

function invertBooked(
  windowStart: string,
  windowEnd: string,
  booked: { start: string; end: string }[],
): CanonicalAvailabilitySlot[] {
  const sorted = [...booked].sort((a, b) => a.start.localeCompare(b.start));
  const free: CanonicalAvailabilitySlot[] = [];
  let cursor = windowStart;
  for (const range of sorted) {
    if (range.start > cursor) free.push({ startAt: cursor, endAt: range.start });
    if (range.end > cursor) cursor = range.end;
  }
  if (cursor < windowEnd) free.push({ startAt: cursor, endAt: windowEnd });
  return free;
}

export async function checkEzyVetAvailability(
  client: EzyVetClient,
  connection: AdapterConnectionCredentials,
  params: CheckAvailabilityParams,
): Promise<CheckAvailabilityResult> {
  const accessToken = connection.accessToken;
  if (!accessToken) {
    throw new VoiceProviderError("ezyvet checkAvailability requires connection.accessToken", {
      code: "validation",
      provider: "ezyvet",
      retryable: false,
    });
  }
  const query = new URLSearchParams({
    active: "1",
    start_time_from: params.startAt,
    start_time_to: params.endAt,
    ...(params.resourceExternalId ? { physical_resource_id: params.resourceExternalId } : {}),
  });

  const raw = await client.request<unknown>("GET", `/appointment?${query.toString()}`, accessToken);
  const parsed = zAppointmentListResponse.safeParse(raw);
  const booked = (parsed.success ? (parsed.data.items ?? []) : []).map((a) => ({
    start: toIso(a.start_time),
    end: toIso(a.end_time),
  }));

  return {
    slots: invertBooked(params.startAt, params.endAt, booked).map((slot) => ({
      ...slot,
      resourceExternalId: params.resourceExternalId,
    })),
  };
}
