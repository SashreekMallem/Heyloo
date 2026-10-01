import type { MessagingRegistry } from "./providers/messaging/registry.ts";
import type { SmsProvider } from "./providers/messaging/types.ts";
import type { SqlClient } from "./types.ts";

/**
 * Can this business text a customer RIGHT NOW? One definition, shared by the
 * `messages_outbound` worker (which decides how to send a queued message) and
 * everything that must not PROMISE a text the worker cannot send: the voice
 * tools (`send_sms_confirmation`, `send_payment_link`, `join_waitlist`) and the
 * per-call `{{sms_enabled}}` / `{{texting_policy_text}}` dynamic variables
 * `voice-inbound` sends (MSG-3, docs/design/MESSAGING_PROVIDERS.md).
 *
 * Owner decision (MSG-3): phone numbers are Retell-provided and there is NO
 * texting provider at launch, so until a tenant has a carrier-verified SMS
 * sender AND that sender's provider has secrets configured, texting is OFF.
 * "Verified sender" is `messaging_senders.registration_status = 'verified'`
 * (legacy fallback: the tenant's primary phone number with
 * `tenants.a2p_status = 'verified'`); "provider configured" is the messaging
 * registry resolving the sender's / tenant's / platform SMS provider.
 */

export type SmsRoute =
  | { ok: true; from: string; provider: SmsProvider }
  | {
      ok: false;
      reason: "sender_not_verified" | "no_sending_number" | "provider_not_configured";
      detail?: string;
    };

export interface SmsSenderRow {
  a2p_status: string | null;
  sms_provider: string | null;
  sender_e164: string | null;
  sender_provider: string | null;
  sender_status: string | null;
  primary_e164: string | null;
}

/** Just the registry surface routing needs (tests and hot-path callers pass a stub). */
export type SmsRegistry = Pick<MessagingRegistry, "resolveSms">;

/** Which number and which provider account a tenant texts from, and
 * whether carriers have approved it. Pure: `row` is `loadSmsSenderRow`'s result. */
export function evaluateSmsRoute(
  row: SmsSenderRow | undefined,
  registry: SmsRegistry,
  options: { requireVerified: boolean },
): SmsRoute {
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

export async function loadSmsSenderRow(
  sql: SqlClient,
  tenantId: string,
): Promise<SmsSenderRow | undefined> {
  const rows = await sql<SmsSenderRow>`
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
  return rows[0];
}

/** Which number and provider a tenant's text goes out through (the worker's routing). */
export async function resolveSmsRoute(
  sql: SqlClient,
  tenantId: string,
  registry: SmsRegistry,
  options: { requireVerified: boolean },
): Promise<SmsRoute> {
  return evaluateSmsRoute(await loadSmsSenderRow(sql, tenantId), registry, options);
}

/** True only when a CUSTOMER text would actually be sent: a carrier-verified
 * sender with a configured provider (exactly `resolveSmsRoute`'s `ok` for a
 * customer message). One indexed statement. */
export async function isSmsAvailable(
  sql: SqlClient,
  tenantId: string,
  registry: SmsRegistry,
): Promise<boolean> {
  return (await resolveSmsRoute(sql, tenantId, registry, { requireVerified: true })).ok;
}

// ---------------------------------------------------------------------------
// What the model is told. Every sentence that mentions a text is either
// conditional on availability or a prohibition; `packages/templates`'
// texting red-team test (and this package's sms-availability.test.ts) pin that.
// ---------------------------------------------------------------------------

/** `{{texting_policy_text}}` when the business can text. */
export const TEXTING_POLICY_ON =
  "Text messages are available for this business. After a booking or order is confirmed you may " +
  "call send_sms_confirmation, and tell the caller a text confirmation is on its way only when " +
  "that tool answers queued: true; if it says texting is unavailable, do not mention a text at all.";

/** `{{texting_policy_text}}` when it cannot (also the compiled default, so an unresolved call is safe). */
export const TEXTING_POLICY_OFF =
  "Text messages are NOT available for this business right now. Never offer to text or message the " +
  "caller, never say or imply that you are texting, messaging or sending anything to their phone " +
  "(no text confirmation, no link, no reminder), and do not call send_sms_confirmation or " +
  "send_payment_link. Confirm out loud instead: after a tool reports the booking or order is " +
  "confirmed, say so in one sentence with the day and time (the details were already read back " +
  "once before saving). If the caller " +
  "wants it in writing or asks for a link, tell them someone from the team will follow up.";

export interface TextingVariables extends Record<string, string> {
  /** `"true"` / `"false"` (Retell dynamic variables are strings). */
  sms_enabled: string;
  texting_policy_text: string;
}

export function resolveTextingVariables(smsAvailable: boolean): TextingVariables {
  return smsAvailable
    ? { sms_enabled: "true", texting_policy_text: TEXTING_POLICY_ON }
    : { sms_enabled: "false", texting_policy_text: TEXTING_POLICY_OFF };
}

/** The text agent's `{{texting_policy_text}}` (SMS conversations and web chat), same idea as above. */
export const TEXT_AGENT_TEXTING_ON =
  "Text messages are available for this business: you may text this customer a payment link " +
  "with send_payment_link, and say a link is on its way only when that tool answers queued: true.";

export const TEXT_AGENT_TEXTING_OFF =
  "Text messages are NOT available for this business right now. Never offer to text the " +
  "customer, never promise a text, a link or a code by text, and do not call send_payment_link. " +
  "Answer in this chat instead; if they need a link or something in writing, tell them someone " +
  "from the team will follow up.";

export function resolveTextAgentTexting(textingAvailable: boolean): string {
  return textingAvailable ? TEXT_AGENT_TEXTING_ON : TEXT_AGENT_TEXTING_OFF;
}

/** Tool result message: `send_sms_confirmation` with no usable sender. */
export const SMS_UNAVAILABLE_CONFIRMATION_MESSAGE =
  "Texting is not available for this business, so NO text was sent and none will be. Do not say or " +
  "imply that you are texting or sending a message. If the booking or order itself succeeded, tell " +
  "the caller it is confirmed and read back the day, time and key details out loud once; if they " +
  "want it in writing, say someone from the team will follow up.";

/** Tool result message: `send_payment_link` with no usable sender. Nothing was created. */
export const SMS_UNAVAILABLE_PAYMENT_LINK_MESSAGE =
  "Texting is not available for this business, so NO payment link was created or sent. Do not say " +
  "or imply that a link is on its way. Tell the caller someone from the team will follow up about " +
  "payment.";

/** Added to a successful `join_waitlist` result when texting is unavailable. */
export const WAITLIST_NO_TEXT_NOTE =
  "Texting is not available for this business, so do not tell the caller they will be texted. Say " +
  "someone from the team will reach out if something opens up.";
