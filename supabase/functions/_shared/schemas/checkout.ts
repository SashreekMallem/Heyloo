import { z } from "zod";

/** `/api-checkout` request (BACKEND_SPEC §7.9 precursor / API_AND_FLOWS.md
 * A.3 + Flow 2 step 1). The authenticated user's id comes from the verified
 * JWT (`verify_jwt: true` in config.toml), never trusted from the body. */
export const CheckoutRequestSchema = z.object({
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
  business_name: z.string().min(1).max(200),
  /** The number the business's customers call today (signup step 1,
   * optional). Already normalized by the web app, but re-checked here as
   * E.164 — `tenants_business_phone_e164_format_chk` would reject anything
   * else, and a bad value must be a 422, not a 500. */
  business_phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/)
    .optional(),
  /** The business's website (signup step 1, optional): http(s) with no
   * whitespace, matching `tenants_website_url_format_chk`. */
  website_url: z
    .string()
    .max(2048)
    .regex(/^https?:\/\/[^\s]+$/i)
    .optional(),
  email: z.string().email(),
  timezone: z.string().min(1).optional(),
  /** Opt-in white-glove onboarding add-on (GAP_REGISTER Cluster G item 5)
   * — a one-time Checkout line item at `platform_settings.price_card_
   * <vertical>.white_glove_price_cents`, charged ONLY when the tenant
   * explicitly requests it here. Unlike `setup_fee_cents` (mandatory
   * whenever the vertical's price card has one configured), white-glove is
   * a selectable service tier, not a universal charge. */
  white_glove: z.boolean().optional().default(false),
  /** Partner referral code from the browser's `heyloo_ref` cookie (PT-01).
   * Only a claim — `api-checkout/referral.ts` resolves it against
   * `referral_links` and silently ignores anything unknown or malformed, so
   * this is deliberately lenient (a bad code must never fail a signup). */
  referral_code: z.string().max(64).optional(),
});

export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;
