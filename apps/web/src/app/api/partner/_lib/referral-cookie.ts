/**
 * Referral attribution cookie (PT-01). Deliberately dependency-free (no
 * `server-only`, no Node APIs) because `middleware.ts` (edge runtime) sets it
 * and the checkout Route Handler reads it.
 *
 * Flow: `/signup?ref=CODE` -> middleware sets this first-party httpOnly cookie
 * -> `POST /api/checkout/session` forwards the code to the `api-checkout` edge
 * function -> that function (service role, verified user id) looks the code up
 * in `referral_links` and writes `tenants.referrer_partner_id` /
 * `referral_link_id` plus a pending `referrals` row. The cookie only ever
 * carries a claim; nothing is trusted until the server resolves it.
 */
export const REFERRAL_COOKIE = {
  name: "heyloo_ref",
  /** 90 days, last click wins. */
  maxAge: 60 * 60 * 24 * 90,
} as const;

/** Query parameter partners' links use (`/signup?ref=CODE`). */
export const REFERRAL_QUERY_PARAM = "ref";

/**
 * Normalizes a raw `?ref=` / cookie value to the canonical upper-case code, or
 * `null` when it cannot be a code we issued (4-32 letters/digits). Codes issued
 * before SEC-11 are 6 chars, since then 8; both fit. Anything else (spaces,
 * punctuation, over-long junk) is dropped rather than stored.
 */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(code) ? code : null;
}
