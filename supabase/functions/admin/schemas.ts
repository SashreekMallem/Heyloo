import { z } from "zod";

/**
 * Local re-declarations of `packages/canonical-types`' admin-settings
 * schemas (Deno can't import the Node/ESM `@heyloo/canonical-types`
 * package directly — same cross-runtime constraint documented on
 * `api-adapter-connect/schema.ts`; kept field-for-field identical to
 * `adminReferralSettingSchema`/`platformPricingTableSchema`/
 * `adminAlertThresholdSchema` in that package).
 */

export const VERTICALS = [
  "auto",
  "vet",
  "legal",
  "dental",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
] as const;

export const AdminReferralSettingSchema = z.object({
  flat_amount_cents: z.number().int().nonnegative(),
  qualification_rule: z.string().trim().min(1).max(500),
});

export const PlatformPricingTableSchema = z.object({
  vertical: z.enum(VERTICALS),
  base_cents: z.number().int().nonnegative(),
  included_minutes: z.number().int().nonnegative(),
  overage_cents: z.number().int().nonnegative(),
  effective_at: z.string().min(1),
});

export const ALERT_METRICS = [
  "price_drift",
  "negative_margin",
  "usage_spike",
  "concurrency",
  "tool_failure_spike",
  "commission_over_margin",
  "payment_failures",
] as const;

export const AdminAlertThresholdSchema = z.object({
  metric: z.enum(ALERT_METRICS),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq"]),
  value: z.number(),
  enabled: z.boolean(),
  channel: z.enum(["email", "sms", "dashboard_only"]),
});
