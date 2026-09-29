import type { SqlClient } from "./types.ts";

/**
 * Database-backed ceilings for the public `api-demo-agent` (verify_jwt false),
 * enforced INSIDE the function so they hold even when a caller skips the
 * marketing site's Next.js proxy and posts to the bare function URL (QA
 * SEC-04). The web layer's in-process limiters reset on every cold start and
 * only guard `/api/demo/*`; every demo the function creates already writes a
 * `demo_sessions` row, so those rows are the counter.
 */

/** Demo sessions (scrape or instant) the function will create per rolling hour, across all callers. */
export const DEMO_SESSIONS_PER_HOUR = 600;

const HOUR_MS = 60 * 60 * 1000;

/** True when creating another demo session would exceed the hourly ceiling. */
export async function demoSessionCeilingReached(
  sql: SqlClient,
  now: Date = new Date(),
  max: number = DEMO_SESSIONS_PER_HOUR,
): Promise<boolean> {
  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from public.demo_sessions where created_at > ${since}
  `;
  return (rows[0]?.n ?? 0) >= max;
}

/**
 * True when this session already had a call token minted. The browser mints
 * exactly one per session (confirm, then the call), so a second confirm for
 * the same id is a caller looping on a valid session id to farm tokens.
 */
export async function demoSessionAlreadyMinted(
  sql: SqlClient,
  demoSessionId: string,
): Promise<boolean> {
  const rows = await sql<{ minted: boolean }>`
    select (retell_call_token is not null) as minted
    from public.demo_sessions where id = ${demoSessionId}
  `;
  return rows[0]?.minted === true;
}
