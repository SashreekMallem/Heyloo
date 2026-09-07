import type { ResendFetch } from "../_shared/providers/resend.js";
import { sendEmail } from "../_shared/providers/resend.js";
import type { TwilioFetch } from "../_shared/providers/twilio.js";
import { sendSms } from "../_shared/providers/twilio.js";
import { renderTemplate } from "../_shared/templates.js";
import type { Logger, SqlClient } from "../_shared/types.js";

/**
 * `messages_outbound_queue` worker (BACKEND_SPEC §9/§10.1/§10.2, MASTER_SPEC
 * §3.3 "the `messages_outbound` worker checks `sms_opt_out` before every
 * send"). Channel dispatch covers `sms` (Twilio, with the A2P-pending ->
 * email-fallback state per BACKEND_SPEC §10.1) and `email` (Resend) fully;
 * `push`/`airtable` are Wave-2/T7 scope (browser-push subscriptions and the
 * Airtable adapter aren't built yet) — routed to an explicit `failed` status
 * with a clear error rather than silently dropped, matching the "never
 * silently failing" principle the spec states for A2P specifically.
 */
export interface OutboundDeps {
  twilioFetch: TwilioFetch;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: (tenantId: string) => Promise<string | null>;
  resendFetch: ResendFetch;
  resendApiKey: string;
  resendFromAddress: string;
  fallbackTenantEmail: (tenantId: string) => Promise<string | null>;
  logger: Logger;
}

interface MessageRow {
  id: string;
  tenant_id: string;
  channel: string;
  recipient: string;
  template_key: string;
  payload: Record<string, unknown>;
  status: string;
  related_booking_id: string | null;
  related_order_id: string | null;
}

export type ProcessOutcome =
  | "sent"
  | "skipped_terminal"
  | "skipped_opt_out"
  | "rerouted_email"
  | "failed";

export async function processOutboundMessage(
  sql: SqlClient,
  messageId: string,
  deps: OutboundDeps,
): Promise<ProcessOutcome> {
  const rows = await sql<MessageRow>`
    select id, tenant_id, channel, recipient, template_key, payload, status, related_booking_id, related_order_id
    from public.messages_outbound where id = ${messageId}
  `;
  const message = rows[0];
  if (!message || message.status === "sent" || message.status === "delivered") {
    return "skipped_terminal";
  }

  let channel = message.channel;

  if (channel === "sms") {
    const optOutRows = await sql<{ sms_opt_out: boolean }>`
      select sms_opt_out from public.customers where tenant_id = ${message.tenant_id} and phone_e164 = ${message.recipient} limit 1
    `;
    if (optOutRows[0]?.sms_opt_out) {
      await sql`update public.messages_outbound set status = 'failed', error = 'sms_opt_out' where id = ${message.id}`;
      return "skipped_opt_out";
    }

    const tenantRows = await sql<{ a2p_status: string | null }>`
      select a2p_status from public.tenants where id = ${message.tenant_id}
    `;
    if ((tenantRows[0]?.a2p_status ?? "verified") !== "verified") {
      channel = "email"; // A2P-pending fallback (BACKEND_SPEC §10.1) — never silently drop.
    }
  }

  const rendered = renderTemplate(message.template_key, message.payload);

  if (channel === "sms") {
    const fromNumber = await deps.twilioFromNumber(message.tenant_id);
    if (!fromNumber) {
      await sql`update public.messages_outbound set status = 'failed', error = 'no_sending_number' where id = ${message.id}`;
      return "failed";
    }
    const result = await sendSms(deps.twilioFetch, deps.twilioAccountSid, deps.twilioAuthToken, {
      to: message.recipient,
      from: fromNumber,
      body: rendered.body,
    });
    const body = result.body as { sid?: string };
    if (!result.ok || !body.sid) {
      await sql`update public.messages_outbound set status = 'failed', error = ${JSON.stringify(result.body)} where id = ${message.id}`;
      return "failed";
    }
    await sql`
      update public.messages_outbound
      set status = 'sent', provider_message_id = ${body.sid}, sent_at = now()
      where id = ${message.id}
    `;
    return "sent";
  }

  if (channel === "email") {
    const toEmail = await deps.fallbackTenantEmail(message.tenant_id);
    if (!toEmail) {
      await sql`update public.messages_outbound set status = 'failed', error = 'no_recipient_email' where id = ${message.id}`;
      return "failed";
    }
    const result = await sendEmail(deps.resendFetch, deps.resendApiKey, {
      from: deps.resendFromAddress,
      to: toEmail,
      subject: rendered.subject ?? "Update from your Heyloo assistant",
      html: `<p>${rendered.body}</p>`,
    });
    if (!result.ok) {
      await sql`update public.messages_outbound set status = 'failed', error = ${JSON.stringify(result.error)} where id = ${message.id}`;
      return "failed";
    }
    await sql`
      update public.messages_outbound
      set status = 'sent', provider_message_id = ${result.id ?? null}, sent_at = now()
      where id = ${message.id}
    `;
    return message.channel === "sms" ? "rerouted_email" : "sent";
  }

  // push / airtable — not yet wired (Wave-2/T7).
  deps.logger.warn("messages_outbound_channel_not_implemented", {
    channel,
    message_id: message.id,
  });
  await sql`update public.messages_outbound set status = 'failed', error = 'channel_not_implemented' where id = ${message.id}`;
  return "failed";
}
