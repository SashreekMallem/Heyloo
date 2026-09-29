import { z } from "zod";
import { normalizeE164 } from "./phone.ts";
import type { OwnerAlertKind } from "./providers/messaging/types.ts";
import { enqueue, QUEUE_NAMES } from "./queue.ts";
import type { Logger, SqlClient } from "./types.ts";

/**
 * Owner notifications (MESSAGING-1, docs/design/MESSAGING_PROVIDERS.md
 * "Owner alerts"). An owner alert is a `messages_outbound` row whose
 * template is in `OWNER_ALERT_TEMPLATES`; the worker re-plans its delivery
 * from the tenant's CURRENT preferences at send time (SMS, email, or both),
 * so a preference change applies to alerts already queued.
 *
 * Preferences live at `agent_configs.dynamic_variable_overrides.delivery`
 * (written by /dashboard/delivery; shape = canonical
 * `deliveryPreferencesSchema`). Every field is parsed independently so one
 * malformed value never disables alerts entirely.
 */

export const OWNER_ALERT_TEMPLATE_BY_KIND: Record<OwnerAlertKind, string> = {
  message_taken: "take_message",
  new_booking: "owner_new_booking",
  new_order: "owner_new_order",
  urgent_call: "owner_urgent_call",
  missed_transfer: "owner_missed_transfer",
  line_ready: "owner_line_ready",
};

/** `after_hours_message` renders like `take_message` (templates.ts) and is
 * owner-facing too. */
export const OWNER_ALERT_TEMPLATES: ReadonlySet<string> = new Set([
  ...Object.values(OWNER_ALERT_TEMPLATE_BY_KIND),
  "after_hours_message",
]);

export function isOwnerAlertTemplate(templateKey: string): boolean {
  return OWNER_ALERT_TEMPLATES.has(templateKey);
}

export interface OwnerAlertContact {
  smsEnabled: boolean;
  emailEnabled: boolean;
  /** E.164; `delivery.alert_phone`, else the agent's transfer number. */
  alertPhone: string | null;
  /** `delivery.notification_email`, else the account owner's sign-in email. */
  email: string | null;
}

const zEmail = z.email();

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function email(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return zEmail.safeParse(trimmed).success ? trimmed : null;
}

export function parseOwnerAlertContact(input: {
  delivery: unknown;
  transferNumber: string | null;
  ownerEmail: string | null;
}): OwnerAlertContact {
  const delivery =
    input.delivery && typeof input.delivery === "object" && !Array.isArray(input.delivery)
      ? (input.delivery as Record<string, unknown>)
      : {};
  const alertPhone =
    normalizeE164(typeof delivery["alert_phone"] === "string" ? delivery["alert_phone"] : null) ??
    normalizeE164(input.transferNumber);
  return {
    smsEnabled: bool(delivery["sms_enabled"], true),
    emailEnabled: bool(delivery["email_enabled"], true),
    alertPhone,
    email: email(delivery["notification_email"]) ?? email(input.ownerEmail),
  };
}

export async function loadOwnerAlertContact(
  sql: SqlClient,
  tenantId: string,
): Promise<OwnerAlertContact> {
  const rows = await sql<{
    transfer_number: string | null;
    delivery: unknown;
    owner_email: string | null;
  }>`
    select ac.transfer_number,
      ac.dynamic_variable_overrides -> 'delivery' as delivery,
      (select u.email from public.memberships m
         join auth.users u on u.id = m.user_id
        where m.tenant_id = t.id and m.role = 'owner'
        order by m.created_at asc
        limit 1) as owner_email
    from public.tenants t
    left join public.agent_configs ac on ac.tenant_id = t.id
    where t.id = ${tenantId}
  `;
  const row = rows[0];
  return parseOwnerAlertContact({
    delivery: row?.delivery ?? null,
    transferNumber: row?.transfer_number ?? null,
    ownerEmail: row?.owner_email ?? null,
  });
}

/**
 * Producer helper: enqueue ONE owner-alert row; the worker fans it out to
 * SMS and/or email per preferences at send time. The row's initial
 * channel/recipient is the best destination known now (SMS to the alert
 * phone when texting is on, else email), purely so the dashboard shows a
 * sensible recipient before it sends. Idempotent: per related booking or
 * order when one is given (so several bookings on one call each alert once,
 * and the `voice-events` end-of-call alert never repeats one a voice tool
 * already sent), else per (call, kind) when a `relatedCallId` is given.
 * Returns null when the owner has no reachable destination at all (nothing
 * to enqueue; the event itself is still on the call/booking row) or when it
 * was already alerted.
 */
export async function enqueueOwnerAlert(
  sql: SqlClient,
  input: {
    tenantId: string;
    kind: OwnerAlertKind;
    payload: Record<string, unknown>;
    relatedCallId?: string | null;
    relatedBookingId?: string | null;
    relatedOrderId?: string | null;
  },
): Promise<string | null> {
  const contact = await loadOwnerAlertContact(sql, input.tenantId);
  const destination =
    contact.smsEnabled && contact.alertPhone
      ? { channel: "sms" as const, recipient: contact.alertPhone }
      : contact.email
        ? { channel: "email" as const, recipient: contact.email }
        : null;
  if (!destination) return null;

  const templateKey = OWNER_ALERT_TEMPLATE_BY_KIND[input.kind];
  const callId = input.relatedCallId ?? null;
  const bookingId = input.relatedBookingId ?? null;
  const orderId = input.relatedOrderId ?? null;
  const rows = await sql<{ id: string }>`
    insert into public.messages_outbound
      (tenant_id, channel, recipient, template_key, payload, related_call_id, related_booking_id, related_order_id)
    select ${input.tenantId}, ${destination.channel}, ${destination.recipient}, ${templateKey},
      ${input.payload}::jsonb, ${callId}, ${bookingId}, ${orderId}
    where (
      ${callId}::uuid is null and ${bookingId}::uuid is null and ${orderId}::uuid is null
    ) or not exists (
      select 1 from public.messages_outbound mo
      where mo.tenant_id = ${input.tenantId}
        and mo.template_key = ${templateKey}
        and mo.parent_message_id is null
        and case
          when ${bookingId}::uuid is not null then mo.related_booking_id = ${bookingId}::uuid
          when ${orderId}::uuid is not null then mo.related_order_id = ${orderId}::uuid
          else mo.related_call_id = ${callId}::uuid
        end
    )
    returning id
  `;
  const id = rows[0]?.id ?? null;
  if (id) await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: id });
  return id;
}

/**
 * Voice-tool flavour of `enqueueOwnerAlert` (VOICE-ALERTS-1): an alert is a
 * side effect, never a reason for a tool call to fail or hang, so this
 * swallows and logs any error, and never alerts for a test call (the
 * regression suite and owner self-calls would otherwise page the owner,
 * same rule as `voice-events`).
 */
export async function enqueueOwnerAlertBestEffort(
  sql: SqlClient,
  logger: Logger,
  ctx: { tenantId: string; isTestCall: boolean },
  input: Omit<Parameters<typeof enqueueOwnerAlert>[1], "tenantId">,
): Promise<string | null> {
  if (ctx.isTestCall) return null;
  try {
    return await enqueueOwnerAlert(sql, { ...input, tenantId: ctx.tenantId });
  } catch (err) {
    logger.error("owner_alert_enqueue_failed", {
      tenant_id: ctx.tenantId,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
