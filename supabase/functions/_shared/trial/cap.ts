import {
  endSubscriptionTrialNow,
  retrieveSubscriptionTrialState,
  type StripeFetch,
  type SubscriptionTrialState,
} from "../providers/stripe.ts";
import type { Logger, SqlClient } from "../types.ts";
import { trialCancelScheduled } from "./config.ts";
import { enqueueTrialOwnerEmail } from "./owner-email.ts";

/**
 * TRIAL-1 minutes cap (docs/BUILD_NOTES.md TRIAL-1): a free trial lasts its
 * days OR `tenants.trial_minutes_cap` billable call minutes, whichever comes
 * first. Reaching the cap ends the trial NOW through Stripe, so the plan starts
 * and is charged; it never blocks or shortens a call.
 *
 * Trial minutes are billable `usage_events` (test calls are not billable)
 * with `occurred_at < trial_ends_at`, the same rule job-billing-cycle uses to
 * keep trial minutes out of overage and the dashboard banner uses to show
 * "M of 100 minutes used". A tenant's number is only provisioned after
 * Checkout, so nothing is billable before the trial starts.
 *
 * Runs after each billable call (voice-events, in its background task after
 * the webhook was acknowledged) and hourly as a safety net (job-billing-cycle
 * `?task=trial_caps`). One run at a time per tenant:
 *  1. lease: `trial_cap_claimed_at` is set only when it is empty or older than
 *     {@link CAP_LEASE_MINUTES} minutes, so concurrent runs (two calls ending
 *     together, a call and the hourly sweep) never both reach Stripe, and a
 *     failed attempt is retried by the first run after the lease lapses. The
 *     trial is NOT marked ended here: until Stripe confirms, the banner and
 *     billing page keep showing the running trial, which is what Stripe has;
 *  2. read the subscription from Stripe. Only a `trialing` one with no
 *     cancellation pending is updated with `trial_end=now`: on one that is not
 *     trialing `trial_end` would move its billing cycle, and on one the owner
 *     already canceled it would start a paid period instead of letting the
 *     subscription end with the trial (the owner was promised no charge). A
 *     pending cancellation is recorded (`trial_cancel_scheduled`) and the
 *     lease is kept, so it is re-checked once per lease period in case the
 *     owner changes their mind;
 *  3. on success `trial_ended_reason = 'minutes'` and `trial_ends_at` becomes
 *     the actual end Stripe reports, and the owner is emailed once.
 * A failure (HTTP error, timeout, unreadable response) keeps the lease and
 * raises one open `trial_cap_end_failed` alert per tenant.
 */
export interface TrialCapDeps {
  stripeFetch: StripeFetch;
  /** Unset while Stripe is not configured: nothing is claimed or called. */
  stripeSecretKey: string | undefined;
  /** The tenant billing page, linked from the owner email when set. */
  billingPageUrl?: string | undefined;
  logger: Logger;
}

export interface TrialCapCandidate {
  tenant_id: string;
  stripe_subscription_id: string;
  trial_minutes_cap: number;
  used_minutes: number | string;
}

export type TrialCapOutcome =
  | "ended"
  | "already_over"
  | "cancel_pending"
  | "not_configured"
  | "claim_lost"
  | "failed";

/** How long one run holds a tenant's cap claim; also the retry and re-check
 * interval after a failure or a pending cancellation. */
export const CAP_LEASE_MINUTES = 15;

/** Tenants on an open trial whose trial minutes reached the cap; one tenant
 * when `tenantId` is given. */
export async function findTrialsOverCap(
  sql: SqlClient,
  tenantId: string | null,
): Promise<TrialCapCandidate[]> {
  return sql<TrialCapCandidate>`
    select x.tenant_id, x.stripe_subscription_id, x.trial_minutes_cap, x.used_minutes
    from (
      select t.id as tenant_id, t.stripe_subscription_id, t.trial_minutes_cap,
        coalesce((
          select sum(ue.minutes) from public.usage_events ue
          where ue.tenant_id = t.id and ue.is_billable and ue.occurred_at < t.trial_ends_at
        ), 0) as used_minutes
      from public.tenants t
      where (${tenantId}::uuid is null or t.id = ${tenantId}::uuid)
        and t.trial_ends_at > now()
        and t.trial_ended_reason is null
        and t.trial_minutes_cap is not null
        and t.stripe_subscription_id is not null
        and t.status = 'active'
        and t.deleted_at is null
    ) x
    where x.used_minutes >= x.trial_minutes_cap
  `;
}

const ENDED_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "incomplete_expired",
]);

async function raiseCapAlert(
  sql: SqlClient,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await sql`
    insert into public.alerts (rule, severity, tenant_id, payload)
    select 'trial_cap_end_failed', 'warning', ${tenantId}, ${payload}::jsonb
    where not exists (
      select 1 from public.alerts a
      where a.rule = 'trial_cap_end_failed' and a.tenant_id = ${tenantId} and a.status = 'open'
    )
  `;
}

async function finalize(
  sql: SqlClient,
  row: TrialCapCandidate,
  trialEnd: number | null,
  deps: TrialCapDeps,
): Promise<void> {
  // Stripe sets trial_end to the moment the trial ended; fall back to now.
  await sql`
    update public.tenants
    set trial_ended_reason = 'minutes',
        trial_ends_at = least(trial_ends_at, coalesce(to_timestamp(${trialEnd}::bigint), now()))
    where id = ${row.tenant_id} and trial_ended_reason is null
  `;
  await enqueueTrialOwnerEmail(sql, deps.logger, {
    tenantId: row.tenant_id,
    template: "trial_minutes_used",
    payload: {
      minutes: row.trial_minutes_cap,
      ...(deps.billingPageUrl ? { billing_url: deps.billingPageUrl } : {}),
    },
  });
}

/** The subscription ended while the cap was being handled: the trial ended
 * with it, and no "your plan has started" email goes out. */
async function markCanceled(sql: SqlClient, row: TrialCapCandidate): Promise<void> {
  await sql`
    update public.tenants
    set trial_ended_reason = 'canceled', trial_ends_at = least(trial_ends_at, now())
    where id = ${row.tenant_id} and trial_ended_reason is null
  `;
}

function cancelPending(subscription: SubscriptionTrialState): boolean {
  return trialCancelScheduled({
    trialEnd: subscription.trialEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    cancelAt: subscription.cancelAt,
  });
}

export async function endTrialForMinutesCap(
  sql: SqlClient,
  row: TrialCapCandidate,
  deps: TrialCapDeps,
): Promise<TrialCapOutcome> {
  const logFields = { tenant_id: row.tenant_id, cap: row.trial_minutes_cap };
  if (!deps.stripeSecretKey) {
    deps.logger.warn("trial_cap_stripe_not_configured", logFields);
    return "not_configured";
  }

  const leases = await sql<{ claimed_ms: number | string }>`
    update public.tenants
    set trial_cap_claimed_at = now()
    where id = ${row.tenant_id} and trial_ends_at > now() and trial_ended_reason is null
      and (
        trial_cap_claimed_at is null
        or trial_cap_claimed_at < now() - ${CAP_LEASE_MINUTES}::int * interval '1 minute'
      )
    returning (extract(epoch from trial_cap_claimed_at) * 1000)::bigint as claimed_ms
  `;
  const lease = leases[0];
  if (!lease) return "claim_lost";

  const current = await retrieveSubscriptionTrialState(
    deps.stripeFetch,
    deps.stripeSecretKey,
    row.stripe_subscription_id,
  );
  if (!current.ok) {
    deps.logger.error("trial_cap_subscription_read_failed", { ...logFields, ...current });
    await raiseCapAlert(sql, row.tenant_id, {
      step: "retrieve",
      status: current.status,
      error: current.error,
    });
    return "failed";
  }
  const subscription = current.subscription;
  if (subscription.status !== "trialing") {
    // The trial already ended in Stripe: an earlier run ended it (its result
    // was not recorded), or the subscription was canceled meanwhile.
    deps.logger.info("trial_cap_already_over_in_stripe", {
      ...logFields,
      status: subscription.status,
    });
    if (ENDED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      await markCanceled(sql, row);
    } else {
      await finalize(sql, row, subscription.trialEnd, deps);
    }
    return "already_over";
  }
  if (cancelPending(subscription)) {
    // The owner canceled: the subscription ends with the trial, unpaid. The
    // lease stays as the re-check throttle.
    await sql`
      update public.tenants set trial_cancel_scheduled = true
      where id = ${row.tenant_id} and not trial_cancel_scheduled
    `;
    deps.logger.info("trial_cap_skipped_cancel_pending", logFields);
    return "cancel_pending";
  }

  const ended = await endSubscriptionTrialNow(
    deps.stripeFetch,
    deps.stripeSecretKey,
    row.stripe_subscription_id,
    // One key per lease: a retry under a new lease is a new request (Stripe
    // replays a saved result, failures included, for the same key).
    { idempotencyKey: `trial-cap:${row.stripe_subscription_id}:${lease.claimed_ms}` },
  );
  if (!ended.ok) {
    deps.logger.error("trial_cap_end_failed", { ...logFields, ...ended });
    await raiseCapAlert(sql, row.tenant_id, {
      step: "end_trial",
      status: ended.status,
      error: ended.error,
    });
    return "failed";
  }
  await finalize(sql, row, ended.subscription.trialEnd, deps);
  deps.logger.info("trial_cap_trial_ended", { ...logFields, used: Number(row.used_minutes) });
  return "ended";
}

/** After a billable call: one indexed read for the tenant; nothing more unless
 * it is on a trial that just reached its cap. Never throws (a cap problem must
 * not fail the call's own event processing); the hourly run retries. */
export async function checkTrialCapAfterCall(
  sql: SqlClient,
  tenantId: string,
  deps: TrialCapDeps,
): Promise<TrialCapOutcome | null> {
  try {
    const [row] = await findTrialsOverCap(sql, tenantId);
    if (!row) return null;
    return await endTrialForMinutesCap(sql, row, deps);
  } catch (err) {
    deps.logger.error("trial_cap_check_failed", {
      tenant_id: tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

export interface TrialCapSweepResult {
  /** Trials that ran their days and were stamped `trial_ended_reason='time'`. */
  stamped_time: number;
  over_cap: number;
  ended: number;
  /** Over the cap, but the owner already canceled: left to end unpaid. */
  cancel_pending: number;
  failed: number;
}

/** Hourly safety net (job-billing-cycle `?task=trial_caps`). */
export async function runTrialCapSweep(
  sql: SqlClient,
  deps: TrialCapDeps,
): Promise<TrialCapSweepResult> {
  const stamped = await sql<{ id: string }>`
    update public.tenants
    set trial_ended_reason = 'time'
    where trial_ends_at is not null and trial_ends_at <= now() and trial_ended_reason is null
    returning id
  `;
  const rows = await findTrialsOverCap(sql, null);
  let ended = 0;
  let cancelPendingCount = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const outcome = await endTrialForMinutesCap(sql, row, deps);
      if (outcome === "ended" || outcome === "already_over") ended += 1;
      if (outcome === "cancel_pending") cancelPendingCount += 1;
      if (outcome === "failed" || outcome === "not_configured") failed += 1;
    } catch (err) {
      failed += 1;
      deps.logger.error("trial_cap_sweep_tenant_failed", {
        tenant_id: row.tenant_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    stamped_time: stamped.length,
    over_cap: rows.length,
    ended,
    cancel_pending: cancelPendingCount,
    failed,
  };
}
