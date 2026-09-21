import { z } from "zod";

/**
 * `/voice-events` request body (BACKEND_SPEC §7.3). VERIFY (docs/VERIFY.md):
 * the exact Retell `call` object shape (`RetellCallObject`) is reconstructed
 * from BACKEND_SPEC's description of the fields it consumes
 * (`call.call_cost.product_costs[]`, `call.call_analysis.*`,
 * disconnection_reason, timestamps) rather than Retell's live webhook
 * reference (egress-blocked). `.passthrough()` throughout so unknown fields
 * never hard-fail parsing; every field this codebase actually reads is still
 * typed and required-or-optional per what BACKEND_SPEC states about it.
 */

export const RetellProductCostSchema = z
  .object({
    product: z.string(),
    unit_price: z.number().optional(),
    cost: z.number(),
  })
  .passthrough();

export const RetellCallCostSchema = z
  .object({
    combined_cost: z.number().optional(),
    product_costs: z.array(RetellProductCostSchema).default([]),
  })
  .passthrough();

export const RetellCallAnalysisSchema = z
  .object({
    call_summary: z.string().optional(),
    in_voicemail: z.boolean().optional(),
    user_sentiment: z.enum(["Positive", "Neutral", "Negative", "Unknown"]).optional(),
    call_successful: z.boolean().optional(),
    custom_analysis_data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// RETELL-VERIFY: confirmed via retell-typescript-sdk's
// `PhoneCallResponse.TranscriptObject` (src/resources/call.ts) — the real
// field is `content` (REQUIRED), not `text` (which doesn't exist on this
// object at all; this schema previously guessed both). `role` is confirmed
// a closed 3-value enum, not an open string. `words` is REQUIRED (can be an
// empty array) but this codebase doesn't read its contents, so it stays
// loosely typed.
export const RetellTranscriptTurnSchema = z
  .object({
    role: z.enum(["agent", "user", "transfer_target"]),
    content: z.string(),
    words: z.array(z.unknown()),
  })
  .passthrough();

export const RetellCallObjectSchema = z
  .object({
    call_id: z.string().min(1),
    agent_id: z.string().optional(),
    from_number: z.string().optional(),
    to_number: z.string().optional(),
    direction: z.string().optional(),
    start_timestamp: z.number().optional(),
    end_timestamp: z.number().optional(),
    disconnection_reason: z.string().optional(),
    call_cost: RetellCallCostSchema.optional(),
    call_analysis: RetellCallAnalysisSchema.optional(),
    transcript: z.string().optional(),
    transcript_object: z.array(RetellTranscriptTurnSchema).optional(),
    recording_url: z.string().optional(),
    recording_multi_channel_url: z.string().optional(),
  })
  .passthrough();

export type RetellCallObject = z.infer<typeof RetellCallObjectSchema>;

export const VoiceEventRequestSchema = z.object({
  event: z.enum(["call_started", "call_ended", "call_analyzed"]),
  call: RetellCallObjectSchema,
});

export type VoiceEventRequest = z.infer<typeof VoiceEventRequestSchema>;

/**
 * ANALYSIS-1 (docs/BUILD_NOTES.md): the platform's own post-call analysis
 * schema — the exact field names
 * `_shared/compiler/template-compiler.ts#buildPostCallAnalysisData`
 * compiles into every agent's `post_call_analysis_data` (RETELL-VERIFIED,
 * docs.retellai.com/api-references/create-agent, 2026-09-21) and this file
 * validates back out of the `call_analyzed` webhook's
 * `call_analysis.custom_analysis_data`. `classification` mirrors
 * `call_logs_classification_check` exactly (migration
 * `20260907130500_call_logs.sql`) — the 12-value enum every shipped
 * template's states declare identically (`agent-template-seeds.ts`).
 */
export const CALL_LOGS_CLASSIFICATION_VALUES = [
  "new_booking",
  "reschedule",
  "cancel",
  "question_faq",
  "status_check",
  "sales_lead",
  "solicitor",
  "wrong_number",
  "spam_robocall",
  "emergency",
  "after_hours_message",
  "transfer_request",
] as const;

export type CallLogsClassification = (typeof CALL_LOGS_CLASSIFICATION_VALUES)[number];

const ClassificationFieldSchema = z.enum(CALL_LOGS_CLASSIFICATION_VALUES);
const NonEmptyStringFieldSchema = z.string().trim().min(1);
const BooleanFieldSchema = z.boolean();

/**
 * Validates ONE `custom_analysis_data` value against `schema`, per field —
 * never the whole object at once, so an LLM-hallucinated/malformed value on
 * ONE field (e.g. a `classification` string outside the 12-value enum,
 * which `call_logs`'s own `CHECK` constraint would otherwise reject at the
 * database) parses to `null` for that field alone, leaving every other
 * field's value intact. Always succeeds — `.safeParse` never throws, so the
 * `call_analyzed` webhook is never rejected over an analysis field, per
 * CLAUDE.md Rule 2's "fail closed" (which governs signature verification,
 * not a single AI-extracted value downstream of it).
 */
function safeAnalysisField<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface ParsedCustomAnalysisData {
  classification: CallLogsClassification | null;
  outcome: string | null;
  /** `false` for both "explicitly false" and "absent/invalid" — matches
   * `call_logs.follow_up_needed`'s own `not null default false` column. */
  followUpNeeded: boolean;
  /** `call_logs.urgency_flag`'s sole post-call source — see
   * `handleCallAnalyzed`'s own doc comment for why a per-vertical
   * `urgency` enum is deliberately NOT also read here. */
  emergencyDetected: boolean;
  legalAdviceGiven: boolean;
}

/** Never throws, never returns `undefined` — `data` itself may be absent
 * (a call with no post-call analysis data declared, or a webhook that
 * arrives before analysis has run) and every field degrades to its safe
 * default rather than propagating `undefined` into a SQL `coalesce`. */
export function parseCustomAnalysisData(
  data: Record<string, unknown> | undefined | null,
): ParsedCustomAnalysisData {
  const d = data ?? {};
  return {
    classification: safeAnalysisField(ClassificationFieldSchema, d["classification"]),
    outcome: safeAnalysisField(NonEmptyStringFieldSchema, d["outcome"]),
    followUpNeeded: safeAnalysisField(BooleanFieldSchema, d["follow_up_needed"]) === true,
    emergencyDetected: safeAnalysisField(BooleanFieldSchema, d["emergency_detected"]) === true,
    legalAdviceGiven: safeAnalysisField(BooleanFieldSchema, d["legal_advice_given"]) === true,
  };
}
