import { claimsFromUser } from "@/lib/auth/claims";
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
  const claims = claimsFromUser(session.user);
  return claims.tenant_id ?? null;
}
