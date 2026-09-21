import type { GeocodeFetch } from "../_shared/providers/geocode.ts";
import type { StripeFetch } from "../_shared/providers/stripe.ts";
import { fallbackEnvelope, missingFieldsEnvelope, toolEnvelope } from "../_shared/responses.ts";
import {
  CancelBookingArgsSchema,
  CheckAvailabilityArgsSchema,
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
import type { Logger, SqlClient, ToolResultEnvelope } from "../_shared/types.ts";
import { getMissingRequiredFields } from "../_shared/vertical-intake.ts";
import type { CallContext } from "./context.ts";
import { resolveCallContext } from "./context.ts";
import { cancelBooking } from "./tools/cancel_booking.ts";
import { checkAvailability } from "./tools/check_availability.ts";
import { createBooking } from "./tools/create_booking.ts";
import { createOrder } from "./tools/create_order.ts";
import { joinWaitlist } from "./tools/join_waitlist.ts";
import { listOfferings } from "./tools/list_offerings.ts";
import { lookupCustomer } from "./tools/lookup_customer.ts";
import { sendPaymentLink } from "./tools/send_payment_link.ts";
import { sendSmsConfirmation } from "./tools/send_sms_confirmation.ts";
import { takeMessage } from "./tools/take_message.ts";
import { updateBooking } from "./tools/update_booking.ts";

/**
 * `/voice-tools` dispatcher (BACKEND_SPEC §7.2). This is the part of the hot
 * path that stays circuit-breaker- and timeout-agnostic on purpose — the
 * Deno `index.ts` wraps a call to `dispatchTool` in the per-tool circuit
 * breaker check and the hard 1.5s abort race; this file only does context
 * resolution + arg validation + routing, so it's unit testable without
 * fake timers.
 */

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
  /** restaurant.md Finding B4 — undefined (no `GEOCODE_API_KEY`) leaves
   * `create_order`'s delivery-address save a pure no-op, never a failure. */
  geocode?: {
    fetchImpl: GeocodeFetch;
    apiKey: string;
  };
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
  telemetry?: { tenantId: string | null };
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
]);

export function isKnownTool(name: string): boolean {
  return KNOWN_TOOLS.has(name);
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
 * Zero new DB round trips either way (hot-path budget, CLAUDE.md Rule 2):
 * pure object manipulation over data already in hand (`ctx` was already
 * resolved for this call; `args` already parsed).
 */
function applyIntakeGate<T extends Record<string, unknown>>(
  ctx: CallContext,
  tool: "create_booking" | "create_order" | "take_message",
  args: T,
  phoneField: "customer" | "caller_phone",
): { ok: true; args: T } | { ok: false; envelope: ToolResultEnvelope } {
  let next: T = args;
  if (phoneField === "customer") {
    const customer = args["customer"] as Record<string, unknown> | undefined;
    if (customer && !customer["phone"] && ctx.callerNumber) {
      next = { ...args, customer: { ...customer, phone: ctx.callerNumber } };
    }
  } else if (!args["caller_phone"] && ctx.callerNumber) {
    next = { ...args, caller_phone: ctx.callerNumber };
  }
  const missing = getMissingRequiredFields(ctx.vertical, tool, next);
  if (missing.length > 0) {
    return { ok: false, envelope: missingFieldsEnvelope(missing) };
  }
  return { ok: true, args: next };
}

export async function dispatchTool(
  deps: DispatchDeps,
  callId: string,
  name: string,
  rawArgs: unknown,
  call?: ToolCall,
): Promise<ToolResultEnvelope> {
  const { sql, logger, dentalIntake, geocode } = deps;

  const ctx = await resolveCallContext(sql, callId, call, logger);
  if (!ctx) {
    return fallbackEnvelope();
  }
  if (deps.telemetry) deps.telemetry.tenantId = ctx.tenantId;

  switch (name) {
    case "check_availability": {
      const parsed = CheckAvailabilityArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await checkAvailability(sql, ctx, parsed.data));
    }
    case "create_booking": {
      const parsed = CreateBookingArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      const gated = applyIntakeGate(ctx, "create_booking", parsed.data, "customer");
      if (!gated.ok) return gated.envelope;
      return toolEnvelope(
        await createBooking(sql, ctx, gated.args, { logger, appBaseUrl: dentalIntake.appBaseUrl }),
      );
    }
    case "update_booking": {
      const parsed = UpdateBookingArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await updateBooking(sql, ctx, parsed.data));
    }
    case "cancel_booking": {
      const parsed = CancelBookingArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await cancelBooking(sql, ctx, parsed.data));
    }
    case "lookup_customer": {
      const parsed = LookupCustomerArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await lookupCustomer(sql, ctx, parsed.data, logger));
    }
    case "take_message": {
      const parsed = TakeMessageArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      const gated = applyIntakeGate(ctx, "take_message", parsed.data, "caller_phone");
      if (!gated.ok) return gated.envelope;
      return toolEnvelope(await takeMessage(sql, ctx, gated.args));
    }
    case "send_sms_confirmation": {
      const parsed = SendSmsConfirmationArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await sendSmsConfirmation(sql, ctx, parsed.data));
    }
    case "create_order": {
      const parsed = CreateOrderArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      const gated = applyIntakeGate(ctx, "create_order", parsed.data, "customer");
      if (!gated.ok) return gated.envelope;
      return toolEnvelope(
        await createOrder(sql, ctx, gated.args, logger, geocode ? { geocode } : {}),
      );
    }
    case "send_payment_link": {
      const parsed = SendPaymentLinkArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(
        await sendPaymentLink(sql, ctx, parsed.data, { ...deps.paymentLink, logger }),
      );
    }
    case "join_waitlist": {
      const parsed = JoinWaitlistArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await joinWaitlist(sql, ctx, parsed.data));
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
