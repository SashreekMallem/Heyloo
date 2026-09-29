import { textToEmailHtml } from "../_shared/email-body.ts";
import type { OwnerAlertContact } from "../_shared/owner-alerts.ts";
import { isOwnerAlertTemplate, loadOwnerAlertContact } from "../_shared/owner-alerts.ts";
import { normalizeE164 } from "../_shared/phone.ts";
import type { MessagingRegistry } from "../_shared/providers/messaging/registry.ts";
import type { SendResult, SmsProvider } from "../_shared/providers/messaging/types.ts";
import type { MessagesOutboundQueueMsg, PgmqMessageRow } from "../_shared/queue.ts";
import {
  deleteMessage,
  enqueue,
  moveToDeadLetter,
  QUEUE_NAMES,
  readBatch,
} from "../_shared/queue.ts";
import type { RenderedMessage } from "../_shared/templates.ts";
import { renderTemplate } from "../_shared/templates.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `messages_outbound_queue` worker (BACKEND_SPEC §9/§10.1/§10.2, MASTER_SPEC
 * §3.3). MESSAGING-1 (docs/design/MESSAGING_PROVIDERS.md): every send goes
 * through the provider-neutral `MessagingRegistry` — this file never sees a
 * Twilio/Telnyx/Resend field name (CLAUDE.md Rule 2).
 *
 * Per row:
 * - Owner alerts (`_shared/owner-alerts.ts` templates) are re-planned from
 *   the tenant's current delivery preferences: SMS, email or both; an SMS
 *   that can't go out yet (texting not approved / no SMS provider) falls
 *   back to email so an alert is never silently dropped.
 * - Customer SMS: opt-out check, then the tenant's sender
 *   (`messaging_senders`, legacy fallback: primary `phone_numbers` number +
 *   `tenants.a2p_status`). Not carrier-approved yet -> rerouted to the
 *   owner's email (the BACKEND_SPEC §10.1 A2P fallback), never silently
 *   dropped. Inbound replies (`sms_reply`/`text_agent_reply`) are exempt
 *   from the reroute: they answer a text the customer just sent us. The
 *   STOP confirmation and HELP answer are exempt from the opt-out check;
 *   one-time codes are never rerouted. Both numbers are normalized to
 *   E.164 before the opt-out lookup and the provider call.
 * - Email: to the row's recipient (owner-facing rows) via the email
 *   provider, body HTML-escaped, `messages_outbound.id` as idempotency key.
 *
 * Failure handling (H1 fix + OPS-8, docs/BUILD_NOTES.md):
 * - permanent provider rejection -> `status='failed'` immediately;
 * - transient -> throw, pgmq visibility-timeout retry, dead-letter after
 *   `OUTBOUND_MAX_ATTEMPTS`;
 * - chosen provider not configured, or deferred (quota) -> `ParkMessageError`:
 *   re-enqueued with a delay (fresh read_ct, so parking never burns retry
 *   attempts) until the row is older than the park window, then
 *   dead-lettered with that reason (`provider_not_configured`, ...).
 * Pre-flight failures detected before any provider call (no sender, no
 * recipient, unknown template) fail immediately — nothing to retry.
 */

export interface OutboundDeps {
  registry: MessagingRegistry;
  /** Public base URL of the `webhooks-sms` function (e.g.
   * `https://<ref>.supabase.co/functions/v1/webhooks-sms`); when set,
   * providers with delivery receipts are asked to POST them to
   * `<base>/<provider>/status`. */
  statusWebhookBaseUrl?: string;
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
  parent_message_id: string | null;
  related_call_id: string | null;
  related_booking_id: string | null;
  related_order_id: string | null;
  created_at: string;
}

export type ProcessOutcome =
  | "sent"
  | "skipped_terminal"
  | "skipped_opt_out"
  | "rerouted_email"
  | "failed";

/** Thrown to park a message (re-enqueue later) instead of retrying now. */
export class ParkMessageError extends Error {
  readonly reason: string;
  readonly retryAfterSeconds: number;
  readonly createdAt: string | null;

  constructor(reason: string, retryAfterSeconds: number, createdAt: string | null) {
    super(`park:${reason}`);
    this.name = "ParkMessageError";
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
    this.createdAt = createdAt;
  }
}

export const PROVIDER_NOT_CONFIGURED_RECHECK_SECONDS = 15 * 60;

/** Templates that answer an inbound text (queued by `webhooks-sms` for
 * providers without a synchronous reply channel). */
const INBOUND_REPLY_TEMPLATES = new Set(["sms_reply", "text_agent_reply"]);

/** Compliance replies sent even to an opted-out number: the STOP
 * confirmation itself, and HELP (answered regardless of opt-out state, as
 * the pre-MESSAGING-1 TwiML path always did). The provider's own block
 * rule, if any, still has the final say (Telnyx 40300 / Twilio 21610). */
const OPT_OUT_EXEMPT_COMPLIANCE = new Set(["stop", "help"]);

/** One-time codes must only ever reach the phone they verify — never
 * rerouted to the owner's inbox while texting isn't approved. */
const NEVER_REROUTE_TEMPLATES = new Set(["chat_phone_verification"]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function markFailed(sql: SqlClient, id: string, error: string): Promise<"failed"> {
  await sql`update public.messages_outbound set status = 'failed', error = ${error.slice(0, 500)} where id = ${id}`;
  return "failed";
}

function describeFailure(providerId: string, result: Extract<SendResult, { ok: false }>): string {
  return `${providerId}:${result.errorCode ?? `http_${result.httpStatus}`}:${result.detail}`;
}

// ---------------------------------------------------------------------------
// SMS routing
// ---------------------------------------------------------------------------

export type SmsRoute =
  | { ok: true; from: string; provider: SmsProvider }
  | {
      ok: false;
      reason: "sender_not_verified" | "no_sending_number" | "provider_not_configured";
      detail?: string;
    };

interface SenderRow {
  a2p_status: string | null;
  sms_provider: string | null;
  sender_e164: string | null;
  sender_provider: string | null;
  sender_status: string | null;
  primary_e164: string | null;
}

/** Which number and which provider account a tenant texts from, and
 * whether carriers have approved it. */
export async function resolveSmsRoute(
  sql: SqlClient,
  tenantId: string,
  registry: MessagingRegistry,
  options: { requireVerified: boolean },
): Promise<SmsRoute> {
  const rows = await sql<SenderRow>`
    select t.a2p_status, t.sms_provider,
      s.e164 as sender_e164, s.provider as sender_provider, s.registration_status as sender_status,
      (select p.e164 from public.phone_numbers p
        where p.tenant_id = t.id and p.released_at is null and p.is_primary
        limit 1) as primary_e164
    from public.tenants t
    left join lateral (
      select ms.e164, ms.provider, ms.registration_status
      from public.messaging_senders ms
      where ms.tenant_id = t.id and ms.released_at is null
      order by ms.is_default desc, (ms.registration_status = 'verified') desc, ms.created_at asc
      limit 1
    ) s on true
    where t.id = ${tenantId}
  `;
  const row = rows[0];
  const fromSender = !!row?.sender_e164;
  const from = fromSender ? row?.sender_e164 : row?.primary_e164;
  const verified = fromSender
    ? row?.sender_status === "verified"
    : (row?.a2p_status ?? null) === "verified";

  if (options.requireVerified && !verified) return { ok: false, reason: "sender_not_verified" };
  if (!from) return { ok: false, reason: "no_sending_number" };

  const resolution = registry.resolveSms({
    senderProvider: fromSender ? row?.sender_provider : null,
    tenantOverride: row?.sms_provider ?? null,
  });
  if (!resolution.ok) {
    return {
      ok: false,
      reason: "provider_not_configured",
      detail: `${resolution.reason}:${resolution.providerId}`,
    };
  }
  return { ok: true, from, provider: resolution.provider };
}

async function sendSmsFor(
  sql: SqlClient,
  message: MessageRow,
  route: Extract<SmsRoute, { ok: true }>,
  to: string,
  body: string,
  deps: OutboundDeps,
): Promise<ProcessOutcome> {
  const provider = route.provider;
  // CLAUDE.md Rule 2: E.164 at every boundary — the port's contract
  // (`SmsSendRequest`) is enforced here, never left to the vendor.
  const toE164 = normalizeE164(to);
  const fromE164 = normalizeE164(route.from);
  if (!toE164) return markFailed(sql, message.id, "invalid_recipient_phone");
  if (!fromE164) return markFailed(sql, message.id, "invalid_sender_phone");
  const statusCallbackUrl =
    deps.statusWebhookBaseUrl && provider.capabilities.deliveryReceipts
      ? `${deps.statusWebhookBaseUrl.replace(/\/+$/, "")}/${provider.id}/status`
      : undefined;
  const result = await provider.sendSms({
    to: toE164,
    from: fromE164,
    body,
    idempotencyKey: message.id,
    ...(statusCallbackUrl ? { statusCallbackUrl } : {}),
  });
  if (result.ok) {
    await sql`
      update public.messages_outbound
      set status = 'sent', provider_message_id = ${result.providerMessageId},
          provider = ${provider.id}, sent_via = 'sms', recipient = ${toE164}, sent_at = now(), error = null
      where id = ${message.id}
    `;
    return "sent";
  }
  return handleSendFailure(sql, message, provider.id, result, deps);
}

async function handleSendFailure(
  sql: SqlClient,
  message: MessageRow,
  providerId: string,
  result: Extract<SendResult, { ok: false }>,
  deps: OutboundDeps,
): Promise<ProcessOutcome> {
  if (result.failure === "permanent") {
    return markFailed(sql, message.id, describeFailure(providerId, result));
  }
  if (result.failure === "deferred") {
    throw new ParkMessageError(
      `${providerId}:${result.errorCode ?? "deferred"}`,
      result.retryAfterSeconds ?? PROVIDER_NOT_CONFIGURED_RECHECK_SECONDS,
      message.created_at,
    );
  }
  deps.logger.warn("worker_messages_outbound_transient_failure", {
    message_id: message.id,
    provider: providerId,
    status: result.httpStatus,
    code: result.errorCode,
  });
  throw new Error(`${providerId}_send_transient_failure:${result.httpStatus}`);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

async function sendEmailFor(
  sql: SqlClient,
  message: MessageRow,
  to: string | null,
  content: { subject: string; text: string },
  deps: OutboundDeps,
  outcome: "sent" | "rerouted_email",
): Promise<ProcessOutcome> {
  if (!to || !EMAIL_PATTERN.test(to)) return markFailed(sql, message.id, "no_recipient_email");
  const resolution = deps.registry.resolveEmail();
  if (!resolution.ok || !deps.registry.emailFromAddress) {
    throw new ParkMessageError(
      "provider_not_configured",
      PROVIDER_NOT_CONFIGURED_RECHECK_SECONDS,
      message.created_at,
    );
  }
  const provider = resolution.provider;
  const result = await provider.sendEmail({
    to,
    from: deps.registry.emailFromAddress,
    subject: content.subject,
    html: textToEmailHtml(content.text),
    text: content.text,
    idempotencyKey: message.id,
  });
  if (!result.ok) return handleSendFailure(sql, message, provider.id, result, deps);
  await sql`
    update public.messages_outbound
    set status = 'sent', provider_message_id = ${result.providerMessageId},
        provider = ${provider.id}, sent_via = 'email', sent_at = now(), error = null
    where id = ${message.id}
  `;
  return outcome;
}

const DEFAULT_SUBJECT = "Update from your Heyloo assistant";

/** What the owner receives when a CUSTOMER text couldn't be sent yet. */
function reroutedCustomerEmail(
  message: MessageRow,
  rendered: RenderedMessage,
): { subject: string; text: string } {
  return {
    subject: `Text to ${message.recipient} not sent yet — copy for you`,
    text:
      `Texting from your business number isn't active yet (carrier approval pending), so we couldn't text ${message.recipient}. ` +
      `Here's what they would have received:\n\n${rendered.body}\n\n` +
      "You can reach them directly, or finish Text messaging setup in your Heyloo dashboard.",
  };
}

// ---------------------------------------------------------------------------
// Owner alerts
// ---------------------------------------------------------------------------

async function processOwnerAlert(
  sql: SqlClient,
  message: MessageRow,
  rendered: RenderedMessage,
  deps: OutboundDeps,
): Promise<ProcessOutcome> {
  const contact: OwnerAlertContact = await loadOwnerAlertContact(sql, message.tenant_id);
  const emailContent = { subject: rendered.subject ?? DEFAULT_SUBJECT, text: rendered.body };
  const alertPhone =
    contact.alertPhone ?? (message.channel === "sms" ? normalizeE164(message.recipient) : null);
  const wantSms = contact.smsEnabled && !!alertPhone;
  const wantEmail = contact.emailEnabled && !!contact.email;

  if (!contact.smsEnabled && !contact.emailEnabled) {
    return markFailed(sql, message.id, "owner_alerts_disabled");
  }

  if (wantSms && alertPhone) {
    const route = await resolveSmsRoute(sql, message.tenant_id, deps.registry, {
      requireVerified: true,
    });
    if (route.ok) {
      if (wantEmail && contact.email) await fanOutEmailCopy(sql, message, contact.email);
      if (await isOptedOut(sql, message.tenant_id, alertPhone)) {
        await sql`update public.messages_outbound set status = 'failed', error = 'sms_opt_out' where id = ${message.id}`;
        return "skipped_opt_out";
      }
      return sendSmsFor(sql, message, route, alertPhone, rendered.body, deps);
    }
    // Texting not possible yet: email instead (even when the email toggle
    // is off — the owner asked to be alerted, SMS just can't carry it yet).
    if (contact.email) {
      return sendEmailFor(sql, message, contact.email, emailContent, deps, "rerouted_email");
    }
    return markFailed(sql, message.id, `owner_alert_undeliverable:${route.reason}`);
  }

  if (contact.email) {
    return sendEmailFor(sql, message, contact.email, emailContent, deps, "sent");
  }
  return markFailed(sql, message.id, "no_owner_alert_destination");
}

/** Idempotent email copy of an SMS owner alert (unique on
 * (parent_message_id, channel) — a retried parent never inserts twice). */
async function fanOutEmailCopy(sql: SqlClient, parent: MessageRow, email: string): Promise<void> {
  const rows = await sql<{ id: string }>`
    insert into public.messages_outbound
      (tenant_id, channel, recipient, template_key, payload, parent_message_id,
       related_call_id, related_booking_id, related_order_id)
    values (${parent.tenant_id}, 'email', ${email}, ${parent.template_key}, ${parent.payload}::jsonb,
      ${parent.id}, ${parent.related_call_id}, ${parent.related_booking_id}, ${parent.related_order_id})
    on conflict (parent_message_id, channel) where parent_message_id is not null do nothing
    returning id
  `;
  const child = rows[0];
  if (child) await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: child.id });
}

async function isOptedOut(sql: SqlClient, tenantId: string, phone: string): Promise<boolean> {
  const rows = await sql<{ sms_opt_out: boolean }>`
    select sms_opt_out from public.customers where tenant_id = ${tenantId} and phone_e164 = ${phone} limit 1
  `;
  return rows[0]?.sms_opt_out === true;
}

// ---------------------------------------------------------------------------
// Entry: one row
// ---------------------------------------------------------------------------

export async function processOutboundMessage(
  sql: SqlClient,
  messageId: string,
  deps: OutboundDeps,
): Promise<ProcessOutcome> {
  const rows = await sql<MessageRow>`
    select id, tenant_id, channel, recipient, template_key, payload, status, parent_message_id,
      related_call_id, related_booking_id, related_order_id, created_at
    from public.messages_outbound where id = ${messageId}
  `;
  const message = rows[0];
  if (!message || message.status === "sent" || message.status === "delivered") {
    return "skipped_terminal";
  }

  const rendered = renderTemplate(message.template_key, message.payload ?? {});
  if (!rendered.body.trim()) {
    // Unknown template key (a tool-supplied key with no renderer) — never
    // send an empty SMS/email.
    return markFailed(sql, message.id, `empty_rendered_body:${message.template_key}`);
  }

  // Owner alert (the original row, not its email fan-out copy).
  if (isOwnerAlertTemplate(message.template_key) && !message.parent_message_id) {
    return processOwnerAlert(sql, message, rendered, deps);
  }

  if (message.channel === "sms") {
    // Normalized before the opt-out lookup too: `customers.phone_e164` is
    // E.164, so a raw recipient could otherwise miss an opt-out.
    const recipient = normalizeE164(message.recipient);
    if (!recipient) return markFailed(sql, message.id, "invalid_recipient_phone");
    const compliance = message.payload?.["compliance"];
    const optOutExempt =
      message.template_key === "sms_reply" &&
      typeof compliance === "string" &&
      OPT_OUT_EXEMPT_COMPLIANCE.has(compliance);
    if (!optOutExempt && (await isOptedOut(sql, message.tenant_id, recipient))) {
      await sql`update public.messages_outbound set status = 'failed', error = 'sms_opt_out' where id = ${message.id}`;
      return "skipped_opt_out";
    }

    const isInboundReply = INBOUND_REPLY_TEMPLATES.has(message.template_key);
    const route = await resolveSmsRoute(sql, message.tenant_id, deps.registry, {
      requireVerified: !isInboundReply,
    });
    if (route.ok) {
      return sendSmsFor(sql, message, route, recipient, rendered.body, deps);
    }
    if (route.reason === "no_sending_number") return markFailed(sql, message.id, route.reason);
    if (route.reason === "provider_not_configured") {
      // The sender is usable; only this provider's secrets are missing.
      // Park (OPS-8) rather than downgrade to email — it sends by SMS as
      // soon as the provider is configured, or dead-letters after 24h.
      throw new ParkMessageError(
        "provider_not_configured",
        PROVIDER_NOT_CONFIGURED_RECHECK_SECONDS,
        message.created_at,
      );
    }
    // sender_not_verified: A2P fallback (BACKEND_SPEC §10.1) — the owner
    // gets a copy by email, never a silent drop. Honors the owner's email
    // toggle. A one-time code is never copied to anyone but its phone.
    if (NEVER_REROUTE_TEMPLATES.has(message.template_key)) {
      return markFailed(sql, message.id, "sms_pending_verification");
    }
    const contact = await loadOwnerAlertContact(sql, message.tenant_id);
    if (!contact.emailEnabled) return markFailed(sql, message.id, "sms_pending_verification");
    return sendEmailFor(
      sql,
      message,
      contact.email,
      reroutedCustomerEmail(message, rendered),
      deps,
      "rerouted_email",
    );
  }

  if (message.channel === "email") {
    let to: string | null = EMAIL_PATTERN.test(message.recipient) ? message.recipient : null;
    if (!to) to = (await loadOwnerAlertContact(sql, message.tenant_id)).email;
    return sendEmailFor(
      sql,
      message,
      to,
      { subject: rendered.subject ?? DEFAULT_SUBJECT, text: rendered.body },
      deps,
      "sent",
    );
  }

  // push / airtable — not yet wired (Wave-2/T7).
  deps.logger.warn("messages_outbound_channel_not_implemented", {
    channel: message.channel,
    message_id: message.id,
  });
  return markFailed(sql, message.id, "channel_not_implemented");
}

// ---------------------------------------------------------------------------
// Batch-poll entry point (OPS-3, docs/BUILD_NOTES.md) — used by this
// function's own index.ts and by worker-tick's combined dispatch.
// ---------------------------------------------------------------------------

export const OUTBOUND_VISIBILITY_TIMEOUT_SECONDS = 30;
export const OUTBOUND_BATCH_SIZE = 20;
export const OUTBOUND_MAX_ATTEMPTS = 5; // BACKEND_SPEC §9 — pgmq's own read_ct is the attempt counter for this queue.
export const OUTBOUND_NOT_CONFIGURED_PARK_SECONDS = 24 * 60 * 60; // 24h.
export const STRANDED_SWEEP_LIMIT = 50;

export interface RunOutboundWorkerResult {
  processed: number;
  dead_lettered: number;
  batch_size: number;
  /** Re-enqueued with a delay (provider not configured / quota). */
  parked: number;
  /** Rows found with no queue message and (re-)enqueued this tick. */
  stranded_enqueued: number;
}

/**
 * Rows that exist but were never put on the queue: `send_sms_confirmation`
 * writes `pending_verification` rows without enqueueing, the
 * `fn_notify_waitlist_on_cancellation` trigger and `_shared/dental-intake.ts`
 * insert `queued` rows without `pgmq.send`. Picks up rows 2 minutes to 24
 * hours old that have no live queue message (older ones are history and
 * are deliberately left alone rather than flooding the owner with stale
 * confirmations), flips them to `queued` and enqueues them — one statement,
 * bounded batch.
 */
export async function enqueueStrandedMessages(sql: SqlClient): Promise<number> {
  const rows = await sql<{ id: string }>`
    with stranded as (
      select mo.id from public.messages_outbound mo
      where mo.status in ('queued', 'pending_verification')
        and mo.created_at > now() - interval '24 hours'
        and mo.created_at < now() - interval '2 minutes'
        and not exists (
          select 1 from pgmq.q_messages_outbound_queue q
          where q.message ->> 'message_id' = mo.id::text
        )
      order by mo.created_at asc
      limit ${STRANDED_SWEEP_LIMIT}
    ),
    flipped as (
      update public.messages_outbound mo set status = 'queued'
      from stranded where mo.id = stranded.id
      returning mo.id
    )
    select id, pgmq.send(${QUEUE_NAMES.messagesOutbound}::text, jsonb_build_object('message_id', id::text)) as msg_id
    from flipped
  `;
  return rows.length;
}

/** Re-enqueue with a delay (fresh read_ct) and drop the current copy. Send
 * first: if the delete fails the worst case is one duplicate queue entry
 * for a row whose terminal-status check makes the second copy a no-op. */
async function parkQueueMessage(
  sql: SqlClient,
  row: PgmqMessageRow<MessagesOutboundQueueMsg>,
  delaySeconds: number,
): Promise<void> {
  await sql`select pgmq.send(${QUEUE_NAMES.messagesOutbound}::text, ${row.message}::jsonb, ${Math.max(1, Math.round(delaySeconds))}::integer)`;
  await deleteMessage(sql, QUEUE_NAMES.messagesOutbound, row.msg_id);
}

export async function runOutboundWorker(
  sql: SqlClient,
  deps: OutboundDeps,
  now: () => number = () => Date.now(),
): Promise<RunOutboundWorkerResult> {
  let strandedEnqueued = 0;
  try {
    strandedEnqueued = await enqueueStrandedMessages(sql);
  } catch (err) {
    deps.logger.warn("worker_messages_outbound_stranded_sweep_failed", { error: String(err) });
  }

  const batch = await readBatch<MessagesOutboundQueueMsg>(
    sql,
    QUEUE_NAMES.messagesOutbound,
    OUTBOUND_VISIBILITY_TIMEOUT_SECONDS,
    OUTBOUND_BATCH_SIZE,
  );

  let processed = 0;
  let deadLettered = 0;
  let parked = 0;
  for (const row of batch) {
    try {
      await processOutboundMessage(sql, row.message.message_id, deps);
      await deleteMessage(sql, QUEUE_NAMES.messagesOutbound, row.msg_id);
      processed += 1;
    } catch (err) {
      const reason = err instanceof ParkMessageError ? err.reason : String(err);
      // OPS-8: the dead-letter/park writes are wrapped in their own
      // try/catch so one row's failure here never strands the rest.
      try {
        if (err instanceof ParkMessageError) {
          const createdMs = err.createdAt ? Date.parse(err.createdAt) : Number.NaN;
          const ageSeconds = Number.isFinite(createdMs) ? (now() - createdMs) / 1000 : 0;
          if (ageSeconds >= OUTBOUND_NOT_CONFIGURED_PARK_SECONDS) {
            await moveToDeadLetter(
              sql,
              QUEUE_NAMES.messagesOutbound,
              row.msg_id,
              row.message,
              reason,
            );
            await sql`
              update public.messages_outbound
              set status = 'failed', error = ${reason}
              where id = ${row.message.message_id} and status not in ('sent', 'delivered')
            `;
            deadLettered += 1;
          } else {
            const remaining = OUTBOUND_NOT_CONFIGURED_PARK_SECONDS - ageSeconds;
            await parkQueueMessage(sql, row, Math.min(err.retryAfterSeconds, remaining));
            parked += 1;
          }
          deps.logger.warn("worker_messages_outbound_parked", {
            msg_id: row.msg_id,
            reason,
            dead_lettered: ageSeconds >= OUTBOUND_NOT_CONFIGURED_PARK_SECONDS,
          });
          continue;
        }

        deps.logger.error("worker_messages_outbound_error", { error: reason, msg_id: row.msg_id });
        if (row.read_ct >= OUTBOUND_MAX_ATTEMPTS) {
          await moveToDeadLetter(
            sql,
            QUEUE_NAMES.messagesOutbound,
            row.msg_id,
            row.message,
            `max_attempts_exceeded:${reason}`,
          );
          // BACKEND_SPEC §9: exhausted retries also flip the domain row, or
          // it would sit `queued` forever with no admin-visible signal.
          await sql`
            update public.messages_outbound
            set status = 'failed', error = ${reason}
            where id = ${row.message.message_id} and status not in ('sent', 'delivered')
          `;
          deadLettered += 1;
        }
        // else: stays in the queue, visible again after the visibility
        // timeout for the next poll to retry.
      } catch (dlqErr) {
        deps.logger.error("worker_messages_outbound_row_fatal", {
          msg_id: row.msg_id,
          error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
        });
      }
    }
  }

  return {
    processed,
    dead_lettered: deadLettered,
    batch_size: batch.length,
    parked,
    stranded_enqueued: strandedEnqueued,
  };
}

// ---------------------------------------------------------------------------
// OPS-8 — honest "no provider configured at all" behavior (unchanged): when
// neither an SMS nor an email provider is configured the leg never calls
// `pgmq.read` (no read_ct inflation); this sweep dead-letters messages that
// have waited past the park window with reason `provider_not_configured`
// so the owner sees a failed row instead of silence. Per-message
// "this message's provider isn't configured" (some other provider is) is
// handled by `ParkMessageError` above with the same window and reason.
// ---------------------------------------------------------------------------

export interface SweepNotConfiguredOutboundResult {
  dead_lettered: number;
}

export async function sweepNotConfiguredOutbound(
  sql: SqlClient,
  staleAfterSeconds: number = OUTBOUND_NOT_CONFIGURED_PARK_SECONDS,
): Promise<SweepNotConfiguredOutboundResult> {
  const stale = await sql<{ msg_id: number; message: MessagesOutboundQueueMsg }>`
    select msg_id, message
    from pgmq.q_messages_outbound_queue
    where enqueued_at < now() - interval '1 second' * ${staleAfterSeconds}
  `;

  let deadLettered = 0;
  for (const row of stale) {
    try {
      await moveToDeadLetter(
        sql,
        QUEUE_NAMES.messagesOutbound,
        row.msg_id,
        row.message,
        "provider_not_configured",
      );
      await sql`
        update public.messages_outbound
        set status = 'failed', error = 'provider_not_configured'
        where id = ${row.message.message_id} and status not in ('sent', 'delivered')
      `;
      deadLettered += 1;
    } catch {
      // Leave it queued for the next sweep — never let one row strand the rest.
    }
  }

  return { dead_lettered: deadLettered };
}
