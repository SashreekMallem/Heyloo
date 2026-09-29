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
  /** `hot_path` only: postgres.js custom type overrides (see
   * `HOT_PATH_DATE_TYPE`). Absent for the default profile. */
  types?: { date: PostgresDateType };
}

/** The shape of a postgres.js 3.4.9 custom type (`types/index.d.ts`
 * `PostgresType`: `to`, `from`, `serialize`, `parse`). */
export interface PostgresDateType {
  to: number;
  from: number[];
  serialize: (value: unknown) => string;
  parse: (raw: string) => Date;
}

/**
 * HOTPATH-REVIEW (docs/BUILD_NOTES.md): the value sent for a date-typed
 * parameter that JavaScript cannot parse. Postgres rejects it for `date`,
 * `timestamp` and `timestamptz` with SQLSTATE 22007, an ordinary server-side
 * error. It is deliberately NOT the caller's raw string: Postgres accepts
 * special inputs such as `tomorrow`, `today` and `now`, so passing the raw
 * text through would silently book or move something to a time nobody
 * chose.
 */
export const UNPARSEABLE_TIMESTAMP_SENTINEL = "Invalid Date";

/**
 * HOTPATH-REVIEW: postgres.js's own serializer for OIDs 1082/1114/1184,
 * except that it never throws.
 *
 * The stock one (postgres@3.4.9 `src/types.js`, `date.serialize`) is
 * `(x instanceof Date ? x : new Date(x)).toISOString()`, which throws a
 * `RangeError` for any string JS cannot parse (`"tomorrow"`, `"10:30 AM"`).
 * The throw happens inside the client, while it builds the Bind message.
 * When the statement is already prepared on the connection and another
 * statement is still in flight, postgres.js 3.4.9 then (reproduced against
 * a real Postgres 16 and in `db-options.test.ts`):
 *  - rejects the in-flight statement, which did nothing wrong, with the
 *    `RangeError`;
 *  - hands the next statement's result to the bad statement;
 *  - hangs every later statement on that connection.
 * Nothing recovers it: `idle_timeout` never fires on a busy connection, and
 * `max_lifetime` waits for the stuck queue to drain. With
 * `HOT_PATH_MAX_CONNECTIONS = 1`, that one connection is the whole
 * isolate's database, so every later tool call on the isolate hits the hard
 * abort. The tools reject unparseable times before binding
 * (`voice-tools/tools/time-args.ts`); this is the backstop for any path
 * that does not.
 *
 * Valid values serialize byte-for-byte as they do today.
 */
export function serializeTimestampParam(value: unknown): string {
  try {
    const date = value instanceof Date ? value : new Date(value as string | number);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // e.g. a Symbol, or an object whose valueOf throws: treated as unparseable.
  }
  return UNPARSEABLE_TIMESTAMP_SENTINEL;
}

/** HOTPATH-REVIEW: postgres.js's built-in `date` type (same `to`/`from`/`parse`
 * as postgres@3.4.9 `src/types.js`) with the non-throwing serializer above.
 * Only the `hot_path` profile sets it. */
export const HOT_PATH_DATE_TYPE: PostgresDateType = {
  to: 1184,
  from: [1082, 1114, 1184],
  serialize: serializeTimestampParam,
  parse: (raw: string) => new Date(raw),
};

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
 *
 * HOTPATH-REVIEW: a single connection also means a single point of
 * failure. A client-side serializer throw poisons the connection (see
 * `serializeTimestampParam`), and with one connection that takes down the
 * whole isolate. That is why the hot path also replaces the date
 * serializer (`HOT_PATH_DATE_TYPE`).
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
  /** QA-1 BE-14: the URL is a Supavisor TRANSACTION-mode pooler (port 6543),
   * not the direct connection: no prepared statements (Supabase: transaction
   * mode does not support them), one connection per isolate (the pooler
   * multiplexes; every extra isolate connection just eats the compute's
   * 60-connection budget) and no startup `statement_timeout` parameter
   * (poolers can reject unknown startup params; only `voice-tools` sets one
   * and it stays on the direct connection). */
  pooled?: boolean;
}): PostgresConnectOptions {
  const hotPath = opts?.profile === "hot_path";
  if (opts?.pooled && !hotPath) {
    return { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 5 };
  }
  const base: PostgresConnectOptions = {
    prepare: true,
    max: hotPath ? HOT_PATH_MAX_CONNECTIONS : 5,
    idle_timeout: 20,
    connect_timeout: 5,
    ...(hotPath ? { types: { date: HOT_PATH_DATE_TYPE } } : {}),
  };
  if (opts?.statementTimeoutMs === undefined) {
    return base;
  }
  return {
    ...base,
    connection: { statement_timeout: opts.statementTimeoutMs },
  };
}

/** QA-1 BE-14: which connection string a profile uses. The hot path
 * (`voice-tools`) ALWAYS stays on the direct `SUPABASE_DB_URL` (prepared
 * statements, one warm connection, no pooler hop on the p95 < 500 ms budget).
 * Every other function uses `SUPABASE_POOLER_URL` (Supavisor transaction
 * mode, port 6543) when the operator has set it, else falls back to the direct
 * URL so nothing changes until the secret exists. */
export function selectDbUrl(
  profile: ConnectionProfile | undefined,
  env: { direct: string | undefined; pooler: string | undefined },
): { url: string | undefined; pooled: boolean } {
  if (profile !== "hot_path" && env.pooler) return { url: env.pooler, pooled: true };
  return { url: env.direct, pooled: false };
}
