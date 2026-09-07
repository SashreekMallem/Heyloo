import { enqueue, QUEUE_NAMES } from "../_shared/queue.js";
import type { SqlClient } from "../_shared/types.js";

/**
 * `review_request` job (MASTER_SPEC §3.9, optional/default-off per tenant):
 * booking `completed` +2h -> SMS with `tenants.review_url`; respects
 * `sms_opt_out`; capped one per customer per 90 days.
 *
 * Reads `tenants.review_url` + `tenants.review_request_enabled` (T1's
 * `20260907130100_tenancy.sql`, confirmed against the actual migration —
 * MASTER_SPEC §3.9/§3.10 names the first directly and only describes the
 * second as "a tenant toggle" without a column name).
 */
export interface ReviewCandidateRow {
  booking_id: string;
  tenant_id: string;
  customer_id: string;
  customer_phone: string;
  review_url: string;
}

export async function findReviewCandidates(
  sql: SqlClient,
  now: Date,
): Promise<ReviewCandidateRow[]> {
  return sql<ReviewCandidateRow>`
    select
      b.id as booking_id, b.tenant_id, b.customer_id, c.phone_e164 as customer_phone, t.review_url
    from public.bookings b
    join public.tenants t on t.id = b.tenant_id
    join public.customers c on c.id = b.customer_id
    where b.status = 'completed'
      and coalesce(t.review_request_enabled, false) = true
      and t.review_url is not null
      and c.sms_opt_out = false
      and b.updated_at between ${now.toISOString()}::timestamptz - interval '3 hours'
                            and ${now.toISOString()}::timestamptz - interval '2 hours'
      and not exists (
        select 1 from public.messages_outbound mo
        where mo.related_booking_id = b.id and mo.template_key = 'review_request'
      )
      and not exists (
        select 1 from public.messages_outbound mo2
        where mo2.tenant_id = b.tenant_id
          and mo2.template_key = 'review_request'
          and mo2.payload->>'customer_id' = b.customer_id::text
          and mo2.created_at > now() - interval '90 days'
      )
  `;
}

export async function sendOneReviewRequest(
  sql: SqlClient,
  row: ReviewCandidateRow,
): Promise<boolean> {
  const inserted = await sql<{ id: string }>`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload, related_booking_id)
    values (
      ${row.tenant_id}, 'sms', ${row.customer_phone}, 'review_request',
      ${JSON.stringify({ review_url: row.review_url, customer_id: row.customer_id })}::jsonb, ${row.booking_id}
    )
    returning id
  `;
  const message = inserted[0];
  if (!message) return false;
  await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
  return true;
}
