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

export const RetellTranscriptTurnSchema = z
  .object({
    role: z.string(),
    content: z.string().optional(),
    text: z.string().optional(),
    words: z.array(z.unknown()).optional(),
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
