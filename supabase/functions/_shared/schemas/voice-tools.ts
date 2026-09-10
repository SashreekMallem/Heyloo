import { z } from "zod";

/**
 * `/voice-tools` dispatch envelope + per-tool argument schemas
 * (BACKEND_SPEC §7.2). VERIFY (docs/VERIFY.md): the envelope shape
 * (`{call_id, name, args}`) is BACKEND_SPEC's canonical assumption about
 * Retell's function-calling tool-webhook contract, not yet confirmed against
 * Retell's live docs (egress-blocked) — re-verify before first production
 * deploy; `.passthrough()` used narrowly so an unexpected extra arg field
 * doesn't hard-fail a call that would otherwise succeed.
 */
export const ToolDispatchEnvelopeSchema = z.object({
  call_id: z.string().min(1),
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});
export type ToolDispatchEnvelope = z.infer<typeof ToolDispatchEnvelopeSchema>;

export const CheckAvailabilityArgsSchema = z
  .object({
    offering_id: z.string().optional(),
    resource_type: z.string().optional(),
    // Motel room-type / any other resource sub-type tag (GAP_REGISTER.md
    // §2 Motel item 2) — narrows within resource_type, doesn't replace it.
    room_type: z.string().optional(),
    date_range: z.object({ start: z.string(), end: z.string() }),
    party_size: z.number().int().positive().optional(),
  })
  .passthrough();

// FIX_REQUESTS.md — read-only offering catalog lookup so a model can
// resolve an appointment-type/offering to a real `offering_id` (never
// invented) before calling check_availability/create_booking.
export const ListOfferingsArgsSchema = z
  .object({
    category: z.string().optional(),
  })
  .passthrough();

export const CustomerInputSchema = z
  .object({
    name: z.string().optional(),
    phone: z.string().min(3),
  })
  .passthrough();

export const CreateBookingArgsSchema = z
  .object({
    resource_id: z.string().min(1),
    offering_id: z.string().optional(),
    start: z.string().min(1),
    end: z.string().min(1),
    customer: CustomerInputSchema,
    party_size: z.number().int().positive().optional(),
    structured_payload: z.record(z.string(), z.unknown()).optional(),
    consent: z.object({ sms: z.boolean().optional(), call: z.boolean().optional() }).optional(),
  })
  .passthrough();

/**
 * `verify` (MASTER_SPEC §3.7 identity fallback): supplied ONLY when the
 * live call's caller number differs from the booking's own customer phone
 * — the agent asks for full name + the appointment date/time the caller
 * believes they have, and the tool compares both against the real booking
 * before proceeding. Never populated when the caller number already
 * matches (that's the default, no-extra-questions path).
 */
const IdentityVerifySchema = z.object({
  full_name: z.string().min(1),
  appointment_time: z.string().min(1),
});

export const UpdateBookingArgsSchema = z.object({
  booking_id: z.string().min(1),
  new_start: z.string().min(1),
  new_end: z.string().min(1),
  verify: IdentityVerifySchema.optional(),
});

export const CancelBookingArgsSchema = z.object({
  booking_id: z.string().min(1),
  reason: z.string().optional(),
  verify: IdentityVerifySchema.optional(),
});

export const LookupCustomerArgsSchema = z.object({
  phone: z.string().min(3),
});

export const TakeMessageArgsSchema = z.object({
  caller_name: z.string().optional(),
  caller_phone: z.string().min(3),
  message_text: z.string().min(1),
  callback_window: z.string().optional(),
  structured_payload: z.record(z.string(), z.unknown()).optional(),
});

export const SendSmsConfirmationArgsSchema = z.object({
  booking_id: z.string().optional(),
  order_id: z.string().optional(),
  phone: z.string().min(3),
  template_key: z.string().min(1),
});

const OrderItemSchema = z
  .object({
    offering_id: z.string().optional(),
    name: z.string().min(1),
    qty: z.number().int().positive(),
    modifiers: z.array(z.string()).optional(),
  })
  .passthrough();

export const CreateOrderArgsSchema = z
  .object({
    items: z.array(OrderItemSchema).min(1),
    fulfillment_type: z.enum(["pickup", "delivery", "dine_in"]),
    delivery_address: z
      .object({
        street: z.string(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        // lat/lng are never model-supplied — attached server-side from a
        // saved `customer_addresses` geocode (MASTER_SPEC §3.1, T1/Wave-3)
        // when one exists, hence `.passthrough()` rather than a typed field.
      })
      .passthrough()
      .optional(),
    customer: CustomerInputSchema,
    consent: z.object({ sms: z.boolean().optional(), call: z.boolean().optional() }).optional(),
    // GAP_REGISTER.md §2 Restaurant item 2 — the template mandates an
    // explicit allergy ask with no field to persist the answer to.
    allergies: z.array(z.string()).optional(),
    special_instructions: z.string().optional(),
  })
  .passthrough();

export const SendPaymentLinkArgsSchema = z
  .object({
    order_id: z.string().optional(),
    booking_id: z.string().optional(),
    phone: z.string().min(3),
    purpose: z.enum(["order", "deposit", "noshow_fee"]),
    amount_cents: z.number().int().positive().optional(),
  })
  .passthrough();

/** MASTER_SPEC §3.4 (GAP_REGISTER.md §1.2) — join_waitlist, race-proof and
 * idempotent the same way `create_booking` is. */
export const JoinWaitlistArgsSchema = z
  .object({
    customer: CustomerInputSchema,
    offering_id: z.string().optional(),
    resource_type: z.string().optional(),
    preferred_window_start: z.string().min(1),
    preferred_window_end: z.string().min(1),
    notes: z.string().optional(),
  })
  .passthrough();
