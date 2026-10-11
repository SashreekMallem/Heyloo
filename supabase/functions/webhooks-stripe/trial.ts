import { z } from "zod";
import {
  FREE_TRIAL_DEFAULTS,
  TRIAL_END_SKEW_SECONDS,
  trialCancelScheduled,
} from "../_shared/trial/config.ts";
import { enqueueTrialOwnerEmail } from "../_shared/trial/owner-email.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * TRIAL-1: free-trial bookkeeping from Stripe subscription events
 * (`customer.subscription.created|updated|paused|resumed|deleted|
 * trial_will_end`). Every one carries a Subscription as `data.object`
 * (docs.stripe.com/api/events/types, fetched 2026-10-11); the fields used are
 * `id`, `customer`, `status`, `trial_end`, `ended_at` and `cancel_at`
 * (nullable Unix seconds), `cancel_at_period_end` (boolean) and `metadata`
 * (api-checkout's `subscription_data.metadata`: `tenant_id`,
 * `trial_minutes`). Validated here at the boundary; a payload that does not
 * parse is ignored, never guessed at.
 *
 * The tenant is found by `metadata.tenant_id` first (when it is not linked to
 * a different Stripe customer), else by `stripe_customer_id`: a
 * `customer.subscription.created` can arrive before
 * `checkout.session.completed` has linked the customer.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SubscriptionPayloadSchema = z.object({
  id: z.string().min(1).optional(),
  customer: z.unknown().optional(),
  status: z.string().min(1).optional(),
  trial_end: z.number().int().positive().nullable().optional(),
  ended_at: z.number().int().positive().nullable().optional(),
  cancel_at_period_end: z.boolean().optional(),
  cancel_at: z.number().int().positive().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export interface SubscriptionFacts {
  subscriptionId: string | null;
  customerId: string | null;
  status: string | null;
  /** Unix seconds, null when the subscription has no trial. */
  trialEnd: number | null;
  /** Unix seconds the subscription ended, null while it has not. */
  endedAt: number | null;
  /** The owner canceled: the subscription ends with its trial, never charged
   * (`trialCancelScheduled`). */
  cancelScheduled: boolean;
  metadataTenantId: string | null;
  /** `metadata.trial_minutes`, else the default cap. */
  trialMinutes: number;
}

/** `customer` is an id string, or the Customer object when expanded. */
function customerIdOf(customer: unknown): string | null {
  if (typeof customer === "string") return customer.length > 0 ? customer : null;
  const id = (customer as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function parseSubscriptionFacts(obj: Record<string, unknown>): SubscriptionFacts | null {
  const parsed = SubscriptionPayloadSchema.safeParse(obj);
  if (!parsed.success) return null;
  const sub = parsed.data;
  const customerId = customerIdOf(sub.customer);
  const metadata = sub.metadata ?? {};
  const tenantId = typeof metadata["tenant_id"] === "string" ? metadata["tenant_id"] : null;
  const minutesRaw =
    typeof metadata["trial_minutes"] === "string" ? Number(metadata["trial_minutes"]) : Number.NaN;
  return {
    subscriptionId: sub.id ?? null,
    customerId,
    status: sub.status ?? null,
    trialEnd: sub.trial_end ?? null,
    endedAt: sub.ended_at ?? null,
    cancelScheduled: trialCancelScheduled({
      trialEnd: sub.trial_end ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      cancelAt: sub.cancel_at ?? null,
    }),
    metadataTenantId: tenantId && UUID_RE.test(tenantId) ? tenantId : null,
    trialMinutes:
      Number.isInteger(minutesRaw) && minutesRaw > 0 && minutesRaw <= 100_000
        ? minutesRaw
        : FREE_TRIAL_DEFAULTS.minutes,
  };
}

/**
 * `trialing`: the tenant can use the product (status `active`; `'trialing'`
 * in tenants means "never paid" and is promoted, any other status is left
 * alone so a late event never revives a canceled or past-due tenant), the
 * trial end and minutes cap are stored, and the Stripe ids are linked if
 * checkout.session.completed has not done it yet. A trial that already ended
 * locally (minutes cap, cancel) keeps its recorded end: a delayed `trialing`
 * event must not reopen it. `trial_cancel_scheduled` follows the event (the
 * owner canceled in the portal, or took it back); it only drives the banner and
 * billing copy, while the minutes cap reads the live subscription itself.
 */
export async function recordTrialing(sql: SqlClient, facts: SubscriptionFacts): Promise<number> {
  if (facts.trialEnd === null) return 0;
  const rows = await sql<{ id: string }>`
    update public.tenants
    set status = case when status = 'trialing' then 'active' else status end,
        trial_ends_at = case
          when trial_ended_reason is null then to_timestamp(${facts.trialEnd}::bigint)
          else trial_ends_at
        end,
        trial_minutes_cap = coalesce(trial_minutes_cap, ${facts.trialMinutes}),
        trial_cancel_scheduled = ${facts.cancelScheduled},
        stripe_customer_id = coalesce(stripe_customer_id, ${facts.customerId}),
        stripe_subscription_id = coalesce(stripe_subscription_id, ${facts.subscriptionId})
    where deleted_at is null and (
      (id = ${facts.metadataTenantId}::uuid
        and (stripe_customer_id is null or stripe_customer_id = ${facts.customerId}))
      or stripe_customer_id = ${facts.customerId}
    )
    returning id
  `;
  return rows.length;
}

const ENDED_STATUSES: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);

/**
 * Any status other than `trialing`:
 *  - the subscription ended no later than its trial end (canceled during the
 *    trial, or set to cancel when the trial ends) -> `trial_ended_reason =
 *    'canceled'` and the actual end is when it ended: the plan was never
 *    charged, and job-billing-cycle never bills it;
 *  - its trial is over (`trial_end` in the past) -> the actual end is Stripe's
 *    `trial_end` and the reason is `time`, unless the minutes cap already
 *    recorded `minutes` (this confirms the cap's Stripe call) or the trial was
 *    canceled. A trial the cap ended in Stripe whose result was not recorded
 *    yet (the cap claimed it, `trial_cap_claimed_at`, and Stripe's end is
 *    earlier than the scheduled one) is recorded as `minutes`, and the owner's
 *    "trial minutes used" email is queued (sent once, whoever gets there first).
 * Rows are only written when something changes. A subscription with no trial
 * (`trial_end` null) is untouched; a trial Stripe reports that was never
 * stored is recorded.
 */
export async function recordTrialOutcome(
  sql: SqlClient,
  facts: SubscriptionFacts,
  options: {
    subscriptionEnded: boolean;
    now: Date;
    logger: Logger;
    billingPageUrl?: string | undefined;
  },
): Promise<void> {
  if (facts.trialEnd === null) return;
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  const ended =
    options.subscriptionEnded || (facts.status !== null && ENDED_STATUSES.has(facts.status));
  const endedAt = facts.endedAt ?? nowSeconds;
  if (ended && endedAt <= facts.trialEnd + TRIAL_END_SKEW_SECONDS) {
    await sql`
      update public.tenants
      set trial_ended_reason = 'canceled',
          trial_ends_at = least(
            coalesce(trial_ends_at, to_timestamp(${facts.trialEnd}::bigint)),
            to_timestamp(${endedAt}::bigint)
          )
      where deleted_at is null
        and (trial_ended_reason is null or trial_ended_reason = 'time')
        and (
          (id = ${facts.metadataTenantId}::uuid
            and (stripe_customer_id is null or stripe_customer_id = ${facts.customerId}))
          or stripe_customer_id = ${facts.customerId}
        )
    `;
  }
  if (facts.trialEnd <= nowSeconds) {
    // SET expressions read the row as it was: `trial_ends_at` in the reason's
    // case is still the scheduled end.
    const updated = await sql<{
      id: string;
      trial_ended_reason: string | null;
      trial_minutes_cap: number | null;
    }>`
      update public.tenants
      set trial_ends_at = case
            when trial_ended_reason is null or trial_ended_reason = 'minutes'
              then to_timestamp(${facts.trialEnd}::bigint)
            else trial_ends_at
          end,
          trial_ended_reason = coalesce(
            trial_ended_reason,
            case
              when trial_cap_claimed_at is not null
                and to_timestamp(${facts.trialEnd}::bigint)
                  < trial_ends_at - ${TRIAL_END_SKEW_SECONDS}::int * interval '1 second'
              then 'minutes'
              else 'time'
            end
          )
      where deleted_at is null
        and (
          trial_ended_reason is null
          or (trial_ended_reason = 'minutes'
            and trial_ends_at is distinct from to_timestamp(${facts.trialEnd}::bigint))
        )
        and (
          (id = ${facts.metadataTenantId}::uuid
            and (stripe_customer_id is null or stripe_customer_id = ${facts.customerId}))
          or stripe_customer_id = ${facts.customerId}
        )
      returning id, trial_ended_reason, trial_minutes_cap
    `;
    for (const tenant of updated) {
      if (tenant.trial_ended_reason !== "minutes") continue;
      await enqueueTrialOwnerEmail(sql, options.logger, {
        tenantId: tenant.id,
        template: "trial_minutes_used",
        payload: {
          ...(tenant.trial_minutes_cap ? { minutes: tenant.trial_minutes_cap } : {}),
          ...(options.billingPageUrl ? { billing_url: options.billingPageUrl } : {}),
        },
      });
    }
  }
}

function formatEndsOn(trialEnd: number, timeZone: string | null): string {
  const options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timeZone ?? "UTC" }).format(
      new Date(trialEnd * 1000),
    );
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
      new Date(trialEnd * 1000),
    );
  }
}

/**
 * `customer.subscription.trial_will_end` -> the owner's "your trial ends on
 * <day>" email. Stripe sends this event 3 days before a trial ends (Dashboard
 * setting) "or immediately when a trial is ended early (for example, with
 * `trial_end=now`)", and says to check the subscription before sending a
 * reminder. So nothing is sent unless the subscription is still `trialing`
 * with its end ahead, and the tenant's trial has not ended locally (the
 * minutes cap sends its own "your plan has started" email instead). Nor when
 * the owner already canceled: their subscription ends with the trial and
 * nothing is charged, so "your card is charged" would be false.
 */
export async function handleTrialWillEnd(
  sql: SqlClient,
  facts: SubscriptionFacts,
  logger: Logger,
  options: { now: Date; billingPageUrl?: string | undefined },
): Promise<"queued" | "skipped"> {
  if (
    facts.status !== "trialing" ||
    facts.trialEnd === null ||
    facts.trialEnd * 1000 <= options.now.getTime() + 60_000 ||
    facts.cancelScheduled
  ) {
    logger.info("stripe_trial_will_end_skipped", {
      status: facts.status,
      subscription_id: facts.subscriptionId,
      cancel_scheduled: facts.cancelScheduled,
    });
    return "skipped";
  }
  const rows = await sql<{
    id: string;
    timezone: string | null;
    trial_ended_reason: string | null;
  }>`
    select id, timezone, trial_ended_reason from public.tenants
    where deleted_at is null and (
      (id = ${facts.metadataTenantId}::uuid
        and (stripe_customer_id is null or stripe_customer_id = ${facts.customerId}))
      or stripe_customer_id = ${facts.customerId}
    )
    limit 1
  `;
  const tenant = rows[0];
  if (!tenant || tenant.trial_ended_reason !== null) return "skipped";
  const id = await enqueueTrialOwnerEmail(sql, logger, {
    tenantId: tenant.id,
    template: "trial_will_end",
    payload: {
      ends_on: formatEndsOn(facts.trialEnd, tenant.timezone),
      trial_ends_at: new Date(facts.trialEnd * 1000).toISOString(),
      ...(options.billingPageUrl ? { billing_url: options.billingPageUrl } : {}),
    },
  });
  return id ? "queued" : "skipped";
}
