/**
 * Restaurant — SYSTEM_DESIGN §4.1 (conversation_flow) + §4.3 input-
 * collection spec: "order vs reservation branch early · items from tool-
 * backed catalog only · pickup/delivery or party size · allergies asked
 * explicitly · full read-back before close." MASTER_SPEC §3.0: delivery
 * orders REQUIRE address capture + a delivery-radius check (handled by
 * `create_order` server-side — a decline there always offers pickup
 * instead, MASTER_SPEC §3.1 default-address reuse noted inline below).
 *
 * NOTE (`create_order`'s `allergies`/`special_instructions` args —
 * GAP_REGISTER.md §2 Restaurant item 2, now fixed): `zCreateOrderRequest`
 * (`@heyloo/canonical-types`), the runtime-enforced schema
 * (`_shared/schemas/voice-tools.ts`), AND the model-FACING JSON-Schema
 * `create_order` sends to Retell (`createOrderTool()`,
 * `packages/templates/src/shared/tools.ts`) all declare `allergies`/
 * `special_instructions` as known properties, so the model has a real
 * declared slot to put the allergy answer in — the prompt instruction
 * below draws on it directly.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import { DISCLOSURE_LINE } from "../shared/disclosure.js";
import { withCallOutcomeExtraction } from "../shared/extraction.js";
import {
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
  CONTACT_DETAILS,
  MULTI_ENTITY_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
} from "../shared/fragments.js";
import {
  humanRequestGlobalIntent,
  safetyEmergencyGlobalIntent,
  solicitorGlobalIntent,
} from "../shared/global-intents.js";
import { buildSystemPrompt } from "../shared/system-prompt.js";
import {
  cancelBookingTool,
  checkAvailabilityTool,
  checkDeliveryAddressTool,
  createBookingTool,
  createOrderTool,
  joinWaitlistTool,
  lookupCustomerTool,
  sendPaymentLinkTool,
  sendSmsConfirmationTool,
  takeMessageTool,
  transferCallTool,
  updateBookingTool,
} from "../shared/tools.js";
import {
  manageBookingState,
  safetyEmergencyState,
  solicitorDeflectState,
  takeMessageFallbackState,
  transferToHumanState,
} from "../shared/utility-states.js";

const CATALOG_DISCIPLINE_FRAGMENT =
  "Every item and price you offer must come from {{menu_text}} (the real, current menu) — " +
  "never invent a dish, a modifier, or a price. If the caller asks for something not on the " +
  "menu, say honestly that it's not available and offer what's closest instead. Callers use " +
  "short, everyday names for dishes, and a word can be misheard; work out which menu item " +
  "they mean yourself. If exactly one item fits, use it and say its full menu name when you " +
  "confirm; if more than one fits, name the options and ask which one. Always pass each " +
  "item's exact name as written in the menu to create_order, never the caller's own wording. " +
  "If create_order answers item_not_found, it lists the menu's real item names (menu_items): " +
  "pick the one the caller meant and call it again without making them repeat themselves — " +
  "ask them only if more than one could fit.";

const ALLERGY_ASK_FRAGMENT =
  "Always ask explicitly whether anyone in the order has any food allergies, even if not " +
  "volunteered — never skip this question for a food order.";

const FULL_READBACK_FRAGMENT =
  "Before closing out an order, make sure you have the caller's name and a callback number " +
  "(per the Caller ID rule: normally just confirm the number they're calling from) — " +
  "create_order needs both. Then, in the one read-back, say every item with its quantity " +
  "and modifiers, pickup or delivery (for delivery, the address and the delivery fee) and " +
  "the total, and get an explicit yes before calling create_order.";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are the phone assistant for a restaurant. Find out right away whether the caller wants " +
    "to place an order or make a table reservation, then follow that path. Answer quick " +
    "questions (hours, menu, prices) briefly from what you were given.",
  CATALOG_DISCIPLINE_FRAGMENT,
  ALLERGY_ASK_FRAGMENT,
  FULL_READBACK_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
  MULTI_ENTITY_FRAGMENT,
);

export const RESTAURANT_TEMPLATE: AgentTemplate = {
  vertical: "restaurant",
  compile_target: "conversation_flow",
  system_prompt: SYSTEM_PROMPT,
  states: [
    {
      id: "greeting",
      name: "Greeting",
      prompt_fragment:
        "The caller has already been greeted by your opening line. Respond to what they said. " +
        "If they ask a quick question first (hours, menu items, prices), answer it briefly; " +
        "then, once they're ready, find out whether they want to place an order (pickup or " +
        "delivery) or reserve a table — unless they already said.",
      allowed_tools: [],
    },
    {
      id: "reservation_details",
      name: "Reservation details",
      prompt_fragment:
        "Get what the reservation needs, taking whatever the caller already said: how many " +
        "people, the day and time, and " +
        CONTACT_DETAILS +
        ". As soon as you have the party size and time, call check_availability and offer the " +
        "open times it returns (if none, follow the waitlist rule).",
      allowed_tools: ["lookup_customer", "check_availability", "join_waitlist"],
    },
    {
      id: "confirm_reservation",
      name: "Confirm reservation",
      prompt_fragment:
        "Do the one read-back (name, party size, day and time) with the consent question and " +
        "the cancellation policy, then create the booking and, if text messages are " +
        "available, send the SMS confirmation.",
      allowed_tools: ["create_booking", "send_sms_confirmation"],
      is_terminal: true,
    },
    // --- Order branch ---
    {
      id: "collect_items",
      name: "Order details",
      prompt_fragment:
        "Take the order from {{menu_text}} per the catalog-discipline rule — callers often " +
        "list several items at once, so take them all and only ask about what's unclear " +
        '(a quantity, a size, which of two dishes). Ask "Anything else?" until they\'re done. ' +
        "Then make sure you have the rest, taking whatever they already said: allergies (ask " +
        "explicitly per the allergy-ask rule — never skip it), pickup or delivery, the delivery " +
        "address if delivery, and " +
        CONTACT_DETAILS +
        ". For delivery, resolve the address per the saved-address rule (call lookup_customer " +
        "with no arguments to see saved addresses): if they pick a saved one, pass its " +
        "address_id on create_order and don't re-ask the street; a new address goes in as " +
        "street/city/state/zip. As soon as the caller gives a new address, call " +
        "check_delivery_address and follow its message: read the matched address back in a " +
        "few words; too far means offer pickup; not found means ask once more, then continue. " +
        "Never argue about the distance or offer a discount for it.",
      allowed_tools: ["lookup_customer", "check_delivery_address"],
    },
    {
      id: "confirm_order",
      name: "Confirm order",
      prompt_fragment:
        "Follow the full-read-back rule, ask the consent question, then call create_order — " +
        "pass whatever the caller said about allergies as the allergies argument (an empty " +
        "list if they said none) and any other special instructions as special_instructions, " +
        "so the kitchen sees them, not just the transcript. If it declines as " +
        "out_of_delivery_radius, offer pickup; if below_delivery_minimum, offer to add items " +
        "or switch to pickup. If the order requires prepayment, " +
        "send a payment link if text messages are available (otherwise say someone from the " +
        "team will follow up about payment); if text messages are available, also send the " +
        "SMS confirmation.",
      allowed_tools: ["create_order", "send_payment_link", "send_sms_confirmation"],
      is_terminal: true,
    },
    manageBookingState(),
    transferToHumanState(),
    solicitorDeflectState(),
    safetyEmergencyState(),
    takeMessageFallbackState(),
  ].map(withCallOutcomeExtraction),
  transitions: [
    { from: "greeting", to: "reservation_details", on: { intent: "wants_reservation" } },
    { from: "greeting", to: "collect_items", on: { intent: "wants_order" } },
    {
      from: "greeting",
      to: "manage_booking",
      on: { intent: "wants_to_change_existing_reservation" },
    },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_general_message" },
    },
    {
      from: "reservation_details",
      to: "confirm_reservation",
      on: { predicate: "slot_selected" },
    },
    {
      from: "reservation_details",
      to: "take_message_fallback",
      on: { predicate: "none_available_and_caller_declines_waitlist" },
    },
    { from: "collect_items", to: "confirm_order", on: { intent: "order_details_complete" } },
  ],
  global_intents: [
    safetyEmergencyGlobalIntent("safety_emergency"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
  ],
  tools: [
    checkAvailabilityTool(),
    createBookingTool(
      "Create a table reservation once party size and a confirmed open time are collected and " +
        "the consent question has been asked.",
      "restaurant",
    ),
    updateBookingTool(),
    cancelBookingTool(),
    createOrderTool(),
    checkDeliveryAddressTool(),
    joinWaitlistTool(),
    lookupCustomerTool(),
    takeMessageTool("restaurant"),
    sendSmsConfirmationTool(),
    sendPaymentLinkTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
