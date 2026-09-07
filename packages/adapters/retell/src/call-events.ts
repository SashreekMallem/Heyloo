/**
 * `/voice/events` `call_ended` support (BACKEND_SPEC §7.3, API_AND_FLOWS.md
 * A.1 "Call events webhook" + "GET /get-call reconciliation" for the cost
 * schema). Bundles signature verification + parsing + cost normalization
 * into one call, per `VoiceProvider.verifyAndParseCallEndedWebhook`.
 */

import {
  type CallEndedEvent,
  type CanonicalCostBreakdown,
  DISCONNECTION_REASONS,
  type DisconnectionReason,
  PayloadValidationError,
  SignatureVerificationError,
  zCanonicalCostBreakdown,
} from "@heyloo/canonical-types";
import {
  type RetellCallCost,
  type RetellCallObject,
  zRetellCallLifecycleWebhook,
} from "./raw-types.js";
import { verifyRetellWebhookSignature } from "./signature.js";

export function verifyAndParseRetellCallEndedWebhook(
  rawBody: string,
  signatureHeader: string | null,
  apiKey: string,
): CallEndedEvent {
  const verification = verifyRetellWebhookSignature({ rawBody, signatureHeader, apiKey });
  if (!verification.valid) {
    throw new SignatureVerificationError("retell", verification.reason);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (cause) {
    throw new PayloadValidationError("retell", "call_ended webhook: invalid JSON", cause);
  }

  const parsed = zRetellCallLifecycleWebhook.safeParse(json);
  if (!parsed.success) {
    throw new PayloadValidationError("retell", "call_ended webhook", parsed.error);
  }
  if (parsed.data.event !== "call_ended") {
    throw new PayloadValidationError(
      "retell",
      `call_ended webhook: expected event 'call_ended', got '${parsed.data.event}'`,
      parsed.data,
    );
  }

  return toCanonicalCallEndedEvent(parsed.data.call);
}

function toCanonicalCallEndedEvent(call: RetellCallObject): CallEndedEvent {
  if (call.end_timestamp === undefined) {
    throw new PayloadValidationError(
      "retell",
      "call_ended webhook: call.end_timestamp is required for a call_ended event",
      call,
    );
  }

  const disconnectionReason = normalizeDisconnectionReason(call.disconnection_reason);

  return {
    providerCallId: call.call_id,
    startedAt: epochMsToIso(call.start_timestamp),
    endedAt: epochMsToIso(call.end_timestamp),
    durationSeconds: Math.max(0, (call.end_timestamp - call.start_timestamp) / 1000),
    disconnectionReason,
    transferOccurred: disconnectionReason === "call_transfer",
    costBreakdown: normalizeCostBreakdown(call.call_cost),
  };
}

function epochMsToIso(epochMs: number): CallEndedEvent["startedAt"] {
  return new Date(epochMs).toISOString() as CallEndedEvent["startedAt"];
}

function normalizeDisconnectionReason(raw: string | undefined): DisconnectionReason {
  if (raw && (DISCONNECTION_REASONS as readonly string[]).includes(raw)) {
    return raw as DisconnectionReason;
  }
  return "unknown";
}

/**
 * Normalize Retell's `call_cost.product_costs[]` into a `CanonicalCostBreakdown`
 * (MASTER_SPEC/API_AND_FLOWS.md, BACKEND_SPEC `cost_events.raw`). VERIFY-4:
 * Retell's convention (per indexed community sources) is that `cost` is
 * already in fractional cents/dollars depending on account currency
 * settings — we assume USD cents here (matching this product's
 * integer-cents money invariant, CLAUDE.md Rule 2) and round to the nearest
 * integer cent; confirm the exact unit against a live sandbox call before
 * the margin cockpit trusts these numbers for billing reconciliation.
 * Granularity is always "exact" here: Retell's webhook itemizes real
 * per-product costs (not an estimate) whenever `call_cost` is present;
 * absence of `call_cost` (e.g. a call that errored before any usage was
 * metered) falls back to a zeroed "estimated" breakdown rather than
 * fabricating line items.
 */
export function normalizeCostBreakdown(
  callCost: RetellCallCost | undefined,
): CanonicalCostBreakdown {
  if (!callCost) {
    return zCanonicalCostBreakdown.parse({
      total_cents: 0,
      currency: "USD",
      granularity: "estimated",
      line_items: [],
    });
  }

  const lineItems = callCost.product_costs.map((item) => ({
    product: item.product,
    cost_cents: Math.max(0, Math.round(item.cost)),
    ...(item.unit_price !== undefined
      ? { unit_price_cents: Math.max(0, Math.round(item.unit_price)) }
      : {}),
    is_transfer_leg_cost: item.is_transfer_leg_cost,
    raw: item,
  }));

  const totalFromLineItems = lineItems.reduce((sum, item) => sum + item.cost_cents, 0);
  const totalCents = Math.max(0, Math.round(callCost.combined_cost)) || totalFromLineItems;

  // Parsed (not just cast) through the canonical schema — validates the
  // shape we just built AND produces the properly-branded `Cents` fields.
  return zCanonicalCostBreakdown.parse({
    total_cents: totalCents,
    currency: "USD",
    granularity: "exact",
    line_items: lineItems,
  });
}
