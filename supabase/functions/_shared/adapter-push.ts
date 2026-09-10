import type { AdapterPushQueueMsg } from "./queue.ts";
import { enqueue, QUEUE_NAMES } from "./queue.ts";
import type { SqlClient } from "./types.ts";

/**
 * E2E_FLOWS_AUDIT B4 fix (producer side): the booking/order voice tools
 * (`create_booking`, `update_booking`, `cancel_booking`, `create_order`)
 * enqueue a real `adapter_push_queue` entry per entity here, instead of
 * either never enqueueing at all (booking tools, before this fix) or
 * enqueueing a literal `adapter: "pos"` that matches no key in
 * `worker-adapter-push/handler.ts`'s `ADAPTER_PUSHERS` map (`create_order`'s
 * prior bug — every message it ever sent silently hit
 * `adapter_push_not_implemented`).
 *
 * The message shape (`AdapterPushQueueMsg`) is unchanged — this only fixes
 * WHO the producer addresses it to: the tenant's own actually-connected
 * `adapter_connections.provider` row(s), which is also exactly what
 * `pushToAdapter`'s `ADAPTER_PUSHERS` lookup keys off of. A tenant with no
 * connected adapter (the common case — most tenants never connect one)
 * enqueues nothing, matching BACKEND_SPEC §7.6's "no/disconnected
 * connection -> never push" contract without the queue ever seeing a
 * message for it in the first place.
 */

const BOOKING_CAPABLE_PROVIDERS = new Set([
  "shopmonkey",
  "ezyvet",
  "google_calendar",
  "square",
  "airtable",
]);
const ORDER_CAPABLE_PROVIDERS = new Set(["square", "airtable"]);

export interface EnqueueAdapterPushParams {
  tenantId: string;
  entityType: "booking" | "order";
  entityId: string;
  idempotencyKey: string;
}

/** Enqueues one `adapter_push_queue` message per tenant-connected adapter
 * that supports this entity type. Returns the number of messages enqueued
 * (0 when the tenant has no matching connected adapter — never an error). */
export async function enqueueAdapterPush(
  sql: SqlClient,
  params: EnqueueAdapterPushParams,
): Promise<number> {
  const supported =
    params.entityType === "booking" ? BOOKING_CAPABLE_PROVIDERS : ORDER_CAPABLE_PROVIDERS;

  const connections = await sql<{ provider: string }>`
    select provider from public.adapter_connections
    where tenant_id = ${params.tenantId} and status = 'connected'
  `;

  let enqueued = 0;
  for (const { provider } of connections) {
    if (!supported.has(provider)) continue;
    const msg: AdapterPushQueueMsg = {
      tenant_id: params.tenantId,
      adapter: provider,
      entity_type: params.entityType,
      entity_id: params.entityId,
      idempotency_key: params.idempotencyKey,
      attempt: 0,
    };
    await enqueue(sql, QUEUE_NAMES.adapterPush, msg);
    enqueued += 1;
  }
  return enqueued;
}
