import { enqueue, QUEUE_NAMES } from "../_shared/queue.ts";
import type { SqlClient } from "../_shared/types.ts";

/**
 * Weekly value-email job (BACKEND_SPEC §8 "Weekly value emails",
 * `0 14 * * 1` Monday 14:00 UTC; MASTER_SPEC §3.8 "feeds weekly value email
 * '~$X saved'"; E2E_FLOWS_AUDIT H3/M3). Sends each active tenant's owner a
 * "here's what your AI did this week" summary: calls answered, bookings
 * captured, and `avg_transaction_value_cents × bookings_captured` framed as
 * "~$X saved" (the tenant's own configured average ticket value, MASTER_SPEC
 * §3.8, times bookings the AI captured this week — a proxy for revenue the
 * tenant would otherwise have had to staff a receptionist to capture).
 *
 * "Respects notification prefs" (task brief): the ONLY per-tenant email-
 * notification-preference surface in this codebase today is
 * `packages/canonical-types/src/schemas/delivery-preferences.ts`
 * (`sms_enabled`/`email_enabled`/`notification_email`) — confirmed by repo-
 * wide grep to have ZERO persistence call sites anywhere (no column, no
 * table, no reader/writer), so there is nothing real to gate on yet
 * (docs/BUILD_NOTES.md CLUSTER-F entry). This job instead respects the one
 * real, already-enforced business gate available: only `status = 'active'`
 * tenants (a trialing/past_due/paused/canceled tenant isn't a live customer
 * to congratulate) receive the email, exactly mirroring the recipient-
 * resolution pattern `webhooks-stripe`'s `invoice.payment_failed` handler
 * already uses (owner membership -> `auth.users.email`) rather than
 * inventing a second one.
 *
 * Sends via the existing `messages_outbound`/`messages_outbound_queue`
 * pipeline (channel `email`, template_key `weekly_value_summary`) so
 * `worker-messages-outbound` does the actual Resend send — this job's own
 * job is choosing WHO gets one and WHAT numbers go in the payload, not
 * calling Resend directly (matches every other "job enqueues, worker
 * sends" job in this codebase, e.g. `job-reminder-scheduler`).
 *
 * VERIFY/FIX_REQUESTS: `_shared/templates.ts`'s `weekly_value_summary` case
 * renders `calls_answered`/`bookings_captured` today but not a dollar
 * figure — this job already computes and passes `value_saved_cents`/
 * `value_saved_display` in the payload; a one-case template update (outside
 * this cluster's ownership of `_shared`) is requested in
 * docs/audit/FIX_REQUESTS.md to render it.
 */
export interface ValueEmailCandidateRow {
  tenant_id: string;
  avg_transaction_value_cents: number;
  calls_answered: number;
  bookings_captured: number;
  owner_email: string | null;
}

export async function findValueEmailCandidates(sql: SqlClient): Promise<ValueEmailCandidateRow[]> {
  return sql<ValueEmailCandidateRow>`
    select
      t.id as tenant_id,
      t.avg_transaction_value_cents,
      coalesce((
        select count(*) from public.call_logs cl
        where cl.tenant_id = t.id and cl.created_at >= now() - interval '7 days'
          and not cl.is_test_call
      ), 0)::int as calls_answered,
      coalesce((
        select count(*) from public.bookings b
        where b.tenant_id = t.id and b.created_at >= now() - interval '7 days'
      ), 0)::int as bookings_captured,
      (
        select u.email from auth.users u
        join public.memberships m on m.user_id = u.id
        where m.tenant_id = t.id and m.role = 'owner'
        limit 1
      ) as owner_email
    from public.tenants t
    where t.status = 'active'
      and t.deleted_at is null
      and not exists (
        select 1 from public.messages_outbound mo
        where mo.tenant_id = t.id
          and mo.template_key = 'weekly_value_summary'
          and mo.created_at >= now() - interval '6 days'
      )
  `;
}

export function formatValueSavedDisplay(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

export type ValueEmailOutcome = "sent" | "skipped_no_owner_email";

export async function sendOneValueEmail(
  sql: SqlClient,
  row: ValueEmailCandidateRow,
): Promise<ValueEmailOutcome> {
  if (!row.owner_email) return "skipped_no_owner_email";

  const valueSavedCents = row.avg_transaction_value_cents * row.bookings_captured;
  const payload = {
    calls_answered: String(row.calls_answered),
    bookings_captured: String(row.bookings_captured),
    value_saved_cents: valueSavedCents,
    value_saved_display: formatValueSavedDisplay(valueSavedCents),
  };

  const inserted = await sql<{ id: string }>`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload)
    values (${row.tenant_id}, 'email', ${row.owner_email}, 'weekly_value_summary', ${payload}::jsonb)
    returning id
  `;
  const message = inserted[0];
  if (message) {
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
  }
  return "sent";
}

export async function runValueEmails(
  sql: SqlClient,
): Promise<{ sent: number; skipped_no_owner_email: number; total: number }> {
  const rows = await findValueEmailCandidates(sql);
  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    const outcome = await sendOneValueEmail(sql, row);
    if (outcome === "sent") sent += 1;
    else skipped += 1;
  }
  return { sent, skipped_no_owner_email: skipped, total: rows.length };
}
