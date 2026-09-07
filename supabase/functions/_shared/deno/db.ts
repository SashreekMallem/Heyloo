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
import type { SqlClient } from "../types.js";
import { requireEnv } from "./env.js";

let client: ReturnType<typeof postgres> | undefined;

/** Lazily constructs the module-scope client on first use within a warm
 * instance, then reuses it for the lifetime of that instance — this is what
 * makes prepared-statement reuse and connection-pool warmth actually pay
 * off across invocations (SYSTEM_DESIGN §5). */
export function getSql(): SqlClient {
  if (!client) {
    client = postgres(requireEnv("SUPABASE_DB_URL"), {
      // Session-mode pooler: prepared statements persist for the
      // connection's lifetime, unlike PgBouncer transaction mode.
      prepare: true,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 5,
    });
  }
  return client as unknown as SqlClient;
}
