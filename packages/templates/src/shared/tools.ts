/**
 * Shared canonical tool builders — one function per voice tool
 * (BACKEND_SPEC §7.2, MASTER_SPEC §3.0/§3.2), so every template declares
 * the SAME JSON-Schema shape and authorization scope for a given tool name
 * instead of 8 hand-copied, silently-drifting versions. This is also what
 * makes the red-team suite's authorization-scope assertions ("lookup_customer
 * is caller_number", "transfer never takes a caller-suppliable destination")
 * meaningful — they hold structurally for every template BECAUSE every
 * template is built from these same functions.
 *
 * `transfer_call` is declared here as a `CanonicalTool` too (authorization
 * `tenant_config_only`, zero parameters) even though the real Retell
 * integration wires it as a native transfer-call function bound to
 * `agent_configs.transfer_number` (canonical-types `TransferCallConfig`,
 * BACKEND_SPEC §7.2.8) rather than an HTTP `/voice/tools` call — declaring
 * it here lets templates reference `"transfer_call"` in a state's
 * `allowed_tools` (required by `zAgentTemplate`'s "unknown tool" structural
 * check) while keeping the schema's own guarantee airtight: no
 * caller-suppliable destination parameter exists anywhere in its shape.
 */

import type { CanonicalTool, Vertical } from "@heyloo/canonical-types";
import { BOOKING_STRUCTURED_PAYLOAD_PROPERTIES } from "@heyloo/canonical-types";

export function checkAvailabilityTool(): CanonicalTool {
  return {
    name: "check_availability",
    description:
      "Check real open slots for a resource/date range. Never state a time is open " +
      "without calling this first — the model must never invent availability.",
    parameters: {
      type: "object",
      properties: {
        offering_id: { type: "string" },
        resource_type: { type: "string" },
        room_type: {
          type: "string",
          description:
            "Narrows within resource_type to a specific room/resource tier (e.g. a motel's " +
            "'queen'/'king'/'suite') — only meaningful when the tenant configures tiers.",
        },
        date_range: {
          type: "object",
          properties: { start: { type: "string" }, end: { type: "string" } },
          required: ["start", "end"],
        },
        party_size: { type: "integer", minimum: 1 },
      },
      required: ["date_range"],
    },
    authorization: { scope: "none" },
  };
}

/**
 * FIX_REQUESTS.md — read-only offering-catalog lookup (GAP_REGISTER.md §2
 * Dental item 3 / Vet item 4) so a model can resolve an appointment-type
 * to a real `offering_id` before calling `check_availability`/
 * `create_booking`, instead of inventing one or leaving `offering_id`
 * unset. Never mutates anything — `authorization: {scope: "none"}` like
 * `check_availability`.
 */
export function listOfferingsTool(): CanonicalTool {
  return {
    name: "list_offerings",
    description:
      "List the tenant's configured appointment types/services (with id, name, category, " +
      "duration, and price where set). Call this to resolve a caller's stated reason for " +
      "visiting to a real offering_id before calling check_availability or create_booking — " +
      "never invent an offering_id.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional narrowing filter (e.g. 'wellness' vs 'emergency').",
        },
      },
    },
    authorization: { scope: "none" },
  };
}

/**
 * `vertical` (optional, GAP_REGISTER.md §1.7) surfaces that vertical's
 * typed `structured_payload` JSON-Schema `properties`
 * (`BOOKING_STRUCTURED_PAYLOAD_PROPERTIES`, `booking-payloads.ts`) as an
 * authoring hint to the model instead of a bare `{type:"object"}` — Retell
 * shows tool JSON-Schema `properties` to the LLM, which measurably improves
 * fill rate. Left optional (defaulting to the bare shape) so every existing
 * `createBookingTool(description)` call site keeps compiling unchanged;
 * passing the vertical is a one-argument follow-up at each call site
 * (`packages/templates/src/verticals/*.ts`, filed in
 * docs/audit/FIX_REQUESTS.md).
 */
export function createBookingTool(description: string, vertical?: Vertical): CanonicalTool {
  return {
    name: "create_booking",
    description,
    parameters: {
      type: "object",
      properties: {
        resource_id: { type: "string" },
        offering_id: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        customer: {
          type: "object",
          properties: { name: { type: "string" }, phone: { type: "string" } },
          required: ["name", "phone"],
        },
        party_size: { type: "integer", minimum: 1 },
        structured_payload: vertical
          ? {
              type: "object",
              description: "Vertical-specific booking details captured this call.",
              properties: BOOKING_STRUCTURED_PAYLOAD_PROPERTIES[vertical],
            }
          : { type: "object" },
        consent: {
          type: "object",
          description: "The caller's answer to the once-per-call consent ask (MASTER_SPEC §3.6).",
          properties: { sms: { type: "boolean" }, call: { type: "boolean" } },
        },
      },
      required: ["resource_id", "start", "end", "customer"],
    },
    authorization: { scope: "none" },
  };
}

export function updateBookingTool(): CanonicalTool {
  return {
    name: "update_booking",
    description: "Reschedule an existing booking to a new confirmed-open start/end time.",
    parameters: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
        new_start: { type: "string" },
        new_end: { type: "string" },
        verify: {
          type: "object",
          description:
            "Required ONLY when the caller's number differs from the booking's own number " +
            "(MASTER_SPEC §3.7 identity fallback) — full name AND exact appointment time.",
          properties: {
            full_name: { type: "string" },
            appointment_time: { type: "string" },
          },
        },
      },
      required: ["booking_id", "new_start", "new_end"],
    },
    authorization: { scope: "none" },
  };
}

export function cancelBookingTool(): CanonicalTool {
  return {
    name: "cancel_booking",
    description: "Cancel an existing booking.",
    parameters: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
        reason: { type: "string" },
        verify: {
          type: "object",
          description:
            "Required ONLY when the caller's number differs from the booking's own number " +
            "(MASTER_SPEC §3.7 identity fallback) — full name AND exact appointment time.",
          properties: {
            full_name: { type: "string" },
            appointment_time: { type: "string" },
          },
        },
      },
      required: ["booking_id"],
    },
    authorization: { scope: "none" },
  };
}

/**
 * G6: scoped to the LIVE CALLER'S OWN NUMBER, server-side — the `phone`
 * argument is cross-checked against the call's actual caller number, never
 * trusted from the model alone. A template must never invite the caller to
 * look up someone else's account.
 */
export function lookupCustomerTool(): CanonicalTool {
  return {
    name: "lookup_customer",
    description:
      "Look up the caller's own account by their phone number (always the number they are " +
      "calling FROM — never a different number the caller provides).",
    parameters: {
      type: "object",
      properties: { phone: { type: "string" } },
      required: ["phone"],
    },
    authorization: { scope: "caller_number" },
  };
}

/**
 * `vertical` (optional, GAP_REGISTER.md §2 Legal item 4 / real_estate) —
 * same non-breaking pattern as `createBookingTool`: surfaces that
 * vertical's typed `structured_payload` properties so a caller who leaves
 * a message instead of completing a booking still gets structured intake
 * captured (`call_logs.structured_booking_payload`, `take_message.ts`),
 * not just free-text `message_text`. Omitted vertical keeps the bare
 * `{type:"object"}` shape, so every existing `takeMessageTool()` call site
 * keeps compiling unchanged.
 */
export function takeMessageTool(vertical?: Vertical): CanonicalTool {
  return {
    name: "take_message",
    description: "Record a message/callback request for staff follow-up.",
    parameters: {
      type: "object",
      properties: {
        caller_name: { type: "string" },
        caller_phone: { type: "string" },
        message_text: { type: "string" },
        callback_window: { type: "string" },
        structured_payload: vertical
          ? {
              type: "object",
              description: "Vertical-specific intake details captured this call.",
              properties: BOOKING_STRUCTURED_PAYLOAD_PROPERTIES[vertical],
            }
          : { type: "object" },
      },
      required: ["caller_phone", "message_text"],
    },
    authorization: { scope: "none" },
  };
}

export function sendSmsConfirmationTool(): CanonicalTool {
  return {
    name: "send_sms_confirmation",
    description: "Send a text confirmation for a booking or order.",
    parameters: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
        order_id: { type: "string" },
        phone: { type: "string" },
        template_key: { type: "string" },
      },
      required: ["phone", "template_key"],
    },
    authorization: { scope: "none" },
  };
}

/**
 * MASTER_SPEC §3.4 (GAP_REGISTER.md §1.2) — record a caller's interest in a
 * fully-booked window so the cancellation-triggered "a slot opened — reply
 * YES" SMS flow (waitlist_entries + webhooks-twilio-sms/handler.ts) has
 * something to match against. Call this instead of take_message when the
 * caller wants to be notified if something opens up.
 */
export function joinWaitlistTool(): CanonicalTool {
  return {
    name: "join_waitlist",
    description:
      "Add the caller to the waitlist for a preferred date/time window that's fully booked. " +
      "They'll be texted automatically if a matching slot opens up.",
    parameters: {
      type: "object",
      properties: {
        customer: {
          type: "object",
          properties: { name: { type: "string" }, phone: { type: "string" } },
          required: ["name", "phone"],
        },
        offering_id: { type: "string" },
        resource_type: { type: "string" },
        preferred_window_start: { type: "string" },
        preferred_window_end: { type: "string" },
        notes: { type: "string" },
      },
      required: ["customer", "preferred_window_start", "preferred_window_end"],
    },
    authorization: { scope: "none" },
  };
}

/** MASTER_SPEC §3.0 — items are validated server-side against the tool-backed `offerings` catalog; never model-invented. */
export function createOrderTool(): CanonicalTool {
  return {
    name: "create_order",
    description:
      "Create an order from items on the real menu/catalog only — never invent an item or " +
      "price. Delivery orders require a full delivery_address and are checked against the " +
      "delivery radius.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              offering_id: { type: "string" },
              name: { type: "string" },
              qty: { type: "integer", minimum: 1 },
              modifiers: { type: "array", items: { type: "string" } },
            },
            required: ["name", "qty"],
          },
        },
        fulfillment_type: { type: "string", enum: ["pickup", "delivery", "dine_in"] },
        delivery_address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            zip: { type: "string" },
          },
        },
        customer: {
          type: "object",
          properties: { name: { type: "string" }, phone: { type: "string" } },
          required: ["name", "phone"],
        },
        consent: {
          type: "object",
          properties: { sms: { type: "boolean" }, call: { type: "boolean" } },
        },
        allergies: {
          type: "array",
          items: { type: "string" },
          description: "Every allergy the caller mentioned — always ask explicitly.",
        },
        special_instructions: {
          type: "string",
          description: "Free-text prep/delivery instructions distinct from allergies.",
        },
      },
      required: ["items", "fulfillment_type", "customer"],
    },
    authorization: { scope: "none" },
  };
}

/** MASTER_SPEC §3.2 — no card numbers are ever spoken or stored; a link is sent instead. */
export function sendPaymentLinkTool(): CanonicalTool {
  return {
    name: "send_payment_link",
    description:
      "Text the caller a secure Stripe payment link. NEVER ask the caller to read a card " +
      "number, expiry, or CVC out loud — always use this tool instead.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        booking_id: { type: "string" },
        phone: { type: "string" },
        purpose: { type: "string", enum: ["order", "deposit", "noshow_fee"] },
        amount_cents: { type: "integer", minimum: 1 },
      },
      required: ["phone", "purpose", "amount_cents"],
    },
    authorization: { scope: "none" },
  };
}

/**
 * G6: the destination is resolved server-side from `agent_configs.transfer_number`
 * (tenant-config-only) — this tool takes NO destination/phone-number argument
 * at all, so it is structurally impossible for a compiled template to let
 * caller input parameterize where a transfer goes.
 */
export function transferCallTool(): CanonicalTool {
  return {
    name: "transfer_call",
    description:
      "Warm-transfer the caller to a human at this business. The destination number is " +
      "resolved entirely from this business's own configuration — it is never a caller-" +
      "supplied number and this tool takes no destination argument.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    authorization: { scope: "tenant_config_only" },
  };
}
