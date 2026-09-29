import type { SqlClient } from "./types.ts";

/**
 * Per-message SMS/email cost capture (COCKPIT-1), written by
 * `worker-messages-outbound` the moment a provider accepts a message.
 *
 * These are ESTIMATES (`cost_events.source = 'estimate'`), computed from
 * `platform_settings.provider_cost_card` (US cents; seeded by migration
 * 20260929180000 from the providers' public price pages, verified
 * 2026-09-29 — see docs/VERIFY.md "COCKPIT-1"):
 *   - SMS: per-segment carrier-network price + per-segment carrier surcharge
 *     (Twilio $0.0083 + ~$0.004, Telnyx $0.004 + ~$0.004 for US 10DLC).
 *   - Email (Resend): $20 / 50,000 emails = $0.0004 per email.
 * Neither provider returns the final price at send time, so replace the
 * estimate with `provider_reported` if/when a price callback is wired.
 *
 * Idempotent per message: keyed by `(provider, product, external_ref =
 * messages_outbound.id)`, so a redelivered queue job never double counts.
 */

export interface ProviderCostCard {
  twilio?: { sms_segment_cents?: number; sms_carrier_fee_cents?: number };
  telnyx?: { sms_segment_cents?: number; sms_carrier_fee_cents?: number };
  resend?: { email_cents?: number };
}

/** Fallbacks when `platform_settings.provider_cost_card` is absent. */
export const DEFAULT_COST_CARD = {
  twilio: { sms_segment_cents: 0.83, sms_carrier_fee_cents: 0.4 },
  telnyx: { sms_segment_cents: 0.4, sms_carrier_fee_cents: 0.4 },
  resend: { email_cents: 0.04 },
} as const;

// GSM 03.38 basic + extension tables. Anything outside forces UCS-2 (70/67).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€\f";

/** Number of SMS segments a body is billed as (GSM-7: 160 / 153 per part; UCS-2: 70 / 67). */
export function smsSegments(body: string): number {
  let septets = 0;
  let gsm = true;
  for (const ch of body) {
    if (GSM7_BASIC.includes(ch)) septets += 1;
    else if (GSM7_EXTENDED.includes(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    if (septets === 0) return 1;
    return septets <= 160 ? 1 : Math.ceil(septets / 153);
  }
  const units = body.length; // UTF-16 code units, which is what UCS-2 segments count
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

export function smsUnitCostCents(
  provider: "twilio" | "telnyx",
  card: ProviderCostCard | null,
): number {
  const configured = card?.[provider];
  const fallback = DEFAULT_COST_CARD[provider];
  return (
    (configured?.sms_segment_cents ?? fallback.sms_segment_cents) +
    (configured?.sms_carrier_fee_cents ?? fallback.sms_carrier_fee_cents)
  );
}

export function emailUnitCostCents(card: ProviderCostCard | null): number {
  return card?.resend?.email_cents ?? DEFAULT_COST_CARD.resend.email_cents;
}

async function loadCostCard(sql: SqlClient): Promise<ProviderCostCard | null> {
  const rows = await sql<{ value: ProviderCostCard }>`
    select value from public.platform_settings where key = 'provider_cost_card'
  `;
  return rows[0]?.value ?? null;
}

export interface RecordMessageCostParams {
  tenantId: string;
  messageId: string;
  relatedCallId: string | null;
  provider: string;
  kind: "sms" | "email";
  /** SMS body (segment count is derived from it). Ignored for email. */
  body?: string;
}

/** Records the estimated cost of one accepted message. Never throws: a cost-ledger
 * failure must not fail or retry an already-sent message (which would double send). */
export async function recordMessageCost(
  sql: SqlClient,
  params: RecordMessageCostParams,
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    const card = await loadCostCard(sql);
    let product: string;
    let quantity: number;
    let unitCost: number;
    if (params.kind === "sms") {
      if (params.provider !== "twilio" && params.provider !== "telnyx") return;
      product = "sms_segment";
      quantity = smsSegments(params.body ?? "");
      unitCost = smsUnitCostCents(params.provider, card);
    } else {
      product = "email";
      quantity = 1;
      unitCost = emailUnitCostCents(card);
    }
    const total = quantity * unitCost;
    await sql`
      insert into public.cost_events (
        tenant_id, call_id, provider, product, quantity, unit, unit_cost_cents,
        total_cost_cents, raw, source, external_ref, occurred_at
      ) values (
        ${params.tenantId}, ${params.relatedCallId}, ${params.provider}, ${product}, ${quantity},
        'message', ${unitCost}, ${total},
        ${{ message_id: params.messageId, segments: quantity, basis: "provider_cost_card" }}::jsonb,
        'estimate', ${params.messageId}, now()
      )
      on conflict (provider, product, external_ref) where external_ref is not null do nothing
    `;
  } catch (err) {
    onError?.(err);
  }
}
