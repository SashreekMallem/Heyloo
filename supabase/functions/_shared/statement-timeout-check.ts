/**
 * CI integration check for EDGE_AUDIT M2 / this file's siblings
 * (`db-options.ts`, `deno/db.ts`): pins postgres.js's
 * `connection: { statement_timeout }` startup-packet GUC against a REAL
 * local Postgres — the `migrations-check` CI job's own `supabase start` —
 * rather than relying solely on `deno/db.ts`'s docstring citation of
 * postgres.js's README (docs/BUILD_NOTES.md's M2 entry, before this file
 * existed, explicitly admitted that gap).
 *
 * Demonstrates the actual repair claim end to end:
 *   1. connect with `connection: { statement_timeout: 500 }` — the exact
 *      shape `buildConnectionOptions({ statementTimeoutMs: 500 })` produces;
 *   2. issue `select pg_sleep(2)` and assert Postgres itself cancels it
 *      (SQLSTATE 57014 `query_canceled`) well under the full 2s sleep;
 *   3. issue a trivial `select 1` on the SAME client afterward and assert
 *      it still works — the actual "pool cannot be exhausted" claim (the
 *      slot was freed and the connection left usable, not broken/leaked).
 *
 * Not a Vitest test file (deliberately not named `*.test.ts`, so a normal
 * `pnpm test`/`vitest run` — which has no live Postgres — never picks it
 * up): it needs a real server enforcing a real GUC, which is exactly what
 * `psql`/`select 1`-style unit tests cannot exercise. Uses the real
 * `postgres` npm package (pinned to 3.4.9 — same version as
 * `supabase/functions/deno.json`'s import map and this package's own
 * devDependency) so it resolves via ordinary Node module resolution when
 * run directly with `node --experimental-strip-types`, unlike
 * `scripts/ci/cron-queues-check.ts`'s `psql`-shelling approach (which has no
 * equivalent of postgres.js's `connection` constructor option and so cannot
 * pin this specific piece of wiring).
 *
 * Required env var: SUPABASE_DB_URL (or DB_URL — `supabase status -o env`'s
 * name for this field; see scripts/ci/cron-queues-check.ts's header for why).
 *
 * Run: node --experimental-strip-types
 * supabase/functions/_shared/statement-timeout-check.ts
 */
import postgres from "postgres";
import { buildConnectionOptions } from "./db-options.ts";

function env(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const v = process.env[key];
    if (v) return v;
  }
  console.error(
    `Missing required env var ${name} (also checked fallbacks: ${fallbacks.join(", ")})`,
  );
  process.exit(1);
}

function isPostgresError(err: unknown): err is { code?: string; message?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

async function main(): Promise<void> {
  const dbUrl = env("SUPABASE_DB_URL", "DB_URL");
  const sql = postgres(dbUrl, buildConnectionOptions({ statementTimeoutMs: 500 }));

  try {
    const startedAt = Date.now();
    let cancelCode: string | undefined;
    try {
      await sql`select pg_sleep(2)`;
    } catch (err) {
      cancelCode = isPostgresError(err) ? err.code : undefined;
      if (cancelCode === undefined) {
        throw new Error(
          `statement-timeout-check FAILED: pg_sleep(2) rejected with a non-Postgres error: ${String(err)}`,
        );
      }
    }
    const elapsedMs = Date.now() - startedAt;

    if (cancelCode === undefined) {
      throw new Error(
        "statement-timeout-check FAILED: select pg_sleep(2) completed instead of being canceled by statement_timeout=500ms.",
      );
    }
    if (cancelCode !== "57014") {
      throw new Error(
        `statement-timeout-check FAILED: expected Postgres SQLSTATE 57014 (query_canceled), got ${cancelCode}.`,
      );
    }
    if (elapsedMs >= 2_000) {
      throw new Error(
        `statement-timeout-check FAILED: cancellation took ${elapsedMs}ms — not well under the full 2000ms pg_sleep, statement_timeout does not appear to be enforced.`,
      );
    }

    const rows = await sql`select 1 as one`;
    const first: unknown = rows[0];
    const stillUsable =
      typeof first === "object" && first !== null && (first as { one?: unknown }).one === 1;
    if (!stillUsable) {
      throw new Error(
        "statement-timeout-check FAILED: select 1 after cancellation did not return the expected row — connection left unusable/leaked.",
      );
    }

    console.log(
      `statement-timeout-check PASSED — pg_sleep(2) canceled (57014) in ${elapsedMs}ms under statement_timeout=500ms, and the same connection served select 1 afterward (pool slot freed, not leaked).`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
