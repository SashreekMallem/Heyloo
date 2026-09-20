/**
 * Request/response types for every in-call voice tool (BACKEND_SPEC §7.2,
 * MASTER_SPEC §3.0 `create_order`, §3.2 `send_payment_link`). These are the
 * canonical shapes `/voice/tools` (T3) validates args against and returns —
 * the Retell dispatch envelope (`{call_id, name, args}` -> `{result}`) is
 * lowered/raised at the adapter boundary in `packages/adapters/retell`,
 * never referenced here.
 */

import { z } from "zod";
import { zBookingStructuredPayload } from "./booking-payloads.js";
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
  /** Motel room-type / any other resource sub-type tag (`resources.room_type`,
   * GAP_REGISTER.md §2 Motel item 2) — narrows within `resource_type`
   * rather than replacing it (a motel's `resource_type` is always `'room'`;
   * `room_type` picks which room tier, e.g. "queen"). */
  room_type: z.string().min(1).optional(),
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

/** GAP_REGISTER.md §3.6: the caller's once-per-call SMS/call consent answer
 * (MASTER_SPEC §3.6), mirrored 1:1 from `_shared/schemas/voice-tools.ts`'s
 * `CreateBookingArgsSchema` — that file is the runtime-enforced shape;
 * `zConsentInput` here is the single canonical source both it and
 * `zCreateOrderRequest` below reference, closing GAP_REGISTER.md §1.9's
 * schema-drift finding. */
const zConsentInput = z.object({ sms: z.boolean().optional(), call: z.boolean().optional() });

/** MASTER_SPEC §3.7 identity fallback: supplied ONLY when the live call's
 * caller number differs from the booking's own customer phone — full name
 * + the appointment time the caller believes they have, checked against
 * the real booking before any write. Mirrored from `_shared/schemas/
 * voice-tools.ts`'s `IdentityVerifySchema` (GAP_REGISTER.md §1.9). */
const zIdentityVerifyInput = z.object({
  full_name: z.string().min(1),
  appointment_time: z.string().min(1),
});

export const zCreateBookingRequest = z.object({
  resource_id: z.string().min(1),
  /** OPS-5 (docs/BUILD_NOTES.md): optional fallback hint mirrored from
   * `_shared/schemas/voice-tools.ts`'s `CreateBookingArgsSchema` —
   * `voice-tools/tools/create_booking.ts` resolves the real resource
   * server-side when `resource_id` doesn't match (a hallucinated/
   * misremembered id), using this name as one of its resolution steps. */
  resource_name: z.string().min(1).optional(),
  offering_id: z.string().min(1).optional(),
  start: z.string().min(1),
  end: z.string().min(1),
  customer: zCustomerInput,
  party_size: z.number().int().positive().optional(),
  /** Typed per vertical (GAP_REGISTER.md §1.7, `booking-payloads.ts`) —
   * still a union of loose objects, so an unrecognized/partial payload is
   * never a hard validation failure on the booking itself. */
  structured_payload: zBookingStructuredPayload.optional(),
  consent: zConsentInput.optional(),
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
  verify: zIdentityVerifyInput.optional(),
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
  verify: zIdentityVerifyInput.optional(),
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
    addresses: z.array(z.record(z.string(), z.unknown())).optional(),
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
  /** GAP_REGISTER.md §2 Legal item 4 / real_estate — reuses the SAME
   * per-vertical typed shapes `create_booking` uses (`booking-payloads.ts`)
   * so a caller who leaves a message instead of completing a booking (no
   * booking concept at all for legal; a lead not ready to schedule a
   * showing for real_estate) still gets structured intake data recorded,
   * not just free-text `message_text`. */
  structured_payload: zBookingStructuredPayload.optional(),
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
// MASTER_SPEC §3.4 join_waitlist (GAP_REGISTER.md §1.2)
// ---------------------------------------------------------------------------

export const zJoinWaitlistRequest = z.object({
  customer: zCustomerInput,
  offering_id: z.string().min(1).optional(),
  resource_type: z.string().min(1).optional(),
  preferred_window_start: z.string().min(1),
  preferred_window_end: z.string().min(1),
  notes: z.string().min(1).optional(),
});
export type JoinWaitlistRequest = z.infer<typeof zJoinWaitlistRequest>;

export const zJoinWaitlistResult = z.discriminatedUnion("joined", [
  z.object({ joined: z.literal(true), waitlist_entry_id: z.string().min(1) }),
  z.object({
    joined: z.literal(false),
    reason: z.enum(["invalid_phone", "offering_not_found"]),
  }),
]);
export type JoinWaitlistResult = z.infer<typeof zJoinWaitlistResult>;

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
  /** CHANNELS-2 item 10: when the caller picked one of several saved
   * addresses `lookup_customer` returned (by its short label), the model
   * passes that saved row's id here instead of re-speaking the full
   * address — `create_order.ts` resolves street/city/state/zip/geocode
   * from the saved row server-side. Omitted for a brand-new address the
   * caller speaks fresh, in which case `street`/etc are required (see the
   * `.check()` below). */
  address_id: z.string().min(1).optional(),
  street: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  zip: z.string().min(1).optional(),
  /** Only set when the caller explicitly asked this address become their
   * new default — merely using or adding an address must never silently
   * replace an existing default (item 10(d)). */
  set_as_default: z.boolean().optional(),
});
export type DeliveryAddressInput = z.infer<typeof zDeliveryAddressInput>;

export const zCreateOrderRequest = z
  .object({
    items: z.array(zOrderItemInput).min(1),
    fulfillment_type: z.enum(FULFILLMENT_TYPES),
    delivery_address: zDeliveryAddressInput.optional(),
    customer: zCustomerInput,
    /** GAP_REGISTER.md §1.10 — `create_order` had no consent field even
     * though `create_booking` did; same once-per-call SMS/call consent ask
     * (MASTER_SPEC §3.6). */
    consent: zConsentInput.optional(),
    /** GAP_REGISTER.md §2 Restaurant item 2 — the template mandates an
     * explicit allergy ask with no schema field to persist the answer to. */
    allergies: z.array(z.string().min(1)).optional(),
    special_instructions: z.string().min(1).optional(),
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
    // CHANNELS-2 item 10: a delivery address must resolve to SOMETHING —
    // either a saved address picked by id, or a freshly spoken street.
    if (
      ctx.value.fulfillment_type === "delivery" &&
      ctx.value.delivery_address &&
      !ctx.value.delivery_address.address_id &&
      !ctx.value.delivery_address.street
    ) {
      ctx.issues.push({
        code: "custom",
        message: "delivery_address needs either address_id (a saved address) or street (a new one)",
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
    /** GAP_REGISTER.md §4 Cluster D — delivery-fee enforcement from the
     * tenant's own per-vertical config (`agent_configs.
     * dynamic_variable_overrides.delivery_fee_cents`); 0/omitted for
     * pickup/dine_in. */
    delivery_fee_cents: zCents.optional(),
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
    /** Optional (FIX-1 follow-up, cross-schema parity test): the runtime
     * `send_payment_link` handler (`voice-tools/tools/send_payment_link.ts`)
     * falls back to the referenced order's own `total_cents` when this is
     * omitted — a model-supplied amount is only needed for a deposit/
     * no-show fee with no order to derive it from. */
    amount_cents: zCents.optional(),
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
  join_waitlist: zJoinWaitlistRequest,
} as const;

export type ToolName = keyof typeof TOOL_REQUEST_SCHEMAS;
export const TOOL_NAMES = Object.keys(TOOL_REQUEST_SCHEMAS) as ToolName[];
