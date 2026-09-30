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

/** Placeholder written while a confirm is minting; replaced by the real token on success, cleared on failure. */
const MINT_IN_PROGRESS = "minting";

/**
 * Atomically claims the one call-token mint a session is allowed. The browser
 * mints exactly one per session (confirm, then the call), so a second confirm
 * for the same id is a caller looping on a valid session id to farm tokens.
 * A read-then-mint check would let parallel requests all pass before the first
 * one stores its token, so the claim is a single conditional UPDATE: exactly
 * one caller sees a returned row. Returns "unknown" when the session does not
 * exist (the handler then answers its normal 404) and "taken" when a token was
 * already minted or is being minted.
 */
export async function claimDemoSessionMint(
  sql: SqlClient,
  demoSessionId: string,
): Promise<"claimed" | "taken" | "unknown"> {
  const claimed = await sql<{ id: string }>`
    update public.demo_sessions set retell_call_token = ${MINT_IN_PROGRESS}
    where id = ${demoSessionId} and retell_call_token is null
    returning id
  `;
  if (claimed.length > 0) return "claimed";
  const existing = await sql<{ id: string }>`
    select id from public.demo_sessions where id = ${demoSessionId}
  `;
  return existing.length > 0 ? "taken" : "unknown";
}

/** Gives the mint back after a failed confirm (Retell refused, edit rejected...) so the visitor can retry. */
export async function releaseDemoSessionMint(sql: SqlClient, demoSessionId: string): Promise<void> {
  await sql`
    update public.demo_sessions set retell_call_token = null
    where id = ${demoSessionId} and retell_call_token = ${MINT_IN_PROGRESS}
  `;
}
