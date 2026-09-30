/**
 * Whether the browser holds a Supabase Auth session cookie. `@supabase/ssr`
 * stores the session in a non-httpOnly cookie named `sb-<project-ref>-auth-token`
 * (split into `.0`, `.1`, ... chunks when large), so the marketing header can
 * tell a signed-in visitor apart without loading the Supabase client or making
 * the statically rendered marketing pages dynamic. This is a UI hint only: the
 * middleware and each route group's layout remain the real access guards.
 */
function isSessionCookieName(name: string): boolean {
  // `sb-<ref>-auth-token`, optionally chunked as `.0`, `.1`, ...
  const base = name.replace(/\.\d+$/, "");
  return base.startsWith("sb-") && base.endsWith("-auth-token") && base.length > 14;
}

export function hasSessionCookie(cookieString: string): boolean {
  return cookieString.split(";").some((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return false;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    return value !== "" && isSessionCookieName(name);
  });
}
