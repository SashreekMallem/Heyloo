/**
 * Ends the browser session. The Supabase browser client is imported lazily
 * so a caller on a marketing route (the no-access toast on `/`) doesn't pull
 * `@supabase/supabase-js` into that route's initial JS budget.
 *
 * Returns `true` when the session is gone; `false` when sign-out failed and
 * the person is still signed in (the caller should say so, not navigate).
 */
export async function performSignOut(): Promise<boolean> {
  const [{ supabaseBrowserClient }, { clearImpersonation }] = await Promise.all([
    import("@/lib/supabase/browser"),
    import("@/lib/impersonation/state"),
  ]);
  const { error } = await supabaseBrowserClient.auth.signOut();
  if (error) return false;
  clearImpersonation();
  return true;
}
