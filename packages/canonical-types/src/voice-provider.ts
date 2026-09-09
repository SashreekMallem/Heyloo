/**
 * The `VoiceProvider` interface (SYSTEM_DESIGN §3 "Voice provider ... behind
 * a VoiceProvider interface with capability flags"; the provider-portability
 * research shapes). Every voice vendor adapter (`packages/adapters/retell`
 * today, a future alternative later) implements this; core code depends only
 * on these canonical types (CLAUDE.md Rule 2) — never a provider SDK type.
 */

import { z } from "zod";
import type { AgentTemplate, CompileTarget } from "./agent-template.js";
import { zCents, zIsoTimestamp } from "./primitives.js";
import type { ToolFallbackResult } from "./tools.js";

// ---------------------------------------------------------------------------
// Capability flags — what a given provider implementation can actually do.
// Core code (the compiler, the provisioning saga) branches on these instead
// of hardcoding "Retell can do X" (SYSTEM_DESIGN §3 portability goal).
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  readonly supportsConversationFlow: boolean;
  readonly supportsMultiPrompt: boolean;
  readonly supportsSinglePrompt: boolean;
  readonly supportsGlobalIntents: boolean;
  readonly supportsWarmTransferContext: boolean;
  readonly supportsNativeSmsChannel: boolean;
  readonly supportsBatchSimulationTesting: boolean;
  readonly supportsConcurrencyQuery: boolean;
  readonly supportsPhoneNumberImport: boolean;
  /** Whether `get-call`-style post-call cost data is itemized/exact, or coarse/estimated. */
  readonly costGranularity: CostGranularity;
  readonly maxToolsPerAgent?: number;
}

export function supportsCompileTarget(
  capabilities: ProviderCapabilities,
  target: CompileTarget,
): boolean {
  switch (target) {
    case "conversation_flow":
      return capabilities.supportsConversationFlow;
    case "multi_prompt":
      return capabilities.supportsMultiPrompt;
    case "single_prompt":
      return capabilities.supportsSinglePrompt;
  }
}

// ---------------------------------------------------------------------------
// Cost breakdown (BACKEND_SPEC `cost_events`, API_AND_FLOWS `get-call`)
// ---------------------------------------------------------------------------

export const COST_GRANULARITIES = ["exact", "estimated"] as const;
export type CostGranularity = (typeof COST_GRANULARITIES)[number];
export const zCostGranularity = z.enum(COST_GRANULARITIES);

export const zCanonicalCostLineItem = z.object({
  /** Normalized product/category id (e.g. "voice_engine", "llm", "telephony", "transfer"). */
  product: z.string().min(1),
  cost_cents: zCents,
  unit_price_cents: zCents.optional(),
  is_transfer_leg_cost: z.boolean(),
  /** Original provider line item, kept for the margin cockpit's provider-repricing-drift parsers (`cost_events.raw`). */
  raw: z.unknown().optional(),
});
export type CanonicalCostLineItem = z.infer<typeof zCanonicalCostLineItem>;

export const zCanonicalCostBreakdown = z.object({
  total_cents: zCents,
  currency: z.literal("USD"),
  granularity: zCostGranularity,
  line_items: z.array(zCanonicalCostLineItem),
});
export type CanonicalCostBreakdown = z.infer<typeof zCanonicalCostBreakdown>;

// ---------------------------------------------------------------------------
// Inbound call resolution (BACKEND_SPEC §7.1 `/voice/inbound`)
// ---------------------------------------------------------------------------

/**
 * The canonical, already-verified inbound-call context an adapter hands to
 * the resolver. `providerCallId` is optional — LIVE-MINE-FIXES
 * (docs/BUILD_NOTES.md LIVE-MINE-EDGE item 1, docs/VERIFY.md VERIFY-2):
 * live legacy production evidence shows Retell's real `call_inbound`
 * webhook carries no call id at all (it hasn't created/attached one yet at
 * this point in the call), so this can never be assumed present here.
 */
export interface InboundCallContext {
  providerCallId?: string;
  fromNumberE164: string;
  toNumberE164: string;
  /** Provider-side agent id, if the provider had already resolved one before asking us. */
  providerAgentId?: string;
}

export const zAgentDynamicVariables = z.object({
  business_name: z.string().min(1),
  assistant_name: z.string().min(1),
  greeting_hours_context: z.string().min(1),
  timezone: z.string().min(1),
  special_instructions: z.string(),
  manager_name: z.string().optional(),
  manager_phone: z.string().optional(),
  parking_info: z.string().optional(),
  accessibility_notes: z.string().optional(),
  accepted_payment_types: z.array(z.string()).optional(),
  is_manual_mode: z.boolean(),
  language: z.string().min(1),
  caller_recent_context: z.string().optional(),
  /** Compiled-in constant; ALWAYS present (G1/G2) — never omitted, never tenant-editable. */
  disclosure_line: z.string().min(1),
});
export type AgentDynamicVariables = z.infer<typeof zAgentDynamicVariables>;

export interface InboundCallResolution {
  /** Set only if number -> tenant resolves to a different agent than the provider's default binding. */
  overrideAgentId?: string;
  dynamicVariables: AgentDynamicVariables;
}

// ---------------------------------------------------------------------------
// Tool-call webhook (BACKEND_SPEC §7.2 `/voice/tools`)
// ---------------------------------------------------------------------------

export interface ToolCallRequest {
  providerCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  /**
   * The call's ACTUAL caller number as recorded by the provider's call
   * session — never trusted from `args` alone (G6). `lookup_customer`
   * authorization cross-checks `args.phone` against this field server-side.
   */
  callerNumberE164?: string;
}

export type ToolCallResult<T = unknown> = { result: T | ToolFallbackResult };

// ---------------------------------------------------------------------------
// Call-ended webhook (BACKEND_SPEC §7.3 `/voice/events`)
// ---------------------------------------------------------------------------

/**
 * Confirmed verbatim against the official `retell-typescript-sdk`
 * (`src/resources/call.ts`, `PhoneCallResponse.disconnection_reason` —
 * RETELL-VERIFY, docs/VERIFY.md VERIFY-5, resolved) — the full enum Retell
 * itself defines, not a guessed/partial subset. `"unknown"` is this
 * codebase's own catch-all for a future value Retell adds that isn't in
 * this list yet (never a rejection).
 */
export const DISCONNECTION_REASONS = [
  "user_hangup",
  "agent_hangup",
  "call_transfer",
  "voicemail_reached",
  "ivr_reached",
  "inactivity",
  "max_duration_reached",
  "concurrency_limit_reached",
  "no_concurrency_fallback",
  "no_valid_payment",
  "scam_detected",
  "dial_busy",
  "dial_failed",
  "dial_no_answer",
  "invalid_destination",
  "telephony_provider_permission_denied",
  "telephony_provider_unavailable",
  "sip_routing_error",
  "marked_as_spam",
  "user_declined",
  "error_llm_websocket_open",
  "error_llm_websocket_lost_connection",
  "error_llm_websocket_runtime",
  "error_llm_websocket_corrupt_payload",
  "error_no_audio_received",
  "error_asr",
  "error_retell",
  "error_unknown",
  "error_user_not_joined",
  "registered_call_timeout",
  "transfer_bridged",
  "transfer_cancelled",
  "manual_stopped",
  "call_take_over",
  "unknown",
] as const;
export type DisconnectionReason = (typeof DISCONNECTION_REASONS)[number];

export const zCallEndedEvent = z.object({
  providerCallId: z.string().min(1),
  startedAt: zIsoTimestamp,
  endedAt: zIsoTimestamp,
  durationSeconds: z.number().nonnegative(),
  disconnectionReason: z.enum(DISCONNECTION_REASONS),
  costBreakdown: zCanonicalCostBreakdown,
  transferOccurred: z.boolean(),
});
export type CallEndedEvent = z.infer<typeof zCallEndedEvent>;

// ---------------------------------------------------------------------------
// Agent lifecycle (API_AND_FLOWS.md A.1 "Agent lifecycle: create / update / delete agent")
// ---------------------------------------------------------------------------

export interface CreateOrUpdateAgentInput {
  tenantId: string;
  /** Set when updating an already-provisioned agent; omitted on first create. */
  existingProviderAgentId?: string;
  template: AgentTemplate;
  voiceId: string;
  model: string;
  toolWebhookUrl: string;
  eventsWebhookUrl: string;
  /**
   * Max time (ms) Retell waits on `eventsWebhookUrl` before giving up.
   * LIVE-MINE-FIXES (docs/BUILD_NOTES.md LIVE-MINE-EDGE item 2): legacy's
   * live `create_agent` always set `webhook_timeout_ms: 10000` alongside
   * `webhook_url` rather than relying on Retell's undocumented default.
   * Defaults to 10000 in `createOrUpdateRetellAgent` when omitted.
   */
  webhookTimeoutMs?: number;
}

export interface CreateOrUpdateAgentResult {
  providerAgentId: string;
  providerLlmId?: string;
  /**
   * The agent's draft version after this create/update (Retell's
   * `AgentResponse.version` — RETELL-VERIFY, confirmed via
   * `retell-typescript-sdk`'s `src/resources/agent.ts`). Required input to
   * `publishAgentVersion` (the publish endpoint has no "latest" shorthand —
   * it must be told exactly which version to promote).
   */
  version: number;
}

export interface PublishAgentVersionInput {
  providerAgentId: string;
  /**
   * The draft version to promote (from `CreateOrUpdateAgentResult.version`).
   * REQUIRED by Retell's `POST /publish-agent-version/{agent_id}` — the
   * endpoint has no "publish whatever's latest" shorthand (RETELL-VERIFY,
   * confirmed via `retell-typescript-sdk`'s `AgentPublishParams`).
   */
  version: number;
}

export interface PublishAgentVersionResult {
  providerAgentId: string;
  version: number;
  publishedAt: string;
}

export interface ImportPhoneNumberInput {
  phoneNumberE164: string;
  /** Twilio Elastic SIP Trunking termination URI, e.g. `<trunk>.pstn.twilio.com`. */
  terminationUri: string;
  inboundAgentId: string;
  outboundAgentId?: string;
  sipTrunkAuthUsername?: string;
  sipTrunkAuthPassword?: string;
  /**
   * The inbound-call resolver webhook (`/voice-inbound`). RETELL-VERIFY
   * (docs/VERIFY.md VERIFY-6, resolved): confirmed via the official SDK's
   * `src/resources/phone-number.ts` that `inbound_webhook_url` is a
   * PHONE-NUMBER-scoped field (`PhoneNumberImportParams`/`*CreateParams`/
   * `*UpdateParams`) — it does NOT exist on the Agent resource at all. Moved
   * here from `CreateOrUpdateAgentInput` accordingly.
   */
  inboundWebhookUrl?: string;
}

export interface ImportPhoneNumberResult {
  providerPhoneNumberId: string;
}

// ---------------------------------------------------------------------------
// Signature verification (shared shape for inbound/tool-call/events webhooks)
// ---------------------------------------------------------------------------

export interface VerifyWebhookSignatureInput {
  rawBody: string;
  signatureHeader: string | null;
  /** Max age (ms) before a timestamp is considered stale — replay-window guard. */
  toleranceMs?: number;
}

export type VerifyWebhookSignatureResult =
  | { valid: true }
  | {
      valid: false;
      reason: "missing_header" | "malformed_header" | "signature_mismatch" | "stale_timestamp";
    };

// ---------------------------------------------------------------------------
// The compiler's output — the canonical wrapper around a provider-shaped
// payload. `providerPayload` is deliberately `unknown` here: only the
// adapter package that produced it may narrow/inspect its real shape
// (CLAUDE.md Rule 2 — no provider type escapes the adapter boundary).
// ---------------------------------------------------------------------------

export interface CompiledAgentArtifact {
  compileTarget: CompileTarget;
  /** True only when the disclosure-line publish gate passed (BACKEND_SPEC §1.3). Never publish when false. */
  disclosureVerified: boolean;
  providerPayload: unknown;
}

// ---------------------------------------------------------------------------
// The VoiceProvider interface itself
// ---------------------------------------------------------------------------

export interface VoiceProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  createOrUpdateAgent(input: CreateOrUpdateAgentInput): Promise<CreateOrUpdateAgentResult>;
  publishAgentVersion(input: PublishAgentVersionInput): Promise<PublishAgentVersionResult>;
  importPhoneNumber(input: ImportPhoneNumberInput): Promise<ImportPhoneNumberResult>;

  verifyWebhookSignature(input: VerifyWebhookSignatureInput): VerifyWebhookSignatureResult;

  /** Parse+validate a provider's inbound-call ("call_inbound") webhook body into the canonical context. */
  resolveInboundCall(rawBody: string): InboundCallContext;
  /** Lower our resolution back into whatever shape the provider's inbound-webhook response expects. */
  buildInboundResponse(resolution: InboundCallResolution): unknown;

  /** Verify signature (fail closed) + parse a tool-call webhook body into the canonical request. Throws on failure. */
  verifyAndParseToolCall(rawBody: string, signatureHeader: string | null): ToolCallRequest;
  buildToolCallResponse(result: ToolCallResult): unknown;

  /** Verify signature (fail closed) + parse+normalize a `call_ended` webhook into the canonical event. Throws on failure. */
  verifyAndParseCallEndedWebhook(rawBody: string, signatureHeader: string | null): CallEndedEvent;

  /** Lower a canonical `AgentTemplate` into this provider's agent-config payload for the given compile target. */
  compileTemplate(template: AgentTemplate, target: CompileTarget): CompiledAgentArtifact;
}
