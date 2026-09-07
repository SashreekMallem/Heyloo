import { z } from "zod";
import { zCents } from "../primitives.js";

/**
 * MASTER_SPEC.md §3.6/§3.8/§3.9/§3.10 — reminders/review toggles + review
 * URL + avg-ticket field, added to Settings alongside the vertical-details
 * tab.
 */
export const reminderReviewSettingsSchema = z.object({
  voice_reminders_enabled: z.boolean(),
  review_request_enabled: z.boolean(),
  review_url: z.url().optional(),
  avg_transaction_value_cents: zCents,
});

export type ReminderReviewSettings = z.infer<typeof reminderReviewSettingsSchema>;
