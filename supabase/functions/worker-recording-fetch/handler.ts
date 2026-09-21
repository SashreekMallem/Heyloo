import type { RetellFetch } from "../_shared/providers/retell.ts";
import { getCall } from "../_shared/providers/retell.ts";
import type { RecordingFetchQueueMsg } from "../_shared/queue.ts";
import {
  deleteMessage,
  enqueue,
  moveToDeadLetter,
  QUEUE_NAMES,
  readBatch,
} from "../_shared/queue.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `recording_fetch_queue` worker (BACKEND_SPEC §9/§7.3). Recordings must be
 * pulled within Retell's <10-minute availability window — the queue's own
 * visibility-timeout/attempt budget (index.ts) is what enforces that, not
 * this function. Storage upload is injected as `uploadToStorage` (a Deno
 * `fetch` call to the Storage REST API) so this file stays portable/
 * testable without a real Supabase project.
 */
/** `detail` (OPS-8): the Storage REST API's own status/body on a failed
 * upload, so `fetchAndStoreRecording`'s `upload_failed` outcome — and, in
 * turn, `runRecordingFetchWorker`'s `row_outcomes.reason` — carries the
 * ACTUAL reason (auth, bucket, payload) instead of a bare boolean. This is
 * what surfaced this task's third root cause live (`docs/BUILD_NOTES.md`
 * OPS-8): Storage rejecting the new-format `sb_secret_...` key on the
 * `authorization: Bearer` header with `Invalid Compact JWS`, since Storage
 * still expects a legacy service_role JWT there. */
export interface UploadResult {
  ok: boolean;
  detail?: string;
}

export interface RecordingFetchDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  uploadToStorage: (path: string, bytes: ArrayBuffer, contentType: string) => Promise<UploadResult>;
  fetchRecordingBytes: (url: string) => Promise<ArrayBuffer | null>;
}

export type RecordingFetchOutcome = "stored" | "not_ready" | "call_not_found" | "upload_failed";

export async function fetchAndStoreRecording(
  sql: SqlClient,
  params: { callId: string; retellCallId: string; tenantId: string },
  deps: RecordingFetchDeps,
): Promise<{ outcome: RecordingFetchOutcome; detail?: string }> {
  const callResult = await getCall(deps.retellFetch, deps.retellApiKey, params.retellCallId);
  if (!callResult.ok) return { outcome: "call_not_found" };

  const body = callResult.body as { recording_url?: string; recording_multi_channel_url?: string };
  if (!body.recording_url) return { outcome: "not_ready" };

  const monoBytes = await deps.fetchRecordingBytes(body.recording_url);
  if (!monoBytes) return { outcome: "not_ready" };

  const monoPath = `recordings/${params.tenantId}/${params.callId}.wav`;
  const monoUpload = await deps.uploadToStorage(monoPath, monoBytes, "audio/wav");
  if (!monoUpload.ok) {
    return monoUpload.detail
      ? { outcome: "upload_failed", detail: monoUpload.detail }
      : { outcome: "upload_failed" };
  }

  let stereoPath: string | null = null;
  if (body.recording_multi_channel_url) {
    const stereoBytes = await deps.fetchRecordingBytes(body.recording_multi_channel_url);
    if (stereoBytes) {
      stereoPath = `recordings/${params.tenantId}/${params.callId}_stereo.wav`;
      await deps.uploadToStorage(stereoPath, stereoBytes, "audio/wav");
    }
  }

  await sql`
    update public.call_logs
    set recording_url = ${monoPath}, stereo_recording_url = ${stereoPath}
    where id = ${params.callId}
  `;

  return { outcome: "stored" };
}

// ---------------------------------------------------------------------------
// Batch-poll entry point (OPS-3, docs/BUILD_NOTES.md) — see
// worker-messages-outbound/handler.ts's identical-purpose comment. Moved
// out of `index.ts` so `worker-tick/handler.ts` can invoke this queue's
// poll in-process alongside the other two workers.
// ---------------------------------------------------------------------------

export const RECORDING_FETCH_VISIBILITY_TIMEOUT_SECONDS = 60;
export const RECORDING_FETCH_BATCH_SIZE = 20;
export const RECORDING_FETCH_MAX_ATTEMPTS = 8; // BACKEND_SPEC §9 — spread to stay within Retell's <10min window.
export const RECORDING_FETCH_RETRY_DELAY_SECONDS = 60;

export interface RunRecordingFetchWorkerResult {
  stored: number;
  retried: number;
  dead_lettered: number;
  batch_size: number;
  retry_delay_seconds: number;
  /** One entry per row that didn't get stored this tick (retried OR
   * dead-lettered), with its reason — so a caller reading this response
   * directly (an ops curl, `worker-tick`'s own response/`admin-cockpit/
   * queues`) can see WHY without cross-referencing logs (edge logs were
   * unreliable enough during this task's own live debugging — OPS-8,
   * docs/BUILD_NOTES.md — that this response body was the only reliable
   * evidence channel). Optional/omitted when empty so existing fixtures/
   * mocks of this result shape don't all need updating for a field they
   * don't exercise. */
  row_outcomes?: {
    msg_id: number;
    call_id: string;
    outcome: "retried" | "dead_lettered" | "row_fatal";
    reason: string;
  }[];
}

/**
 * OPS-8 (docs/BUILD_NOTES.md) — two independent, compounding root causes
 * were found live, both fixed here:
 *
 * 1. The `tenantRows` lookup used to run OUTSIDE this function's
 *    try/catch, and the retry/dead-letter writes lived in a catch block
 *    with no protection of their own. An exception at EITHER point
 *    propagated straight out of this `for` loop, aborting the whole batch
 *    mid-iteration. `pgmq.read` had already bumped every row's `read_ct`
 *    for the tick before the loop started, so the symptom was every
 *    message in the batch re-readable and climbing forever (measured
 *    live: read_ct 470+) while NONE of them ever got deleted, retried, or
 *    dead-lettered (`attempt` frozen at its original value forever).
 *    Fixed: every row's ENTIRE processing now lives inside one try/catch,
 *    and the catch's own retry/dead-letter writes are wrapped in a
 *    second, inner try/catch.
 * 2. Even AFTER fix 1 stopped one row's failure from stranding the batch,
 *    every row still failed to progress — `row_outcomes` (added for this
 *    live debugging session, kept permanently for ops visibility since
 *    edge-log queries were unreliable throughout) surfaced the real
 *    reason: `_shared/queue.ts#deleteMessage`/`archiveMessage` called
 *    `pgmq.delete`/`pgmq.archive` with UNTYPED bound parameters, and pgmq
 *    ships two overloads of each (`(text, bigint)` and `(text,
 *    bigint[])`) — Postgres couldn't resolve which one to call
 *    (`function pgmq.delete(unknown, unknown) is not unique`), on every
 *    single invocation, 100% of the time. Fixed with explicit `::text`/
 *    `::bigint` casts in `queue.ts` (full detail in that file's own
 *    comment on those two functions) — this was the actual reason no
 *    message had EVER been deleted, retried past attempt 0, or
 *    dead-lettered by this worker, going back to whenever pgmq gained
 *    the array-batch overload on this project.
 */
export async function runRecordingFetchWorker(
  sql: SqlClient,
  deps: RecordingFetchDeps,
  logger: Logger,
): Promise<RunRecordingFetchWorkerResult> {
  const batch = await readBatch<RecordingFetchQueueMsg>(
    sql,
    QUEUE_NAMES.recordingFetch,
    RECORDING_FETCH_VISIBILITY_TIMEOUT_SECONDS,
    RECORDING_FETCH_BATCH_SIZE,
  );

  let stored = 0;
  let deadLettered = 0;
  let retried = 0;
  const rowOutcomes: NonNullable<RunRecordingFetchWorkerResult["row_outcomes"]> = [];

  for (const row of batch) {
    const { call_id, retell_call_id, attempt } = row.message;

    try {
      const tenantRows = await sql<{
        tenant_id: string;
      }>`select tenant_id from public.call_logs where id = ${call_id}`;
      const tenantId = tenantRows[0]?.tenant_id;
      if (!tenantId) {
        await deleteMessage(sql, QUEUE_NAMES.recordingFetch, row.msg_id);
        continue;
      }

      const { outcome, detail } = await fetchAndStoreRecording(
        sql,
        { callId: call_id, retellCallId: retell_call_id, tenantId },
        deps,
      );
      if (outcome === "stored") {
        await deleteMessage(sql, QUEUE_NAMES.recordingFetch, row.msg_id);
        stored += 1;
        continue;
      }
      throw new Error(detail ? `${outcome}:${detail}` : outcome);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("worker_recording_fetch_retry", { error: reason, call_id, attempt });
      try {
        if (attempt + 1 >= RECORDING_FETCH_MAX_ATTEMPTS) {
          await moveToDeadLetter(
            sql,
            QUEUE_NAMES.recordingFetch,
            row.msg_id,
            row.message,
            `max_attempts_exceeded:${reason}`,
          );
          logger.error("worker_recording_fetch_exhausted", { call_id, retell_call_id, reason });
          deadLettered += 1;
          rowOutcomes.push({ msg_id: row.msg_id, call_id, outcome: "dead_lettered", reason });
        } else {
          await deleteMessage(sql, QUEUE_NAMES.recordingFetch, row.msg_id);
          await enqueue(sql, QUEUE_NAMES.recordingFetch, {
            call_id,
            retell_call_id,
            attempt: attempt + 1,
          } satisfies RecordingFetchQueueMsg);
          // A fixed re-visibility delay isn't expressible via pgmq.send's
          // `delay` param through this queue.ts helper's current signature —
          // the next cron cycle (1 min) provides the retry cadence instead;
          // `RECORDING_FETCH_RETRY_DELAY_SECONDS` documents the intent for a
          // future `enqueue(..., delaySeconds)` overload.
          retried += 1;
          rowOutcomes.push({ msg_id: row.msg_id, call_id, outcome: "retried", reason });
        }
      } catch (retryErr) {
        // Could not even record the retry/dead-letter (e.g. a transient DB
        // blip on the delete/enqueue/archive calls themselves) — logged and
        // left on the queue rather than crashing the rest of the batch;
        // the message becomes visible again after its visibility timeout
        // for the next tick to try again.
        const retryErrMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
        logger.error("worker_recording_fetch_row_fatal", {
          call_id,
          retell_call_id,
          msg_id: row.msg_id,
          error: retryErrMessage,
        });
        rowOutcomes.push({
          msg_id: row.msg_id,
          call_id,
          outcome: "row_fatal",
          reason: retryErrMessage,
        });
      }
    }
  }

  return {
    stored,
    retried,
    dead_lettered: deadLettered,
    batch_size: batch.length,
    retry_delay_seconds: RECORDING_FETCH_RETRY_DELAY_SECONDS,
    ...(rowOutcomes.length > 0 ? { row_outcomes: rowOutcomes } : {}),
  };
}
