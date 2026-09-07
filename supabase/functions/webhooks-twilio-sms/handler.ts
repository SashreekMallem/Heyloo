import { normalizeE164 } from "../_shared/phone.js";
import type { TwilioInboundSms } from "../_shared/schemas/twilio-sms.js";
import { classifyInboundSms, SMS_STATIC_REPLIES } from "../_shared/sms-compliance.js";
import type { SqlClient } from "../_shared/types.js";

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
  const classification = classifyInboundSms(sms.Body);

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
  // resolved by phone match when one exists.
  const customerRows = await sql<{ id: string }>`
    select id from public.customers where tenant_id = ${tenantId} and phone_e164 = ${fromNumber} limit 1
  `;
  const customerId = customerRows[0]?.id ?? null;

  await sql`
    insert into public.messages_inbound (tenant_id, phone_number_id, customer_id, from_e164, to_e164, body, twilio_message_sid, classification)
    values (${tenantId}, ${phoneNumberRow?.id ?? null}, ${customerId}, ${fromNumber}, ${toNumber}, ${sms.Body}, ${sms.MessageSid}, 'other')
    on conflict (twilio_message_sid) do nothing
  `;

  // MASTER_SPEC §3.4 waitlist: a plain "YES" reply auto-books via the same
  // idempotent create_booking path when it matches a notified waitlist
  // entry for this customer — left as a Wave-3 follow-up (needs
  // `waitlist_entries`, T1) rather than guessed at here; a bare "YES" today
  // is stored as an ordinary inbound message.

  return {};
}
