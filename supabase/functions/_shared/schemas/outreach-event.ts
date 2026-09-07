import { z } from "zod";

/**
 * Normalized outreach webhook event (BACKEND_SPEC §7.5). The Deno
 * `index.ts` is responsible for mapping whichever provider's raw payload
 * (Smartlead or Instantly — VERIFY.md: "confirm which of the two is
 * selected before coding") into this shape; this schema validates the
 * already-normalized object.
 */
export const NormalizedOutreachEventSchema = z.object({
  campaign_external_id: z.string().min(1),
  lead_email_or_phone: z.string().min(1),
  event: z.enum(["reply", "open", "click", "bounce", "complaint", "unsubscribe"]),
  body: z.string().optional(),
  occurred_at: z.string().min(1),
  provider_message_id: z.string().optional(),
});

export type NormalizedOutreachEventInput = z.infer<typeof NormalizedOutreachEventSchema>;
