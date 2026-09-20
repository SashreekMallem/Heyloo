import type { CallContext } from "../../voice-tools/context.ts";
import { cancelBooking } from "../../voice-tools/tools/cancel_booking.ts";
import { checkAvailability } from "../../voice-tools/tools/check_availability.ts";
import { createBooking } from "../../voice-tools/tools/create_booking.ts";
import { createOrder } from "../../voice-tools/tools/create_order.ts";
import { joinWaitlist } from "../../voice-tools/tools/join_waitlist.ts";
import { listOfferings } from "../../voice-tools/tools/list_offerings.ts";
import { lookupCustomer } from "../../voice-tools/tools/lookup_customer.ts";
import { sendPaymentLink } from "../../voice-tools/tools/send_payment_link.ts";
import { takeMessage } from "../../voice-tools/tools/take_message.ts";
import { updateBooking } from "../../voice-tools/tools/update_booking.ts";
import { normalizeE164 } from "../phone.ts";
import type { StripeFetch } from "../providers/stripe.ts";
import { enqueue, QUEUE_NAMES } from "../queue.ts";
import {
  CancelBookingArgsSchema,
  CheckAvailabilityArgsSchema,
  CreateBookingArgsSchema,
  CreateOrderArgsSchema,
  JoinWaitlistArgsSchema,
  ListOfferingsArgsSchema,
  LookupCustomerArgsSchema,
  SendPaymentLinkArgsSchema,
  TakeMessageArgsSchema,
  UpdateBookingArgsSchema,
} from "../schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../types.ts";
import { ensureShadowCallLog, saveConversationPatch } from "./conversation-store.ts";
import { verifyPhoneRateLimiter } from "./rate-limit.ts";
import type { TextConversationRow } from "./types.ts";
import {
  checkVerificationCode,
  createPendingVerification,
  generateVerificationCode,
  MAX_VERIFICATION_ATTEMPTS,
} from "./verification.ts";

/** Cap on how many DISTINCT phone numbers one conversation can trigger a
 * `verify_phone` SMS to, independent of `verifyPhoneRateLimiter`'s
 * tenant-wide hourly budget below — stops a single (or a handful of
 * cheaply-re-created) conversation(s) from spraying many different
 * strangers' numbers while still comfortably allowing a customer who
 * mistypes their own number a couple of retries. Re-sending to an already-
 * attempted number (e.g. "resend the code") never counts against this. */
const MAX_DISTINCT_PHONES_PER_CONVERSATION = 3;

/** Minimum spacing between two `verify_phone` sends to the SAME number,
 * regardless of which conversation/session triggers them — closes the gap
 * the other two caps leave open: `MAX_DISTINCT_PHONES_PER_CONVERSATION`
 * only bounds one conversation's own spread of distinct numbers (an
 * already-attempted number is deliberately exempt, for the legitimate
 * "didn't get it, resend" case), and `verifyPhoneRateLimiter`'s 20/hour
 * tenant-wide budget still lets an attacker who mints many fresh
 * conversations/sessions burn the whole hour's budget on ONE victim number
 * within seconds. Keyed on `tenantId:phone` (module-scope, in-process —
 * same "cheap backstop, not cross-instance-exact" shape as
 * `TextAgentRateLimiter`), independent of conversation/session identity so
 * a fresh conversation targeting the same number doesn't reset it. */
const VERIFY_PHONE_NUMBER_COOLDOWN_MS = 60_000;
const lastVerifySendAtByNumber = new Map<string, number>();

function checkAndRecordCooldown(key: string, nowMs: number): boolean {
  const last = lastVerifySendAtByNumber.get(key);
  if (last !== undefined && nowMs - last < VERIFY_PHONE_NUMBER_COOLDOWN_MS) {
    return false;
  }
  lastVerifySendAtByNumber.set(key, nowMs);
  return true;
}

function attemptedVerifyPhones(conversation: TextConversationRow): string[] {
  const raw = conversation.structuredState["verify_phone_attempts"];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Dispatches one Anthropic `tool_use` block to the SAME voice-tools
 * implementations `voice-tools/handler.ts` dispatches to for a live call
 * (CLAUDE.md Rule 4 / this task's explicit instruction: reuse, never fork,
 * booking logic) — every booking/order/message/waitlist/lookup tool call
 * below is the literal function from `voice-tools/tools/*.ts`, unmodified.
 * `CallContext` is built from the text conversation instead of a
 * `retell_call_id` lookup (`resolveCallContext`) — see the migration's
 * `call_logs.channel` comment for why a shadow `call_logs` row exists at
 * all: those handlers require a real `callLogId`.
 *
 * Never throws back to the engine's tool-use loop — every branch returns a
 * JSON-serializable result (or `{error: ...}`) that becomes the
 * `tool_result` content block, so a single tool failure degrades to the
 * model explaining/retrying rather than crashing the whole turn (same
 * graceful-fallback discipline as `_shared/responses.ts`'s `fallbackEnvelope`).
 */
export interface TextToolRouterDeps {
  sql: SqlClient;
  logger: Logger;
  conversation: TextConversationRow;
  vertical: string;
  appBaseUrl: string;
  paymentLink?: {
    fetchImpl: StripeFetch;
    stripeSecretKey: string;
    successUrl: string;
    cancelUrl: string;
  };
  /** Enables `verify_phone` (web_chat only) — omitted when the tenant's A2P
   * campaign isn't verified, so the tool simply isn't callable and the
   * model is told so via the tool_result instead of silently failing. */
  a2pVerified: boolean;
  /** Injectable clock for `verify_phone`'s per-number cooldown (tests only —
   * production callers omit this and get the real time). */
  now?: () => Date;
}

async function buildCallContext(deps: TextToolRouterDeps): Promise<CallContext> {
  const callLogId = await ensureShadowCallLog(deps.sql, deps.conversation);
  return {
    tenantId: deps.conversation.tenantId,
    callLogId,
    retellCallId: `text:${deps.conversation.id}`,
    callerNumber: deps.conversation.phoneE164,
    vertical: deps.vertical,
    // CALL-6 (docs/BUILD_NOTES.md): a text/chat conversation is a real
    // customer channel, never a Retell batch-test/simulator artifact —
    // `isTestCall` is always false here, unlike `voice-tools/context.ts`'s
    // resolver, which derives it from the placeholder-call-id detection
    // that only applies to actual Retell voice calls.
    isTestCall: false,
  };
}

function jsonResult(value: unknown): string {
  return JSON.stringify(value);
}

async function runVerifyPhone(
  deps: TextToolRouterDeps,
  rawArgs: unknown,
): Promise<{ resultText: string; isError: boolean }> {
  if (deps.conversation.channel !== "web_chat") {
    return { resultText: jsonResult({ error: "not_applicable_for_this_channel" }), isError: true };
  }
  const phone = normalizeE164(
    typeof (rawArgs as { phone?: unknown })?.phone === "string"
      ? (rawArgs as { phone: string }).phone
      : null,
  );
  if (!phone) {
    return { resultText: jsonResult({ sent: false, reason: "invalid_phone" }), isError: false };
  }
  if (!deps.a2pVerified) {
    return {
      resultText: jsonResult({
        sent: false,
        reason: "sms_unavailable",
        note: "SMS verification isn't available right now — tell the customer you can still help with a new booking using the details they give you, just not look up an existing one.",
      }),
      isError: false,
    };
  }

  // Distinct-numbers-per-conversation cap (see MAX_DISTINCT_PHONES_PER_
  // CONVERSATION's docstring) — checked BEFORE any send, so a blocked
  // attempt never triggers an SMS or mutates verification state.
  const priorPhones = attemptedVerifyPhones(deps.conversation);
  const alreadyAttempted = priorPhones.includes(phone);
  if (!alreadyAttempted && priorPhones.length >= MAX_DISTINCT_PHONES_PER_CONVERSATION) {
    return {
      resultText: jsonResult({
        sent: false,
        reason: "too_many_numbers",
        note: "Too many different phone numbers have been tried in this conversation — tell the customer to try again later, or continue without verifying (you can still help with a new booking).",
      }),
      isError: false,
    };
  }

  // Tenant-wide hourly cap, independent of the above and of the general
  // per-session message rate limit — see `verifyPhoneRateLimiter`'s
  // docstring for why this can't just ride on either of those.
  if (!verifyPhoneRateLimiter.allow(deps.conversation.tenantId)) {
    return {
      resultText: jsonResult({
        sent: false,
        reason: "rate_limited",
        note: "SMS verification is temporarily unavailable — tell the customer you can still help with a new booking, just not look up an existing one right now.",
      }),
      isError: false,
    };
  }

  // Per-number cooldown — see VERIFY_PHONE_NUMBER_COOLDOWN_MS's docstring.
  // Checked last (after the cheaper in-memory caps above), still before any
  // send/DB write.
  const cooldownKey = `${deps.conversation.tenantId}:${phone}`;
  const nowMs = (deps.now?.() ?? new Date()).getTime();
  if (!checkAndRecordCooldown(cooldownKey, nowMs)) {
    return {
      resultText: jsonResult({
        sent: false,
        reason: "cooldown",
        note: "A verification code was just sent to that number — tell the customer to check their messages, or wait a bit before requesting another.",
      }),
      isError: false,
    };
  }

  const code = generateVerificationCode();
  const pending = await createPendingVerification(code);
  await saveConversationPatch(deps.sql, deps.conversation, {
    verificationPhoneE164: phone,
    verificationCodeHash: pending.codeHash,
    verificationCodeExpiresAt: pending.expiresAtIso,
    verificationAttempts: 0,
    structuredState: alreadyAttempted
      ? deps.conversation.structuredState
      : { ...deps.conversation.structuredState, verify_phone_attempts: [...priorPhones, phone] },
  });

  const rows = await deps.sql<{ id: string }>`
    insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload)
    values (${deps.conversation.tenantId}, 'sms', ${phone}, 'chat_phone_verification', ${{ code }}::jsonb)
    returning id
  `;
  const messageId = rows[0]?.id;
  if (messageId) {
    await enqueue(deps.sql, QUEUE_NAMES.messagesOutbound, { message_id: messageId });
  }

  return { resultText: jsonResult({ sent: true }), isError: false };
}

/** Called by `engine.ts` BEFORE the normal tool-use loop whenever a pending
 * verification exists and the customer's message looks like a code —
 * short-circuits straight to a yes/no check rather than spending an
 * Anthropic call on it. Returns `verified: true` (and promotes the
 * conversation's phone) or `verified: false` with a reason the engine turns
 * into a short, non-LLM-generated reply. */
export async function tryVerifyCode(
  sql: SqlClient,
  conversation: TextConversationRow,
  candidateCode: string,
): Promise<{ verified: true } | { verified: false; reason: "expired" | "wrong" | "too_many" }> {
  const { verificationPhoneE164, verificationCodeHash, verificationCodeExpiresAt } = conversation;
  if (!verificationPhoneE164 || !verificationCodeHash || !verificationCodeExpiresAt) {
    return { verified: false, reason: "expired" };
  }
  if (conversation.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
    return { verified: false, reason: "too_many" };
  }

  const ok = await checkVerificationCode({
    candidate: candidateCode,
    codeHash: verificationCodeHash,
    expiresAtIso: verificationCodeExpiresAt,
  });

  if (!ok) {
    const expired = new Date(verificationCodeExpiresAt).getTime() <= Date.now();
    await saveConversationPatch(sql, conversation, {
      verificationAttempts: conversation.verificationAttempts + 1,
    });
    return { verified: false, reason: expired ? "expired" : "wrong" };
  }

  await saveConversationPatch(sql, conversation, {
    phoneE164: verificationPhoneE164,
    verificationPhoneE164: null,
    verificationCodeHash: null,
    verificationCodeExpiresAt: null,
    verificationAttempts: 0,
  });
  return { verified: true };
}

export async function dispatchTextTool(
  deps: TextToolRouterDeps,
  toolName: string,
  rawArgs: unknown,
): Promise<{ resultText: string; isError: boolean }> {
  if (toolName === "verify_phone") {
    return runVerifyPhone(deps, rawArgs);
  }

  const ctx = await buildCallContext(deps);
  const { sql, logger } = deps;

  try {
    switch (toolName) {
      case "check_availability": {
        const parsed = CheckAvailabilityArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return {
          resultText: jsonResult(await checkAvailability(sql, ctx, parsed.data)),
          isError: false,
        };
      }
      case "create_booking": {
        const parsed = CreateBookingArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return {
          resultText: jsonResult(
            await createBooking(sql, ctx, parsed.data, { logger, appBaseUrl: deps.appBaseUrl }),
          ),
          isError: false,
        };
      }
      case "update_booking": {
        const parsed = UpdateBookingArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return {
          resultText: jsonResult(await updateBooking(sql, ctx, parsed.data)),
          isError: false,
        };
      }
      case "cancel_booking": {
        const parsed = CancelBookingArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return {
          resultText: jsonResult(await cancelBooking(sql, ctx, parsed.data)),
          isError: false,
        };
      }
      case "lookup_customer": {
        const parsed = LookupCustomerArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return {
          resultText: jsonResult(await lookupCustomer(sql, ctx, parsed.data, logger)),
          isError: false,
        };
      }
      case "take_message": {
        const parsed = TakeMessageArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return { resultText: jsonResult(await takeMessage(sql, ctx, parsed.data)), isError: false };
      }
      case "create_order": {
        const parsed = CreateOrderArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return {
          resultText: jsonResult(await createOrder(sql, ctx, parsed.data, logger)),
          isError: false,
        };
      }
      case "send_payment_link": {
        if (!deps.paymentLink) {
          return {
            resultText: jsonResult({ queued: false, reason: "unavailable" }),
            isError: true,
          };
        }
        const parsed = SendPaymentLinkArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return {
          resultText: jsonResult(
            await sendPaymentLink(sql, ctx, parsed.data, { ...deps.paymentLink, logger }),
          ),
          isError: false,
        };
      }
      case "join_waitlist": {
        const parsed = JoinWaitlistArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return {
          resultText: jsonResult(await joinWaitlist(sql, ctx, parsed.data)),
          isError: false,
        };
      }
      case "list_offerings": {
        const parsed = ListOfferingsArgsSchema.safeParse(rawArgs);
        if (!parsed.success)
          return { resultText: jsonResult({ error: "invalid_args" }), isError: true };
        return {
          resultText: jsonResult(await listOfferings(sql, ctx, parsed.data)),
          isError: false,
        };
      }
      default:
        logger.warn("text_agent_unknown_tool", {
          tool: toolName,
          tenant_id: deps.conversation.tenantId,
        });
        return { resultText: jsonResult({ error: "unknown_tool" }), isError: true };
    }
  } catch (err) {
    logger.error("text_agent_tool_error", {
      tool: toolName,
      tenant_id: deps.conversation.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { resultText: jsonResult({ error: "tool_execution_failed" }), isError: true };
  }
}
