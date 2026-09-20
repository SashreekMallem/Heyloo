import { normalizeE164 } from "../_shared/phone.ts";
import type { TwilioInboundSms } from "../_shared/schemas/twilio-sms.ts";
import { classifyInboundSms, SMS_STATIC_REPLIES } from "../_shared/sms-compliance.ts";
import type { TextAgentDeps } from "../_shared/text-agent/engine.ts";
import { handleInboundText } from "../_shared/text-agent/engine.ts";
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
  if (entry?.status !== "notified") return null;

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
  /**
   * Cluster T (text-agent engine): when provided, an "other"-classified
   * message (post STOP/HELP/waitlist-YES precedence, per this task's own
   * instruction) is routed into `handleInboundText` instead of only being
   * archived to `messages_inbound`. Optional and defaulting to the prior
   * archive-only behavior so every existing STOP/START/HELP/waitlist test
   * above keeps passing unchanged — a caller that wants the AI reply (the
   * real `index.ts` entrypoint) passes it; a caller that only wants the
   * compliance-keyword behavior (or doesn't have Anthropic credentials
   * configured) can omit it.
   */
  textEngineDeps?: TextAgentDeps,
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

  if (!textEngineDeps) {
    // No engine deps wired (older/simpler callers, or an environment
    // without Anthropic credentials configured) — archive-only, same
    // behavior as before this task.
    return {};
  }

  // Route into the text-agent engine (this task's core instruction). The
  // engine applies its own gates (A2P, opt-out, rate limit, human handoff)
  // and returns `sent: false` for any of those — never a thrown error —
  // so the TwiML reply is simply omitted rather than surfacing a webhook
  // failure to Twilio for a deliberate no-reply outcome.
  const engineResult = await handleInboundText(textEngineDeps, {
    channel: "sms",
    tenantId,
    phoneE164: fromNumber,
    message: sms.Body ?? "",
  });
  if (!engineResult.sent || !engineResult.reply) return {};

  // Delivery-tracking option (b) (docs/spec/BACKEND_SPEC.md §13): the sync
  // TwiML `<Message>` reply above is what actually sends the AI's SMS back
  // to the customer, but Twilio doesn't hand this webhook response a SID
  // for it (that's only ever delivered later, if at all, via a status
  // callback) — without a row here, the dashboard thread and the tenant's
  // delivery-status view have no record this reply was ever sent at all.
  // Insert it as already `'sent'` (never `'queued'`): the real send already
  // happened via TwiML, so this must never also be picked up by the
  // `messages_outbound` queue worker and sent a second time.
  await sql`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload, status, sent_at)
    values (${tenantId}, 'sms', ${fromNumber}, 'text_agent_reply', ${{ body: engineResult.reply }}::jsonb, 'sent', now())
  `;
  return { replyBody: engineResult.reply };
}
