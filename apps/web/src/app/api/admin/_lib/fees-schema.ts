import { z } from "zod";

/**
 * Setup fee / white-glove onboarding fee, admin-editable per vertical
 * (Cluster H task brief item 5 — new product surface, no prior spec;
 * logged in docs/BUILD_NOTES.md). Stored the same way the pre-existing
 * `price_card_<vertical>` key is (`platform_settings`, admin-only RLS) —
 * a `fees_<vertical>` key holding this shape. Money in integer cents per
 * CLAUDE.md Rule 2; both fee amounts are optional and the corresponding
 * `*_enabled` flag gates whether the amount is ever shown to a tenant
 * (an amount can be configured ahead of time without going live).
 */
export const platformFeesSchema = z.object({
  vertical: z.enum([
    "auto",
    "vet",
    "legal",
    "dental",
    "real_estate",
    "motel",
    "restaurant",
    "generic",
  ]),
  setup_fee_enabled: z.boolean(),
  setup_fee_cents: z.number().int().min(0),
  white_glove_enabled: z.boolean(),
  white_glove_fee_cents: z.number().int().min(0),
  white_glove_description: z.string().max(500),
});
export type PlatformFees = z.infer<typeof platformFeesSchema>;

export const DEFAULT_FEES: Omit<PlatformFees, "vertical"> = {
  setup_fee_enabled: false,
  setup_fee_cents: 0,
  white_glove_enabled: false,
  white_glove_fee_cents: 0,
  white_glove_description: "",
};
