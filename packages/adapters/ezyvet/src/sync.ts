/**
 * `pullChanges` for ezyVet — the primary two-way sync mechanism for this
 * adapter (see webhook.ts's docstring on why). Reads appointments modified
 * since the last poll (`GET /appointment?modified_date_from=...`) — VERIFY
 * exact query-parameter name (docs/VERIFY.md).
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  CanonicalAdapterEvent,
  PullChangesParams,
  PullChangesResult,
} from "./adapter-types.js";
import type { EzyVetClient } from "./client.js";

const zAppointmentChange = z.object({
  id: z.union([z.string(), z.number()]),
  active: z.union([z.boolean(), z.number()]).optional(),
});

const zAppointmentListResponse = z.object({
  items: z.array(zAppointmentChange).optional(),
});

export async function pullEzyVetChanges(
  client: EzyVetClient,
  params: PullChangesParams,
): Promise<PullChangesResult> {
  const accessToken = params.connection.accessToken;
  if (!accessToken) {
    throw new VoiceProviderError("ezyvet pullChanges requires connection.accessToken", {
      code: "validation",
      provider: "ezyvet",
      retryable: false,
    });
  }

  const now = new Date();
  const query = new URLSearchParams(params.since ? { modified_date_from: params.since } : {});
  const raw = await client.request<unknown>("GET", `/appointment?${query.toString()}`, accessToken);
  const parsed = zAppointmentListResponse.safeParse(raw);

  const events: CanonicalAdapterEvent[] = (parsed.success ? (parsed.data.items ?? []) : []).map(
    (item) => ({
      type: "booking_changed",
      externalId: String(item.id),
      changes: { active: item.active !== false && item.active !== 0 },
    }),
  );
  return { events, cursor: now.toISOString() };
}
