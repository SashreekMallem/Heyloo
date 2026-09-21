import type { SqlClient } from "./types.ts";

/**
 * pgmq queue helpers (BACKEND_SPEC §9). Portable (depends only on
 * `SqlClient`, not the Deno postgres.js client directly) since these are
 * just SQL calls into the `pgmq` extension's own schema-qualified
 * functions.
 *
 * VERIFY follow-up, RESOLVED (OPS-8, docs/BUILD_NOTES.md): this file's own
 * earlier note flagged `pgmq.read`'s arity as possibly version-dependent
 * and unconfirmed — re-checked live against this project's actual
 * `pg_proc` catalog (`pg_get_function_arguments`), not docs summaries.
 * `read(queue_name text, vt integer, qty integer, conditional jsonb
 * DEFAULT '{}'::jsonb)` is the only `read` overload, so the 3-arg call
 * below is unambiguous. `send(queue_name text, msg jsonb)` is likewise the
 * only 2-arg `send` overload. `delete`/`archive`, however, EACH have TWO
 * overloads — `(queue_name text, msg_id bigint)` and `(queue_name text,
 * msg_ids bigint[])` (a batch form) — and calling either with untyped
 * bound parameters (postgres.js's default) is genuinely ambiguous:
 * confirmed live, every `deleteMessage`/`archiveMessage` call failed with
 * `function pgmq.delete(unknown, unknown) is not unique` until the
 * explicit `::text`/`::bigint` casts below were added — this was this
 * task's actual root cause for `recording_fetch_queue` never draining
 * (full story in `docs/BUILD_NOTES.md`'s OPS-8 entry).
 */

export const QUEUE_NAMES = {
  messagesOutbound: "messages_outbound_queue",
  recordingFetch: "recording_fetch_queue",
  adapterPush: "adapter_push_queue",
  outreachSend: "outreach_send_queue",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface MessagesOutboundQueueMsg {
  message_id: string;
}
export interface RecordingFetchQueueMsg {
  call_id: string;
  retell_call_id: string;
  attempt: number;
}
export interface AdapterPushQueueMsg {
  tenant_id: string;
  adapter: string;
  entity_type: "booking" | "order";
  entity_id: string;
  idempotency_key: string;
  attempt: number;
}
export interface OutreachSendQueueMsg {
  lead_id: string;
  campaign_id: string;
  step_index: number;
}

export async function enqueue(sql: SqlClient, queue: QueueName, message: unknown): Promise<void> {
  await sql`select pgmq.send(${queue}, ${message}::jsonb)`;
}

export interface PgmqMessageRow<T> {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: T;
}

export async function readBatch<T>(
  sql: SqlClient,
  queue: QueueName,
  visibilityTimeoutSeconds: number,
  quantity: number,
): Promise<PgmqMessageRow<T>[]> {
  return sql<PgmqMessageRow<T>>`
    select * from pgmq.read(${queue}, ${visibilityTimeoutSeconds}, ${quantity})
  `;
}

/**
 * OPS-8 root cause #2 (docs/BUILD_NOTES.md), found live via a direct
 * `pgmq.delete`/`pgmq.archive` call and confirmed against `pg_proc`: pgmq
 * ships TWO overloads of both `delete` and `archive` —
 * `(queue_name text, msg_id bigint)` and `(queue_name text, msg_ids
 * bigint[])` (a batch form). Postgres.js sends bound parameters untyped by
 * default, so without an explicit cast Postgres cannot pick an overload —
 * every call failed live with `function pgmq.delete(unknown, unknown) is
 * not unique`, on EVERY invocation, 100% of the time (this is the second,
 * independent bug compounding `runRecordingFetchWorker`'s own uncaught-
 * exception bug: even once that loop stopped letting one row's failure
 * strand the batch, every row's delete/archive call was still itself
 * failing here). `readBatch`'s `pgmq.read` and `enqueue`'s `pgmq.send`
 * calls were NOT affected — each has only one same-arity overload (`read`
 * with `(text, integer, integer[, jsonb])`, `send`'s 2-arg form already
 * casts its `jsonb` param explicitly), so Postgres could always resolve
 * those without ambiguity. The explicit `::text`/`::bigint` casts below
 * are the fix — they pick the scalar overload unambiguously. */
export async function deleteMessage(
  sql: SqlClient,
  queue: QueueName,
  msgId: number,
): Promise<void> {
  await sql`select pgmq.delete(${queue}::text, ${msgId}::bigint)`;
}

export async function archiveMessage(
  sql: SqlClient,
  queue: QueueName,
  msgId: number,
): Promise<void> {
  await sql`select pgmq.archive(${queue}::text, ${msgId}::bigint)`;
}

/** Dead-letter: move an exhausted message's payload into the queue's `_dlq`
 * companion queue (pgmq has no native DLQ primitive — BACKEND_SPEC §9) then
 * delete/archive it off the source queue.
 *
 * `reason` (OPS-8, docs/BUILD_NOTES.md) is REQUIRED, not optional — every
 * dead-lettered message must carry a human-readable explanation of why it
 * was exhausted (`max_attempts_exceeded:<last error>`,
 * `provider_not_configured`, etc.) so an admin reading the `_dlq` queue
 * (or `pgmq.metrics_all()`'s length for it) never has to guess. The
 * original message body is nested under `message` so nothing about its
 * own shape is lost; `dead_lettered_at` records when the move happened,
 * independent of the message's own `enqueued_at`. */
export async function moveToDeadLetter(
  sql: SqlClient,
  queue: QueueName,
  msgId: number,
  message: unknown,
  reason: string,
): Promise<void> {
  await sql`
    select pgmq.send(${`${queue}_dlq`}, ${{
      reason,
      dead_lettered_at: new Date().toISOString(),
      message,
    }}::jsonb)
  `;
  await archiveMessage(sql, queue, msgId);
}

export interface QueueMetricsRow {
  queue_name: string;
  queue_length: number;
  newest_msg_age_sec: number | null;
  oldest_msg_age_sec: number | null;
  total_messages: number;
  queue_visible_length: number;
}

/** `pgmq.metrics_all()` — one row per queue (including every `_dlq`
 * companion), used by `worker-tick`'s response and the
 * `admin-cockpit/queues` read (OPS-8) so backlog/DLQ depth is visible
 * without a direct DB query. */
export async function metricsAll(sql: SqlClient): Promise<QueueMetricsRow[]> {
  return sql<QueueMetricsRow>`select * from pgmq.metrics_all() order by queue_name`;
}
