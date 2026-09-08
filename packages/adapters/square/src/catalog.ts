/**
 * `syncCatalog` for Square — `POST /v2/catalog/search` (SYSTEM_DESIGN §14
 * salvage note: "catalog via POST /v2/catalog/search; price at
 * `variations[0].item_variation_data.price_money.amount`"). Paginates via
 * `cursor` until exhausted; only `ITEM` objects are mapped (Square's catalog
 * also holds `CATEGORY`/`MODIFIER_LIST`/etc. objects, out of scope here).
 *
 * VERIFY (docs/VERIFY.md): the endpoint path and price-field path above were
 * confirmed against the official `square` npm SDK's own generated types
 * (`SearchCatalogObjectsRequest`/`CatalogObjectItem`) — but that same source
 * also revealed this build's original `params.locationIds` handling was
 * WRONG: `POST /v2/catalog/search` has no location-filter request field at
 * all (`enabled_location_ids` belongs only to the DIFFERENT, simpler
 * `POST /v2/catalog/search-catalog-items` endpoint this adapter doesn't
 * call) — so the `enabled_location_ids` body param this build sent used to
 * be silently ignored by Square, meaning `locationIds` never actually
 * filtered anything. Fixed by post-filtering the returned objects using the
 * `present_at_all_locations`/`present_at_location_ids`/
 * `absent_at_location_ids` fields every `CatalogObjectBase` DOES carry
 * (also confirmed against the SDK's own types) — the standard way Square's
 * catalog models per-location item visibility.
 */

import { z } from "zod";
import type { CanonicalCatalogItem, SyncCatalogResult } from "./adapter-types.js";
import type { SquareClient } from "./client.js";

const zMoney = z.object({ amount: z.number().int(), currency: z.string().optional() });

const zCatalogVariation = z.object({
  id: z.string(),
  item_variation_data: z
    .object({
      name: z.string().optional(),
      price_money: zMoney.optional(),
    })
    .optional(),
});

const zCatalogItemObject = z.object({
  type: z.string(),
  id: z.string(),
  is_deleted: z.boolean().optional(),
  present_at_all_locations: z.boolean().optional(),
  present_at_location_ids: z.array(z.string()).optional(),
  absent_at_location_ids: z.array(z.string()).optional(),
  item_data: z
    .object({
      name: z.string().optional(),
      category_id: z.string().optional(),
      variations: z.array(zCatalogVariation).optional(),
    })
    .optional(),
});

/** Mirrors Square's own per-location visibility semantics for a catalog
 * object: present everywhere unless explicitly absent, OR present only at
 * an explicit allow-list. */
function isPresentAtAnyLocation(
  obj: z.infer<typeof zCatalogItemObject>,
  locationIds: string[],
): boolean {
  if (obj.absent_at_location_ids?.some((id) => locationIds.includes(id))) {
    return obj.present_at_location_ids?.some((id) => locationIds.includes(id)) ?? false;
  }
  if (obj.present_at_all_locations) return true;
  if (obj.present_at_location_ids) {
    return obj.present_at_location_ids.some((id) => locationIds.includes(id));
  }
  // Neither flag set defensively defaults to "present everywhere" (Square's
  // own documented default for `present_at_all_locations`).
  return true;
}

const zCatalogSearchResponse = z.object({
  objects: z.array(zCatalogItemObject).optional(),
  cursor: z.string().optional(),
});

export interface SyncCatalogParams {
  locationIds?: string[] | undefined;
}

export async function syncSquareCatalog(
  client: SquareClient,
  accessToken: string,
  params: SyncCatalogParams = {},
): Promise<SyncCatalogResult> {
  const items: CanonicalCatalogItem[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      object_types: ["ITEM"],
      include_deleted_objects: false,
      ...(cursor ? { cursor } : {}),
    };
    const raw = await client.request<unknown>("POST", "/v2/catalog/search", accessToken, body);
    const parsed = zCatalogSearchResponse.safeParse(raw);
    if (!parsed.success) break;

    for (const obj of parsed.data.objects ?? []) {
      if (obj.type !== "ITEM" || obj.is_deleted) continue;
      if (params.locationIds && !isPresentAtAnyLocation(obj, params.locationIds)) continue;
      const variation = obj.item_data?.variations?.[0];
      items.push({
        externalId: obj.id,
        name: obj.item_data?.name ?? variation?.item_variation_data?.name ?? "Unnamed item",
        category: obj.item_data?.category_id,
        priceCents: variation?.item_variation_data?.price_money?.amount,
        active: true,
        raw: obj,
      });
    }
    cursor = parsed.data.cursor;
  } while (cursor);

  return { items };
}
