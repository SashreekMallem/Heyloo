/**
 * Service-role client — bypasses RLS entirely. Server-only, and only for
 * the narrow cases FRONTEND_SPEC.md names explicitly:
 *  - reading `platform_settings` (price cards) from a pre-auth signup route
 *    ("service-role Route Handler, never client-direct", §4.2)
 *  - any other admin-privileged read/write a Route Handler needs where the
 *    signed-in user's own JWT claims aren't the right authorization model
 *    (e.g. a public, unauthenticated Route Handler).
 * NEVER import this into a Client Component or anything that ships to the
 * browser — there is no build-time guard for that, so it is a code-review
 * invariant (CLAUDE.md Rule 2 spirit: secrets only via env, server-only).
 * Prefer the per-request server client (RLS-enforced via the user's own
 * session) wherever the caller's own permissions are sufficient.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

export type SupabaseServiceRoleClient = ReturnType<typeof createClient<Database>>;

export function createSupabaseServiceRoleClient(
  supabaseUrl: string,
  supabaseSecretKey: string,
): SupabaseServiceRoleClient {
  return createClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
