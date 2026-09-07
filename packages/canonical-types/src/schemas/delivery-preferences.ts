import { z } from "zod";

/** `/dashboard/delivery` (FRONTEND_SPEC.md §6.8). */
export const deliveryPreferencesSchema = z.object({
  sms_enabled: z.boolean(),
  email_enabled: z.boolean(),
  notification_email: z.email("Enter a valid email address").optional(),
});

export type DeliveryPreferences = z.infer<typeof deliveryPreferencesSchema>;
