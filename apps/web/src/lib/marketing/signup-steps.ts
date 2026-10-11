/** Shared step labels for `<WizardStepper>` across the 6-step signup flow (FRONTEND_SPEC.md §4) — one source instead of copy-pasted in every step's client component. Step 4 is Stripe Checkout, where the owner adds the card that starts the free trial (TRIAL-1). */
export const SIGNUP_STEPS: string[] = [
  "Business info",
  "Plan",
  "Account",
  "Start trial",
  "Provisioning",
  "Phone setup",
];

/**
 * TRIAL-1 free-trial terms as the marketing and signup copy states them. The
 * edge functions read the live values from `platform_settings.free_trial`
 * (seeded 7 / 100 by migration 20261011120100, defaults in
 * supabase/functions/_shared/trial/config.ts): change both together.
 */
export const FREE_TRIAL_DAYS = 7;
export const FREE_TRIAL_MINUTES = 100;

/** The full terms, in the words every signup surface uses. */
export const FREE_TRIAL_TERMS = `Your free trial lasts ${FREE_TRIAL_DAYS} days or ${FREE_TRIAL_MINUTES} call minutes, whichever comes first. A card is required to start, and your plan price is charged when the trial ends. Cancel before it ends and you never pay for the plan. One free trial per business.`;
