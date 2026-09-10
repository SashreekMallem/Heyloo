import { z } from "zod";

/**
 * PayPal webhook event envelope (`/webhooks-paypal` — BACKEND_SPEC §8
 * "Referral qualification + payout batch"; E2E_FLOWS_AUDIT H2). Kept
 * function-local (not `_shared/schemas/`, outside this cluster's
 * ownership) — same "single-purpose schema lives next to its one
 * consumer" convention `api-adapter-connect/schema.ts` already uses.
 *
 * VERIFY (docs/VERIFY.md): `developer.paypal.com` is egress-blocked in this
 * build (same as `_shared/providers/paypal.ts`'s own VERIFY note). Field
 * names below (`id`, `event_type`, `resource_type`, `resource.payout_item_id`,
 * `resource.payout_batch_id`, `resource.transaction_status`,
 * `resource.payout_item.sender_item_id`) were cross-checked via GitHub code
 * search against multiple independent real-world PayPal Payouts webhook
 * integrations (not guessed from memory alone) — `resource` is left a loose
 * `z.record` passthrough since only the payout-item shape is handled today;
 * a live sandbox delivery is still worth confirming before go-live.
 */
export const PayPalWebhookEventSchema = z
  .object({
    id: z.string().min(1),
    event_type: z.string().min(1),
    resource_type: z.string().optional(),
    resource: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export type PayPalWebhookEvent = z.infer<typeof PayPalWebhookEventSchema>;

export const PAYOUT_ITEM_EVENT_TYPES = [
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.DENIED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.ONHOLD",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
] as const;

export interface PayoutItemResource {
  payoutBatchId: string;
  senderItemId: string;
  transactionStatus: string;
}

/** Narrows `resource` for the payout-item event types this handler acts on
 * — `payout_batch_id` lives at the top of `resource`, `sender_item_id`
 * nested under `resource.payout_item` (the request-time echo of what
 * `_shared/providers/paypal.ts`'s `createPayoutBatch` sent as
 * `sender_item_id: referral_partner_id`). Returns `null` on anything that
 * doesn't match — the caller treats that as "not a payout-item event this
 * handler understands" rather than throwing. */
export function parsePayoutItemResource(
  resource: Record<string, unknown>,
): PayoutItemResource | null {
  const payoutBatchId = resource["payout_batch_id"];
  const transactionStatus = resource["transaction_status"];
  const payoutItem = resource["payout_item"];
  if (
    typeof payoutBatchId !== "string" ||
    typeof transactionStatus !== "string" ||
    typeof payoutItem !== "object" ||
    !payoutItem
  ) {
    return null;
  }
  const senderItemId = (payoutItem as Record<string, unknown>)["sender_item_id"];
  if (typeof senderItemId !== "string") return null;
  return { payoutBatchId, senderItemId, transactionStatus };
}
