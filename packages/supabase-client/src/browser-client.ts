/**
 * Browser Supabase client — cookie-based session (no tokens in
 * localStorage, closing audit finding #12 per FRONTEND_STACK.md). Used by
 * client components for anything RLS already permits: TanStack Query
 * mutations/queries, and the realtime channel subscription (§0.3 pattern 2
 * and 3). Verify against supabase.com/docs/guides/auth/server-side/nextjs
 * before changing this factory (CLAUDE.md Rule 1).
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types.js";

export type SupabaseBrowserClient = ReturnType<typeof createBrowserClient<Database>>;

export function createSupabaseBrowserClient(
  supabaseUrl: string,
  supabasePublishableKey: string,
): SupabaseBrowserClient {
  return createBrowserClient<Database>(supabaseUrl, supabasePublishableKey);
}
