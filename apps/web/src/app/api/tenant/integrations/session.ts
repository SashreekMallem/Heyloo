import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

/**
 * Same split-for-testability reasoning as
 * `api/tenant/delivery/airtable/session.ts` (kept function-local rather
 * than importing that file directly — outside this cluster's ownership
 * and this is a near-trivial few lines, not worth a cross-cluster
 * dependency on a file another cluster may still be editing). No
 * `import "server-only"` guard here either, matching that file exactly —
 * only Route Handlers/Server Components ever import this, and `server-only`
 * unconditionally throws under plain Vitest/jsdom (no Next.js build step to
 * swap it for a no-op), which would break unit testing this module.
 */
export interface IntegrationsSession {
  tenantId: string;
  accessToken: string;
  canManage: boolean;
}

export async function requireIntegrationsSession(): Promise<IntegrationsSession | null> {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const claims = claimsFromUser(session.user);
  if (!claims.tenant_id) return null;
  return {
    tenantId: claims.tenant_id,
    accessToken: session.access_token,
    // Connect/disconnect is owner|admin only, matching api-adapter-connect's
    // own server-side role check (BACKEND_SPEC §11.1) — a `member` can
    // still view status (isTenantStaff, checked separately by the caller).
    canManage: claims.role === "owner" || claims.role === "admin",
  };
}
