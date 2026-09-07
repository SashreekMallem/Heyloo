// Deno entrypoint (excluded from ../tsconfig.json). Invoked by the pg_cron
// "Queue worker poll" job (BACKEND_SPEC §8, every minute).
import { timingSafeEqual } from "../_shared/crypto.js";
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import type { AdapterPushQueueMsg } from "../_shared/queue.js";
import {
  deleteMessage,
  enqueue,
  moveToDeadLetter,
  QUEUE_NAMES,
  readBatch,
} from "../_shared/queue.js";
import { jsonResponse } from "../_shared/responses.js";
import { pushToAdapter } from "./handler.js";

const logger = createLogger({ fn: "worker-adapter-push" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
const VISIBILITY_TIMEOUT_SECONDS = 45;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 6; // BACKEND_SPEC §9

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const batch = await readBatch<AdapterPushQueueMsg>(
    sql,
    QUEUE_NAMES.adapterPush,
    VISIBILITY_TIMEOUT_SECONDS,
    BATCH_SIZE,
  );

  let pushed = 0;
  let deadLettered = 0;

  for (const row of batch) {
    const msg = row.message;
    const ok = await pushToAdapter(sql, msg, logger);
    if (ok) {
      await deleteMessage(sql, QUEUE_NAMES.adapterPush, row.msg_id);
      pushed += 1;
      continue;
    }

    if (msg.attempt + 1 >= MAX_ATTEMPTS) {
      await moveToDeadLetter(sql, QUEUE_NAMES.adapterPush, row.msg_id, msg);
      logger.error("worker_adapter_push_exhausted", {
        tenant_id: msg.tenant_id,
        adapter: msg.adapter,
        entity_id: msg.entity_id,
      });
      deadLettered += 1;
      // T7 TODO: once a dashboard "sync failed" banner surface exists, flip
      // a per-entity sync-status flag here so it renders (BACKEND_SPEC §9).
    } else {
      await deleteMessage(sql, QUEUE_NAMES.adapterPush, row.msg_id);
      await enqueue(sql, QUEUE_NAMES.adapterPush, {
        ...msg,
        attempt: msg.attempt + 1,
      } satisfies AdapterPushQueueMsg);
    }
  }

  return jsonResponse({ pushed, dead_lettered: deadLettered, batch_size: batch.length });
});
