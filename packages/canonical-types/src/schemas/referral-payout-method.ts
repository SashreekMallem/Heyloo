import { z } from "zod";

/** Refer & earn / Partner portal settings (FRONTEND_SPEC.md §6.10/§8.5). */
export const referralPayoutMethodSchema = z.object({
  paypal_email: z.email("Enter a valid PayPal email address"),
});

export type ReferralPayoutMethod = z.infer<typeof referralPayoutMethodSchema>;
