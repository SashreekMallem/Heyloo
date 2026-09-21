import { type AppMetadataClaims, extractClaims } from "@heyloo/supabase-client";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Reads the SAME `app_metadata` claims the backend's Custom Access Token
 * Hook sets — one claim source for frontend guards and backend RLS
 * (FRONTEND_SPEC.md §0.1).
 *
 * SIGNUP-1 (docs/BUILD_NOTES.md): a `User` object — from
 * `supabase.auth.getUser()`, `getSession()`, or a `signInWithPassword`/
 * `signUp` response — reflects `auth.users`' own DB row `app_metadata`
 * column. The Custom Access Token Hook (`custom_access_token_hook` in
 * `supabase/migrations/20260907131400_functions_triggers.sql`) injects
 * `tenant_id`/`role`/`platform_admin`/`referral_partner_id` ONLY into the
 * signed JWT's `claims.app_metadata` at token-mint time — it never writes
 * back to that DB row. Confirmed live: a freshly-refreshed access token's
 * OWN decoded payload carried a real `tenant_id`, while the SAME request's
 * `getUser()`/`getSession()` result had an `app_metadata` with no
 * `tenant_id` at all. `claimsFromUser` (this function) is therefore only
 * ever correct for a user with NO hook-added claims — every tenant owner/
 * staff member, platform admin, and referral partner falls through every
 * guard that calls it. Use `claimsFromSupabaseClient` (below) instead,
 * which reads `supabase.auth.getClaims()` — the JWT's own claims, verified,
 * exactly the method the SDK itself documents for this ("The returned
 * claims can be customized per project using the Custom Access Token
 * Hook"). Kept only for the one remaining caller that already has a bare
 * `User` and no live claim to re-derive (a page rendering profile fields
 * that are NOT authorization-relevant); every route-guard call site must
 * use `claimsFromSupabaseClient`.
 */
export function claimsFromUser(user: User | null | undefined): AppMetadataClaims {
  if (!user) return {};
  return extractClaims(user.app_metadata);
}

/**
 * The correct way to read authorization claims (SIGNUP-1 fix, see
 * `claimsFromUser`'s doc comment above for why `user.app_metadata` cannot
 * be used for this). `getClaims()` decodes and verifies the current
 * session's access token and returns ITS OWN `app_metadata` — the Custom
 * Access Token Hook's actual output — falling back to `{}` (never throws)
 * when there is no session or the token fails verification, so every call
 * site's existing "falsy claims -> redirect/deny" logic keeps working
 * unchanged.
 */
export async function claimsFromSupabaseClient(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<AppMetadataClaims> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return {};
  return extractClaims(data.claims.app_metadata);
}

/**
 * AUTH-1 (docs/BUILD_NOTES.md): `impersonated_by` is stamped into the JWT's
 * own `app_metadata` by `custom_access_token_hook`
 * (`supabase/migrations/20260910110000_impersonation_claim.sql`) — the
 * exact same JWT-only pattern as `tenant_id`/`role`/`platform_admin`, and
 * NOT part of `AppMetadataClaims` (that type lives in
 * `@heyloo/supabase-client`, outside this cluster's ownership). Reading it
 * off a `User`/session object's `app_metadata` (as
 * `api/admin/[...path]/route.ts` previously did) always returns `null` for
 * a real impersonation session, for the identical reason `claimsFromUser`
 * was broken — the self-service impersonate-end/edit-mode routes 403 for
 * every real platform admin today. Use this instead.
 */
export async function impersonatedByFromSupabaseClient(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<string | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  const appMetadata = data.claims.app_metadata;
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const value = (appMetadata as Record<string, unknown>)["impersonated_by"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type Aal = "aal1" | "aal2";

/** Supabase's built-in Authenticator Assurance Level claim (not a custom claim — set by GoTrue itself once an MFA factor is verified). Read from the user's session via `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` at call sites; this type alias just documents the shape. */
export interface AalStatus {
  currentLevel: Aal | null;
  nextLevel: Aal | null;
}
