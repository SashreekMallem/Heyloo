import { z } from "zod";
import { zCents } from "../primitives.js";
import { zVertical } from "../vertical.js";

/** Platform settings → Pricing tables (FRONTEND_SPEC.md §7.5). Writes a NEW `price_version`, never mutates one.
 *
 * `included_text_conversations`/`text_conversation_overage_cents` are the
 * text-agent (SMS + web_chat) metering unit set alongside voice minutes on
 * the same `price_card_<vertical>` row (`20260911110000_channels_pricing_
 * and_usage.sql`, `seed.sql`) — required here (not optional) so an admin
 * save always carries an explicit value for both and the write handler
 * never has to guess a default on the admin's behalf. */
export const platformPricingTableSchema = z.object({
  vertical: zVertical,
  base_cents: zCents,
  included_minutes: z.number().int().nonnegative(),
  overage_cents: zCents,
  included_text_conversations: z.number().int().nonnegative(),
  text_conversation_overage_cents: zCents,
  effective_at: z.iso.datetime(),
});

export type PlatformPricingTable = z.infer<typeof platformPricingTableSchema>;
