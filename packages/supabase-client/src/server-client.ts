/**
 * Server Supabase client factory — framework-agnostic over `@supabase/ssr`'s
 * `createServerClient`, which takes a plain `{getAll, setAll}` cookie
 * adapter (the current documented shape, replacing the older get/set/remove
 * trio — verify against supabase.com/docs/guides/auth/server-side/nextjs
 * before changing, CLAUDE.md Rule 1). `apps/web/src/lib/supabase/server.ts`
 * is the thin Next.js wrapper that supplies `next/headers`' `cookies()` as
 * this adapter — kept here, not there, so the factory itself has no
 * `next/*` import and stays reusable if a second app is ever added.
 */
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./database.types.js";

export interface CookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
}

export type SupabaseServerClient = ReturnType<typeof createServerClient<Database>>;

export function createSupabaseServerClient(
  supabaseUrl: string,
  supabasePublishableKey: string,
  cookies: CookieAdapter,
): SupabaseServerClient {
  return createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookies.setAll(cookiesToSet);
        } catch {
          // Called from a Server Component that can only read cookies (no
          // response to attach Set-Cookie to) — safe to ignore as long as
          // middleware also refreshes the session on every request, which
          // apps/web/src/middleware.ts does.
        }
      },
    },
  });
}
