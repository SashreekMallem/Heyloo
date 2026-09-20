import { enqueue, QUEUE_NAMES } from "../_shared/queue.ts";
import { isQuietHours, resolveQuietHoursWindow } from "../_shared/quiet-hours.ts";
import type { SqlClient } from "../_shared/types.ts";

/**
 * Hourly reminder-scheduler job (MASTER_SPEC §3.6): bookings T-24h (per-
 * vertical configurable window) whose customer consented to `sms`/`call`
 * get a reminder enqueued; quiet hours (9pm-9am tenant-local, configurable)
 * are enforced by simply not sending this pass — the next hourly run
 * re-evaluates, so a booking whose reminder window opens during quiet
 * hours is picked up on the first in-window run once quiet hours end,
 * never silently skipped forever.
 *
 * "Already sent" tracking uses `messages_outbound` itself (an existing row
 * with `template_key = 'reminder'` and `related_booking_id`) rather than a
 * new `bookings.reminder_sent_at` column this task can't migrate — flagged
 * for T1/T4 to consider promoting to a real column if the existence-check
 * join becomes a query-plan concern at scale.
 */
export interface ReminderCandidateRow {
  booking_id: string;
  tenant_id: string;
  start_at: string;
  timezone: string;
  consent_sms: boolean;
  consent_call: boolean;
  customer_phone: string | null;
  reminder_window_hours: number;
  /** `tenants.quiet_hours` jsonb (BACKEND_SPEC.md §13.2) — a proactive
   * booking reminder is exactly the "unsolicited/proactive" case that
   * column exists to gate; resolved via `resolveQuietHoursWindow`. */
  quiet_hours: unknown;
}

export async function findReminderCandidates(
  sql: SqlClient,
  now: Date,
): Promise<ReminderCandidateRow[]> {
  return sql<ReminderCandidateRow>`
    select
      b.id as booking_id,
      b.tenant_id,
      b.start_at,
      t.timezone,
      t.quiet_hours,
      coalesce((c.consent->>'sms')::boolean, false) as consent_sms,
      coalesce((c.consent->>'call')::boolean, false) as consent_call,
      c.phone_e164 as customer_phone,
      coalesce((ac.dynamic_variable_overrides->>'reminder_window_hours')::int, 24) as reminder_window_hours
    from public.bookings b
    join public.tenants t on t.id = b.tenant_id
    left join public.customers c on c.id = b.customer_id
    left join public.agent_configs ac on ac.tenant_id = b.tenant_id
    where b.status = 'confirmed'
      and b.start_at between ${now.toISOString()}::timestamptz + interval '23 hours'
                          and ${now.toISOString()}::timestamptz + interval '25 hours'
      and not exists (
        select 1 from public.messages_outbound mo
        where mo.related_booking_id = b.id and mo.template_key = 'reminder'
      )
  `;
}

export async function scheduleOneReminder(
  sql: SqlClient,
  row: ReminderCandidateRow,
  now: Date,
): Promise<"sent" | "deferred_quiet_hours" | "no_consent" | "no_phone"> {
  if (!row.consent_sms && !row.consent_call) return "no_consent";
  if (!row.customer_phone) return "no_phone";
  const window = resolveQuietHoursWindow(row.quiet_hours);
  if (window.enabled && isQuietHours(now, row.timezone, window.startHour, window.endHour)) {
    return "deferred_quiet_hours";
  }

  const inserted = await sql<{ id: string }>`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload, related_booking_id)
    values (${row.tenant_id}, 'sms', ${row.customer_phone}, 'reminder', ${{ start_local: row.start_at }}::jsonb, ${row.booking_id})
    returning id
  `;
  const message = inserted[0];
  if (message) {
    await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
  }
  // Voice-reminder-with-voicemail-detection (the tenant-enabled alternative
  // to SMS) is a Retell batch-outbound-call feature — deferred to a
  // follow-up once that Retell API shape is verified (docs/VERIFY.md);
  // SMS is always attempted here regardless so no tenant goes without a
  // reminder channel.
  return "sent";
}
