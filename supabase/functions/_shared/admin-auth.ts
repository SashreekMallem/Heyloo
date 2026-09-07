/**
 * Platform-admin JWT claim checks (BACKEND_SPEC §7.7, §11.3). Portable pure
 * functions — the Deno `index.ts` decodes the already-`verify_jwt`-checked
 * bearer token's payload (Supabase's platform-level JWT verification has
 * already run since this function deploys with `verify_jwt: true`) and
 * passes the claims object here.
 */
export interface AdminJwtClaims {
  app_metadata?: {
    platform_admin?: boolean;
    tenant_id?: string;
    role?: string;
    referral_partner_id?: string;
  };
  aal?: "aal1" | "aal2";
}

export function isPlatformAdmin(claims: AdminJwtClaims | null): boolean {
  return claims?.app_metadata?.platform_admin === true;
}

/**
 * AAL2-required check for sensitive admin actions (impersonation, refunds,
 * template publish — BACKEND_SPEC §7.7/§11.3). VERIFY.md: BACKEND_SPEC
 * recommends a 15-minute "AAL2 confirmed within a freshness window" check,
 * which needs a timestamp of when the session was elevated to AAL2 — the
 * JWT's own `aal` claim is a point-in-time session level, not a timestamp,
 * so a true freshness window needs either a custom claim the token hook
 * adds (an `aal2_at` timestamp, not in BACKEND_SPEC's §3.1 hook as
 * documented) or a live Supabase Auth Admin API read of the session's MFA
 * challenge time. This checks session-level AAL2 only (`claims.aal ===
 * 'aal2'`) — sufficient to gate the action to an MFA-completed session, but
 * NOT the additional "re-challenge after 15 minutes" freshness BACKEND_SPEC
 * describes; flagged here rather than fabricating a freshness mechanism
 * that doesn't exist yet.
 */
export function isAal2(claims: AdminJwtClaims | null): boolean {
  return claims?.aal === "aal2";
}
