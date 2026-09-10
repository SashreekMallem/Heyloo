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
}): PostgresConnectOptions {
  const base: PostgresConnectOptions = {
    prepare: true,
    max: 5,
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
