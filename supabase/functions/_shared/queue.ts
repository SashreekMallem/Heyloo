import type { SqlClient } from "./types.js";

/**
 * pgmq queue helpers (BACKEND_SPEC §9). Portable (depends only on
 * `SqlClient`, not the Deno postgres.js client directly) since these are
 * just SQL calls into the `pgmq` extension's own schema-qualified functions
 * — VERIFY (docs/VERIFY.md): confirm `pgmq.send`/`pgmq.read`/`pgmq.delete`/
 * `pgmq.archive` exact signatures against the pgmq version Supabase ships
 * (egress-blocked here; reconstructed from pgmq's public GitHub docs/
 * changelog summaries — `pgmq.send(queue_name text, msg jsonb, delay int
 * default 0) returns setof bigint` is the confirmed-stable core signature;
 * `pgmq.read`'s signature reportedly changed to take a 4th `jsonb`
 * conditional-filter arg across versions, so `read`/`pop` below are called
 * with only the historically-stable 3-arg form and should be re-verified).
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
  await sql`select pgmq.send(${queue}, ${JSON.stringify(message)}::jsonb)`;
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

export async function deleteMessage(
  sql: SqlClient,
  queue: QueueName,
  msgId: number,
): Promise<void> {
  await sql`select pgmq.delete(${queue}, ${msgId})`;
}

export async function archiveMessage(
  sql: SqlClient,
  queue: QueueName,
  msgId: number,
): Promise<void> {
  await sql`select pgmq.archive(${queue}, ${msgId})`;
}

/** Dead-letter: move an exhausted message's payload into the queue's `_dlq`
 * companion queue (pgmq has no native DLQ primitive — BACKEND_SPEC §9) then
 * delete/archive it off the source queue. */
export async function moveToDeadLetter(
  sql: SqlClient,
  queue: QueueName,
  msgId: number,
  message: unknown,
): Promise<void> {
  await sql`select pgmq.send(${`${queue}_dlq`}, ${JSON.stringify(message)}::jsonb)`;
  await archiveMessage(sql, queue, msgId);
}
