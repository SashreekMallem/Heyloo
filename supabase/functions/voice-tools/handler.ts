import {
  applyCustomAnswers,
  type CustomQuestion,
  NO_CUSTOM_QUESTIONS_TEXT,
  resolveCustomQuestions,
} from "../_shared/custom-questions.ts";
import type { CensusFetch } from "../_shared/providers/census-geocode.ts";
import type { StripeFetch } from "../_shared/providers/stripe.ts";
import {
  fallbackEnvelope,
  missingFieldsEnvelope,
  toolEnvelope,
  unavailableEnvelope,
  WRITE_TOOL_NAMES,
  writeFailureEnvelope,
} from "../_shared/responses.ts";
import {
  CancelBookingArgsSchema,
  CheckAvailabilityArgsSchema,
  CheckDeliveryAddressArgsSchema,
  CreateBookingArgsSchema,
  CreateOrderArgsSchema,
  JoinWaitlistArgsSchema,
  ListOfferingsArgsSchema,
  LookupCustomerArgsSchema,
  SendPaymentLinkArgsSchema,
  SendSmsConfirmationArgsSchema,
  TakeMessageArgsSchema,
  type ToolCall,
  ToolDispatchEnvelopeSchema,
  UpdateBookingArgsSchema,
} from "../_shared/schemas/voice-tools.ts";
import type { SmsRegistry } from "../_shared/sms-availability.ts";
import { isSmsAvailable } from "../_shared/sms-availability.ts";
import type { Logger, SqlClient, ToolResultEnvelope } from "../_shared/types.ts";
import {
  getIntakeGaps,
  getMissingRequiredFields,
  isPartialIntake,
  PARTIAL_INTAKE_STATUS,
} from "../_shared/vertical-intake.ts";
import type { CallContext } from "./context.ts";
import { resolveCallContext } from "./context.ts";
import {
  MANUAL_MODE_BOOKING_MESSAGE,
  MANUAL_MODE_CANCEL_MESSAGE,
  MANUAL_MODE_CHANGE_MESSAGE,
  MANUAL_MODE_ORDER_MESSAGE,
} from "./manual-mode.ts";
import { cancelBooking } from "./tools/cancel_booking.ts";
import { checkAvailability } from "./tools/check_availability.ts";
import { checkDeliveryAddressTool } from "./tools/check_delivery_address.ts";
import {
  type CreateBookingResult,
  createBooking,
  createBookingIdempotencyKey,
  findCommittedBooking,
} from "./tools/create_booking.ts";
import { createOrder } from "./tools/create_order.ts";
import { joinWaitlist } from "./tools/join_waitlist.ts";
import { listOfferings } from "./tools/list_offerings.ts";
import { lookupCustomer } from "./tools/lookup_customer.ts";
import { sendPaymentLink } from "./tools/send_payment_link.ts";
import { sendSmsConfirmation } from "./tools/send_sms_confirmation.ts";
import { takeMessage } from "./tools/take_message.ts";
import { localizeNaiveTimes } from "./tools/time-args.ts";
import { updateBooking } from "./tools/update_booking.ts";

/**
 * `/voice-tools` dispatcher (BACKEND_SPEC §7.2). The Deno `index.ts` wraps a
 * call to `dispatchTool` in the per-tool circuit breaker check and a
 * last-resort hard abort (`toolBudget(name).hardAbortMs`); this file does
 * context resolution + arg validation + routing, and — HOTPATH — owns
 * `create_booking`'s deadline and its truthful timeout answer
 * (`createBookingWithinBudget`), so that logic is unit tested.
 */

/**
 * HOTPATH (docs/BUILD_NOTES.md) per-tool time budgets.
 *
 * Retell's own limit is the custom tool's `timeout_ms`: "By default, this is
 * set to 120,000 ms (2 min)", min 1,000, max 600,000, with `max_retry`
 * defaulting to 0 (docs.retellai.com/api-references/create-retell-llm and
 * /create-conversation-flow, re-read 2026-09-29; docs/VERIFY.md HOTPATH).
 * No compiled tool sets `timeout_ms` (checked live: no `agent_configs.
 * compiled_config` contains it), so every budget below sits far inside
 * Retell's. They are about how long a caller should wait in silence, not
 * about Retell giving up.
 *
 * - Every tool except create_booking and the two delivery-address tools
 *   keeps the historical 1.5 s hard abort (graceful fallback envelope).
 * - check_delivery_address / create_order (DELIVERY-1): 3.5 s. Each may wait
 *   up to 1.5 s on the US Census Geocoder (observed 0.27-0.55 s live) on top
 *   of the context read and their own statements; the geocoder's own
 *   AbortController timeout answers "could not verify" well before this.
 * - create_booking: 4 s to finish the write, then up to 1.5 s to read back
 *   what actually committed (`findCommittedBooking`). 1.5 s is deliberately
 *   longer than `index.ts`'s 1.2 s server-side `statement_timeout`, so the
 *   read — queued behind whatever statement is in flight on the single
 *   connection — normally gets its answer. Then a 0.5 s margin
 *   before `index.ts`'s hard abort — 6 s worst case, one tenth of a percent
 *   of the time Retell would wait. Live, the write committed 1.1-1.4 s in
 *   and the old 1.5 s abort answered "someone will confirm" 5/5 times
 *   while the agent told the caller it was booked.
 */
export const DEFAULT_TOOL_BUDGET_MS = 1_500;
export const CREATE_BOOKING_BUDGET_MS = 4_000;
export const CREATE_BOOKING_VERIFY_MS = 1_500;
export const DELIVERY_ADDRESS_TOOL_BUDGET_MS = 3_500;
/** DELIVERY-1: per-request Census Geocoder timeout on the hot path. */
export const CENSUS_TIMEOUT_MS = 1_500;
const HARD_ABORT_MARGIN_MS = 500;

export interface ToolBudget {
  /** Deadline for the tool's own work, measured from dispatch start. */
  budgetMs: number;
  /** create_booking only: how long to wait for the post-deadline check. */
  verifyMs: number;
  /** `index.ts`'s last-resort abort for the whole dispatch. */
  hardAbortMs: number;
}

export function toolBudget(name: string): ToolBudget {
  if (name === "create_booking") {
    return {
      budgetMs: CREATE_BOOKING_BUDGET_MS,
      verifyMs: CREATE_BOOKING_VERIFY_MS,
      hardAbortMs: CREATE_BOOKING_BUDGET_MS + CREATE_BOOKING_VERIFY_MS + HARD_ABORT_MARGIN_MS,
    };
  }
  if (name === "check_delivery_address" || name === "create_order") {
    return {
      budgetMs: DELIVERY_ADDRESS_TOOL_BUDGET_MS,
      verifyMs: 0,
      hardAbortMs: DELIVERY_ADDRESS_TOOL_BUDGET_MS,
    };
  }
  return { budgetMs: DEFAULT_TOOL_BUDGET_MS, verifyMs: 0, hardAbortMs: DEFAULT_TOOL_BUDGET_MS };
}

/** What a dispatch ended as, for `tool_health.stages.outcome`. */
export type DispatchOutcome =
  | "ok"
  | "context_unresolved"
  | "booking_verified_after_timeout"
  | "booking_verified_after_error"
  | "booking_not_completed"
  | "booking_outcome_unknown";

/** HOTPATH: a create_booking that ran out of time without a verified
 * answer is truthful to the caller but still a dependency failure, so it
 * counts against the per-tool circuit breaker (as the old hard abort did);
 * a booking verified after the deadline does not. */
export function countsAsBreakerFailure(outcome: DispatchOutcome | undefined): boolean {
  return outcome === "booking_not_completed" || outcome === "booking_outcome_unknown";
}

/** HOTPATH: the model-facing answers for a create_booking deadline. Both are
 * `confirmed: false`, so the agent can never tell the caller "booked" from
 * them; both say a retry is safe, which is true because the booking is
 * idempotent on (call_id, start instant) — a retry after a late commit
 * returns the existing booking instead of inserting a second one, even if
 * the retry writes the same time in a different format
 * (`createBookingIdempotencyKey`). HOTPATH-REVIEW: the pending message used
 * to promise a confirmation "by text"; nothing sends one, so it now matches
 * the generic fallback's "someone will follow up to confirm". */
export const BOOKING_NOT_COMPLETED_MESSAGE =
  "The booking was NOT made: the system took too long and nothing was saved. Tell the caller you need one more moment, then call create_booking again with exactly the same details. Retrying is safe and can never double-book.";
export const BOOKING_PENDING_MESSAGE =
  "The booking could NOT be confirmed yet, so do not tell the caller it is booked. You may call create_booking once more with exactly the same details (it can never double-book); if that also fails, take the caller's details and tell them someone from the team will follow up to confirm.";

export type BookingTimeoutResult = {
  confirmed: false;
  reason: "not_completed" | "confirmation_pending";
  retry_safe: true;
  message: string;
};

export interface DispatchDeps {
  sql: SqlClient;
  logger: Logger;
  paymentLink: {
    fetchImpl: StripeFetch;
    stripeSecretKey: string;
    successUrl: string;
    cancelUrl: string;
  };
  /** FIX_REQUESTS.md — base URL the dental-intake link is built against. */
  dentalIntake: {
    appBaseUrl: string;
  };
  /** DELIVERY-1: US Census Geocoder transport (keyless) for
   * `check_delivery_address` and `create_order`'s inline address check.
   * Undefined = addresses are recorded as unverified, never geocoded. */
  census?: {
    fetchImpl: CensusFetch;
    timeoutMs?: number;
  };
  /** MSG-3: the messaging registry the text-promising tools (`send_sms_confirmation`,
   * `send_payment_link`, `join_waitlist`) consult to know whether the tenant can
   * really text. Omitted = texting is treated as UNAVAILABLE (fail closed: a tool
   * never promises a text it cannot prove will be sent). */
  sms?: { registry: SmsRegistry };
  /** CALL-2 fix: a mutable out-param `index.ts` reads AFTER `dispatchTool`
   * resolves, so `recordToolStat`'s `tool_health` row can be tagged with
   * the real resolved `tenant_id` instead of always `null` (the pre-CALL-2
   * bug — `resolveCallContext`'s result never left this function, so
   * every `tool_health` row was written with `tenant_id: null` regardless
   * of whether context resolution succeeded, making the per-tenant
   * `tool_health` counts `api-admin-run-agent-tests` reports structurally
   * always zero). Chosen over widening `ToolResultEnvelope`'s shape
   * (which every tool test and the Retell-facing response contract
   * assumes is exactly `{result: ...}`) — a lean hot-path out-param, not a
   * second return channel. */
  telemetry?: {
    tenantId: string | null;
    /** HOTPATH stage timings (ms), filled by `dispatchTool`. */
    contextMs?: number | null;
    toolMs?: number | null;
    outcome?: DispatchOutcome;
  };
  /** HOTPATH: monotonic millisecond clock (`performance.now` in index.ts). */
  now?: () => number;
  /** HOTPATH: schedules work to run after the response
   * (`EdgeRuntime.waitUntil` in index.ts). Omitted: awaited inline. */
  defer?: (label: string, task: () => Promise<void>) => void;
  /** HOTPATH: per-tool budget override (tests); defaults to `toolBudget`. */
  budget?: ToolBudget;
}

const KNOWN_TOOLS = new Set([
  "check_availability",
  "create_booking",
  "update_booking",
  "cancel_booking",
  "lookup_customer",
  "take_message",
  "send_sms_confirmation",
  "create_order",
  "send_payment_link",
  "join_waitlist",
  "list_offerings",
  "check_delivery_address",
]);

export function isKnownTool(name: string): boolean {
  return KNOWN_TOOLS.has(name);
}

/**
 * F5 / F-LEGAL-XFER-1: how many times this call's `take_message` has already
 * been bounced with `missing_required_fields`. A message is never worth
 * losing over a missing intake detail: after ONE bounce the next attempt is
 * stored as a partial intake (the row lists what was missing) instead of being
 * bounced again, so a caller who cannot or will not answer, or is about to be
 * transferred, is never stonewalled and nothing is dropped. Per isolate and
 * best effort (the agent is also told to send `intake_status: "partial"`
 * itself); bounded so a long-lived isolate cannot grow it without limit.
 */
const MESSAGE_BOUNCES_PER_CALL = new Map<string, number>();
const MAX_TRACKED_CALLS = 500;

function recordMessageBounce(callKey: string): number {
  const next = (MESSAGE_BOUNCES_PER_CALL.get(callKey) ?? 0) + 1;
  MESSAGE_BOUNCES_PER_CALL.set(callKey, next);
  if (MESSAGE_BOUNCES_PER_CALL.size > MAX_TRACKED_CALLS) {
    const oldest = MESSAGE_BOUNCES_PER_CALL.keys().next().value;
    if (oldest !== undefined) MESSAGE_BOUNCES_PER_CALL.delete(oldest);
  }
  return next;
}

/** `structured_payload` marked as a partial intake, listing what was still missing. */
function withPartialMarker<T extends Record<string, unknown>>(
  args: T,
  gaps: readonly { path: string }[],
): T {
  const payload =
    args["structured_payload"] && typeof args["structured_payload"] === "object"
      ? (args["structured_payload"] as Record<string, unknown>)
      : {};
  return {
    ...args,
    structured_payload: {
      ...payload,
      intake_status: PARTIAL_INTAKE_STATUS,
      ...(gaps.length > 0 ? { missing_fields: gaps.map((g) => g.path) } : {}),
    },
  };
}

/**
 * CALL-8 (docs/BUILD_PLAN.md): shared pre-write gate for every tool
 * `_shared/vertical-intake.ts` declares requirements for
 * (create_booking/create_order/take_message). Two things, in order, both
 * BEFORE any DB write:
 *
 *  1. Default the caller's callback phone from the live call's own
 *     caller-id (`ctx.callerNumber`) when the model didn't supply one —
 *     "when the caller is on a real call, default callback phone to the
 *     caller number and only confirm it rather than re-ask" (this task's
 *     own instruction). A batch-test/simulator call never has a caller-id
 *     at all (CALL-2's documented finding, `voice-tools/context.ts`), so
 *     this is a no-op there — a batch-test scenario must still have the
 *     model ask/collect a phone number itself, which is exactly what the
 *     required-field check below then verifies happened.
 *  2. Check this vertical/tool's required fields (`getMissingRequiredFields`)
 *     against the (now phone-defaulted) args. Any miss short-circuits with
 *     `missingFieldsEnvelope` — naming exactly what to ask, so the model
 *     has an actionable next step — instead of writing an incomplete row.
 *
 * No new DB round trips for the built-in fields (hot-path budget, CLAUDE.md
 * Rule 2): pure object manipulation over data already in hand (`ctx` was
 * already resolved for this call; `args` already parsed). The owner's custom
 * questions (INTAKE-Q-1) add at most ONE indexed read, only for create_booking
 * / take_message, and none at all when the call's own dynamic variables say
 * the agent was given no custom questions (`loadCustomQuestions`).
 */
async function applyIntakeGate<T extends Record<string, unknown>>(
  deps: DispatchDeps,
  ctx: CallContext,
  call: ToolCall | undefined,
  tool: "create_booking" | "create_order" | "take_message",
  args: T,
  phoneField: "customer" | "caller_phone",
): Promise<{ ok: true; args: T } | { ok: false; envelope: ToolResultEnvelope }> {
  let next: T = args;
  if (phoneField === "customer") {
    const customer = args["customer"] as Record<string, unknown> | undefined;
    if (customer && !customer["phone"] && ctx.callerNumber) {
      next = { ...args, customer: { ...customer, phone: ctx.callerNumber } };
    }
  } else if (!args["caller_phone"] && ctx.callerNumber) {
    next = { ...args, caller_phone: ctx.callerNumber };
  }
  const builtinMissing = getMissingRequiredFields(ctx.vertical, tool, next);
  const customMissing: typeof builtinMissing = [];

  // INTAKE-Q-1: the owner's custom questions (bookings and messages only).
  // Built-in misses are reported first, in the same envelope, then the owner's
  // required questions — so the model asks everything still needed in one go.
  if (tool !== "create_order") {
    const questions = await loadCustomQuestions(deps, ctx, call);
    const custom = applyCustomAnswers(tool, questions, next);
    next = custom.args as T;
    customMissing.push(...custom.missing);
  }
  const missing = [...builtinMissing, ...customMissing];

  if (tool === "take_message") {
    // A message is never lost over a missing intake detail. An explicit
    // partial intake is stored as it is. An incomplete one is bounced once so
    // the model can ask, then stored as partial on the next attempt. The
    // owner's required custom questions are the exception to the second half:
    // the caller can always answer them ("declined" is a valid answer), so
    // they keep bouncing.
    if (isPartialIntake(next)) {
      const gaps = getIntakeGaps(ctx.vertical, tool, next);
      return { ok: true, args: withPartialMarker(next, gaps) };
    }
    if (missing.length > 0) {
      if (customMissing.length === 0 && recordMessageBounce(ctx.retellCallId) > 1) {
        deps.logger.warn("voice_tools_take_message_accepted_partial", {
          tenant_id: ctx.tenantId,
          vertical: ctx.vertical,
          missing: missing.map((m) => m.path),
        });
        return { ok: true, args: withPartialMarker(next, missing) };
      }
      return { ok: false, envelope: missingFieldsEnvelope(missing, { partialEscape: true }) };
    }
    return { ok: true, args: next };
  }
  if (missing.length > 0) {
    return { ok: false, envelope: missingFieldsEnvelope(missing) };
  }
  return { ok: true, args: next };
}

/** INTAKE-Q-1: first `AGENT_COMPILER_VERSION` whose agents can ask custom questions (the portal mirrors it as `CUSTOM_QUESTIONS_MIN_COMPILER_VERSION`). */
const CUSTOM_QUESTIONS_MIN_COMPILER_VERSION = 2;

/**
 * INTAKE-Q-1: the tenant's active custom intake questions, from
 * `agent_configs.dynamic_variable_overrides.custom_questions` — one indexed
 * single-row read (`agent_configs.tenant_id`), only on the two write tools that
 * can carry them (create_booking, take_message), scoped by the verified call
 * context's tenant, never by args.
 *
 * Enforced only when the PUBLISHED agent can actually ask them
 * (`compiled_with_version >= CUSTOM_QUESTIONS_MIN_COMPILER_VERSION`): an agent
 * compiled before this feature has neither the procedure nor the `custom_answers`
 * tool parameter, so a required question saved before the owner republishes
 * would otherwise block every booking and message with a question the agent was
 * never told to ask.
 *
 * Skips the read when the call's own dynamic variables (set by `/voice-inbound`,
 * never by a caller) say the agent was given no custom questions: nothing was
 * asked, so nothing can be required. Any other value, or a payload without the
 * variable (older/other callers), reads the database.
 *
 * Fails OPEN on a read error (warn + `[]`): an unreadable optional owner config
 * must not block a real booking or message (Rule 2 graceful fallback); the
 * built-in required fields are unaffected.
 */
async function loadCustomQuestions(
  deps: DispatchDeps,
  ctx: CallContext,
  call: ToolCall | undefined,
): Promise<CustomQuestion[]> {
  if (call?.retell_llm_dynamic_variables?.["custom_questions_text"] === NO_CUSTOM_QUESTIONS_TEXT) {
    return [];
  }
  try {
    const rows = await deps.sql<{
      custom_questions: unknown;
      compiled_with_version: number | null;
    }>`
      select dynamic_variable_overrides -> 'custom_questions' as custom_questions,
        compiled_with_version
      from public.agent_configs
      where tenant_id = ${ctx.tenantId}
      limit 1
    `;
    const row = rows[0];
    if ((row?.compiled_with_version ?? 0) < CUSTOM_QUESTIONS_MIN_COMPILER_VERSION) return [];
    return resolveCustomQuestions({ custom_questions: row?.custom_questions });
  } catch (err) {
    deps.logger.warn("voice_tools_custom_questions_read_failed", {
      tenant_id: ctx.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function dispatchTool(
  deps: DispatchDeps,
  callId: string,
  name: string,
  rawArgs: unknown,
  call?: ToolCall,
): Promise<ToolResultEnvelope> {
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const ctx = await resolveCallContext(deps.sql, callId, call, deps.logger);
  const contextDoneAt = now();
  if (deps.telemetry) {
    deps.telemetry.contextMs = contextDoneAt - startedAt;
    deps.telemetry.outcome = ctx ? "ok" : "context_unresolved";
  }
  if (!ctx) {
    // F4: a write tool never answers with the generic "someone will confirm"
    // fallback, which reads like success: it says the write did not happen.
    deps.logger.warn("voice_tools_fallback_returned", { tool: name, reason: "context_unresolved" });
    return unavailableEnvelope(name);
  }
  if (deps.telemetry) deps.telemetry.tenantId = ctx.tenantId;

  try {
    return await runTool(deps, ctx, callId, name, rawArgs, startedAt, call);
  } finally {
    if (deps.telemetry) deps.telemetry.toolMs = now() - contextDoneAt;
  }
}

async function runTool(
  deps: DispatchDeps,
  ctx: CallContext,
  callId: string,
  name: string,
  rawArgs: unknown,
  startedAt: number,
  call?: ToolCall,
): Promise<ToolResultEnvelope> {
  const { sql, logger, census } = deps;
  const censusDeps = census ? { census: { timeoutMs: CENSUS_TIMEOUT_MS, ...census } } : {};
  // MSG-3: one indexed statement, only when a text-promising tool asks (at most
  // once per tool call), never on the other tools' path.
  let smsAvailability: Promise<boolean> | undefined;
  const smsAvailable = (): Promise<boolean> => {
    // A failed lookup reads as "no texting", never as a failed tool: the tool then
    // answers "texting unavailable" (a booking or waitlist entry it already wrote
    // must not turn into an error, and no text may be promised on a guess).
    smsAvailability ??= deps.sms
      ? isSmsAvailable(sql, ctx.tenantId, deps.sms.registry).catch((err: unknown) => {
          logger.warn("voice_tools_sms_availability_failed", {
            tenant_id: ctx.tenantId,
            error: String(err),
          });
          return false;
        })
      : Promise.resolve(false);
    return smsAvailability;
  };
  // F1: an offset-less time from the model means the tenant's wall clock,
  // not the edge runtime's (UTC). Rewritten once here so check_availability,
  // create_booking (and its idempotency key), update_booking and
  // join_waitlist all see the same unambiguous instant.
  const localize = <V extends Record<string, string | undefined>>(values: V): Promise<V> =>
    localizeNaiveTimes(
      async () => {
        const rows = await sql<{ timezone: string | null }>`
          select timezone from public.tenants where id = ${ctx.tenantId}
        `;
        return rows[0]?.timezone ?? null;
      },
      values,
      (err) =>
        logger.warn("voice_tools_timezone_read_failed", {
          tenant_id: ctx.tenantId,
          error: String(err),
        }),
    );
  // F4: an argument shape the schema rejects. A write tool answers with what to
  // fix and an explicit "NOT saved" (never the generic fallback, which reads
  // like success); any other tool keeps the generic fallback. Always logged.
  const invalidArgs = (error: {
    issues: readonly { path: PropertyKey[] }[];
  }): ToolResultEnvelope => {
    const fields = [...new Set(error.issues.map((i) => i.path.map(String).join(".") || "(args)"))];
    logger.warn("voice_tools_fallback_returned", {
      tool: name,
      reason: "invalid_args",
      tenant_id: ctx.tenantId,
      fields,
    });
    if (name === "take_message" && fields.includes("message_text")) {
      return missingFieldsEnvelope([
        { path: "message_text", askFor: "a short description of what the message is about" },
      ]);
    }
    if (!WRITE_TOOL_NAMES.has(name)) return fallbackEnvelope();
    return writeFailureEnvelope(
      name,
      `NOT saved: these arguments were missing or invalid: ${fields.join(", ")}. Fix them (ask the caller if you do not have the value) and call ${name} again. Do not tell the caller it was recorded until it returns success.`,
    );
  };
  switch (name) {
    case "check_availability": {
      const parsed = CheckAvailabilityArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      const range = await localize(parsed.data.date_range);
      return toolEnvelope(await checkAvailability(sql, ctx, { ...parsed.data, date_range: range }));
    }
    case "create_booking": {
      const parsed = CreateBookingArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return invalidArgs(parsed.error);
      // VOICE-ALERTS-1: answered before the intake gate so a caller is not
      // walked through required fields for a booking that cannot be made.
      // (`createBooking` refuses too, for callers that skip this dispatcher.)
      if (ctx.manualMode) {
        return toolEnvelope({
          confirmed: false,
          reason: "manual_mode",
          message: MANUAL_MODE_BOOKING_MESSAGE,
        });
      }
      const localized = {
        ...parsed.data,
        ...(await localize({ start: parsed.data.start, end: parsed.data.end })),
      };
      const gated = await applyIntakeGate(deps, ctx, call, "create_booking", localized, "customer");
      if (!gated.ok) return gated.envelope;
      return toolEnvelope(await createBookingWithinBudget(deps, ctx, gated.args, startedAt));
    }
    case "update_booking": {
      const parsed = UpdateBookingArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      if (ctx.manualMode) {
        return toolEnvelope({
          confirmed: false,
          reason: "manual_mode",
          message: MANUAL_MODE_CHANGE_MESSAGE,
        });
      }
      const times = await localize({
        new_start: parsed.data.new_start,
        new_end: parsed.data.new_end,
        appointment_time: parsed.data.verify?.appointment_time,
      });
      return toolEnvelope(
        await updateBooking(sql, ctx, {
          ...parsed.data,
          new_start: times.new_start,
          new_end: times.new_end,
          ...(parsed.data.verify
            ? {
                verify: {
                  ...parsed.data.verify,
                  appointment_time: times.appointment_time ?? parsed.data.verify.appointment_time,
                },
              }
            : {}),
        }),
      );
    }
    case "cancel_booking": {
      const parsed = CancelBookingArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      if (ctx.manualMode) {
        return toolEnvelope({
          cancelled: false,
          reason: "manual_mode",
          message: MANUAL_MODE_CANCEL_MESSAGE,
        });
      }
      const verify = parsed.data.verify;
      if (verify) {
        const times = await localize({ appointment_time: verify.appointment_time });
        return toolEnvelope(
          await cancelBooking(
            sql,
            ctx,
            {
              ...parsed.data,
              verify: {
                ...verify,
                appointment_time: times.appointment_time ?? verify.appointment_time,
              },
            },
            { smsAvailable },
          ),
        );
      }
      return toolEnvelope(await cancelBooking(sql, ctx, parsed.data, { smsAvailable }));
    }
    case "lookup_customer": {
      const parsed = LookupCustomerArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await lookupCustomer(sql, ctx, parsed.data, logger));
    }
    case "take_message": {
      const parsed = TakeMessageArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return invalidArgs(parsed.error);
      const gated = await applyIntakeGate(
        deps,
        ctx,
        call,
        "take_message",
        parsed.data,
        "caller_phone",
      );
      if (!gated.ok) return gated.envelope;
      // F4: one retry on a database error (the live failure was connection
      // exhaustion, which is transient). If that fails too the agent is told
      // the message was NOT saved, never that it was.
      try {
        return toolEnvelope(await takeMessage(sql, ctx, gated.args, { logger, defer: deps.defer }));
      } catch (firstError) {
        logger.warn("voice_tools_take_message_retry", {
          tenant_id: ctx.tenantId,
          error: String(firstError),
        });
        try {
          return toolEnvelope(
            await takeMessage(sql, ctx, gated.args, { logger, defer: deps.defer }),
          );
        } catch (secondError) {
          logger.error("voice_tools_take_message_failed", {
            tenant_id: ctx.tenantId,
            call_id: callId,
            error: String(secondError),
          });
          return writeFailureEnvelope("take_message");
        }
      }
    }
    case "send_sms_confirmation": {
      const parsed = SendSmsConfirmationArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await sendSmsConfirmation(sql, ctx, parsed.data, { smsAvailable }));
    }
    case "create_order": {
      const parsed = CreateOrderArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return invalidArgs(parsed.error);
      if (ctx.manualMode) {
        return toolEnvelope({
          confirmed: false,
          reason: "manual_mode",
          message: MANUAL_MODE_ORDER_MESSAGE,
        });
      }
      const gated = await applyIntakeGate(deps, ctx, call, "create_order", parsed.data, "customer");
      if (!gated.ok) return gated.envelope;
      return toolEnvelope(
        await createOrder(sql, ctx, gated.args, logger, {
          ...censusDeps,
          defer: deps.defer,
        }),
      );
    }
    case "send_payment_link": {
      const parsed = SendPaymentLinkArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(
        await sendPaymentLink(sql, ctx, parsed.data, {
          ...deps.paymentLink,
          logger,
          smsAvailable,
        }),
      );
    }
    case "join_waitlist": {
      const parsed = JoinWaitlistArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      const window = await localize({
        preferred_window_start: parsed.data.preferred_window_start,
        preferred_window_end: parsed.data.preferred_window_end,
      });
      return toolEnvelope(
        await joinWaitlist(sql, ctx, { ...parsed.data, ...window }, { smsAvailable }),
      );
    }
    case "check_delivery_address": {
      const parsed = CheckDeliveryAddressArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(
        await checkDeliveryAddressTool(sql, ctx, parsed.data, { logger, ...censusDeps }),
      );
    }
    case "list_offerings": {
      const parsed = ListOfferingsArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await listOfferings(sql, ctx, parsed.data));
    }
    default:
      logger.warn("voice_tools_unknown_tool", { call_id: callId, tool: name });
      return fallbackEnvelope();
  }
}

type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown }
  | { status: "timeout" };

/** Waits at most `ms` for `promise` without ever rejecting; `ms <= 0` still
 * reports a promise that is already settled (its reactions run as
 * microtasks, before the timer's macrotask). Never leaves a timer behind. */
function settleWithin<T>(promise: Promise<T>, ms: number): Promise<Settled<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: "timeout" }), Math.max(0, ms));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ status: "fulfilled", value });
      },
      (reason: unknown) => {
        clearTimeout(timer);
        resolve({ status: "rejected", reason });
      },
    );
  });
}

function bookingTimeoutResult(reason: BookingTimeoutResult["reason"]): BookingTimeoutResult {
  return {
    confirmed: false,
    reason,
    retry_safe: true,
    message: reason === "not_completed" ? BOOKING_NOT_COMPLETED_MESSAGE : BOOKING_PENDING_MESSAGE,
  };
}

/**
 * HOTPATH (docs/BUILD_NOTES.md): create_booking under a deadline, with an
 * answer that is true whichever way the race went.
 *
 * 1. Run `createBooking` until `startedAt + budget.budgetMs`.
 * 2. If it is still running at the deadline, set the abort flag FIRST —
 *    `createBooking` checks it synchronously right before issuing its write,
 *    so from this point on no write can start.
 * 3. Look the booking up by its idempotency key. The hot path runs ONE
 *    connection (`_shared/db-options.ts#HOT_PATH_MAX_CONNECTIONS`) and
 *    Postgres executes a connection's statements in the order they were
 *    sent, so this lookup runs after any write that was already in flight
 *    has committed or failed. Found: answer with the real booking
 *    (`confirmed: true`). Not found: nothing was booked and nothing can be
 *    anymore — `not_completed`, retry safe.
 * 4. If even the lookup does not answer within `budget.verifyMs`, the truth
 *    is unknown: `confirmation_pending` (never "booked"), and the eventual
 *    outcome of the write is logged after the response for staff follow-up.
 */
async function createBookingWithinBudget(
  deps: DispatchDeps,
  ctx: CallContext,
  args: Parameters<typeof createBooking>[2],
  startedAt: number,
): Promise<CreateBookingResult | BookingTimeoutResult> {
  const { sql, logger } = deps;
  const now = deps.now ?? Date.now;
  const budget = deps.budget ?? toolBudget("create_booking");
  const setOutcome = (outcome: DispatchOutcome) => {
    if (deps.telemetry) deps.telemetry.outcome = outcome;
  };
  const idempotencyKey = createBookingIdempotencyKey(ctx, args);

  const remainingMs = startedAt + budget.budgetMs - now();
  if (remainingMs <= 0) {
    // Context resolution alone used the whole budget: nothing was started.
    setOutcome("booking_not_completed");
    return bookingTimeoutResult("not_completed");
  }

  const abort = { aborted: false };
  const work = createBooking(sql, ctx, args, {
    logger,
    appBaseUrl: deps.dentalIntake.appBaseUrl,
    ...(deps.defer ? { defer: deps.defer } : {}),
    isAborted: () => abort.aborted,
  });
  const first = await settleWithin(work, remainingMs);
  if (first.status === "fulfilled") return first.value;
  if (first.status === "rejected") {
    // The write can fail AFTER Postgres committed it (e.g. the connection
    // dropped before the reply arrived). Answer from the database before
    // falling back; a genuine pre-commit failure still surfaces as the
    // error (generic fallback + circuit-breaker accounting in index.ts).
    const check = await settleWithin(
      findCommittedBooking(sql, ctx, idempotencyKey),
      budget.verifyMs,
    );
    if (check.status === "fulfilled" && check.value) {
      setOutcome("booking_verified_after_error");
      logger.warn("create_booking_verified_after_error", {
        call_id: ctx.retellCallId,
        tenant_id: ctx.tenantId,
        idempotency_key: idempotencyKey,
        error: first.reason instanceof Error ? first.reason.message : String(first.reason),
      });
      return check.value;
    }
    throw first.reason;
  }

  abort.aborted = true;
  const verify = await settleWithin(
    findCommittedBooking(sql, ctx, idempotencyKey),
    budget.verifyMs,
  );
  if (verify.status === "fulfilled") {
    if (verify.value) {
      setOutcome("booking_verified_after_timeout");
      logger.warn("create_booking_verified_after_timeout", {
        call_id: ctx.retellCallId,
        tenant_id: ctx.tenantId,
        idempotency_key: idempotencyKey,
      });
      return verify.value;
    }
    // Nothing committed. If the tool itself has settled by now with a
    // definitive answer (e.g. slot_taken), that answer is the more useful
    // true one; otherwise it can only end as the aborted no-op.
    const settled = await settleWithin(work, 0);
    if (
      settled.status === "fulfilled" &&
      !(settled.value.confirmed === false && settled.value.reason === "not_completed")
    ) {
      return settled.value;
    }
    setOutcome("booking_not_completed");
    logger.warn("create_booking_not_completed_before_deadline", {
      call_id: ctx.retellCallId,
      tenant_id: ctx.tenantId,
      idempotency_key: idempotencyKey,
    });
    return bookingTimeoutResult("not_completed");
  }

  setOutcome("booking_outcome_unknown");
  logger.error("create_booking_outcome_unknown", {
    call_id: ctx.retellCallId,
    tenant_id: ctx.tenantId,
    idempotency_key: idempotencyKey,
    verify: verify.status,
  });
  // Record how the write actually ended once it does (after the response).
  const reportLateOutcome = async () => {
    const late = await settleWithin(work, budget.verifyMs + HARD_ABORT_MARGIN_MS);
    logger.error("create_booking_late_outcome", {
      call_id: ctx.retellCallId,
      tenant_id: ctx.tenantId,
      idempotency_key: idempotencyKey,
      status: late.status,
      ...(late.status === "fulfilled" ? { result: late.value } : {}),
    });
  };
  if (deps.defer) deps.defer("create_booking_late_outcome", reportLateOutcome);
  return bookingTimeoutResult("confirmation_pending");
}

export function validateEnvelope(body: unknown) {
  return ToolDispatchEnvelopeSchema.safeParse(body);
}

/**
 * CALL-2: the real Retell body nests `call_id` under `call.call_id`
 * (`_shared/schemas/voice-tools.ts`'s header comment) — top-level `call_id`
 * is accepted too (e.g. `job-keep-warm`'s synthetic ping body) but is never
 * the only source. `index.ts` treats a `null` result from this as a 400
 * `invalid_request`, same as a schema-validation failure — neither shape
 * providing a call id at all is not a recoverable request.
 */
export function resolveEnvelopeCallId(data: { call_id?: string; call?: ToolCall }): string | null {
  return data.call_id ?? data.call?.call_id ?? null;
}
