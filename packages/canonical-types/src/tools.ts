/**
 * Request/response types for every in-call voice tool (BACKEND_SPEC §7.2,
 * MASTER_SPEC §3.0 `create_order`, §3.2 `send_payment_link`). These are the
 * canonical shapes `/voice/tools` (T3) validates args against and returns —
 * the Retell dispatch envelope (`{call_id, name, args}` -> `{result}`) is
 * lowered/raised at the adapter boundary in `packages/adapters/retell`,
 * never referenced here.
 */

import { z } from "zod";
import { zCents } from "./primitives.js";

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

const zSlotAlternative = z.object({ start: z.string(), end: z.string() });

const zCustomerInput = z.looseObject({
  name: z.string().min(1),
  phone: z.string().min(1),
});

/** Every tool's failure branch when a graceful message-taking fallback is used instead of an error (BACKEND_SPEC §7.2). */
export const zToolFallbackResult = z.object({
  fallback: z.literal(true),
  message: z.string().min(1),
});
export type ToolFallbackResult = z.infer<typeof zToolFallbackResult>;

// ---------------------------------------------------------------------------
// 7.2.1 check_availability
// ---------------------------------------------------------------------------

export const zCheckAvailabilityRequest = z.object({
  offering_id: z.string().min(1).optional(),
  resource_type: z.string().min(1).optional(),
  date_range: z.object({ start: z.string().min(1), end: z.string().min(1) }),
  party_size: z.number().int().positive().optional(),
});
export type CheckAvailabilityRequest = z.infer<typeof zCheckAvailabilityRequest>;

export const zCheckAvailabilityResult = z.object({
  slots: z.array(z.object({ start: z.string(), end: z.string(), resource_id: z.string() })),
  none_available: z.boolean(),
  nearest_alternative: zSlotAlternative.optional(),
});
export type CheckAvailabilityResult = z.infer<typeof zCheckAvailabilityResult>;

// ---------------------------------------------------------------------------
// 7.2.2 create_booking
// ---------------------------------------------------------------------------

export const zCreateBookingRequest = z.object({
  resource_id: z.string().min(1),
  offering_id: z.string().min(1).optional(),
  start: z.string().min(1),
  end: z.string().min(1),
  customer: zCustomerInput,
  party_size: z.number().int().positive().optional(),
  structured_payload: z.record(z.string(), z.unknown()).optional(),
});
export type CreateBookingRequest = z.infer<typeof zCreateBookingRequest>;

export const zCreateBookingResult = z.discriminatedUnion("confirmed", [
  z.object({
    confirmed: z.literal(true),
    booking_id: z.string().min(1),
    start: z.string(),
    end: z.string(),
  }),
  z.object({
    confirmed: z.literal(false),
    reason: z.literal("slot_taken"),
    nearest_alternative: zSlotAlternative.optional(),
  }),
]);
export type CreateBookingResult = z.infer<typeof zCreateBookingResult>;

// ---------------------------------------------------------------------------
// 7.2.3 update_booking (reschedule)
// ---------------------------------------------------------------------------

export const zUpdateBookingRequest = z.object({
  booking_id: z.string().min(1),
  new_start: z.string().min(1),
  new_end: z.string().min(1),
});
export type UpdateBookingRequest = z.infer<typeof zUpdateBookingRequest>;

export const zUpdateBookingResult = z.discriminatedUnion("confirmed", [
  z.object({ confirmed: z.literal(true), start: z.string(), end: z.string() }),
  z.object({ confirmed: z.literal(false), reason: z.literal("slot_taken") }),
]);
export type UpdateBookingResult = z.infer<typeof zUpdateBookingResult>;

// ---------------------------------------------------------------------------
// 7.2.4 cancel_booking
// ---------------------------------------------------------------------------

export const zCancelBookingRequest = z.object({
  booking_id: z.string().min(1),
  reason: z.string().min(1).optional(),
});
export type CancelBookingRequest = z.infer<typeof zCancelBookingRequest>;

export const zCancelBookingResult = z.object({ cancelled: z.literal(true) });
export type CancelBookingResult = z.infer<typeof zCancelBookingResult>;

// ---------------------------------------------------------------------------
// 7.2.5 lookup_customer (G6: server-side cross-checked against caller number)
// ---------------------------------------------------------------------------

export const zLookupCustomerRequest = z.object({ phone: z.string().min(1) });
export type LookupCustomerRequest = z.infer<typeof zLookupCustomerRequest>;

export const zLookupCustomerResult = z.union([
  z.object({
    found: z.boolean(),
    name: z.string().optional(),
    segment: z.enum(["new", "returning", "loyal", "vip"]).optional(),
    recent_bookings: z.array(z.record(z.string(), z.unknown())).optional(),
    vehicles: z.array(z.record(z.string(), z.unknown())).optional(),
    pets: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  z.object({ error: z.literal("unauthorized_lookup") }),
]);
export type LookupCustomerResult = z.infer<typeof zLookupCustomerResult>;

// ---------------------------------------------------------------------------
// 7.2.6 take_message
// ---------------------------------------------------------------------------

export const zTakeMessageRequest = z.object({
  caller_name: z.string().min(1).optional(),
  caller_phone: z.string().min(1),
  message_text: z.string().min(1),
  callback_window: z.string().min(1).optional(),
});
export type TakeMessageRequest = z.infer<typeof zTakeMessageRequest>;

export const zTakeMessageResult = z.object({ recorded: z.literal(true) });
export type TakeMessageResult = z.infer<typeof zTakeMessageResult>;

// ---------------------------------------------------------------------------
// 7.2.7 send_sms_confirmation
// ---------------------------------------------------------------------------

export const zSendSmsConfirmationRequest = z.object({
  booking_id: z.string().min(1).optional(),
  order_id: z.string().min(1).optional(),
  phone: z.string().min(1),
  template_key: z.string().min(1),
});
export type SendSmsConfirmationRequest = z.infer<typeof zSendSmsConfirmationRequest>;

export const zSendSmsConfirmationResult = z.object({
  queued: z.literal(true),
  message_id: z.string().min(1),
});
export type SendSmsConfirmationResult = z.infer<typeof zSendSmsConfirmationResult>;

// ---------------------------------------------------------------------------
// 7.2.8 transfer_call (native provider function; compiled-in config, not an
// HTTP tool call — modeled here only as the tenant-config-only destination
// shape the compiler reads and the warm-transfer context summary payload).
// ---------------------------------------------------------------------------

export const zTransferCallConfig = z.object({
  /** Resolved ONLY from `agent_configs.transfer_number` — never a runtime tool argument (G6). */
  destination_number: z.string().min(1),
  /** "Warm transfers always carry a context summary" (SYSTEM_DESIGN §4.5). */
  context_summary_enabled: z.literal(true),
});
export type TransferCallConfig = z.infer<typeof zTransferCallConfig>;

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.0 create_order (restaurant/message-mode commerce)
// ---------------------------------------------------------------------------

export const zOrderItemInput = z.object({
  offering_id: z.string().min(1).optional(),
  name: z.string().min(1),
  qty: z.number().int().positive(),
  modifiers: z.array(z.string().min(1)).optional(),
});
export type OrderItemInput = z.infer<typeof zOrderItemInput>;

export const FULFILLMENT_TYPES = ["pickup", "delivery", "dine_in"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const zDeliveryAddressInput = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
});
export type DeliveryAddressInput = z.infer<typeof zDeliveryAddressInput>;

export const zCreateOrderRequest = z
  .object({
    items: z.array(zOrderItemInput).min(1),
    fulfillment_type: z.enum(FULFILLMENT_TYPES),
    delivery_address: zDeliveryAddressInput.optional(),
    customer: zCustomerInput,
  })
  .check((ctx) => {
    if (ctx.value.fulfillment_type === "delivery" && !ctx.value.delivery_address) {
      ctx.issues.push({
        code: "custom",
        message:
          "delivery orders REQUIRE address capture (MASTER_SPEC §3.0) — delivery_address is required " +
          "when fulfillment_type is 'delivery'",
        input: ctx.value,
        path: ["delivery_address"],
      });
    }
  });
export type CreateOrderRequest = z.infer<typeof zCreateOrderRequest>;

export const zCreateOrderResult = z.discriminatedUnion("confirmed", [
  z.object({
    confirmed: z.literal(true),
    order_id: z.string().min(1),
    subtotal_cents: zCents,
    tax_cents: zCents,
    total_cents: zCents,
  }),
  z.object({
    // Out-of-radius delivery -> polite decline with a pickup offer (§3.0).
    confirmed: z.literal(false),
    reason: z.enum(["out_of_delivery_radius", "below_minimum_order", "item_not_found"]),
    pickup_offered: z.boolean().optional(),
    min_order_cents: zCents.optional(),
  }),
]);
export type CreateOrderResult = z.infer<typeof zCreateOrderResult>;

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.2 send_payment_link (phone payments)
// ---------------------------------------------------------------------------

export const PAYMENT_LINK_PURPOSES = ["order", "deposit", "noshow_fee"] as const;
export type PaymentLinkPurpose = (typeof PAYMENT_LINK_PURPOSES)[number];

export const zSendPaymentLinkRequest = z
  .object({
    order_id: z.string().min(1).optional(),
    booking_id: z.string().min(1).optional(),
    phone: z.string().min(1),
    purpose: z.enum(PAYMENT_LINK_PURPOSES),
    amount_cents: zCents,
  })
  .check((ctx) => {
    if (!ctx.value.order_id && !ctx.value.booking_id) {
      ctx.issues.push({
        code: "custom",
        message: "send_payment_link requires at least one of order_id/booking_id",
        input: ctx.value,
        path: ["order_id"],
      });
    }
  });
export type SendPaymentLinkRequest = z.infer<typeof zSendPaymentLinkRequest>;

export const zSendPaymentLinkResult = z.object({
  queued: z.literal(true),
  payment_link_id: z.string().min(1),
});
export type SendPaymentLinkResult = z.infer<typeof zSendPaymentLinkResult>;

// ---------------------------------------------------------------------------
// Tool name -> request/response schema registry (dispatch table for /voice/tools)
// ---------------------------------------------------------------------------

export const TOOL_REQUEST_SCHEMAS = {
  check_availability: zCheckAvailabilityRequest,
  create_booking: zCreateBookingRequest,
  update_booking: zUpdateBookingRequest,
  cancel_booking: zCancelBookingRequest,
  lookup_customer: zLookupCustomerRequest,
  take_message: zTakeMessageRequest,
  send_sms_confirmation: zSendSmsConfirmationRequest,
  create_order: zCreateOrderRequest,
  send_payment_link: zSendPaymentLinkRequest,
} as const;

export type ToolName = keyof typeof TOOL_REQUEST_SCHEMAS;
export const TOOL_NAMES = Object.keys(TOOL_REQUEST_SCHEMAS) as ToolName[];
