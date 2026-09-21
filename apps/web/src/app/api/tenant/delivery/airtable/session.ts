import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

/**
 * Split out of `shared.ts` (which stays free of `server-only`-marked
 * imports so its pure crypto/PKCE helpers can be unit-tested under
 * vitest's jsdom environment without tripping the `server-only` package's
 * client-component guard).
 */
export async function requireTenantIdFromSession(): Promise<string | null> {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  // AUTH-1 fix (docs/BUILD_NOTES.md, SIGNUP-1 root cause #3): claims live
  // only in the JWT itself, never in the User/session object's
  // app_metadata; claimsFromUser(user) always evaluated to {} for a real
  // tenant/admin/partner here.
  const claims = await claimsFromSupabaseClient(supabase);
  return claims.tenant_id ?? null;
}
