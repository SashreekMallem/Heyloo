/**
 * Whether referral attribution actually works end to end (QA-1 F-24).
 *
 * A shared `/signup?ref=CODE` link is only a promise the product can keep once
 * the signup flow captures the code and provisioning inserts the `referrals`
 * row / sets `tenants.referrer_partner_id`. As of QA-1 none of that exists —
 * `referral_links`, `referrals` and `tenants.referrer_partner_id` are empty for
 * every tenant because nothing consumes `ref` — so the tenant "Refer & earn"
 * page and its nav entry are hidden behind this switch rather than inviting
 * owners to share links that can never earn anything.
 *
 * Flip to `true` in the same change that lands attribution (capture `?ref` on
 * the signup pages -> pass it through checkout/provisioning -> insert
 * `referrals` + set `tenants.referrer_partner_id`). Tracked in
 * docs/BUILD_NOTES.md under QA-1-portal-core.
 */
const REFERRAL_ATTRIBUTION_LIVE = false;

export function isReferralAttributionLive(): boolean {
  return REFERRAL_ATTRIBUTION_LIVE;
}
