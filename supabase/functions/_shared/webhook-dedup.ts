import type { SqlClient } from "./types.ts";

/**
 * The idempotent-insert gate every webhook handler must write to before any
 * side effect (CLAUDE.md Rule 2, BACKEND_SPEC §1.5 `webhook_events`, unique
 * `(source, event_id)`). Returns `{ isNew: true }` the first time an event
 * id is seen; a retried delivery of the same event returns `{ isNew: false }`
 * and the caller fast-acks with no further work — this is also what makes
 * out-of-order/duplicate Retell delivery safe (BACKEND_SPEC §7.3).
 */
export interface WebhookDedupResult {
  isNew: boolean;
  webhookEventId?: string;
}

export async function insertWebhookEventIfNew(
  sql: SqlClient,
  params: {
    source: string;
    eventId: string;
    eventType: string;
    payload: unknown;
    signatureVerified: boolean;
  },
): Promise<WebhookDedupResult> {
  const { source, eventId, eventType, payload, signatureVerified } = params;
  const rows = await sql<{ id: string }>`
    insert into public.webhook_events (source, event_id, event_type, payload, signature_verified)
    values (${source}, ${eventId}, ${eventType}, ${JSON.stringify(payload)}::jsonb, ${signatureVerified})
    on conflict (source, event_id) do nothing
    returning id
  `;
  const first = rows[0];
  if (!first) return { isNew: false };
  return { isNew: true, webhookEventId: first.id };
}

export async function markWebhookEventProcessed(
  sql: SqlClient,
  webhookEventId: string,
  error?: string,
): Promise<void> {
  await sql`
    update public.webhook_events
    set processed_at = now(), processing_error = ${error ?? null}
    where id = ${webhookEventId}
  `;
}
