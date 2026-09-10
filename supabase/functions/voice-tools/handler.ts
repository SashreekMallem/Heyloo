import type { GeocodeFetch } from "../_shared/providers/geocode.ts";
import type { StripeFetch } from "../_shared/providers/stripe.ts";
import { fallbackEnvelope, toolEnvelope } from "../_shared/responses.ts";
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
  ToolDispatchEnvelopeSchema,
  UpdateBookingArgsSchema,
} from "../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient, ToolResultEnvelope } from "../_shared/types.ts";
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

export async function dispatchTool(
  deps: DispatchDeps,
  callId: string,
  name: string,
  rawArgs: unknown,
): Promise<ToolResultEnvelope> {
  const { sql, logger, dentalIntake, geocode } = deps;

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
      return toolEnvelope(
        await createBooking(sql, ctx, parsed.data, { logger, appBaseUrl: dentalIntake.appBaseUrl }),
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
      return toolEnvelope(
        await createOrder(sql, ctx, parsed.data, logger, geocode ? { geocode } : {}),
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
