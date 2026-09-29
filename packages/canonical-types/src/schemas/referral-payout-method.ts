import { z } from "zod";

const PAYPAL_EMAIL_MESSAGE = "Enter a valid PayPal email address";

/** RFC 5321: 254 octets for the whole address, 64 for the local part. */
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;

/** Refer & earn / Partner portal settings (FRONTEND_SPEC.md §6.10/§8.5). */
export const referralPayoutMethodSchema = z.object({
  paypal_email: z
    .string()
    .trim()
    .max(MAX_EMAIL_LENGTH, PAYPAL_EMAIL_MESSAGE)
    .pipe(
      z
        .email(PAYPAL_EMAIL_MESSAGE)
        .refine(
          (value) => value.slice(0, value.lastIndexOf("@")).length <= MAX_LOCAL_PART_LENGTH,
          PAYPAL_EMAIL_MESSAGE,
        ),
    ),
});

export type ReferralPayoutMethod = z.infer<typeof referralPayoutMethodSchema>;
