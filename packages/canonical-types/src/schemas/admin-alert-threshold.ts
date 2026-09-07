import { z } from "zod";

/** `/cockpit/alerts` (FRONTEND_SPEC.md §7.1.9) — the SYSTEM_DESIGN §11 alert-rule list. */
export const ALERT_METRICS = [
  "price_drift",
  "negative_margin",
  "usage_spike",
  "concurrency",
  "tool_failure_spike",
  "commission_over_margin",
  "payment_failures",
] as const;

export const adminAlertThresholdSchema = z.object({
  metric: z.enum(ALERT_METRICS),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq"]),
  value: z.number(),
  enabled: z.boolean(),
  channel: z.enum(["email", "sms", "dashboard_only"]),
});

export type AdminAlertThreshold = z.infer<typeof adminAlertThresholdSchema>;
