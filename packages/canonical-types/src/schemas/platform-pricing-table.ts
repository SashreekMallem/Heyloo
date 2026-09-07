import { z } from "zod";
import { zCents } from "../primitives.js";
import { zVertical } from "../vertical.js";

/** Platform settings → Pricing tables (FRONTEND_SPEC.md §7.5). Writes a NEW `price_version`, never mutates one. */
export const platformPricingTableSchema = z.object({
  vertical: zVertical,
  base_cents: zCents,
  included_minutes: z.number().int().nonnegative(),
  overage_cents: zCents,
  effective_at: z.iso.datetime(),
});

export type PlatformPricingTable = z.infer<typeof platformPricingTableSchema>;
