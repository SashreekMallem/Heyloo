// Pure option-building logic for `_shared/deno/db.ts`'s `getSql`, pulled out
// into this file specifically because it (unlike `_shared/deno/**`) IS
// covered by this package's tsconfig.json/Vitest (EDGE_AUDIT M2 — see
// `db-options.test.ts` and `docs/BUILD_NOTES.md`'s M2 entry). No Deno/Node
// runtime dependency at all — just the object `db.ts` passes straight
// through to postgres.js's constructor.
export interface PostgresConnectOptions {
  prepare: boolean;
  max: number;
  idle_timeout: number;
  connect_timeout: number;
  connection?: { statement_timeout: number };
}

/**
 * `"default"` — every job/worker/webhook/API function (unchanged).
 * `"hot_path"` — `voice-tools` only (HOTPATH, docs/BUILD_NOTES.md): one
 * connection per isolate. See `buildConnectionOptions`.
 */
export type ConnectionProfile = "default" | "hot_path";

/**
 * HOTPATH (docs/BUILD_NOTES.md, docs/VERIFY.md HOTPATH): the hot path runs a
 * single connection per isolate.
 *
 * Why 1, measured against the pinned postgres.js 3.4.9 source
 * (`node_modules/postgres/src/{index,connection}.js`) and Supabase's own
 * serverless guidance ("Set the pool to 1 connection ... Raise the pool
 * above 1 only when you have evidence that concurrent invocations on one
 * instance are queuing for the connection",
 * supabase.com/docs/guides/database/connecting-to-postgres#configure-your-client):
 *
 *  - A statement postgres.js has not prepared on this connection yet is
 *    sent as Parse/Describe/Flush and the connection is marked busy until
 *    ParameterDescription comes back (`describeFirst`). A second query
 *    issued meanwhile (every `Promise.all` group in the tools) does NOT
 *    wait for it with `max > 1`: `handler()` takes a closed slot and opens
 *    a brand-new connection (TCP + TLS + SCRAM + the `fetch_types`
 *    catalog query, ~7 round trips) instead of the 2 round trips it would
 *    cost to wait. That is the "11 postgres.js connections from 8
 *    isolates" VERIFY-DEPLOY sampled, and it is slower, not faster.
 *  - With one connection, statements run strictly in the order they were
 *    issued — postgres.js's own README (v3.4.9): "There are no guarantees
 *    about queries executing in order unless using a transaction with
 *    `sql.begin()` or setting `max: 1`". `voice-tools/handler.ts`'s
 *    create_booking timeout recovery relies on that: its idempotency-key
 *    check is queued behind any write already in flight, so the check sees
 *    the write's committed result (proven against the real client in
 *    `db-options.test.ts`).
 *
 * `prepare` stays `true`: `SUPABASE_DB_URL` is the DIRECT connection
 * (supabase.com/docs/guides/functions/secrets: "Use it to connect directly
 * to your database"; live `pg_stat_activity` shows `postgres.js` clients on
 * AWS IPv6 addresses, no Supavisor), which supports prepared statements. A
 * repeat statement on a warm connection is then 1 round trip; with
 * `prepare: false` postgres.js still describes every parameterized
 * statement first (`describeFirst = parameters.length && !q.prepared`), so
 * every statement would cost 2 round trips on every call.
 */
export const HOT_PATH_MAX_CONNECTIONS = 1;

/**
 * `statementTimeoutMs`, when given, is threaded through as a Postgres
 * `connection` startup parameter (`statement_timeout`) — a genuine
 * server-side GUC (VERIFY-confirmed against postgres.js's own README at
 * pinned v3.4.9, `docs/VERIFY.md`), not just a client-side race. Omitted
 * entirely (no `connection` key at all) when no `statementTimeoutMs` is
 * given, so every caller other than `voice-tools/index.ts` keeps today's
 * unbounded-per-query behavior.
 *
 * Passed through as the raw number, matching postgres.js's own
 * `ConnectionParameters['statement_timeout']: number` type (its installed
 * `node_modules/postgres/types/index.d.ts`, not the string this repo's code
 * used before this fix) — `postgres`'s `StartupMessage()` builds the wire
 * value via plain string concatenation (`src/connection.js`), which coerces
 * a number identically to a pre-stringified value, so this is a type-only
 * correction with no behavior change.
 */
export function buildConnectionOptions(opts?: {
  statementTimeoutMs?: number;
  profile?: ConnectionProfile;
}): PostgresConnectOptions {
  const base: PostgresConnectOptions = {
    prepare: true,
    max: opts?.profile === "hot_path" ? HOT_PATH_MAX_CONNECTIONS : 5,
    idle_timeout: 20,
    connect_timeout: 5,
  };
  if (opts?.statementTimeoutMs === undefined) {
    return base;
  }
  return {
    ...base,
    connection: { statement_timeout: opts.statementTimeoutMs },
  };
}
