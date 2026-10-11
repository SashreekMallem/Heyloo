import { enqueue, QUEUE_NAMES } from "../queue.ts";
import type { Logger, SqlClient } from "../types.ts";

/** TRIAL-1 owner emails, rendered by `_shared/templates.ts`. */
export type TrialEmailTemplate = "trial_will_end" | "trial_minutes_used";

/**
 * Queues a free-trial email to the tenant's owner (their sign-in email, the
 * same recipient as the dunning email in webhooks-stripe). At most one per
 * tenant and template ever: a tenant has one trial, and Stripe, the cap and
 * the webhook can deliver the same trigger twice, even at the same moment.
 * The `not exists` skips the usual repeat; the partial unique index
 * `messages_outbound_trial_email_once` (migration 20261011120100) makes a
 * concurrent second insert a no-op. Returns the message id, or null when it
 * was already queued or the owner has no email.
 *
 * The row is pushed onto the messages queue right away; if that push fails
 * the row still exists and the outbound worker's stranded-row sweep sends it.
 */
export async function enqueueTrialOwnerEmail(
  sql: SqlClient,
  logger: Logger,
  input: { tenantId: string; template: TrialEmailTemplate; payload: Record<string, unknown> },
): Promise<string | null> {
  const rows = await sql<{ id: string }>`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload)
    select ${input.tenantId}, 'email', u.email, ${input.template}, ${input.payload}::jsonb
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.tenant_id = ${input.tenantId} and m.role = 'owner' and u.email is not null
      and not exists (
        select 1 from public.messages_outbound mo
        where mo.tenant_id = ${input.tenantId} and mo.template_key = ${input.template}
      )
    order by m.created_at
    limit 1
    on conflict (tenant_id, template_key)
      where template_key in ('trial_will_end', 'trial_minutes_used') and parent_message_id is null
      do nothing
    returning id
  `;
  const id = rows[0]?.id ?? null;
  if (!id) return null;
  try {
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: id });
  } catch (err) {
    logger.warn("trial_email_enqueue_failed", {
      tenant_id: input.tenantId,
      template: input.template,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return id;
}
