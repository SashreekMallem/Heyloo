import type { StripeFetch } from "../_shared/providers/stripe.js";
import { fallbackEnvelope, toolEnvelope } from "../_shared/responses.js";
import {
  CancelBookingArgsSchema,
  CheckAvailabilityArgsSchema,
  CreateBookingArgsSchema,
  CreateOrderArgsSchema,
  LookupCustomerArgsSchema,
  SendPaymentLinkArgsSchema,
  SendSmsConfirmationArgsSchema,
  TakeMessageArgsSchema,
  ToolDispatchEnvelopeSchema,
  UpdateBookingArgsSchema,
} from "../_shared/schemas/voice-tools.js";
import type { Logger, SqlClient, ToolResultEnvelope } from "../_shared/types.js";
import { resolveCallContext } from "./context.js";
import { cancelBooking } from "./tools/cancel_booking.js";
import { checkAvailability } from "./tools/check_availability.js";
import { createBooking } from "./tools/create_booking.js";
import { createOrder } from "./tools/create_order.js";
import { lookupCustomer } from "./tools/lookup_customer.js";
import { sendPaymentLink } from "./tools/send_payment_link.js";
import { sendSmsConfirmation } from "./tools/send_sms_confirmation.js";
import { takeMessage } from "./tools/take_message.js";
import { updateBooking } from "./tools/update_booking.js";

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
]);

export function isKnownTool(name: string): boolean {
  return KNOWN_TOOLS.has(name);
}

export async function dispatchTool(
  deps: DispatchDeps,
  callId: string,
  name: string,
  rawArgs: unknown,
): Promise<ToolResultEnvelope> {
  const { sql, logger } = deps;

  const ctx = await resolveCallContext(sql, callId);
  if (!ctx) {
    logger.warn("voice_tools_unresolved_call_context", { call_id: callId, tool: name });
    return fallbackEnvelope();
  }

  switch (name) {
    case "check_availability": {
      const parsed = CheckAvailabilityArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await checkAvailability(sql, ctx, parsed.data));
    }
    case "create_booking": {
      const parsed = CreateBookingArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await createBooking(sql, ctx, parsed.data));
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
      return toolEnvelope(await takeMessage(sql, ctx, parsed.data));
    }
    case "send_sms_confirmation": {
      const parsed = SendSmsConfirmationArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await sendSmsConfirmation(sql, ctx, parsed.data));
    }
    case "create_order": {
      const parsed = CreateOrderArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(await createOrder(sql, ctx, parsed.data, logger));
    }
    case "send_payment_link": {
      const parsed = SendPaymentLinkArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return fallbackEnvelope();
      return toolEnvelope(
        await sendPaymentLink(sql, ctx, parsed.data, { ...deps.paymentLink, logger }),
      );
    }
    default:
      logger.warn("voice_tools_unknown_tool", { call_id: callId, tool: name });
      return fallbackEnvelope();
  }
}

export function validateEnvelope(body: unknown) {
  return ToolDispatchEnvelopeSchema.safeParse(body);
}
