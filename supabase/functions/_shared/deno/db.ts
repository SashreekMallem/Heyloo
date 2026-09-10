// Deno-only glue (excluded from ../../tsconfig.json). Module-scope Postgres
// client — constructed ONCE per warm Edge Function instance, never
// per-invocation (CLAUDE.md Rule 2 hot-path discipline: "module-scope DB
// client"). Uses postgres.js (the `postgres` package) directly against
// Supabase's session-mode/dedicated pooler connection string
// (SUPABASE_DB_URL, port 5432 session pooler or 6543 transaction pooler per
// current Supabase connection docs — VERIFY.md: confirm current
// recommended pooler mode for Edge Functions before go-live, egress-blocked
// here) rather than supabase-js/PostgREST, because pgmq's `pgmq.*` schema
// functions and pg_cron/pg_net-adjacent SQL used by the jobs/workers below
// are not exposed through PostgREST's `public`-schema-only REST surface —
// a single raw-SQL client that speaks every schema is simpler than two DB
// access paths. No ORM (Rule 2) — every query below is a tagged-template
// literal SQL string, postgres.js's native (and only) query style.
import postgres from "postgres";
import { buildConnectionOptions } from "../db-options.ts";
import type { SqlClient } from "../types.ts";
import { requireEnv } from "./env.ts";

let client: ReturnType<typeof postgres> | undefined;

/** Lazily constructs the module-scope client on first use within a warm
 * instance, then reuses it for the lifetime of that instance — this is what
 * makes prepared-statement reuse and connection-pool warmth actually pay
 * off across invocations (SYSTEM_DESIGN §5).
 *
 * `statementTimeoutMs` (EDGE_AUDIT M2): passed as a Postgres `connection`
 * startup parameter — VERIFY-confirmed against postgres.js's own README
 * (`raw.githubusercontent.com/porsager/postgres/v3.4.9/README.md`,
 * `docs.twilio.com`-class egress block does not apply to GitHub raw
 * content): "`connection: {..., other connection parameters, see
 * https://www.postgresql.org/docs/current/runtime-config-client.html}`" —
 * `statement_timeout` is one of those, a genuine server-side GUC enforced
 * by Postgres itself for every statement on this connection, not merely a
 * client-side race. This is what makes the hot path's 1.5s JS-level
 * `withTimeout` hard-abort (`voice-tools/index.ts`) actually free the
 * underlying connection back to the 5-slot pool when a query hangs, rather
 * than just abandoning the caller-visible promise while the query (and its
 * pool slot) keeps running server-side — the resource-exhaustion risk M2
 * flags. Only `voice-tools` passes this (a value comfortably under its own
 * 1.5s hard-abort); every other caller omits it and keeps today's
 * unbounded-per-query behavior, since a blanket timeout here would also cap
 * legitimate longer-running job/worker queries (reconciliation scans,
 * batch billing runs) that have no hot-path budget to honor. Only the
 * FIRST caller to construct the module-scope client on a given warm
 * instance's value takes effect (the client is a lazy singleton) — every
 * caller in this codebase is consistent about which timeout (if any) it
 * wants for its own function, so this is not a real conflict in practice.
 *
 * The connection-option object itself is built by
 * `../db-options.ts#buildConnectionOptions` (covered by this package's
 * tsconfig/Vitest, unlike this file — see `db-options.test.ts`, EDGE_AUDIT
 * M2). `factory` defaults to the real npm `postgres` import; the optional
 * second parameter exists only so a test could construct a `getSql` bound
 * to a fake/mock client without ever touching the module-scope singleton
 * above — production call sites never pass it. */
export function getSql(
  opts?: { statementTimeoutMs?: number },
  factory: typeof postgres = postgres,
): SqlClient {
  if (!client) {
    // Session-mode pooler: prepared statements persist for the connection's
    // lifetime, unlike PgBouncer transaction mode.
    client = factory(requireEnv("SUPABASE_DB_URL"), buildConnectionOptions(opts));
  }
  return client as unknown as SqlClient;
}
