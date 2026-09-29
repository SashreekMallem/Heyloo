import { z } from "zod";
import { E164_PATTERN } from "../primitives.js";

const zPhoneString = z.string().regex(E164_PATTERN, "Use E.164 format, e.g. +15551234567");

/**
 * `/dashboard/delivery` (FRONTEND_SPEC.md §6.8) — how the OWNER is alerted
 * (message taken, new booking, urgent call, missed transfer). Stored at
 * `agent_configs.dynamic_variable_overrides.delivery`; read by the
 * `messages_outbound` worker's owner-alert fan-out
 * (supabase/functions/worker-messages-outbound/owner-alerts.ts), which
 * mirrors this shape. Customer-facing confirmations are governed by the
 * caller's own consent/opt-out, not by these toggles.
 *
 * - `sms_enabled`: text the owner at `alert_phone` (falls back to the
 *   agent's transfer number when blank).
 * - `email_enabled`: email the owner at `notification_email` (falls back
 *   to the account owner's sign-in email when blank).
 * Both on = both channels; an SMS that can't be sent yet (texting not
 * approved) falls back to email so an alert is never silently dropped.
 */
export const deliveryPreferencesSchema = z.object({
  sms_enabled: z.boolean(),
  email_enabled: z.boolean(),
  notification_email: z.email("Enter a valid email address").optional(),
  alert_phone: zPhoneString.optional(),
});

export type DeliveryPreferences = z.infer<typeof deliveryPreferencesSchema>;
