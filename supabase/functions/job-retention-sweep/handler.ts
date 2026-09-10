import type { SqlClient } from "../_shared/types.ts";

/**
 * Retention-sweep job (BACKEND_SPEC §8 "Retention sweep", `0 5 * * *`;
 * SYSTEM_DESIGN §9/G3 BIPA-aware recordings retention; E2E_FLOWS_AUDIT H3;
 * docs/audit/FIX_REQUESTS.md's own filed request for this exact function).
 * Deletes Storage objects for any call recording older than that call's
 * OWN TENANT's `tenants.retention_days` (per-tenant, not a platform-wide
 * window — distinct from `fn_cron_internal_retention_sweep`'s platform-wide
 * `webhook_events`/`tool_health` pruning, which is unrelated and already
 * handled elsewhere), then nulls `call_logs.recording_url`/
 * `stereo_recording_url` so the dashboard stops offering a dead link.
 *
 * Age reference is `coalesce(started_at, created_at)` — `started_at` is
 * nullable on `call_logs` (BACKEND_SPEC §1.5) but every row that reaches
 * this query has a recording, which only exists once a call actually
 * started, so this is a defensive fallback, not the expected path.
 *
 * Batched (`BATCH_SIZE`, oldest first) so one run's runtime is bounded even
 * with a large backlog — a tenant whose recordings aren't purged on the
 * exact day retention_days elapses gets purged on the next run instead,
 * matching BACKEND_SPEC §8's own "per-object failure logged, retried next
 * run; never blocks on a single failed delete" tolerance.
 */
const BATCH_SIZE = 200;

export interface PurgeCandidateRow {
  id: string;
  tenant_id: string;
  recording_url: string | null;
  stereo_recording_url: string | null;
}

export async function findRecordingsToPurge(
  sql: SqlClient,
  now: Date,
  limit: number = BATCH_SIZE,
): Promise<PurgeCandidateRow[]> {
  return sql<PurgeCandidateRow>`
    select cl.id, cl.tenant_id, cl.recording_url, cl.stereo_recording_url
    from public.call_logs cl
    join public.tenants t on t.id = cl.tenant_id
    where (cl.recording_url is not null or cl.stereo_recording_url is not null)
      and coalesce(cl.started_at, cl.created_at)
          < ${now.toISOString()}::timestamptz - make_interval(days => t.retention_days)
    order by coalesce(cl.started_at, cl.created_at) asc
    limit ${limit}
  `;
}

/** Strips the `recordings/` prefix stored in the DB column down to the
 * bucket-relative key the Storage REST API expects (matches
 * `worker-recording-fetch/index.ts`'s `uploadToStorage` doing the exact
 * same strip on the way in). */
function toBucketRelativePath(recordingUrl: string): string {
  return recordingUrl.replace(/^recordings\//, "");
}

export interface RetentionSweepDeps {
  /** Bulk-remove by bucket-relative path (Supabase Storage's
   * `DELETE /storage/v1/object/{bucket}` with `{ prefixes }, confirmed
   * against the installed `@supabase/storage-js` v2.116.0 source — see
   * docs/VERIFY.md). Returns false on any failure so the caller retries
   * next run rather than nulling columns for objects that may still exist. */
  removeFromStorage: (paths: string[]) => Promise<boolean>;
}

export async function purgeOneCallRecording(
  sql: SqlClient,
  row: PurgeCandidateRow,
  deps: RetentionSweepDeps,
): Promise<boolean> {
  const paths = [row.recording_url, row.stereo_recording_url]
    .filter((p): p is string => !!p)
    .map(toBucketRelativePath);

  if (paths.length > 0) {
    const ok = await deps.removeFromStorage(paths);
    if (!ok) return false;
  }

  await sql`
    update public.call_logs
    set recording_url = null, stereo_recording_url = null
    where id = ${row.id}
  `;
  return true;
}

export async function runRetentionSweep(
  sql: SqlClient,
  now: Date,
  deps: RetentionSweepDeps,
): Promise<{ purged: number; failed: number; total: number }> {
  const rows = await findRecordingsToPurge(sql, now);
  let purged = 0;
  let failed = 0;
  for (const row of rows) {
    const ok = await purgeOneCallRecording(sql, row, deps);
    if (ok) purged += 1;
    else failed += 1;
  }
  return { purged, failed, total: rows.length };
}
