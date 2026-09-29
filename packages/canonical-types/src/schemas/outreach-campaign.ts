import { z } from "zod";
import { zVertical } from "../vertical.js";

/**
 * A DNS hostname with at least one dot and an alphabetic TLD (`mail.example.com`):
 * labels of 1-63 letters/digits/hyphens that neither start nor end with a hyphen,
 * 253 characters in total. Case-insensitive; the schema lower-cases it.
 * NOTE: `supabase/functions/admin/schemas.ts` re-declares this schema field for
 * field (Deno cannot import this package); the parity cases in
 * `supabase/functions/admin/handler.outreach.test.ts` fail when the two drift.
 */
export const SENDING_DOMAIN_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Upper bound on the per-day send cap (COCKPIT-F23) — a warming domain never sends more than this. */
export const MAX_DAILY_SEND_CAP = 2000;

/** `/cockpit/outreach/campaigns/new` (FRONTEND_SPEC.md §7.3). `respect_suppression` is locked `true` — CAN-SPAM non-negotiable. */
export const outreachCampaignSchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required").max(200),
  vertical: zVertical,
  sending_domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SENDING_DOMAIN_RE, "Enter a domain such as mail.example.com"),
  daily_send_cap: z
    .number()
    .int()
    .min(1, "Must be at least 1")
    .max(MAX_DAILY_SEND_CAP, `Must be at most ${MAX_DAILY_SEND_CAP}`),
  /** Optional outreach template reference; blank is allowed, anything else must be a uuid. */
  template_id: z.union([z.literal(""), z.uuid("Template ID must be a UUID")]).optional(),
  respect_suppression: z.literal(true),
});

export type OutreachCampaign = z.infer<typeof outreachCampaignSchema>;
