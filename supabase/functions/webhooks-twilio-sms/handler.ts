import { normalizeE164 } from "../_shared/phone.ts";
import type { TwilioInboundSms } from "../_shared/schemas/twilio-sms.ts";
import { classifyInboundSms, SMS_STATIC_REPLIES } from "../_shared/sms-compliance.ts";
import type { SqlClient } from "../_shared/types.ts";

const EXCLUSION_VIOLATION = "23P01";
const UNIQUE_VIOLATION = "23505";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/**
 * MASTER_SPEC §3.4 waitlist YES auto-book: matches a bare "yes"/"y" reply
 * to the most recent `waitlist_slot_opened` notification sent to this
 * customer, then books the freed slot via the SAME idempotent path
 * `create_booking` uses (the exclusion constraint is the race-proofing,
 * never check-then-insert) — `idempotency_key = 'waitlist:' || entry_id`
 * so a Twilio retry of the same inbound SMS never double-books.
 *
 * Returns `null` (not a waitlist reply — or no matching/still-open entry)
 * so the caller falls through to ordinary STOP/START/HELP/other handling;
 * this deliberately runs BEFORE that classification because
 * `sms-compliance.ts`'s START_KEYWORDS already includes "yes" (CTIA
 * opt-in vocabulary) — a customer who has an active waitlist notification
 * gets booked, not silently just resubscribed; one who doesn't gets the
 * unchanged opt-in behavior (docs/BUILD_NOTES.md T4 entry documents this
 * as a found conflict between the two independently-specced features).
 */
async function tryWaitlistAutoBook(
  sql: SqlClient,
  tenantId: string,
  customerId: string,
  fromNumber: string,
): Promise<string | null> {
  const notifications = await sql<{
    payload: { waitlist_entry_id?: string };
    related_booking_id: string | null;
  }>`
    select payload, related_booking_id from public.messages_outbound
    where tenant_id = ${tenantId} and recipient = ${fromNumber} and template_key = 'waitlist_slot_opened'
    order by created_at desc limit 1
  `;
  const notification = notifications[0];
  const entryId = notification?.payload?.waitlist_entry_id;
  if (!entryId || !notification.related_booking_id) return null;

  const entryRows = await sql<{ id: string; status: string; offering_id: string | null }>`
    select id, status, offering_id from public.waitlist_entries
    where id = ${entryId} and tenant_id = ${tenantId} and customer_id = ${customerId}
  `;
  const entry = entryRows[0];
  if (!entry || entry.status !== "notified") return null;

  const freedRows = await sql<{ resource_id: string; start_at: string; end_at: string }>`
    select resource_id, start_at, end_at from public.bookings where id = ${notification.related_booking_id}
  `;
  const freed = freedRows[0];
  if (!freed) return null;

  const stillOpen = await sql<{ id: string }>`
    select id from public.availability_slots
    where tenant_id = ${tenantId} and resource_id = ${freed.resource_id}
      and slot_range = tstzrange(${freed.start_at}, ${freed.end_at}) and is_available
    limit 1
  `;
  if (!stillOpen[0]) {
    await sql`update public.waitlist_entries set status = 'expired' where id = ${entry.id}`;
    return "Sorry — that slot's already been taken. We'll text you if another opens up.";
  }

  const idempotencyKey = `waitlist:${entry.id}`;
  try {
    await sql`
      insert into public.bookings (tenant_id, resource_id, offering_id, customer_id, start_at, end_at, status, idempotency_key)
      values (${tenantId}, ${freed.resource_id}, ${entry.offering_id}, ${customerId}, ${freed.start_at}, ${freed.end_at}, 'confirmed', ${idempotencyKey})
      on conflict (tenant_id, idempotency_key) do nothing
    `;
  } catch (err) {
    if (isPgError(err, EXCLUSION_VIOLATION) || isPgError(err, UNIQUE_VIOLATION)) {
      await sql`update public.waitlist_entries set status = 'expired' where id = ${entry.id}`;
      return "Sorry — that slot's already been taken. We'll text you if another opens up.";
    }
    throw err;
  }

  await sql`update public.waitlist_entries set status = 'converted' where id = ${entry.id}`;
  return "You're booked! We'll send a confirmation shortly. Reply STOP to opt out.";
}

/**
 * `/webhooks-twilio-sms` background logic (MASTER_SPEC §3.3). The Deno
 * `index.ts` owns Twilio signature verification + `webhook_events` dedup +
 * fast-ack (TwiML response); this file is the pure-DB-effects branch,
 * unit tested with a mocked `sql`.
 */
export interface TwilioSmsResult {
  /** TwiML-worthy reply body, if any (STOP/HELP get a static compliance
   * reply; a plain inbound message gets no auto-reply). */
  replyBody?: string;
}

export async function processInboundSms(
  sql: SqlClient,
  sms: TwilioInboundSms,
): Promise<TwilioSmsResult> {
  const fromNumber = normalizeE164(sms.From);
  const toNumber = normalizeE164(sms.To);

  const phoneRows = toNumber
    ? await sql<{ tenant_id: string; id: string }>`
        select tenant_id, id from public.phone_numbers where e164 = ${toNumber} and released_at is null limit 1
      `
    : [];
  const phoneNumberRow = phoneRows[0];
  const tenantId = phoneNumberRow?.tenant_id ?? null;

  if (!tenantId || !fromNumber) {
    // Can't resolve a tenant for this number — nothing more to do; Twilio
    // still gets a 200 (via index.ts) so it doesn't retry indefinitely.
    return {};
  }

  const customerRows = await sql<{ id: string }>`
    select id from public.customers where tenant_id = ${tenantId} and phone_e164 = ${fromNumber} limit 1
  `;
  const customerId = customerRows[0]?.id ?? null;

  const trimmedLower = (sms.Body ?? "").trim().toLowerCase();
  if (customerId && (trimmedLower === "yes" || trimmedLower === "y")) {
    const waitlistReply = await tryWaitlistAutoBook(sql, tenantId, customerId, fromNumber);
    if (waitlistReply) return { replyBody: waitlistReply };
    // No matching/open waitlist entry — falls through to ordinary
    // classification below (a bare "yes" with no waitlist context is just
    // the standard CTIA opt-in keyword).
  }

  const classification = classifyInboundSms(sms.Body);

  if (classification === "stop") {
    await sql`
      update public.customers
      set sms_opt_out = true, consent = consent || '{"sms": false}'::jsonb
      where tenant_id = ${tenantId} and phone_e164 = ${fromNumber}
    `;
    return { replyBody: SMS_STATIC_REPLIES.stop };
  }

  if (classification === "start") {
    await sql`
      update public.customers
      set sms_opt_out = false
      where tenant_id = ${tenantId} and phone_e164 = ${fromNumber}
    `;
    return { replyBody: SMS_STATIC_REPLIES.start };
  }

  if (classification === "help") {
    return { replyBody: SMS_STATIC_REPLIES.help };
  }

  // Ordinary inbound message: store + surface in the dashboard thread +
  // notify (MASTER_SPEC §3.3 `messages_inbound` table + notification).
  // Schema per T1's `20260907130700_messaging.sql`: `from_e164`/`to_e164`
  // (not `from_number`/`to_number`), `twilio_message_sid` (unique partial
  // index, not `provider_message_id`), and an optional `customer_id` FK
  // resolved by phone match when one exists (`customerId` resolved above,
  // ahead of the waitlist-YES check).
  await sql`
    insert into public.messages_inbound (tenant_id, phone_number_id, customer_id, from_e164, to_e164, body, twilio_message_sid, classification)
    values (${tenantId}, ${phoneNumberRow?.id ?? null}, ${customerId}, ${fromNumber}, ${toNumber}, ${sms.Body}, ${sms.MessageSid}, 'other')
    on conflict (twilio_message_sid) do nothing
  `;

  return {};
}
