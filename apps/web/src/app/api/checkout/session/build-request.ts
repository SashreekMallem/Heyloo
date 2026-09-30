import type { SignupDraft } from "@/lib/signup/draft-cookie";

/**
 * The exact body `/functions/v1/api-checkout` parses
 * (`supabase/functions/_shared/schemas/checkout.ts`'s `CheckoutRequestSchema`
 * — vertical/business_name/email required, timezone optional). Extracted
 * into its own module (only a `type`-only import of `SignupDraft`, so no
 * `server-only`-guarded runtime code is pulled in) so the contract can be
 * unit tested without driving the Next.js request lifecycle (see
 * `./build-request.test.ts`) — this IS the seam contract test for the
 * checkout signup step, since `apps/web` and `supabase/functions` are
 * separate pnpm workspace packages that don't share a runtime-importable
 * Zod schema across the Node/Deno boundary (BUILD_NOTES.md's documented
 * split).
 *
 * `draft.business_type` is ALREADY the canonical `Vertical` short form
 * (`"auto"`, `"vet"`, ...) — it comes straight from `signupBusinessTypeSchema`
 * (step 1) unchanged, matching both `CheckoutRequestSchema.vertical`'s enum
 * AND the current `tenants.vertical` check constraint
 * (`supabase/migrations/20260907130100_tenancy.sql`) exactly. Deliberately
 * NOT run through `@heyloo/supabase-client`'s `VERTICAL_TO_DB_VALUE` — that
 * map's long-form output (`"auto_repair"`, `"veterinary"`) is stale against
 * the live migration's short-form constraint (docs/BUILD_NOTES.md flagged;
 * see this cluster's FIX_REQUESTS.md entry for that package's owner).
 *
 * `whiteGlove` mirrors `CheckoutRequestSchema.white_glove` (opt-in
 * white-glove onboarding add-on, default `false`) — omitted from the
 * returned body entirely when falsy, the same way `timezone` is omitted
 * when absent, so it matches the schema's own `.optional().default(false)`
 * and doesn't change the body shape for the (still far more common) case
 * where a tenant doesn't opt in.
 *
 * `referralCode` (PT-01) is the already-normalized partner code from the
 * `heyloo_ref` cookie (`api/partner/_lib/referral-cookie.ts`), mirroring
 * `CheckoutRequestSchema.referral_code`. It is only a claim: `api-checkout`
 * resolves it against `referral_links` and ignores an unknown code, so it is
 * omitted when absent and never grants anything by itself.
 *
 * `business_phone` (E.164) / `website_url` (http(s)) mirror the optional
 * `CheckoutRequestSchema` fields written to `tenants.business_phone` /
 * `tenants.website_url`. Omitted when the draft has none (left blank at
 * step 1, or a draft saved before step 1 asked), so the body is unchanged
 * for those customers.
 */
export function buildApiCheckoutRequest(
  draft: Pick<SignupDraft, "business_type" | "business_name" | "business_phone" | "website_url">,
  email: string,
  timezone?: string,
  whiteGlove?: boolean,
  referralCode?: string,
): {
  vertical: string;
  business_name: string;
  business_phone?: string;
  website_url?: string;
  email: string;
  timezone?: string;
  white_glove?: boolean;
  referral_code?: string;
} {
  return {
    vertical: draft.business_type,
    business_name: draft.business_name,
    ...(draft.business_phone ? { business_phone: draft.business_phone } : {}),
    ...(draft.website_url ? { website_url: draft.website_url } : {}),
    email,
    ...(timezone ? { timezone } : {}),
    ...(whiteGlove ? { white_glove: true } : {}),
    ...(referralCode ? { referral_code: referralCode } : {}),
  };
}
