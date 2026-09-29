import { buildAgentSettingsVariables, resolveTextPersona } from "../agent-settings.ts";
import type { LlmClient, LlmMessage, LlmToolResult } from "../providers/llm/types.ts";
import type { StripeFetch } from "../providers/stripe.ts";
import { withTimeout } from "../timeout.ts";
import type { Logger, SqlClient } from "../types.ts";
import {
  createWebChatConversation,
  incrementTextMessagesOut,
  isSmsOptedOut,
  loadOrCreateSmsConversation,
  loadWebChatConversationByToken,
  resolveTenantTextContext,
  saveConversationPatch,
} from "./conversation-store.ts";
import { recordTextAgentLlmCost } from "./llm-cost.ts";
import { textAgentRateLimiter } from "./rate-limit.ts";
import {
  buildTextSystemPrompt,
  interpolate,
  TEXT_DISCLOSURE_LINE,
  TEXT_TONE_FRAGMENTS,
} from "./system-prompt.ts";
import { dispatchTextTool, tryVerifyCode } from "./tool-router.ts";
import { toolsForChannel } from "./tools.ts";
import type { TextAgentTurnResult, TextConversationRow, TextTurn } from "./types.ts";
import { looksLikeVerificationCode, normalizeCandidateCode } from "./verification.ts";

/** Bounded tool-use round trips per customer turn — a runaway/looping model
 * fails safe into a take-message-shaped reply rather than an unbounded
 * LLM-call sequence (SMS latency budget: "~5s p95"). */
const MAX_TOOL_ITERATIONS = 4;
const MAX_REPLY_TOKENS = 350; // short SMS-shaped replies, not a full paragraph
const LLM_ATTEMPT_TIMEOUT_MS = 6_000; // one model call; the whole turn is still capped by DEFAULT_TURN_TIMEOUT_MS
const DEFAULT_TURN_TIMEOUT_MS = 8_000; // engine-side ceiling under the ~5s p95 TARGET with headroom for one retry-free pass

const FALLBACK_REPLY =
  "Sorry, I'm having trouble right now — I've noted your message and someone will follow up shortly.";

export interface TextAgentDeps {
  sql: SqlClient;
  logger: Logger;
  /** The LLM port (Gemini by default — docs/design/LLM_PROVIDERS.md). The
   * engine never sees a vendor payload; it speaks canonical messages/tools. */
  llm: LlmClient;
  appBaseUrl: string;
  paymentLink?: {
    fetchImpl: StripeFetch;
    stripeSecretKey: string;
    successUrl: string;
    cancelUrl: string;
  };
  turnTimeoutMs?: number;
  now?: () => Date;
}

export interface SmsTurnInput {
  channel: "sms";
  tenantId: string;
  phoneE164: string;
  message: string;
}

export interface WebChatTurnInput {
  channel: "web_chat";
  tenantId: string;
  /** Absent/unrecognized -> a new conversation is created and its token
   * returned on the result (`TextAgentTurnResult.widgetSessionToken`). */
  sessionToken?: string;
  message: string;
  /**
   * Stable identifier for the caller's *browser session* (not the
   * conversation row) — the rate limiter below is keyed on this instead of
   * `conversation.id`. Without it, a caller that simply omits
   * `sessionToken` on every request gets a brand-new `conversation.id` (see
   * `resolveOrCreateConversation`) and therefore a brand-new rate-limit
   * bucket on every single message, defeating the limiter entirely
   * (docs/BUILD_NOTES.md, repair task: web_chat rate-limit bypass).
   * `api-text-chat/handler.ts` derives this from a hash of the caller's
   * `widget_token`, which stays constant for the token's whole TTL
   * regardless of how many fresh conversations get created under it.
   * Falls back to `conversation.id` when absent (e.g. direct engine
   * callers/tests) so this stays backward compatible.
   */
  sessionKey?: string;
}

export type TextAgentTurnInput = SmsTurnInput | WebChatTurnInput;

function turnRecord(role: "user" | "assistant", text: string, now: Date): TextTurn {
  return { role, text, at: now.toISOString() };
}

async function resolveOrCreateConversation(
  deps: TextAgentDeps,
  input: TextAgentTurnInput,
): Promise<{ conversation: TextConversationRow; widgetSessionToken?: string }> {
  if (input.channel === "sms") {
    return {
      conversation: await loadOrCreateSmsConversation(deps.sql, input.tenantId, input.phoneE164),
    };
  }
  if (input.sessionToken) {
    const existing = await loadWebChatConversationByToken(
      deps.sql,
      input.tenantId,
      input.sessionToken,
    );
    if (existing) return { conversation: existing };
  }
  const created = await createWebChatConversation(deps.sql, input.tenantId);
  return { conversation: created.conversation, widgetSessionToken: created.sessionToken };
}

function noReply(
  conversationId: string,
  reason: NonNullable<TextAgentTurnResult["reason"]>,
  widgetSessionToken?: string,
): TextAgentTurnResult {
  return {
    conversationId,
    reply: null,
    sent: false,
    reason,
    ...(widgetSessionToken ? { widgetSessionToken } : {}),
  };
}

/**
 * Processes one inbound text-channel message end to end (this task's core
 * deliverable): loads/creates the conversation, applies every gate (human
 * handoff, A2P, opt-out, rate limit, pending phone-code verification), runs
 * the LLM tool-calling loop over the SAME `voice-tools/tools/*.ts`
 * handlers, persists state, and meters the reply. Never throws for a
 * business-logic/provider failure — every branch resolves to a
 * `TextAgentTurnResult`, `sent: false` with a `reason` for anything that
 * isn't a normal AI reply, matching this codebase's graceful-fallback
 * discipline (`_shared/responses.ts`).
 */
export async function handleInboundText(
  deps: TextAgentDeps,
  input: TextAgentTurnInput,
): Promise<TextAgentTurnResult> {
  const now = deps.now?.() ?? new Date();
  const { conversation, widgetSessionToken } = await resolveOrCreateConversation(deps, input);

  const tenantContext = await resolveTenantTextContext(deps.sql, input.tenantId);
  if (!tenantContext) {
    deps.logger.error("text_agent_tenant_not_found", { tenant_id: input.tenantId });
    return noReply(conversation.id, "engine_error", widgetSessionToken);
  }

  // Human handoff (cluster W's dashboard "take over" UI flips this column;
  // this task exposes the state transition, not the button) — record the
  // inbound turn for the human to see, but never reply.
  if (conversation.status === "human") {
    await saveConversationPatch(deps.sql, conversation, {
      appendTurns: [turnRecord("user", input.message, now)],
      incrementMessageCount: true,
    });
    return noReply(conversation.id, "human_handoff", widgetSessionToken);
  }

  if (input.channel === "sms") {
    // SETTINGS-2 (docs/BUILD_NOTES.md): the owner's "Text agent enabled" switch
    // (`tenants.text_agent_enabled`, default false) now gates the AI's replies to
    // inbound SMS — off means the message is archived for the owner (the caller
    // already stored it in `messages_inbound`) and NO automatic reply is sent.
    // Website chat follows the widget switch instead (the tab says so). Checked
    // before the opt-out/A2P/rate-limit work: nothing else needs to run.
    if (!tenantContext.textAgentEnabled) {
      await saveConversationPatch(deps.sql, conversation, {
        appendTurns: [turnRecord("user", input.message, now)],
        incrementMessageCount: true,
      });
      return noReply(conversation.id, "text_agent_disabled");
    }
    const optedOut = await isSmsOptedOut(deps.sql, input.tenantId, input.phoneE164);
    if (optedOut) {
      await saveConversationPatch(deps.sql, conversation, {
        appendTurns: [turnRecord("user", input.message, now)],
        incrementMessageCount: true,
      });
      return noReply(conversation.id, "opted_out");
    }
    if (tenantContext.a2pStatus !== "verified") {
      // MASTER_SPEC §10.1's `tenants.a2p_status` enum is
      // 'pending_verification'|'verified'|'failed' — this task's own
      // instruction phrase ("a2p_status != approved") maps to != 'verified'.
      await saveConversationPatch(deps.sql, conversation, {
        appendTurns: [turnRecord("user", input.message, now)],
        incrementMessageCount: true,
      });
      return noReply(conversation.id, "a2p_not_verified");
    }
  }

  const rateLimitKey = `${input.tenantId}:${input.channel}:${
    input.channel === "sms" ? input.phoneE164 : (input.sessionKey ?? conversation.id)
  }`;
  if (!textAgentRateLimiter.allow(rateLimitKey)) {
    await saveConversationPatch(deps.sql, conversation, {
      appendTurns: [turnRecord("user", input.message, now)],
      incrementMessageCount: true,
    });
    return noReply(conversation.id, "rate_limited", widgetSessionToken);
  }

  // Web-chat pending phone verification: intercept BEFORE spending an
  // LLM call whenever the message looks like a code (verification.ts).
  if (
    conversation.channel === "web_chat" &&
    conversation.verificationCodeHash &&
    looksLikeVerificationCode(input.message)
  ) {
    const result = await tryVerifyCode(
      deps.sql,
      conversation,
      normalizeCandidateCode(input.message),
    );
    const reply = result.verified
      ? "You're verified! How can I help?"
      : result.reason === "too_many"
        ? "That's too many tries — let's continue without verifying for now. I can still help with a new booking."
        : result.reason === "expired"
          ? "That code expired — just ask me to resend it."
          : "That code didn't match — please double check and try again.";
    await saveConversationPatch(deps.sql, conversation, {
      appendTurns: [turnRecord("user", input.message, now), turnRecord("assistant", reply, now)],
      incrementMessageCount: true,
      incrementAiMessageCount: true,
    });
    await incrementTextMessagesOut(deps.sql, input.tenantId, tenantContext.priceVersion);
    return {
      conversationId: conversation.id,
      reply,
      sent: true,
      ...(widgetSessionToken ? { widgetSessionToken } : {}),
    };
  }

  // SETTINGS-2: every owner setting the portal saves, resolved fresh for this
  // turn (an edit is live on the next text, no publish) through the SAME
  // sanitizing/bounding module the voice pipeline uses (`agent-settings.ts`),
  // plus the owner's text persona (tone, sign-off). Owner text is data inside
  // the prompt's fenced block (`TEXT_OWNER_INFO_INSTRUCTIONS`); the mandatory
  // first-reply disclosure is prepended in code below, never by the model.
  const settings = buildAgentSettingsVariables({
    specialInstructions: tenantContext.specialInstructions,
    overrides: tenantContext.dynamicVariableOverrides,
    manualMode: tenantContext.manualMode,
    transferNumber: null,
    vertical: tenantContext.vertical,
    timezone: tenantContext.timezone,
    businessHours: tenantContext.businessHours,
    hoursExceptions: tenantContext.hoursExceptions,
    now,
  });
  const persona = resolveTextPersona(tenantContext.textAgentPersona);
  const systemPrompt = interpolate(buildTextSystemPrompt(tenantContext.vertical), {
    cancellation_policy_text: tenantContext.cancellationPolicyText,
    business_name: tenantContext.businessName,
    assistant_name: tenantContext.assistantName,
    special_instructions: settings.special_instructions,
    faq_text: settings.faq_text,
    business_facts: settings.business_facts,
    voicemail_message: settings.voicemail_message,
    booking_mode_text: settings.booking_mode_text,
    text_tone_text: TEXT_TONE_FRAGMENTS[persona.tone],
    text_sign_off: persona.signOff,
  });

  const messages: LlmMessage[] = [
    ...conversation.recentTurns.map(
      (t): LlmMessage =>
        t.role === "user" ? { role: "user", text: t.text } : { role: "assistant", text: t.text },
    ),
    { role: "user", text: input.message },
  ];

  const runLoop = async (): Promise<string> => {
    const tools = toolsForChannel(input.channel);
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const result = await deps.llm.chat({
        tier: "quality",
        maxOutputTokens: MAX_REPLY_TOKENS,
        system: systemPrompt,
        messages,
        tools,
        // The turn has its own ~8s ceiling (`withTimeout` below): one bounded
        // retry on a transient 429/5xx, never a long backoff stack.
        timeoutMs: LLM_ATTEMPT_TIMEOUT_MS,
        maxRetries: 1,
      });
      if (!result.ok) {
        deps.logger.error("text_agent_llm_error", {
          tenant_id: input.tenantId,
          provider: deps.llm.provider,
          kind: result.error.kind,
          status: result.error.status,
        });
        return FALLBACK_REPLY;
      }

      // COCKPIT-1: token cost of every successful LLM call enters the
      // tenant's margin (text turns are not covered by Retell's call_cost).
      await recordTextAgentLlmCost(
        deps.sql,
        {
          tenantId: input.tenantId,
          provider: deps.llm.provider,
          model: result.model,
          usage: result.usage,
          channel: input.channel,
          externalRef: crypto.randomUUID(),
        },
        (err) =>
          deps.logger.warn("text_agent_cost_record_failed", {
            tenant_id: input.tenantId,
            error: String(err),
          }),
      );
      if (result.stopReason !== "tool_use") {
        return result.text || FALLBACK_REPLY;
      }

      messages.push(result.assistantMessage);
      // Sequential, not Promise.all: tool dispatch can mutate `conversation`
      // in place (e.g. verify_phone, the shadow call_logs id cache) and a
      // single turn realistically calls one or two tools — correctness over
      // the marginal latency of parallelizing.
      const toolResults: LlmToolResult[] = [];
      for (const call of result.toolCalls) {
        const { resultText, isError } = await dispatchTextTool(
          {
            sql: deps.sql,
            logger: deps.logger,
            conversation,
            vertical: tenantContext.vertical,
            appBaseUrl: deps.appBaseUrl,
            ...(deps.paymentLink ? { paymentLink: deps.paymentLink } : {}),
            a2pVerified: tenantContext.a2pStatus === "verified",
            manualMode: tenantContext.manualMode,
          },
          call.name,
          call.args,
        );
        toolResults.push({
          callId: call.id,
          name: call.name,
          content: resultText,
          ...(isError ? { isError: true } : {}),
        });
      }
      messages.push({ role: "tool", results: toolResults });
    }
    // Exhausted the tool-call budget without a final text turn — fail safe
    // rather than loop forever or return a half-finished tool_use.
    return FALLBACK_REPLY;
  };

  let replyBody: string;
  try {
    replyBody = await withTimeout(runLoop(), deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS);
  } catch (err) {
    deps.logger.error("text_agent_turn_failed", {
      tenant_id: input.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    replyBody = FALLBACK_REPLY;
  }

  let reply = replyBody;
  let disclosureSent = conversation.disclosureSent;
  if (!disclosureSent) {
    const disclosure = interpolate(TEXT_DISCLOSURE_LINE, {
      business_name: tenantContext.businessName,
    });
    reply = `${disclosure}\n\n${replyBody}`;
    disclosureSent = true;
  }

  await saveConversationPatch(deps.sql, conversation, {
    appendTurns: [turnRecord("user", input.message, now), turnRecord("assistant", reply, now)],
    disclosureSent,
    incrementMessageCount: true,
    incrementAiMessageCount: true,
  });
  await incrementTextMessagesOut(deps.sql, input.tenantId, tenantContext.priceVersion);

  return {
    conversationId: conversation.id,
    reply,
    sent: true,
    ...(widgetSessionToken ? { widgetSessionToken } : {}),
  };
}
