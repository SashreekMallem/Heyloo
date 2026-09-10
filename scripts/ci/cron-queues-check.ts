/**
 * Cron jobs + pgmq queues integration check (BACKEND_SPEC.md §8/§9,
 * docs/audit/DB_AUDIT.md DB-B2/DB-B3).
 *
 * `supabase db lint` (the migrations-check CI job) only validates schema
 * syntax/plpgsql — it has no notion of "every BACKEND_SPEC §8 job row is
 * actually scheduled" or "every §9 queue actually exists," so a job silently
 * dropped from every migration (as the keep-warm ping was before this fix)
 * passes CI clean. This script asserts against the REAL local Postgres
 * `supabase start` already stood up: every expected `cron.job.jobname` and
 * every expected `pgmq.list_queues()` queue name is present.
 *
 * The HTTP-calling jobs (BACKEND_SPEC §8's `job-*`/`worker-*` rows) only get
 * scheduled once `cron_functions_base_url`/`cron_invoke_secret` exist in
 * Supabase Vault (see `20260910093000_queues_and_scheduled_jobs.sql`'s own
 * guard + docs/DEPLOY.md §3.6) — never true on a fresh local `supabase
 * start` DB. Rather than accept "vault secrets absent" as a reason to skip
 * checking those jobs entirely (which would silently stop catching the
 * exact class of gap this script exists for), this script inserts CI-only
 * dummy secrets and re-applies every migration file that calls
 * `fn_cron_upsert` — safe and idempotent by the migrations' own design
 * (`cron.schedule` upserts by job name, `pgmq.create` is a no-op once a
 * queue exists), and exactly the recovery path docs/DEPLOY.md §3.6 already
 * documents for a real deploy that reaches this state.
 *
 * Dependency-free by the same constraint as
 * scripts/ci/rls-cross-tenant-probe.ts (scripts/ is not part of the pnpm
 * workspace, no new root dependency) — shells out to `psql` (preinstalled
 * on GitHub's ubuntu-latest runners; the CI step also has a cheap
 * `apt-get install` fallback) instead of adding a Postgres client library.
 * Written in erasable-TypeScript syntax only, run via
 * `node --experimental-strip-types scripts/ci/cron-queues-check.ts`.
 *
 * Required env var: SUPABASE_DB_URL (or DB_URL — `supabase status -o env`'s
 * default name for this field, confirmed against the current
 * github.com/supabase/cli source's `status-values.ts`, since supabase.com's
 * docs site itself is egress-blocked from this environment; recorded in
 * docs/VERIFY.md).
 */

import { spawnSync } from "node:child_process";

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

const DB_URL = env("SUPABASE_DB_URL", "DB_URL");

function psql(sql: string): string {
  const result = spawnSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], {
    encoding: "utf-8",
  });
  if (result.error) {
    console.error(`Failed to run psql (is it installed on this runner?): ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`psql exited ${result.status} for:\n${sql}\n--- stderr ---\n${result.stderr}`);
    process.exit(1);
  }
  return result.stdout;
}

function psqlFile(path: string): void {
  const result = spawnSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-f", path], {
    encoding: "utf-8",
  });
  if (result.error) {
    console.error(`Failed to run psql -f ${path}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`psql -f ${path} exited ${result.status}\n--- stderr ---\n${result.stderr}`);
    process.exit(1);
  }
}

function rows(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * BACKEND_SPEC §8's 12 job-table rows, expanded to the ACTUAL job names the
 * migrations schedule (the "queue worker poll" row becomes 3 `worker-*`
 * jobs; "referral qualification + payout batch" becomes 2 jobs) plus the
 * DB-internal jobs that ride the same `cron.job` table
 * (`job-internal-*` — availability roll-forward, usage rollup, the DB-M1
 * webhook_events/tool_health retention sweep, referral qualification).
 * Sourced by grepping every `fn_cron_upsert('<name>'` call site across
 * supabase/migrations/*.sql — keep this list in sync with that grep if a
 * future migration adds/renames a scheduled job.
 */
const EXPECTED_CRON_JOBS: readonly string[] = [
  "job-internal-availability-rollforward",
  "job-internal-usage-rollup",
  "job-internal-retention-sweep",
  "job-internal-referral-qualification",
  "worker-messages-outbound",
  "worker-recording-fetch",
  "worker-adapter-push",
  "job-retell-health-failover",
  "job-alert-evaluation",
  "job-reminder-scheduler",
  "job-review-request",
  "job-billing-cycle",
  "job-reconciliation",
  "job-referral-payouts",
  "job-outreach-personalize",
  "job-outreach-personalize-collect",
  "job-churn-scoring",
  "job-value-email",
  "job-offboarding",
  "job-retention-sweep",
  "job-keep-warm",
];

/** BACKEND_SPEC §9's 4 queues + their DLQ companions (DB-B3). */
const EXPECTED_QUEUES: readonly string[] = [
  "messages_outbound_queue",
  "messages_outbound_queue_dlq",
  "recording_fetch_queue",
  "recording_fetch_queue_dlq",
  "adapter_push_queue",
  "adapter_push_queue_dlq",
  "outreach_send_queue",
  "outreach_send_queue_dlq",
];

/**
 * Migration files (in filename/apply order) whose statements are safe and
 * meaningful to re-run after the CI-only vault secrets are inserted — every
 * file that calls `fn_cron_upsert`. Listed explicitly (rather than grepped
 * at runtime) so this script fails loudly if a new such migration is added
 * without updating it, instead of silently widening what gets re-applied.
 */
const CRON_MIGRATIONS: readonly string[] = [
  "supabase/migrations/20260910093000_queues_and_scheduled_jobs.sql",
  "supabase/migrations/20260910100500_new_job_cron_schedules.sql",
  "supabase/migrations/20260910100600_job_keep_warm_cron_schedule.sql",
];

function main(): void {
  const extensions = rows(
    psql(
      "select extname from pg_extension where extname in ('pg_cron','pgmq','pg_net','supabase_vault') order by extname",
    ),
  );
  const missingExtensions = ["pg_cron", "pgmq", "pg_net", "supabase_vault"].filter(
    (e) => !extensions.includes(e),
  );
  if (missingExtensions.length > 0) {
    console.error(
      `cron-queues-check: required extension(s) not installed on this Postgres: ${missingExtensions.join(", ")} — cannot verify jobs/queues. This is expected only on a plain local Postgres without the Supabase platform image; \`supabase start\`'s own local stack ships all four.`,
    );
    process.exit(1);
  }

  // CI-only dummy Vault secrets so the HTTP-calling jobs' guarded blocks
  // actually schedule instead of skipping — see this file's header comment.
  // Idempotent: only inserted if not already present (e.g. a re-run in the
  // same CI job).
  psql(
    `do $$
     begin
       if not exists (select 1 from vault.decrypted_secrets where name = 'cron_functions_base_url') then
         perform vault.create_secret('http://127.0.0.1:54321/functions/v1', 'cron_functions_base_url');
       end if;
       if not exists (select 1 from vault.decrypted_secrets where name = 'cron_invoke_secret') then
         perform vault.create_secret('ci-dummy-cron-invoke-secret', 'cron_invoke_secret');
       end if;
     end;
     $$;`,
  );

  for (const file of CRON_MIGRATIONS) {
    psqlFile(file);
  }

  const scheduledJobs = rows(psql("select jobname from cron.job order by jobname"));
  const missingJobs = EXPECTED_CRON_JOBS.filter((j) => !scheduledJobs.includes(j));

  const queues = rows(psql("select queue_name from pgmq.list_queues() order by queue_name"));
  const missingQueues = EXPECTED_QUEUES.filter((q) => !queues.includes(q));

  const failures: string[] = [];
  if (missingJobs.length > 0) {
    failures.push(`missing cron.job entries: ${missingJobs.join(", ")}`);
  }
  if (missingQueues.length > 0) {
    failures.push(`missing pgmq queues: ${missingQueues.join(", ")}`);
  }

  if (failures.length > 0) {
    console.error(`\ncron-queues-check FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `\ncron-queues-check PASSED — ${EXPECTED_CRON_JOBS.length} expected cron.job entries and ${EXPECTED_QUEUES.length} expected pgmq queues all present.`,
  );
}

main();
