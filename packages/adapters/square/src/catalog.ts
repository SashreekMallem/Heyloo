/**
 * `syncCatalog` for Square — `POST /v2/catalog/search` (SYSTEM_DESIGN §14
 * salvage note: "catalog via POST /v2/catalog/search; price at
 * `variations[0].item_variation_data.price_money.amount`"). Paginates via
 * `cursor` until exhausted; only `ITEM` objects are mapped (Square's catalog
 * also holds `CATEGORY`/`MODIFIER_LIST`/etc. objects, out of scope here).
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
  item_data: z
    .object({
      name: z.string().optional(),
      category_id: z.string().optional(),
      variations: z.array(zCatalogVariation).optional(),
    })
    .optional(),
});

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
      ...(params.locationIds ? { enabled_location_ids: params.locationIds } : {}),
    };
    const raw = await client.request<unknown>("POST", "/v2/catalog/search", accessToken, body);
    const parsed = zCatalogSearchResponse.safeParse(raw);
    if (!parsed.success) break;

    for (const obj of parsed.data.objects ?? []) {
      if (obj.type !== "ITEM" || obj.is_deleted) continue;
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
