import { z } from "zod";
import { zVertical } from "../vertical.js";

/** `/cockpit/outreach/campaigns/new` (FRONTEND_SPEC.md §7.3). `respect_suppression` is locked `true` — CAN-SPAM non-negotiable. */
export const outreachCampaignSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required").max(200),
  vertical: zVertical,
  sending_domain: z.string().trim().min(1, "Sending domain is required"),
  daily_send_cap: z.number().int().positive(),
  template_id: z.string().min(1),
  respect_suppression: z.literal(true),
});

export type OutreachCampaign = z.infer<typeof outreachCampaignSchema>;
