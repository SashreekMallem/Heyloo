/**
 * `syncCatalog` for ezyVet — appointment types (API_AND_FLOWS.md A.6:
 * "resources/appointment types across ~216 documented endpoints"). VERIFY
 * exact endpoint path/field names (docs/VERIFY.md) — `GET /appointmenttype`
 * is the researched-shape hypothesis this build codes against, following
 * ezyVet's documented `noun`-per-resource REST convention.
 */

import { z } from "zod";
import type { CanonicalCatalogItem, SyncCatalogResult } from "./adapter-types.js";
import type { EzyVetClient } from "./client.js";

const zAppointmentType = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().optional(),
  duration: z.number().optional(),
  active: z.union([z.boolean(), z.number()]).optional(),
});

const zAppointmentTypeListResponse = z.object({
  items: z.array(zAppointmentType).optional(),
});

export async function syncEzyVetCatalog(
  client: EzyVetClient,
  accessToken: string,
): Promise<SyncCatalogResult> {
  const raw = await client.request<unknown>("GET", "/appointmenttype", accessToken);
  const parsed = zAppointmentTypeListResponse.safeParse(raw);
  if (!parsed.success) return { items: [] };

  const items: CanonicalCatalogItem[] = (parsed.data.items ?? []).map((entry) => ({
    externalId: String(entry.id),
    name: entry.name ?? `Appointment type ${entry.id}`,
    durationMinutes: entry.duration,
    active: entry.active === undefined || entry.active === true || entry.active === 1,
    raw: entry,
  }));
  return { items };
}
