import type { ProviderResolution } from "../_shared/providers/messaging/registry.ts";
import type {
  CanonicalDeliveryStatus,
  CanonicalInboundSms,
  RawWebhookRequest,
  SmsProvider,
  WebhookAck,
} from "../_shared/providers/messaging/types.ts";
import { enqueue, QUEUE_NAMES } from "../_shared/queue.ts";
import { classifyInboundSms, SMS_STATIC_REPLIES } from "../_shared/sms-compliance.ts";
import type { TextAgentDeps } from "../_shared/text-agent/engine.ts";
import { handleInboundText } from "../_shared/text-agent/engine.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";

/**
 * Provider-neutral inbound-SMS + delivery-receipt webhook (MESSAGING-1,
 * docs/design/MESSAGING_PROVIDERS.md). Served by `webhooks-sms/index.ts`
 * at `/webhooks-sms/<provider>[/status]` and by the legacy
 * `webhooks-twilio-sms/index.ts` (Twilio numbers already pointed there).
 *
 * Pipeline (CLAUDE.md Rule 2): the adapter verifies the signature on the
 * RAW body first (fail closed) -> the adapter parses into a canonical
 * inbound message or delivery status -> idempotent `webhook_events` insert
 * -> ack. Providers that can reply inside the HTTP response (Twilio TwiML,
 * `capabilities.syncWebhookReply`) get the reply inline exactly as before;
 * every other provider (Telnyx: 2xx within 2 s, no reply channel) is
 * fast-acked and the work runs in the background, with any reply queued as
 * an ordinary `messages_outbound` send.
 *
 * Nothing in this file knows a provider's field names.
 */

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
 * so a redelivery of the same inbound SMS never double-books.
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

export type InboundReplyKind = "stop" | "start" | "help" | "waitlist" | "text_agent";

export interface InboundSmsResult {
  /** Reply text, if any. With `replyMode: "sync"` the caller returns it in
   * the webhook response; with `"queued"` it has already been enqueued. */
  replyBody?: string;
  replyKind?: InboundReplyKind;
}

export interface ProcessInboundOptions {
  /** `sync` (default): the reply goes back in the webhook response (Twilio
   * TwiML) and only the AI reply is recorded, as already-`sent`. `queued`:
   * every reply becomes a queued `messages_outbound` send. */
  replyMode?: "sync" | "queued";
}

async function queueReply(
  sql: SqlClient,
  tenantId: string,
  to: string,
  kind: InboundReplyKind,
  body: string,
): Promise<void> {
  const templateKey = kind === "text_agent" ? "text_agent_reply" : "sms_reply";
  const payload = kind === "text_agent" ? { body } : { body, compliance: kind };
  const rows = await sql<{ id: string }>`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload)
    values (${tenantId}, 'sms', ${to}, ${templateKey}, ${payload}::jsonb)
    returning id
  `;
  const row = rows[0];
  if (row) await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: row.id });
}

/**
 * Business logic for one inbound text (MASTER_SPEC §3.3): resolve the
 * tenant by the number texted (a dedicated SMS sender first, then the
 * tenant's voice numbers), waitlist YES auto-book, STOP/START/HELP
 * (opt-out state is always recorded; HELP and START are always answered;
 * the STOP confirmation is skipped only when the provider already blocked
 * the number itself), archive to `messages_inbound`, and
 * route everything else to the text-agent engine.
 */
export async function processInboundSms(
  sql: SqlClient,
  sms: CanonicalInboundSms,
  /**
   * Cluster T (text-agent engine): when provided, an "other"-classified
   * message is routed into `handleInboundText`; omitted = archive-only
   * (e.g. no LLM provider configured).
   */
  textEngineDeps?: TextAgentDeps,
  options: ProcessInboundOptions = {},
): Promise<InboundSmsResult> {
  const replyMode = options.replyMode ?? "sync";
  const fromNumber = sms.fromE164;
  const toNumber = sms.toE164;

  const numberRows = await sql<{ tenant_id: string; id: string | null }>`
    select tenant_id, id from (
      select ms.tenant_id, null::uuid as id, 0 as priority
        from public.messaging_senders ms where ms.e164 = ${toNumber} and ms.released_at is null
      union all
      select p.tenant_id, p.id, 1 as priority
        from public.phone_numbers p where p.e164 = ${toNumber} and p.released_at is null
    ) numbers
    order by priority
    limit 1
  `;
  const numberRow = numberRows[0];
  const tenantId = numberRow?.tenant_id ?? null;
  if (!tenantId) {
    // Unknown number — nothing more to do; the provider still gets a 2xx
    // (from the caller) so it doesn't retry indefinitely.
    return {};
  }

  const reply = async (kind: InboundReplyKind, body: string): Promise<InboundSmsResult> => {
    if (replyMode === "queued") await queueReply(sql, tenantId, fromNumber, kind, body);
    return { replyBody: body, replyKind: kind };
  };

  const customerRows = await sql<{ id: string }>`
    select id from public.customers where tenant_id = ${tenantId} and phone_e164 = ${fromNumber} limit 1
  `;
  const customerId = customerRows[0]?.id ?? null;

  const trimmedLower = sms.body.trim().toLowerCase();
  if (customerId && (trimmedLower === "yes" || trimmedLower === "y")) {
    const waitlistReply = await tryWaitlistAutoBook(sql, tenantId, customerId, fromNumber);
    if (waitlistReply) return reply("waitlist", waitlistReply);
    // No matching/open waitlist entry — falls through (a bare "yes" is the
    // standard CTIA opt-in keyword).
  }

  // A provider that matched a keyword itself (Telnyx `autoresponse_type`,
  // including its intent classifier on free text) is authoritative for the
  // opt-out STATE. It is NOT a signal that the provider replied: Telnyx
  // sets the field whenever a keyword matches, and its developer docs say
  // no auto-reply is sent unless one is configured (docs/VERIFY.md
  // MESSAGING-1 review). So only the STOP confirmation is left to the
  // provider — its block rule is already in place, so ours could never be
  // delivered (Telnyx rejects it with 40300) and the provider / toll-free
  // network sends its own. START and HELP are always answered here: an
  // unanswered HELP breaks carrier rules; a duplicate is harmless.
  const classification = sms.providerHandledKeyword ?? classifyInboundSms(sms.body);
  const providerBlockedAfterStop = sms.providerHandledKeyword === "stop";

  if (classification === "stop") {
    await sql`
      update public.customers
      set sms_opt_out = true, consent = consent || '{"sms": false}'::jsonb
      where tenant_id = ${tenantId} and phone_e164 = ${fromNumber}
    `;
    return providerBlockedAfterStop ? {} : reply("stop", SMS_STATIC_REPLIES.stop);
  }

  if (classification === "start") {
    await sql`
      update public.customers
      set sms_opt_out = false
      where tenant_id = ${tenantId} and phone_e164 = ${fromNumber}
    `;
    return reply("start", SMS_STATIC_REPLIES.start);
  }

  if (classification === "help") {
    return reply("help", SMS_STATIC_REPLIES.help);
  }

  // Ordinary inbound message: store + surface in the dashboard thread (the
  // realtime broadcast fires from the messages_inbound insert trigger).
  await sql`
    insert into public.messages_inbound
      (tenant_id, phone_number_id, customer_id, from_e164, to_e164, body,
       provider, provider_message_id, twilio_message_sid, classification)
    values (${tenantId}, ${numberRow?.id ?? null}, ${customerId}, ${fromNumber}, ${toNumber}, ${sms.body},
      ${sms.provider}, ${sms.providerMessageId}, ${sms.provider === "twilio" ? sms.providerMessageId : null}, 'other')
    on conflict do nothing
  `;

  if (!textEngineDeps) return {};

  // The engine applies its own gates (A2P, opt-out, rate limit, human
  // handoff) and returns `sent: false` for any of those — never a thrown
  // error — so a deliberate no-reply is simply no reply.
  const engineResult = await handleInboundText(textEngineDeps, {
    channel: "sms",
    tenantId,
    phoneE164: fromNumber,
    message: sms.body,
  });
  if (!engineResult.sent || !engineResult.reply) return {};

  if (replyMode === "queued") return reply("text_agent", engineResult.reply);

  // Delivery-tracking option (b) (BACKEND_SPEC §13): the sync reply is sent
  // by the provider from the webhook response, which yields no message id —
  // record it as already 'sent' (never 'queued': the queue worker must not
  // send it a second time) so the dashboard thread shows it.
  await sql`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload, status, sent_at, sent_via)
    values (${tenantId}, 'sms', ${fromNumber}, 'text_agent_reply', ${{ body: engineResult.reply }}::jsonb, 'sent', now(), 'sms')
  `;
  return { replyBody: engineResult.reply, replyKind: "text_agent" };
}

/**
 * Delivery receipt -> `messages_outbound`. Only terminal outcomes change
 * the row (the worker already wrote `sent` when the provider accepted it);
 * never downgrades a delivered row, and tolerates out-of-order receipts.
 */
export async function applyDeliveryStatus(
  sql: SqlClient,
  status: CanonicalDeliveryStatus,
): Promise<"updated" | "ignored" | "not_found"> {
  if (status.status === "delivered") {
    const rows = await sql<{ id: string }>`
      update public.messages_outbound
      set status = 'delivered', delivered_at = now()
      where provider_message_id = ${status.providerMessageId}
        and (provider = ${status.provider} or provider is null)
        and status in ('queued', 'sent')
      returning id
    `;
    return rows.length > 0 ? "updated" : "not_found";
  }
  if (status.status === "undelivered" || status.status === "failed") {
    const error = `${status.provider}:delivery_${status.status}:${status.errorCode ?? "unknown"}`;
    const rows = await sql<{ id: string }>`
      update public.messages_outbound
      set status = 'failed', error = ${error}
      where provider_message_id = ${status.providerMessageId}
        and (provider = ${status.provider} or provider is null)
        and status in ('queued', 'sent')
      returning id
    `;
    return rows.length > 0 ? "updated" : "not_found";
  }
  return "ignored";
}

// ---------------------------------------------------------------------------
// HTTP pipeline
// ---------------------------------------------------------------------------

export interface SmsWebhookDeps {
  sql: SqlClient;
  logger: Logger;
  textEngineDeps?: TextAgentDeps;
  /** Runs work after the response is returned (EdgeRuntime.waitUntil). */
  runInBackground: (task: () => Promise<void>) => void;
}

export type SmsWebhookResponse = WebhookAck;

const NOT_CONFIGURED: SmsWebhookResponse = {
  status: 503,
  contentType: "application/json",
  body: JSON.stringify({ error: "not_configured" }),
};
const UNAUTHORIZED: SmsWebhookResponse = {
  status: 401,
  contentType: "text/plain",
  body: "unauthorized",
};

export async function handleSmsWebhook(
  deps: SmsWebhookDeps,
  resolution: ProviderResolution<SmsProvider>,
  request: RawWebhookRequest,
): Promise<SmsWebhookResponse> {
  if (!resolution.ok) {
    deps.logger.error("sms_webhook_provider_not_configured", {
      provider: resolution.providerId,
      reason: resolution.reason,
      missing: resolution.missing,
    });
    return NOT_CONFIGURED;
  }
  const provider = resolution.provider;

  const verification = await provider.verifyInboundWebhook(request);
  if (!verification.valid) {
    deps.logger.warn("sms_webhook_signature_rejected", {
      provider: provider.id,
      reason: verification.reason,
    });
    return verification.reason === "missing_secret" ? NOT_CONFIGURED : UNAUTHORIZED;
  }

  const inbound = provider.parseInbound(request);
  if (inbound) return handleInbound(deps, provider, inbound);

  const status = provider.parseStatusCallback(request);
  if (status) {
    const dedup = await insertWebhookEventIfNew(deps.sql, {
      source: `${provider.id}_sms_status`,
      eventId: status.eventId,
      eventType: `delivery_${status.status}`,
      payload: status,
      signatureVerified: true,
    });
    if (dedup.isNew) {
      try {
        await applyDeliveryStatus(deps.sql, status);
        if (dedup.webhookEventId) await markWebhookEventProcessed(deps.sql, dedup.webhookEventId);
      } catch (err) {
        deps.logger.error("sms_status_processing_error", { error: String(err) });
        if (dedup.webhookEventId) {
          await markWebhookEventProcessed(deps.sql, dedup.webhookEventId, String(err));
        }
      }
    }
    return provider.webhookAck();
  }

  // Verified but neither an inbound message nor a receipt we track (e.g. an
  // event type we don't consume) — ack so the provider stops retrying.
  deps.logger.info("sms_webhook_ignored_event", { provider: provider.id });
  return provider.webhookAck();
}

async function handleInbound(
  deps: SmsWebhookDeps,
  provider: SmsProvider,
  inbound: CanonicalInboundSms,
): Promise<SmsWebhookResponse> {
  const dedup = await insertWebhookEventIfNew(deps.sql, {
    // `twilio_sms` for Twilio — the source every pre-MESSAGING-1 row used.
    source: `${provider.id}_sms`,
    eventId: inbound.eventId,
    eventType: "inbound_sms",
    payload: inbound,
    signatureVerified: true,
  });
  if (!dedup.isNew) return provider.webhookAck();

  const run = async (replyMode: "sync" | "queued"): Promise<InboundSmsResult> => {
    try {
      const result = await processInboundSms(deps.sql, inbound, deps.textEngineDeps, {
        replyMode,
      });
      if (dedup.webhookEventId) await markWebhookEventProcessed(deps.sql, dedup.webhookEventId);
      return result;
    } catch (err) {
      deps.logger.error("sms_inbound_processing_error", {
        provider: provider.id,
        error: String(err),
      });
      if (dedup.webhookEventId) {
        await markWebhookEventProcessed(deps.sql, dedup.webhookEventId, String(err));
      }
      return {};
    }
  };

  if (provider.capabilities.syncWebhookReply) {
    const result = await run("sync");
    return provider.webhookAck(result.replyBody);
  }

  deps.runInBackground(async () => {
    await run("queued");
  });
  return provider.webhookAck();
}

// ---------------------------------------------------------------------------
// Routing helpers (used by index.ts; portable so they're unit tested)
// ---------------------------------------------------------------------------

export interface SmsWebhookRoute {
  providerId: string;
  kind: "inbound" | "status";
}

/** `/functions/v1/webhooks-sms/telnyx` -> {telnyx, inbound};
 * `.../webhooks-sms/twilio/status` -> {twilio, status}. The runtime may or
 * may not keep the `/functions/v1` prefix, so match on the function name. */
export function parseSmsWebhookRoute(pathname: string): SmsWebhookRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  const at = segments.lastIndexOf("webhooks-sms");
  const rest = at >= 0 ? segments.slice(at + 1) : [];
  const providerId = rest[0]?.toLowerCase();
  if (!providerId || !/^[a-z0-9_-]+$/.test(providerId)) return null;
  if (rest.length === 1) return { providerId, kind: "inbound" };
  if (rest.length === 2 && rest[1] === "status") return { providerId, kind: "status" };
  return null;
}

/** The public URL the provider called — what URL-signing schemes verify. */
export function publicWebhookUrl(baseUrl: string, route: SmsWebhookRoute, search: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${route.providerId}${route.kind === "status" ? "/status" : ""}${search}`;
}
