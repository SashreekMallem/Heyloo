import type { PayoutItem, PayPalFetch } from "../_shared/providers/paypal.ts";
import { createPayoutBatch, getAccessToken } from "../_shared/providers/paypal.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * Monthly referral-partner payout batch (BACKEND_SPEC §8 "Referral
 * qualification + payout batch", `0 8 1 * *`; API_AND_FLOWS.md A.4 "Payouts
 * API — batch create"). Batches every partner with `commission_events` in
 * `'accrued'` status into ONE PayPal Payouts batch call (max 15,000 items,
 * far above our partner count), then creates `referral_payouts` rows and
 * flips those commission events to `'batched'`.
 *
 * Idempotency (per API_AND_FLOWS.md A.4): `sender_batch_id` reused within
 * 30 days is rejected by PayPal as a duplicate — a deterministic
 * `referral-payout-{period}` id IS the idempotency guarantee at the PayPal
 * layer. This function adds a cheaper first check on our own side (skip
 * entirely if a non-failed `referral_payouts` row already exists for this
 * period) so a re-run of an already-succeeded month doesn't even attempt
 * the (harmless, PayPal-rejected) duplicate call.
 *
 * A partner missing a `paypal_email` is skipped (never included in the
 * batch item list) with their commission events left `'accrued'` for the
 * next cycle — matches BACKEND_SPEC §8's "a failed/blocked item... does not
 * block the rest of the batch and is retried next cycle once the partner's
 * ... PayPal-account issue is resolved."
 *
 * Item-level payout status (`PAYMENT.PAYOUTS-ITEM.SUCCEEDED`/`FAILED`/
 * `BLOCKED`/`UNCLAIMED`, per A.4) arrives asynchronously via PayPal
 * webhooks — consuming those to flip `referral_payouts`/`commission_events`
 * from `'sent'`/`'batched'` to a final `paid`/`failed` state is a follow-up
 * (docs/BUILD_NOTES.md T4 entry): no `/webhooks-paypal` function exists yet,
 * so this job's own success only means "PayPal accepted the batch for
 * async processing," not "every partner was paid."
 */
export interface ReferralPayoutsDeps {
  paypalFetch: PayPalFetch;
  paypalBaseUrl: string;
  paypalClientId: string;
  paypalClientSecret: string;
  logger: Logger;
}

interface AccruedPartnerRow {
  referral_partner_id: string;
  paypal_email: string | null;
  name: string;
  total_cents: number;
}

export function currentPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function findAccruedByPartner(sql: SqlClient): Promise<AccruedPartnerRow[]> {
  return sql<AccruedPartnerRow>`
    select
      rp.id as referral_partner_id,
      rp.paypal_email,
      rp.name,
      sum(ce.amount_cents)::int as total_cents
    from public.commission_events ce
    join public.referral_partners rp on rp.id = ce.referral_partner_id
    where ce.status = 'accrued'
    group by rp.id, rp.paypal_email, rp.name
    having sum(ce.amount_cents) > 0
  `;
}

export async function alreadyRanForPeriod(sql: SqlClient, period: string): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    select id from public.referral_payouts where period = ${period}::date and status <> 'failed' limit 1
  `;
  return rows.length > 0;
}

export interface ReferralPayoutRunResult {
  ran: boolean;
  batchId?: string;
  partnersPaid: number;
  partnersSkippedNoEmail: number;
}

export async function runReferralPayouts(
  sql: SqlClient,
  now: Date,
  deps: ReferralPayoutsDeps,
): Promise<ReferralPayoutRunResult> {
  const period = currentPeriod(now);

  if (await alreadyRanForPeriod(sql, period)) {
    deps.logger.info("job_referral_payouts_already_ran", { period });
    return { ran: false, partnersPaid: 0, partnersSkippedNoEmail: 0 };
  }

  const partners = await findAccruedByPartner(sql);
  const payable = partners.filter((p) => !!p.paypal_email);
  const skipped = partners.length - payable.length;

  if (payable.length === 0) {
    deps.logger.info("job_referral_payouts_nothing_to_pay", { period, skipped });
    return { ran: true, partnersPaid: 0, partnersSkippedNoEmail: skipped };
  }

  const tokenResult = await getAccessToken(
    deps.paypalFetch,
    deps.paypalBaseUrl,
    deps.paypalClientId,
    deps.paypalClientSecret,
  );
  if (!tokenResult.ok || !tokenResult.accessToken) {
    deps.logger.error("job_referral_payouts_oauth_failed", { period, status: tokenResult.status });
    return { ran: true, partnersPaid: 0, partnersSkippedNoEmail: skipped };
  }

  const items: PayoutItem[] = payable.map((p) => ({
    recipientEmail: p.paypal_email as string,
    amountCents: p.total_cents,
    currency: "USD",
    note: `Heyloo referral payout — ${period}`,
    senderItemId: p.referral_partner_id,
  }));

  const senderBatchId = `referral-payout-${period}`;
  const batchResult = await createPayoutBatch(
    deps.paypalFetch,
    deps.paypalBaseUrl,
    tokenResult.accessToken,
    {
      senderBatchId,
      emailSubject: "Your Heyloo referral payout",
      items,
    },
  );

  const batchBody = batchResult.body as { batch_header?: { payout_batch_id?: string } };
  const batchId = batchBody.batch_header?.payout_batch_id;
  if (!batchResult.ok || !batchId) {
    deps.logger.error("job_referral_payouts_batch_create_failed", {
      period,
      status: batchResult.status,
    });
    // Commissions stay 'accrued' — never lost, retried next cycle (BACKEND_SPEC §8).
    return { ran: true, partnersPaid: 0, partnersSkippedNoEmail: skipped };
  }

  for (const partner of payable) {
    await sql`
      insert into public.referral_payouts (referral_partner_id, period, total_cents, paypal_batch_id, status)
      values (${partner.referral_partner_id}, ${period}::date, ${partner.total_cents}, ${batchId}, 'sent')
    `;
    await sql`
      update public.commission_events set status = 'batched'
      where referral_partner_id = ${partner.referral_partner_id} and status = 'accrued'
    `;
  }

  deps.logger.info("job_referral_payouts_batch_sent", {
    period,
    batch_id: batchId,
    partners_paid: payable.length,
    partners_skipped: skipped,
  });

  return { ran: true, batchId, partnersPaid: payable.length, partnersSkippedNoEmail: skipped };
}
