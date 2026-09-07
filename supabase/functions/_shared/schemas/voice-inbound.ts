import { z } from "zod";

/**
 * `/voice-inbound` request body (BACKEND_SPEC §7.1). VERIFY (docs/VERIFY.md):
 * canonical shape per BACKEND_SPEC, not yet confirmed against Retell's live
 * inbound-call webhook reference (egress-blocked in this environment) —
 * `.passthrough()` so an extra field Retell adds doesn't hard-fail parsing,
 * while the fields we depend on are still strictly validated.
 */
export const VoiceInboundRequestSchema = z
  .object({
    call_id: z.string().min(1),
    from_number: z.string().min(1),
    to_number: z.string().min(1),
    agent_id: z.string().optional(),
  })
  .passthrough();

export type VoiceInboundRequest = z.infer<typeof VoiceInboundRequestSchema>;

export const VoiceInboundDynamicVariablesSchema = z.object({
  business_name: z.string(),
  assistant_name: z.string(),
  greeting_hours_context: z.string(),
  timezone: z.string(),
  special_instructions: z.string(),
  manager_name: z.string().optional(),
  manager_phone: z.string().optional(),
  parking_info: z.string().optional(),
  accessibility_notes: z.string().optional(),
  accepted_payment_types: z.array(z.string()).optional(),
  is_manual_mode: z.boolean(),
  language: z.string(),
  caller_recent_context: z.string().optional(),
  disclosure_line: z.string(),
});

export const VoiceInboundResponseSchema = z.object({
  call_inbound: z.object({
    override_agent_id: z.string().optional(),
    dynamic_variables: VoiceInboundDynamicVariablesSchema,
  }),
});

export type VoiceInboundResponse = z.infer<typeof VoiceInboundResponseSchema>;
