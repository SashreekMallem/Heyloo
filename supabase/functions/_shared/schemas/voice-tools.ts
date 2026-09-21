import { z } from "zod";

/**
 * `/voice-tools` dispatch envelope + per-tool argument schemas
 * (BACKEND_SPEC §7.2). CALL-2 (docs/BUILD_NOTES.md, docs/VERIFY.md):
 * RETELL-VERIFIED live against docs.retellai.com/build/conversation-flow/
 * custom-function (the compile target every shipped template uses) and
 * docs.retellai.com/build/single-multi-prompt/custom-function (identical
 * example) 2026-09-20 — the real request body is `{name, call, args}`, NOT
 * BACKEND_SPEC's originally-assumed flat `{call_id, name, args}`: `call_id`
 * lives nested at `call.call_id`, not as a top-level sibling of `name`/
 * `args`. `call` also carries `agent_id` (used by CALL-2's context-
 * resolution fallback, `../voice-tools/context.ts`) and `call_type`
 * (`"web_call"` in the only example either page shows). `call.from_number`/
 * `to_number`/`direction` are NOT present in either fetched example —
 * VERIFY.md logs this as unconfirmed for real phone calls (the docs' one
 * worked example is a web_call); `ToolCallSchema` types them optional and
 * `.passthrough()`s the rest so their absence never breaks parsing and
 * their presence (if Retell does send them on phone calls, as BACKEND_SPEC
 * assumed) is used opportunistically. Top-level `call_id` is ALSO accepted
 * (optional) for back-compat with anything already sending the old assumed
 * shape (e.g. `job-keep-warm`'s synthetic ping body) — `ToolDispatchEnvelope`
 * requires at least one of `call_id`/`call.call_id` to be present, checked
 * by `../../voice-tools/handler.ts#validateEnvelope`, not by this schema
 * alone (Zod's cross-field refine reports a less useful error than the
 * dedicated check there).
 */
export const ToolCallSchema = z
  .object({
    call_id: z.string().min(1).optional(),
    agent_id: z.string().min(1).optional(),
    call_type: z.string().optional(),
    from_number: z.string().optional(),
    to_number: z.string().optional(),
    direction: z.string().optional(),
    // CALL-2 (docs/BUILD_NOTES.md, docs/VERIFY.md): confirmed live —
    // Retell's batch-test simulator's tool-call payload has NEITHER
    // `agent_id` NOR `to_number` populated at all (no real Agent/phone-
    // number resource is involved in a batch-test run against a bare
    // response_engine). `retell_llm_dynamic_variables` is documented on
    // the custom-function `call` object generally; used ONLY as a
    // batch-test/QA-harness resolution signal — see context.ts's
    // resolveTenantFromPayload — never relied on for a real call (real
    // calls never set `heyloo_tenant_id` in dynamic variables).
    retell_llm_dynamic_variables: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolDispatchEnvelopeSchema = z
  .object({
    call_id: z.string().min(1).optional(),
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    call: ToolCallSchema.optional(),
  })
  .passthrough();
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

/**
 * CALL-8 (docs/BUILD_PLAN.md): `phone` is now OPTIONAL at the Zod-shape
 * level — it used to be `z.string().min(3)` (hard-required), which meant a
 * model that omitted it entirely (rather than passing an obviously-invalid
 * value) failed SHAPE validation and got the generic, unhelpful
 * `fallbackEnvelope()` ("I'll take your details...") instead of a chance to
 * ask again. `voice-tools/handler.ts` now defaults it from the live call's
 * own caller-id (`ctx.callerNumber`) when the model doesn't supply one —
 * "default the callback phone to the caller number and only confirm it,
 * never re-ask" — and `_shared/vertical-intake.ts`'s required-field check
 * (also in handler.ts, after this defaulting) is what actually enforces a
 * phone end up on the row: a real STILL-missing phone (no caller id either,
 * e.g. a blocked-caller-ID real call where the model also never asked)
 * returns `missingFieldsEnvelope` naming exactly this field, not a silent
 * `invalid_phone` failure deep inside the tool.
 */
export const CustomerInputSchema = z
  .object({
    name: z.string().optional(),
    phone: z.string().min(3).optional(),
  })
  .passthrough();

export const CreateBookingArgsSchema = z
  .object({
    resource_id: z.string().min(1),
    // OPS-5 (docs/BUILD_NOTES.md): optional fallback hint — the resource's
    // human-readable name, used by `create_booking`'s server-side
    // resolution when `resource_id` doesn't match a real resource for this
    // tenant (a hallucinated/misremembered id from `check_availability`'s
    // own result a few turns earlier). Never trusted alone either; see
    // `create_booking.ts`'s `resolveBookingResourceId`.
    resource_name: z.string().min(1).optional(),
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

/**
 * CALL-8: `caller_phone` is now optional at the shape level for the same
 * reason `CustomerInputSchema.phone` is (see its own comment) — defaulted
 * from `ctx.callerNumber` in `voice-tools/handler.ts` before the
 * `_shared/vertical-intake.ts` required-field check runs.
 */
export const TakeMessageArgsSchema = z.object({
  caller_name: z.string().optional(),
  caller_phone: z.string().min(3).optional(),
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
        // CHANNELS-2 item 10: when `lookup_customer` returned several saved
        // addresses and the caller picked one by its short label, the
        // model passes that saved row's id here INSTEAD of re-speaking the
        // full street/city/state/zip — `street` is therefore optional when
        // `address_id` is present (`create_order.ts` resolves the real
        // address server-side from the saved row). A brand-new address the
        // caller speaks fresh still requires `street` (enforced by the
        // canonical `zCreateOrderRequest.check()`, not re-duplicated here).
        address_id: z.string().optional(),
        street: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        // Only meaningful for a caller-confirmed choice (new address or an
        // existing one) that should become the NEW default — never implied
        // by merely using/adding an address (CHANNELS-2 item 10(d): adding
        // an address must never silently replace the default).
        set_as_default: z.boolean().optional(),
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
