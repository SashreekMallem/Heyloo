// Deno-only glue (excluded from ../../tsconfig.json). Module-scope Postgres
// client — constructed ONCE per warm Edge Function instance, never
// per-invocation (CLAUDE.md Rule 2 hot-path discipline: "module-scope DB
// client"). Uses postgres.js (the `postgres` package) directly against
// `SUPABASE_DB_URL`, which is the DIRECT Postgres connection
// (`db.<ref>.supabase.co:5432`), not a pooler — HOTPATH (docs/VERIFY.md),
// confirmed two ways: supabase.com/docs/guides/functions/secrets defines it
// as "The URL for your Postgres database. Use it to connect directly to your
// database", and live `pg_stat_activity` shows these clients as
// `application_name = 'postgres.js'` on AWS IPv6 addresses with no
// Supavisor hop. Prepared statements (`prepare: true`) are therefore
// supported. supabase-js/PostgREST is not used because pgmq's `pgmq.*`
// schema functions and pg_cron/pg_net-adjacent SQL used by the jobs/workers
// below are not exposed through PostgREST's `public`-schema-only REST
// surface — a single raw-SQL client that speaks every schema is simpler
// than two DB access paths. No ORM (Rule 2) — every query below is a
// tagged-template literal SQL string, postgres.js's native (and only) query
// style.
import postgres from "postgres";
import { buildConnectionOptions, type ConnectionProfile } from "../db-options.ts";
import type { SqlClient } from "../types.ts";
import { requireEnv } from "./env.ts";

let client: ReturnType<typeof postgres> | undefined;

// HOTPATH stage attribution (docs/BUILD_NOTES.md): whether this isolate's
// connection was already open when a request started. `true` once a request
// has used the client; reset by postgres.js's `onclose` hook (idle_timeout,
// max_lifetime, network error). Exact for the `hot_path` profile, whose
// pool is a single connection; approximate for pools of 5.
let connectionOpen = false;

/** HOTPATH: `true` when the (single, hot-path) connection was open at the
 * moment of the call — i.e. this request will not pay the TCP/TLS/SCRAM
 * handshake plus postgres.js's per-connection `fetch_types` query. */
export function isDbConnectionWarm(): boolean {
  return client !== undefined && connectionOpen;
}

/** HOTPATH: call after a request's queries have run on the client. */
export function markDbConnectionUsed(): void {
  if (client !== undefined) connectionOpen = true;
}

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
 * client-side race. This is what makes the hot path's JS-level
 * `withTimeout` hard-abort (`voice-tools/index.ts`) actually free the
 * underlying connection when a query hangs, rather than just abandoning the
 * caller-visible promise while the query (and its connection) keeps running
 * server-side — the resource-exhaustion risk M2 flags. Only `voice-tools`
 * passes this (a value under its own per-tool budgets); every other caller
 * omits it and keeps today's
 * unbounded-per-query behavior, since a blanket timeout here would also cap
 * legitimate longer-running job/worker queries (reconciliation scans,
 * batch billing runs) that have no hot-path budget to honor. Only the
 * FIRST caller to construct the module-scope client on a given warm
 * instance's value takes effect (the client is a lazy singleton) — every
 * caller in this codebase is consistent about which timeout (if any) it
 * wants for its own function, so this is not a real conflict in practice.
 *
 * `profile: "hot_path"` (HOTPATH, `voice-tools` only) caps the pool at one
 * connection — see `HOT_PATH_MAX_CONNECTIONS`'s doc comment for the
 * measured reason. Same rule as the timeout: the first caller's options win.
 *
 * The connection-option object itself is built by
 * `../db-options.ts#buildConnectionOptions` (covered by this package's
 * tsconfig/Vitest, unlike this file — see `db-options.test.ts`, EDGE_AUDIT
 * M2). `factory` defaults to the real npm `postgres` import; the optional
 * second parameter exists only so a test could construct a `getSql` bound
 * to a fake/mock client without ever touching the module-scope singleton
 * above — production call sites never pass it. */
export function getSql(
  opts?: { statementTimeoutMs?: number; profile?: ConnectionProfile },
  factory: typeof postgres = postgres,
): SqlClient {
  if (!client) {
    // Direct connection: prepared statements persist for the connection's
    // lifetime (no transaction-mode pooler in the path).
    client = factory(requireEnv("SUPABASE_DB_URL"), {
      ...buildConnectionOptions(opts),
      onclose: () => {
        connectionOpen = false;
      },
    });
  }
  return client as unknown as SqlClient;
}
