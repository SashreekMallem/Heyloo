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

import type { CanonicalTool } from "@heyloo/canonical-types";

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

export function createBookingTool(description: string): CanonicalTool {
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
        structured_payload: { type: "object" },
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

export function takeMessageTool(): CanonicalTool {
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
