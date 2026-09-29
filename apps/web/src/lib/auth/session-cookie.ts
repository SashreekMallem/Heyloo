/**
 * `@supabase/ssr` stores the session in a cookie named
 * `sb-<project-ref>-auth-token`, split into `.0`, `.1`, ... chunks when large.
 * Presence of that cookie means "this browser holds a session"; it is only a
 * hint for UI copy (marketing header) — authorization is always decided
 * server-side from the verified JWT, never from this.
 */
const SESSION_COOKIE = /(?:^|;\s*)sb-[^=;\s]+-auth-token(?:\.\d+)?=[^;]+/;

export function hasSupabaseSessionCookie(cookieHeader: string): boolean {
  return SESSION_COOKIE.test(cookieHeader);
}
