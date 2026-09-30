import type { AppMetadataClaims } from "@heyloo/supabase-client";

/**
 * Where an authenticated user with no usable role / workspace is sent instead
 * of the marketing home with a transient toast (AUTH-05): a real page that
 * says what is wrong and offers next steps and log out.
 */
export const NO_ACCESS_PATH = "/no-access";

/**
 * The post-login home for a set of verified JWT claims. One function so the
 * login page, the middleware's "already signed in" bounce and the no-access
 * page can never disagree. Precedence matches the login page's historical
 * order: platform admin, then referral partner, then tenant member.
 *
 * A platform admin whose token is below aal2 carries `admin_mfa_required`
 * instead of `platform_admin` (SEC-01) and still belongs at `/cockpit`, where
 * the guards route them to MFA enrollment or the challenge.
 */
export function roleHome(
  claims: AppMetadataClaims,
  options: { adminMfaRequired?: boolean } = {},
): string {
  if (claims.platform_admin || options.adminMfaRequired) return "/cockpit";
  if (claims.referral_partner_id) return "/portal";
  if (claims.tenant_id) return "/dashboard";
  return NO_ACCESS_PATH;
}
