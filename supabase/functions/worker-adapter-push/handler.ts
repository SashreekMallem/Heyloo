import type { AdapterPushQueueMsg } from "../_shared/queue.js";
import type { Logger, SqlClient } from "../_shared/types.js";

/**
 * `adapter_push_queue` worker (BACKEND_SPEC §9/§7.6). Adapter dispatch
 * SHELL: registers one pusher function per adapter name; only "pos" exists
 * today and is itself a not-yet-implemented placeholder (Square's real
 * `pushOrder` is Wave-3/T7 scope per packages/adapters/README.md — this
 * task's Square work was `handleWebhook`, the inbound direction, only).
 * Marking `failed` here (never silently succeeding) is what makes the
 * dashboard's "sync failed" banner (BACKEND_SPEC §9) show up correctly once
 * that banner UI exists — the failure is real and visible, not swallowed.
 */
export type AdapterPusher = (sql: SqlClient, msg: AdapterPushQueueMsg) => Promise<boolean>;

export const ADAPTER_PUSHERS: Record<string, AdapterPusher> = {
  // Populated per-adapter in Wave 3 (Shopmonkey, ezyVet, Square, Calendar).
};

export async function pushToAdapter(
  sql: SqlClient,
  msg: AdapterPushQueueMsg,
  logger: Logger,
): Promise<boolean> {
  const pusher = ADAPTER_PUSHERS[msg.adapter];
  if (!pusher) {
    logger.warn("adapter_push_not_implemented", {
      adapter: msg.adapter,
      entity_type: msg.entity_type,
    });
    return false;
  }
  return pusher(sql, msg);
}
