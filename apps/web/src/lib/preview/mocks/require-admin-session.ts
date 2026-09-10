import "server-only";

import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { PREVIEW_ADMIN_USER } from "../fixtures";

/** UI Preview Mode replacement for `@/lib/auth/require-admin-session` — see `./require-tenant-session.ts` for the full rationale. */
export async function requireAdminSession(_nextPath: string) {
  const supabase = await createSupabaseServerComponentClient();
  return {
    supabase,
    user: PREVIEW_ADMIN_USER,
    claims: { platform_admin: true as const },
  };
}
