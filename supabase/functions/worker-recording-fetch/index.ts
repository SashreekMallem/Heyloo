// Deno entrypoint (excluded from ../tsconfig.json). Invoked by the pg_cron
// "Queue worker poll" job (BACKEND_SPEC §8, every minute).
import { timingSafeEqual } from "../_shared/crypto.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import type { RecordingFetchQueueMsg } from "../_shared/queue.js";
import {
  deleteMessage,
  enqueue,
  moveToDeadLetter,
  QUEUE_NAMES,
  readBatch,
} from "../_shared/queue.js";
import { jsonResponse } from "../_shared/responses.js";
import { fetchAndStoreRecording } from "./handler.js";

const logger = createLogger({ fn: "worker-recording-fetch" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SECRET_KEY = requireEnv("SUPABASE_SECRET_KEY");

const VISIBILITY_TIMEOUT_SECONDS = 60;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 8; // BACKEND_SPEC §9 — spread to stay within Retell's <10min window.
const RETRY_DELAY_SECONDS = 60;

async function uploadToStorage(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/recordings/${encodeURI(path.replace(/^recordings\//, ""))}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        "content-type": contentType,
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  return res.ok;
}

async function fetchRecordingBytes(url: string): Promise<ArrayBuffer | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.arrayBuffer();
}

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const batch = await readBatch<RecordingFetchQueueMsg>(
    sql,
    QUEUE_NAMES.recordingFetch,
    VISIBILITY_TIMEOUT_SECONDS,
    BATCH_SIZE,
  );

  const deps = {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    uploadToStorage,
    fetchRecordingBytes,
  };

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
      if (attempt + 1 >= MAX_ATTEMPTS) {
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
        // `RETRY_DELAY_SECONDS` documents the intent for a future
        // `enqueue(..., delaySeconds)` overload.
        retried += 1;
      }
    }
  }

  return jsonResponse({
    stored,
    retried,
    dead_lettered: deadLettered,
    batch_size: batch.length,
    retry_delay_seconds: RETRY_DELAY_SECONDS,
  });
});
