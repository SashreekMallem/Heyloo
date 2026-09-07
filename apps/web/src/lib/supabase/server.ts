import "server-only";

import { createSupabaseServerClient, type SupabaseServerClient } from "@heyloo/supabase-client";
import { cookies } from "next/headers";
import { env } from "../env";

/**
 * Server component / Route Handler Supabase client, RLS-enforced against
 * the signed-in user's own session (FRONTEND_SPEC.md §0.3 pattern 1).
 * `await cookies()` per Next 15+'s async Dynamic APIs.
 */
export async function createSupabaseServerComponentClient(): Promise<SupabaseServerClient> {
  const cookieStore = await cookies();
  return createSupabaseServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      for (const { name, value, options } of cookiesToSet) {
        cookieStore.set(name, value, options);
      }
    },
  });
}
