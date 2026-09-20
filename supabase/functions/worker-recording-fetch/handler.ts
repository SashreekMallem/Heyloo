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
export interface RecordingFetchDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  uploadToStorage: (path: string, bytes: ArrayBuffer, contentType: string) => Promise<boolean>;
  fetchRecordingBytes: (url: string) => Promise<ArrayBuffer | null>;
}

export type RecordingFetchOutcome = "stored" | "not_ready" | "call_not_found" | "upload_failed";

export async function fetchAndStoreRecording(
  sql: SqlClient,
  params: { callId: string; retellCallId: string; tenantId: string },
  deps: RecordingFetchDeps,
): Promise<RecordingFetchOutcome> {
  const callResult = await getCall(deps.retellFetch, deps.retellApiKey, params.retellCallId);
  if (!callResult.ok) return "call_not_found";

  const body = callResult.body as { recording_url?: string; recording_multi_channel_url?: string };
  if (!body.recording_url) return "not_ready";

  const monoBytes = await deps.fetchRecordingBytes(body.recording_url);
  if (!monoBytes) return "not_ready";

  const monoPath = `recordings/${params.tenantId}/${params.callId}.wav`;
  const monoOk = await deps.uploadToStorage(monoPath, monoBytes, "audio/wav");
  if (!monoOk) return "upload_failed";

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

  return "stored";
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
}

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

  for (const row of batch) {
    const { call_id, retell_call_id, attempt } = row.message;
    const tenantRows = await sql<{
      tenant_id: string;
    }>`select tenant_id from public.call_logs where id = ${call_id}`;
    const tenantId = tenantRows[0]?.tenant_id;
    if (!tenantId) {
      await deleteMessage(sql, QUEUE_NAMES.recordingFetch, row.msg_id);
      continue;
    }

    try {
      const outcome = await fetchAndStoreRecording(
        sql,
        { callId: call_id, retellCallId: retell_call_id, tenantId },
        deps,
      );
      if (outcome === "stored") {
        await deleteMessage(sql, QUEUE_NAMES.recordingFetch, row.msg_id);
        stored += 1;
        continue;
      }
      throw new Error(outcome);
    } catch (err) {
      logger.warn("worker_recording_fetch_retry", { error: String(err), call_id, attempt });
      if (attempt + 1 >= RECORDING_FETCH_MAX_ATTEMPTS) {
        await moveToDeadLetter(sql, QUEUE_NAMES.recordingFetch, row.msg_id, row.message);
        logger.error("worker_recording_fetch_exhausted", { call_id, retell_call_id });
        deadLettered += 1;
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
      }
    }
  }

  return {
    stored,
    retried,
    dead_lettered: deadLettered,
    batch_size: batch.length,
    retry_delay_seconds: RECORDING_FETCH_RETRY_DELAY_SECONDS,
  };
}
