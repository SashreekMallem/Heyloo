import "server-only";

import {
  createSupabaseServiceRoleClient,
  type SupabaseServiceRoleClient,
} from "@heyloo/supabase-client";
import { env } from "../env";

/**
 * Bypasses RLS — Route Handler use only, narrowly: `platform_settings`
 * price-card reads pre-auth (signup step 2), admin-proxy fallbacks that
 * need cross-tenant reads a caller's own JWT can't provide. Never import
 * this from a Client Component or anything the browser bundle could reach
 * (the `server-only` import throws at build time if it is).
 */
export function createSupabaseServiceRoleServerClient(): SupabaseServiceRoleClient {
  return createSupabaseServiceRoleClient(env.supabaseUrl, env.supabaseSecretKey);
}
