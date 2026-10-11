import { z } from "zod";
import type { SqlClient } from "../types.ts";

/**
 * TRIAL-1 free-trial settings and the one-trial-per-business rule
 * (docs/BUILD_NOTES.md TRIAL-1).
 *
 * Settings live in `platform_settings.free_trial` (seeded by migration
 * 20261011120100) and are read like the price cards: an absent or malformed
 * row falls back to the defaults below, so a missing setting never blocks a
 * signup. The marketing and signup copy states the same 7 days / 100 minutes
 * (apps/web/src/lib/marketing/signup-steps.ts): change both together.
 */
export const FREE_TRIAL_DEFAULTS = { enabled: true, days: 7, minutes: 100 } as const;

/** Stripe accepts `subscription_data.trial_period_days` from 1 to 730
 * (docs.stripe.com/api/checkout/sessions/create, /billing/subscriptions/
 * trials/free-trials, fetched 2026-10-11). */
export const STRIPE_MAX_TRIAL_DAYS = 730;

export interface FreeTrialSettings {
  enabled: boolean;
  days: number;
  minutes: number;
}

const FreeTrialSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  days: z.number().int().min(1).max(STRIPE_MAX_TRIAL_DAYS).optional(),
  minutes: z.number().int().min(1).max(100_000).optional(),
});

/** Each field falls back to its default on its own; a value of the wrong type
 * or out of range is ignored (logged by the caller), never trusted. */
export function parseFreeTrialSettings(value: unknown): FreeTrialSettings {
  const parsed = FreeTrialSettingsSchema.safeParse(value);
  const v = parsed.success ? parsed.data : {};
  return {
    enabled: v.enabled ?? FREE_TRIAL_DEFAULTS.enabled,
    days: v.days ?? FREE_TRIAL_DEFAULTS.days,
    minutes: v.minutes ?? FREE_TRIAL_DEFAULTS.minutes,
  };
}

export const FREE_TRIAL_SETTINGS_KEY = "free_trial";

/** Stripe can stamp a cancel or end time a little after `trial_end` when a
 * cancel-at-trial-end subscription is closed. */
export const TRIAL_END_SKEW_SECONDS = 60;

/**
 * Whether the owner already canceled a trialing subscription, so that it ends
 * when (or before) its trial ends and is never charged: Stripe's
 * `cancel_at_period_end` (during a trial the current period ends with the
 * trial) or a `cancel_at` no later than the trial end
 * (docs.stripe.com/api/subscriptions/object and /billing/subscriptions/cancel,
 * fetched 2026-10-11). The customer portal's "cancel at end of period" sets
 * the first. Ending such a trial early with `trial_end=now` would start a paid
 * period instead, so the minutes cap never does it, and no "you will be
 * charged" email or copy is shown.
 */
export function trialCancelScheduled(input: {
  trialEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
}): boolean {
  if (input.cancelAtPeriodEnd) return true;
  if (input.cancelAt === null) return false;
  return input.trialEnd === null || input.cancelAt <= input.trialEnd + TRIAL_END_SKEW_SECONDS;
}

export async function loadFreeTrialSettings(sql: SqlClient): Promise<FreeTrialSettings> {
  const rows = await sql<{ value: unknown }>`
    select value from public.platform_settings where key = ${FREE_TRIAL_SETTINGS_KEY}
  `;
  return parseFreeTrialSettings(rows[0]?.value);
}

/**
 * One free trial per business. A business has had its trial when any tenant
 * it owns carries `trial_ends_at` (set when Stripe reports a trialing
 * subscription, and kept after the trial ends or is canceled). "Its" means
 * any of:
 *  - a tenant this user owns;
 *  - a tenant owned by an account with the same email (case-insensitive), so
 *    a second sign-up with the same address does not get a second trial;
 *  - a tenant with the same business phone, so a new account for the same
 *    business does not either.
 * Each Checkout creates a new Stripe customer from the email (api-checkout
 * passes `customer_email`, never a stored customer id), so "same Stripe
 * customer" is covered by the email check. A Checkout that is abandoned never
 * creates a subscription, so it does not use up the trial.
 */
export async function hasHadFreeTrial(
  sql: SqlClient,
  input: { userId: string; email: string; businessPhone?: string | null | undefined },
): Promise<boolean> {
  const rows = await sql<{ had_trial: boolean }>`
    select exists (
      select 1
      from public.tenants prior
      join public.memberships m on m.tenant_id = prior.id and m.role = 'owner'
      left join auth.users u on u.id = m.user_id
      where prior.trial_ends_at is not null
        and (m.user_id = ${input.userId} or lower(u.email) = lower(${input.email}))
    ) or (
      ${input.businessPhone ?? null}::text is not null and exists (
        select 1 from public.tenants prior
        where prior.trial_ends_at is not null and prior.business_phone = ${input.businessPhone ?? null}
      )
    ) as had_trial
  `;
  return rows[0]?.had_trial === true;
}
