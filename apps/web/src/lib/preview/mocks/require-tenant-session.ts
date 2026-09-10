import "server-only";

import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { PREVIEW_TENANT, PREVIEW_TENANT_USER } from "../fixtures";

/**
 * UI Preview Mode replacement for `@/lib/auth/require-tenant-session`
 * (see `apps/web/next.config.ts`'s `UI_PREVIEW_MODE`-gated module alias,
 * and `apps/web/src/lib/preview/README.md`). Same exported signature and
 * return shape as the real function — every real `(tenant)` page/layout
 * that calls `requireTenantSession(nextPath)` keeps working completely
 * unmodified, it just resolves against fixture data instead of a real
 * login session.
 *
 * `supabase` is a REAL `@supabase/ssr` server client — its own
 * `.from(...)` calls still issue real HTTP requests, which
 * `apps/web/src/lib/preview/mock-fetch.ts` intercepts globally.
 */
export async function requireTenantSession(_nextPath: string) {
  const supabase = await createSupabaseServerComponentClient();
  return {
    supabase,
    user: PREVIEW_TENANT_USER,
    claims: { tenant_id: PREVIEW_TENANT.id, role: "owner" as const },
    tenant: PREVIEW_TENANT,
  };
}
