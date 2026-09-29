import { type SignupBusinessType, signupBusinessTypeSchema } from "@heyloo/canonical-types";

/**
 * The signup wizard's progress, carried on the Supabase user itself
 * (`auth.users.raw_user_meta_data`, set through `signUp({options: {data}})`)
 * so it survives the one hop the signed draft cookie cannot: the customer
 * opens the confirmation email in another browser or after the cookie's TTL
 * (SIGNUP-BILL-FIX A). After the email link signs them in,
 * `/signup/resume` reads it back and continues exactly where they left off.
 *
 * `user_metadata` is user-editable, so nothing here is trusted beyond what the
 * customer could already type into the wizard: the draft is re-validated with
 * the same schema as step 1, the plan flags are plain booleans that only
 * select an admin-configured price (never an amount), and tenant identity
 * still comes from the server-side checkout function, never from here.
 */
export const SIGNUP_DRAFT_METADATA_KEY = "signup_draft";
export const SIGNUP_PLAN_METADATA_KEY = "signup_plan";

export interface SignupPlanChoice {
  annual: boolean;
  white_glove: boolean;
}

export function buildSignupUserMetadata(input: {
  ownerName: string;
  draft: SignupBusinessType;
  plan: SignupPlanChoice;
}): Record<string, unknown> {
  return {
    owner_name: input.ownerName,
    [SIGNUP_DRAFT_METADATA_KEY]: {
      business_type: input.draft.business_type,
      business_name: input.draft.business_name,
    },
    [SIGNUP_PLAN_METADATA_KEY]: {
      annual: input.plan.annual,
      white_glove: input.plan.white_glove,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function draftFromUserMetadata(metadata: unknown): SignupBusinessType | null {
  const raw = asRecord(metadata)?.[SIGNUP_DRAFT_METADATA_KEY];
  const parsed = signupBusinessTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function planFromUserMetadata(metadata: unknown): SignupPlanChoice {
  const raw = asRecord(asRecord(metadata)?.[SIGNUP_PLAN_METADATA_KEY]);
  return { annual: raw?.["annual"] === true, white_glove: raw?.["white_glove"] === true };
}
