import type { Logger, SqlClient } from "../_shared/types.ts";
import type { PayPalWebhookEvent } from "./schema.ts";
import { parsePayoutItemResource } from "./schema.ts";

/**
 * `/webhooks-paypal` background processing (BACKEND_SPEC §8 referral
 * payout batch; E2E_FLOWS_AUDIT H2 — "Payout status never advances past
 * 'sent'/commission never advances past 'batched' — no /webhooks-paypal
 * consumer exists"). The Deno `index.ts` owns signature verification +
 * `webhook_events` dedup + fast-ack (matching `webhooks-stripe`'s split
 * exactly); this file is the pure-DB-effects branch, unit tested with a
 * mocked `sql`.
 *
 * Matching a `PAYMENT.PAYOUTS-ITEM.*` event back to ONE `referral_payouts`
 * row needs no new column: `job-referral-payouts/handler.ts` sends exactly
 * one PayPal payout item per partner per batch with
 * `sender_item_id: referral_partner_id`, and inserts exactly one
 * `referral_payouts` row per partner with that same batch's
 * `paypal_batch_id` — so `(paypal_batch_id, referral_partner_id)` already
 * uniquely identifies the row this event is about.
 *
 * `commission_events`/`referrals`/`referral_partners.ytd_payout_cents` are
 * updated alongside `referral_payouts` in the SAME transition this webhook
 * observes, for the same reason `referral_payouts` itself needed a
 * consumer: leaving `commission_events` stuck at `'batched'` forever would
 * just move H2's bug to a different table. Every write below is gated on
 * `referral_payouts.status = 'sent'` (the only non-terminal state a row can
 * be in) so a redelivered event — `webhook_events`' dedup already blocks an
 * identical event id, but PayPal can still deliver more than one event
 * touching the same item — is a safe no-op the second time.
 *
 * VERIFY/FIX_REQUESTS (docs/audit/FIX_REQUESTS.md): `referral_payouts`'
 * CHECK constraint today is `('pending','sent','failed')` — this handler
 * writes `'completed'`/`'returned'` too, per the task brief's literal
 * "sent → completed/failed/returned" and to distinguish "PayPal confirmed
 * payment" from "PayPal returned the funds to us" for finance. An additive
 * migration widening that constraint is requested from the DB-owning
 * cluster; until it lands, a live `'completed'`/`'returned'` write will be
 * rejected by Postgres (loud failure, never a silently-wrong status) —
 * this file cannot apply that migration itself (outside this cluster's
 * ownership of `supabase/migrations`).
 */
export type PayoutOutcome =
  | "completed"
  | "failed"
  | "returned"
  | "in_flight"
  | "ignored_not_payout_item"
  | "no_matching_payout";

const SUCCESS_EVENT_TYPES = new Set(["PAYMENT.PAYOUTS-ITEM.SUCCEEDED"]);
const FAILED_EVENT_TYPES = new Set([
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.DENIED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
]);
const RETURNED_EVENT_TYPES = new Set([
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
]);

export async function processPayPalEvent(
  sql: SqlClient,
  event: PayPalWebhookEvent,
  logger: Logger,
): Promise<PayoutOutcome> {
  const resource = parsePayoutItemResource(event.resource);
  if (!resource) {
    logger.debug("paypal_event_not_payout_item", { type: event.event_type, id: event.id });
    return "ignored_not_payout_item";
  }

  if (
    !SUCCESS_EVENT_TYPES.has(event.event_type) &&
    !FAILED_EVENT_TYPES.has(event.event_type) &&
    !RETURNED_EVENT_TYPES.has(event.event_type)
  ) {
    // UNCLAIMED / ONHOLD / anything else still in flight — no terminal
    // state change yet; a later event on the same item will resolve it.
    logger.info("paypal_payout_item_in_flight", {
      type: event.event_type,
      payout_batch_id: resource.payoutBatchId,
      referral_partner_id: resource.senderItemId,
    });
    return "in_flight";
  }

  const terminalStatus = SUCCESS_EVENT_TYPES.has(event.event_type)
    ? "completed"
    : FAILED_EVENT_TYPES.has(event.event_type)
      ? "failed"
      : "returned";

  const updatedRows = await sql<{ id: string; total_cents: number }>`
    update public.referral_payouts
    set status = ${terminalStatus}
    where paypal_batch_id = ${resource.payoutBatchId}
      and referral_partner_id = ${resource.senderItemId}
      and status = 'sent'
    returning id, total_cents
  `;
  const payout = updatedRows[0];
  if (!payout) {
    logger.warn("paypal_payout_no_matching_referral_payouts_row", {
      type: event.event_type,
      payout_batch_id: resource.payoutBatchId,
      referral_partner_id: resource.senderItemId,
    });
    return "no_matching_payout";
  }

  if (terminalStatus === "completed") {
    const commissionRows = await sql<{ id: string; referral_id: string }>`
      update public.commission_events
      set status = 'paid'
      where referral_partner_id = ${resource.senderItemId} and status = 'batched'
      returning id, referral_id
    `;
    for (const commission of commissionRows) {
      await sql`
        update public.referrals set status = 'paid'
        where id = ${commission.referral_id} and status = 'qualified'
      `;
    }
    await sql`
      update public.referral_partners
      set ytd_payout_cents = ytd_payout_cents + ${payout.total_cents}
      where id = ${resource.senderItemId}
    `;
    logger.info("paypal_payout_completed", {
      referral_partner_id: resource.senderItemId,
      payout_batch_id: resource.payoutBatchId,
      total_cents: payout.total_cents,
      commission_events_paid: commissionRows.length,
    });
    return "completed";
  }

  // failed / returned — revert the accrued commissions so next month's
  // batch retries them (BACKEND_SPEC §8: "a failed/blocked item ... does
  // not block the rest of the batch and is retried next cycle").
  await sql`
    update public.commission_events
    set status = 'accrued'
    where referral_partner_id = ${resource.senderItemId} and status = 'batched'
  `;
  await sql`
    insert into public.alerts (rule, severity, tenant_id, payload)
    values (
      'referral_payout_failed', 'warning', null,
      ${{
        referral_partner_id: resource.senderItemId,
        payout_batch_id: resource.payoutBatchId,
        event_type: event.event_type,
        terminal_status: terminalStatus,
      }}::jsonb
    )
  `;
  logger.warn("paypal_payout_failed_or_returned", {
    referral_partner_id: resource.senderItemId,
    payout_batch_id: resource.payoutBatchId,
    terminal_status: terminalStatus,
  });
  return terminalStatus;
}
