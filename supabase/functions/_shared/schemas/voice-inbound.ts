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
  // CALL-2 (docs/BUILD_NOTES.md): the model's only absolute-date anchor —
  // see packages/templates/src/shared/fragments.ts's CURRENT_DATE_FRAGMENT
  // and @heyloo/canonical-types' zAgentDynamicVariables (kept in sync,
  // same Node/Deno boundary this file's own header already documents).
  current_date: z.string(),
  current_weekday: z.string(),
  // CALL-6 (docs/BUILD_NOTES.md) — a ready-made weekday-name->date lookup
  // for the next 7 days (`computeUpcomingWeekdayDates`), so the model
  // never has to compute "next Monday" itself; see agent-template-seeds.ts'
  // CURRENT_DATE guidance for the exact prompt wording.
  upcoming_weekday_dates: z.string(),
  special_instructions: z.string(),
  manager_name: z.string().optional(),
  manager_phone: z.string().optional(),
  // FIX_REQUESTS.md (Cluster B) — sourced ONLY from `agent_configs.transfer_number`
  // (never the dynamic_variable_overrides jsonb blob, never a runtime tool
  // argument, BACKEND_SPEC §7.2.8/G6), so the compiler's native
  // `transfer_call` destination (`{{transfer_number}}`) resolves at call
  // time instead of speaking/dialing a literal unresolved placeholder.
  // PUBLISH-1 (docs/BUILD_NOTES.md): ALWAYS present now (an empty string
  // when unset, never omitted) — `_shared/inbound-dynamic-variables.ts`'s
  // own doc comment has the full rationale (every compiled flow now
  // unconditionally references `{{transfer_number}}`, so it needs a real,
  // always-a-string value to substitute, never a literal unresolved
  // placeholder left behind by an omitted key).
  transfer_number: z.string().optional(),
  parking_info: z.string().optional(),
  accessibility_notes: z.string().optional(),
  accepted_payment_types: z.array(z.string()).optional(),
  is_manual_mode: z.boolean(),
  language: z.string(),
  // CALL-9 (docs/BUILD_NOTES.md): ALWAYS set now — every branch of
  // `_shared/inbound-dynamic-variables.ts#resolveCallerRecentContext`
  // returns a real sentence, never omits the field. Required (not
  // `.optional()`) so a caller that forgets to set it fails validation
  // loudly instead of leaving `{{caller_recent_context}}` as a literal
  // unresolved placeholder in the compiled prompt that now references it.
  caller_recent_context: z.string(),
  disclosure_line: z.string(),
  // GAP_REGISTER §1.3 — per-vertical `{{token}}`s every compiled prompt may
  // reference (packages/templates/src/red-team/prompt-lint.ts's
  // ALLOWED_DYNAMIC_VARIABLES), always resolved with a safe default by
  // `resolveVerticalDynamicVariables` (./dynamic-variables.ts) rather than
  // ever being a literal unresolved placeholder.
  cancellation_policy_text: z.string(),
  consult_fee_text: z.string().optional(),
  practice_areas: z.string().optional(),
  tow_partner_name: z.string().optional(),
  tow_partner_phone: z.string().optional(),
  vehicle_makes_serviced: z.string().optional(),
  species_treated: z.string().optional(),
  emergency_referral_name: z.string().optional(),
  emergency_referral_phone: z.string().optional(),
  rate_table: z.string().optional(),
  deposit_policy_text: z.string().optional(),
  menu_text: z.string().optional(),
  prep_time_text: z.string().optional(),
  delivery_terms_text: z.string().optional(),
});

export const VoiceInboundResponseSchema = z.object({
  call_inbound: z.object({
    override_agent_id: z.string().optional(),
    dynamic_variables: VoiceInboundDynamicVariablesSchema,
  }),
});

export type VoiceInboundResponse = z.infer<typeof VoiceInboundResponseSchema>;
