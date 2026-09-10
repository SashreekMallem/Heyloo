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
  email: z.string().email(),
  timezone: z.string().min(1).optional(),
  /** Opt-in white-glove onboarding add-on (GAP_REGISTER Cluster G item 5)
   * — a one-time Checkout line item at `platform_settings.price_card_
   * <vertical>.white_glove_price_cents`, charged ONLY when the tenant
   * explicitly requests it here. Unlike `setup_fee_cents` (mandatory
   * whenever the vertical's price card has one configured), white-glove is
   * a selectable service tier, not a universal charge. */
  white_glove: z.boolean().optional().default(false),
});

export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;
