import { z } from "zod";
import { zCents } from "../primitives.js";

/** Platform settings → Referral tab (FRONTEND_SPEC.md §7.5). */
export const adminReferralSettingSchema = z.object({
  flat_amount_cents: zCents,
  qualification_rule: z.string().trim().min(1).max(500),
});

export type AdminReferralSetting = z.infer<typeof adminReferralSettingSchema>;
