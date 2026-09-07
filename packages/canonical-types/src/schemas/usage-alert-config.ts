import { z } from "zod";

/** `/dashboard/billing` usage alert config (FRONTEND_SPEC.md §6.9). */
export const usageAlertConfigSchema = z.object({
  alert_80_enabled: z.boolean(),
  alert_100_enabled: z.boolean(),
  hard_cap_enabled: z.boolean(),
  hard_cap_minutes: z.number().int().positive().optional(),
});

export type UsageAlertConfig = z.infer<typeof usageAlertConfigSchema>;
