/**
 * `pullChanges` for Shopmonkey — the poll-back fallback BACKEND_SPEC §7.6
 * names for this adapter when no cancellation webhook is confirmed to
 * exist. `GET /appointment?updatedAfter=...` is this build's
 * researched-shape hypothesis — VERIFY (docs/VERIFY.md).
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  CanonicalAdapterEvent,
  PullChangesParams,
  PullChangesResult,
} from "./adapter-types.js";
import type { ShopmonkeyClient } from "./client.js";

const zAppointmentChange = z.object({ id: z.string(), status: z.string().optional() });
const zAppointmentListResponse = z.object({ data: z.array(zAppointmentChange).optional() });

export async function pullShopmonkeyChanges(
  client: ShopmonkeyClient,
  params: PullChangesParams,
): Promise<PullChangesResult> {
  const apiKey = params.connection.accessToken;
  if (!apiKey) {
    throw new VoiceProviderError("shopmonkey pullChanges requires connection.accessToken", {
      code: "validation",
      provider: "shopmonkey",
      retryable: false,
    });
  }
  const now = new Date();
  const query = new URLSearchParams(params.since ? { updatedAfter: params.since } : {});
  const raw = await client.request<unknown>("GET", `/appointment?${query.toString()}`, apiKey);
  const parsed = zAppointmentListResponse.safeParse(raw);

  const events: CanonicalAdapterEvent[] = (parsed.success ? (parsed.data.data ?? []) : []).map(
    (item) => ({
      type: "booking_changed",
      externalId: item.id,
      changes: { status: item.status ?? "unknown" },
    }),
  );
  return { events, cursor: now.toISOString() };
}
