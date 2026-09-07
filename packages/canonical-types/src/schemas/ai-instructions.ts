import { z } from "zod";
import { E164_PATTERN } from "../primitives.js";

// Plain (unbranded) E.164 check — react-hook-form's resolver needs the
// form's input and output shapes to match, which a branded `zE164`
// transform (packages/canonical-types/src/primitives.ts) breaks; form
// schemas validate the string shape here and leave normalization to the
// write path instead.
const zPhoneString = z.string().regex(E164_PATTERN, "Use E.164 format, e.g. +15551234567");

/** Agent → AI Instructions (FRONTEND_SPEC.md §6.6): free text + the carried-over rich context fields. */
export const aiInstructionsSchema = z.object({
  special_instructions: z.string().max(4000).optional(),
  transfer_number: zPhoneString.optional(),
  voicemail_message: z.string().max(1000).optional(),
  manager_name: z.string().max(200).optional(),
  manager_phone: zPhoneString.optional(),
  parking_info: z.string().max(1000).optional(),
  accessibility_notes: z.string().max(1000).optional(),
  prep_time_minutes: z.number().int().nonnegative().optional(),
  delivery_radius_miles: z.number().nonnegative().optional(),
  delivery_minimum_cents: z.number().int().nonnegative().optional(),
  accepted_payment_types: z.array(z.string()).optional(),
});

export type AiInstructions = z.infer<typeof aiInstructionsSchema>;
