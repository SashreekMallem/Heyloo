import { z } from "zod";

/**
 * `/voice-inbound` request body (BACKEND_SPEC §7.1). VERIFY-2
 * (docs/VERIFY.md): the flat `{call_id, from_number, to_number, agent_id?}`
 * body BACKEND_SPEC originally documented was CONTRADICTED by live legacy
 * production evidence (LIVE-MINE-FIXES, docs/BUILD_NOTES.md LIVE-MINE-EDGE
 * item 1 / docs/LEGACY_LIVE_FINDINGS.md § Edge Functions "VERIFY-2") — 76
 * production redeploys of the legacy `retell-assistant` edge function show
 * Retell's real `call_inbound` webhook body is nested:
 * `{event: "call_inbound", call_inbound: {from_number, to_number, agent_id?}}`.
 * There is NO top-level (or nested) `call_id` in this webhook at all —
 * Retell has not yet created/attached a call id at the point it asks us who
 * should handle the call. `.passthrough()` at both levels so an extra field
 * Retell adds doesn't hard-fail parsing, while the fields we depend on are
 * still strictly validated. The RESPONSE envelope below (`call_inbound:
 * {override_agent_id?, dynamic_variables}`) is unaffected — already
 * confirmed correct by the same live evidence.
 */
export const VoiceInboundRequestSchema = z
  .object({
    event: z.string().optional(),
    call_inbound: z
      .object({
        from_number: z.string().min(1),
        to_number: z.string().min(1),
        agent_id: z.string().optional(),
      })
      .passthrough(),
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
