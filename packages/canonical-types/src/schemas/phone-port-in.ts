import { z } from "zod";
import { CARRIERS } from "./phone-forwarding-setup.js";

/** Phone setup → port-in (FRONTEND_SPEC.md §6.7). Async, days-long. */
export const phonePortInRequestSchema = z.object({
  current_number: z.string().trim().min(7, "Enter your current business phone number"),
  account_number: z.string().trim().min(1, "Account number is required"),
  account_pin: z.string().trim().min(1, "Account PIN is required"),
  carrier: z.enum(CARRIERS),
});

export type PhonePortInRequest = z.infer<typeof phonePortInRequestSchema>;
