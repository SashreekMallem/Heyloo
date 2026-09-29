import { z } from "zod";
import { CARRIERS } from "./phone-forwarding-setup.js";

/**
 * Phone setup → port-in (FRONTEND_SPEC.md §6.7). Async, days-long.
 *
 * QA-1 F-15: there is deliberately NO account PIN field. The request is
 * recorded as a plain-text `support_requests` row that staff and the tenant
 * can read back, and a carrier PIN doesn't belong in a ticket body. The form
 * used to demand a PIN and the route silently dropped it; support now asks
 * for the PIN securely once the port starts. `current_number` is normalized
 * to E.164 by the route (the phone rule lives in `apps/web/src/lib/settings/phone.ts`).
 */
export const phonePortInRequestSchema = z.object({
  current_number: z.string().trim().min(7, "Enter your current business phone number"),
  account_number: z.string().trim().min(1, "Account number is required"),
  carrier: z.enum(CARRIERS),
});

export type PhonePortInRequest = z.infer<typeof phonePortInRequestSchema>;
