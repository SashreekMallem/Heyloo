import { existsSync } from "node:fs";

/**
 * True only when `SUPABASE_URL` looks like a local `supabase start`
 * instance (always `http://127.0.0.1:<port>` — Supabase's local CLI never
 * produces any other host) AND a secret key is present. Deliberately NOT
 * "is `SUPABASE_URL` merely set" — `apps/web/.env.local` (and this repo's
 * CI `e2e` job, which needs `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_URL` set to
 * SOME value for `next build`/`next start` to run at all, see
 * `.github/workflows/ci.yml`) sets it to an unreachable
 * `https://placeholder.supabase.co` on purpose — a bare truthiness check
 * would make the authenticated specs try to hit that placeholder host
 * instead of skipping, hanging the CI job rather than failing it cleanly.
 */
export function isLocalSupabaseReachable(): boolean {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SECRET_KEY"];
  return Boolean(url && key && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url));
}

/**
 * Resolves a saved `storageState` path from the "setup" project
 * (`auth.setup.ts`), or `undefined` when it doesn't exist — which is the
 * normal case whenever no local Supabase was reachable, since "setup"'s own
 * tests self-skip rather than fail in that case (see `auth.setup.ts`'s doc
 * comment) and therefore never write the file. `test.use({ storageState })`
 * resolves at browser-context-launch time, BEFORE a spec's own
 * `test.skip(!isLocalSupabaseReachable(), ...)` line runs — passing a
 * nonexistent path there throws when the context is created, not a clean
 * skip — so every authenticated spec must go through this helper rather
 * than hard-coding the path directly.
 */
export function authStorageState(
  role: "tenant-owner" | "platform-admin-no-mfa",
): string | undefined {
  const path = `playwright/.auth/${role}.json`;
  return existsSync(path) ? path : undefined;
}
