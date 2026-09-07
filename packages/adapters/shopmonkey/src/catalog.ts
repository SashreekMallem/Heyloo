/**
 * `syncCatalog` for Shopmonkey — service/labor-rate categories
 * (API_AND_FLOWS.md A.6: "pull service categories/labor rates if exposed
 * (2.0 endpoint TBD, VERIFY against the 2.0 quickstart)"). `GET
 * /laborrate` is this build's researched-shape hypothesis — VERIFY exact
 * path/fields (docs/VERIFY.md).
 */

import { z } from "zod";
import type { CanonicalCatalogItem, SyncCatalogResult } from "./adapter-types.js";
import type { ShopmonkeyClient } from "./client.js";

const zLaborRate = z.object({
  id: z.string(),
  name: z.string().optional(),
  amount: z.number().optional(),
  deleted: z.boolean().optional(),
});

const zLaborRateListResponse = z.object({
  data: z.array(zLaborRate).optional(),
});

export async function syncShopmonkeyCatalog(
  client: ShopmonkeyClient,
  apiKey: string,
): Promise<SyncCatalogResult> {
  const raw = await client.request<unknown>("GET", "/laborrate", apiKey);
  const parsed = zLaborRateListResponse.safeParse(raw);
  if (!parsed.success) return { items: [] };

  const items: CanonicalCatalogItem[] = (parsed.data.data ?? [])
    .filter((rate) => !rate.deleted)
    .map((rate) => ({
      externalId: rate.id,
      name: rate.name ?? `Labor rate ${rate.id}`,
      priceCents: rate.amount,
      active: true,
      raw: rate,
    }));
  return { items };
}
