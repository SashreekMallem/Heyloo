import type { AnthropicToolDef } from "./anthropic-messages.ts";
import type { TextChannel } from "./types.ts";

/**
 * Anthropic tool-use declarations for the text-agent engine. Hand-authored
 * here rather than imported from `packages/templates/src/shared/tools.ts`
 * (the canonical Retell/voice-facing `CanonicalTool` builders) for two
 * independent reasons: (1) this package's Deno-executed files cannot import
 * a pnpm-workspace Node/ESM package without a bundling step this codebase
 * doesn't add (same documented constraint `admin/schemas.ts` and
 * `_shared/schemas/booking-payloads.ts` already carry for
 * `@heyloo/canonical-types` — `packages/templates` is exactly as
 * unreachable from here at runtime); (2) Anthropic's tool-use schema
 * (`input_schema`, flat JSON Schema) and Retell's function-calling
 * declaration are genuinely different artifacts tuned for different
 * conversation shapes (a voice state-machine's `allowed_tools` gating vs. a
 * free-form SMS/chat tool-use loop) — this was never "the same tool
 * schema" to fork in the first place, only the field NAMES below are kept
 * identical to `_shared/schemas/voice-tools.ts` (the RUNTIME-ENFORCED
 * shape every one of these tool calls is validated against either way —
 * see `tool-router.ts`), which is what actually matters for correctness.
 * `tools.test.ts` parity-checks the required/optional key sets against
 * those same runtime Zod schemas so the two can't silently drift.
 *
 * The booking/order/message-taking tools ARE the exact same voice tools
 * (`voice-tools/tools/*.ts`, imported unmodified by `tool-router.ts`) —
 * only their JSON-Schema DECLARATION lives here, hand-authored for this
 * different calling convention.
 */

export function checkAvailabilityTool(): AnthropicToolDef {
  return {
    name: "check_availability",
    description:
      "Check real open slots for a resource/date range. Never state a time is open without " +
      "calling this first — never invent availability.",
    input_schema: {
      type: "object",
      properties: {
        offering_id: { type: "string" },
        resource_type: { type: "string" },
        room_type: { type: "string" },
        date_range: {
          type: "object",
          properties: { start: { type: "string" }, end: { type: "string" } },
          required: ["start", "end"],
        },
        party_size: { type: "integer", minimum: 1 },
      },
      required: ["date_range"],
    },
  };
}

export function listOfferingsTool(): AnthropicToolDef {
  return {
    name: "list_offerings",
    description:
      "List the tenant's configured appointment types/services (id, name, category, duration, " +
      "price where set). Resolve a stated reason for visiting to a real offering_id before " +
      "check_availability/create_booking — never invent an offering_id.",
    input_schema: {
      type: "object",
      properties: { category: { type: "string" } },
    },
  };
}

const CUSTOMER_SCHEMA = {
  type: "object",
  properties: { name: { type: "string" }, phone: { type: "string" } },
  required: ["name", "phone"],
} as const;

export function createBookingTool(): AnthropicToolDef {
  return {
    name: "create_booking",
    description:
      "Create a confirmed booking once resource, time, and customer name+phone are collected " +
      "and the consent question has been asked.",
    input_schema: {
      type: "object",
      properties: {
        resource_id: { type: "string" },
        offering_id: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        customer: CUSTOMER_SCHEMA,
        party_size: { type: "integer", minimum: 1 },
        structured_payload: { type: "object", description: "Vertical-specific booking details." },
        consent: {
          type: "object",
          properties: { sms: { type: "boolean" }, call: { type: "boolean" } },
        },
      },
      required: ["resource_id", "start", "end", "customer"],
    },
  };
}

export function updateBookingTool(): AnthropicToolDef {
  return {
    name: "update_booking",
    description: "Reschedule an existing booking to a new confirmed-open start/end time.",
    input_schema: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
        new_start: { type: "string" },
        new_end: { type: "string" },
        verify: {
          type: "object",
          description:
            "Required ONLY when the texter's phone differs from the booking's own phone: full " +
            "name AND exact appointment time.",
          properties: { full_name: { type: "string" }, appointment_time: { type: "string" } },
        },
      },
      required: ["booking_id", "new_start", "new_end"],
    },
  };
}

export function cancelBookingTool(): AnthropicToolDef {
  return {
    name: "cancel_booking",
    description: "Cancel an existing booking.",
    input_schema: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
        reason: { type: "string" },
        verify: {
          type: "object",
          description:
            "Required ONLY when the texter's phone differs from the booking's own phone: full " +
            "name AND exact appointment time.",
          properties: { full_name: { type: "string" }, appointment_time: { type: "string" } },
        },
      },
      required: ["booking_id"],
    },
  };
}

/** G6: server-side cross-checked against the conversation's OWN verified
 * phone — never trusted from the model/customer alone (`tool-router.ts`). */
export function lookupCustomerTool(): AnthropicToolDef {
  return {
    name: "lookup_customer",
    description:
      "Look up the texter's own account by phone number — always the phone this conversation " +
      "is verified against, never a different number the customer types in.",
    input_schema: {
      type: "object",
      properties: { phone: { type: "string" } },
      required: ["phone"],
    },
  };
}

export function takeMessageTool(): AnthropicToolDef {
  return {
    name: "take_message",
    description: "Record a message/callback request for staff follow-up.",
    input_schema: {
      type: "object",
      properties: {
        caller_name: { type: "string" },
        caller_phone: { type: "string" },
        message_text: { type: "string" },
        callback_window: { type: "string" },
        structured_payload: { type: "object" },
      },
      required: ["caller_phone", "message_text"],
    },
  };
}

export function joinWaitlistTool(): AnthropicToolDef {
  return {
    name: "join_waitlist",
    description:
      "Add the customer to the waitlist for a preferred date/time window that's fully booked. " +
      "They'll be texted automatically if a matching slot opens up.",
    input_schema: {
      type: "object",
      properties: {
        customer: CUSTOMER_SCHEMA,
        offering_id: { type: "string" },
        resource_type: { type: "string" },
        preferred_window_start: { type: "string" },
        preferred_window_end: { type: "string" },
        notes: { type: "string" },
      },
      required: ["customer", "preferred_window_start", "preferred_window_end"],
    },
  };
}

export function createOrderTool(): AnthropicToolDef {
  return {
    name: "create_order",
    description:
      "Create an order from items on the real menu/catalog only — never invent an item or " +
      "price. Delivery orders require a full delivery_address.",
    input_schema: {
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
        customer: CUSTOMER_SCHEMA,
        consent: {
          type: "object",
          properties: { sms: { type: "boolean" }, call: { type: "boolean" } },
        },
        allergies: { type: "array", items: { type: "string" } },
        special_instructions: { type: "string" },
      },
      required: ["items", "fulfillment_type", "customer"],
    },
  };
}

export function sendPaymentLinkTool(): AnthropicToolDef {
  return {
    name: "send_payment_link",
    description:
      "Text the customer a secure Stripe payment link. NEVER ask for a card number, expiry, " +
      "or CVC in the chat — always use this tool instead.",
    input_schema: {
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
  };
}

/**
 * Web-chat-only, engine-internal tool (never exposed to the SMS channel,
 * which is already phone-authenticated by the inbound webhook itself, and
 * never declared anywhere in `packages/templates` since it has no voice
 * equivalent). Calling it sends a 6-digit SMS code to the given phone;
 * `engine.ts` intercepts the customer's next reply to check it before
 * resuming the normal tool-use loop — see `verification.ts`.
 */
export function verifyPhoneTool(): AnthropicToolDef {
  return {
    name: "verify_phone",
    description:
      "Send a 6-digit verification code by text to the phone number the customer provides. Use " +
      "this before looking up an existing customer/booking by phone, or when the customer wants " +
      "to confirm their identity. After calling this, ask the customer to type the code they " +
      "receive.",
    input_schema: {
      type: "object",
      properties: { phone: { type: "string" } },
      required: ["phone"],
    },
  };
}

/** Tool set offered per channel. `transfer_call` is never included (no
 * telephony transfer over text); `send_sms_confirmation` is never included
 * either — the engine's own reply IS the confirmation channel, so a
 * separate confirmation tool call would just duplicate it. `verify_phone`
 * is web_chat-only (see its own docstring above). */
export function toolsForChannel(channel: TextChannel): AnthropicToolDef[] {
  const shared = [
    checkAvailabilityTool(),
    listOfferingsTool(),
    createBookingTool(),
    updateBookingTool(),
    cancelBookingTool(),
    lookupCustomerTool(),
    takeMessageTool(),
    joinWaitlistTool(),
    createOrderTool(),
    sendPaymentLinkTool(),
  ];
  return channel === "web_chat" ? [...shared, verifyPhoneTool()] : shared;
}
