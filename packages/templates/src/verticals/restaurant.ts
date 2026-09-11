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
  "menu, say honestly that it's not available and offer what's closest instead.";

const ALLERGY_ASK_FRAGMENT =
  "Always ask explicitly whether anyone in the order has any food allergies, even if not " +
  "volunteered — never skip this question for a food order.";

const FULL_READBACK_FRAGMENT =
  "Before closing out an order, read back every item, quantity, and modifier, the pickup-or-" +
  "delivery choice (and address if delivery), and the total, and get an explicit yes before " +
  "calling create_order.";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are the phone assistant for a restaurant. Find out right away whether the caller wants " +
    "to place an order or make a table reservation, then follow that path.",
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
      prompt_fragment: "Greet the caller.",
      allowed_tools: [],
    },
    {
      id: "order_or_reservation",
      name: "Order vs reservation (branch early)",
      prompt_fragment:
        "Ask right away: order (pickup/delivery) or a table reservation? This determines the " +
        "whole rest of the call — decide it before asking anything else.",
      allowed_tools: [],
    },
    // --- Reservation branch ---
    {
      id: "collect_party_size",
      name: "Collect party size",
      prompt_fragment: "Ask how many people the reservation is for, then what day/time works.",
      allowed_tools: [],
    },
    {
      id: "check_time_reservation",
      name: "Check reservation availability",
      prompt_fragment:
        "Call check_availability for the requested party size and time. If none_available, " +
        "follow the waitlist-offer rule.",
      allowed_tools: ["check_availability", "join_waitlist"],
    },
    {
      id: "confirm_reservation",
      name: "Confirm reservation",
      prompt_fragment:
        "Read back party size and date/time, ask the consent question, then create the " +
        "booking and send the SMS confirmation.",
      allowed_tools: ["create_booking", "send_sms_confirmation"],
      is_terminal: true,
    },
    // --- Order branch ---
    {
      id: "collect_items",
      name: "Collect order items",
      prompt_fragment:
        "Take the order one item at a time from {{menu_text}} per the catalog-discipline rule, " +
        "confirming each item and quantity as you go.",
      allowed_tools: ["lookup_customer"],
    },
    {
      id: "collect_allergies",
      name: "Collect allergies",
      prompt_fragment: "Ask explicitly about food allergies per the allergy-ask rule.",
      allowed_tools: [],
    },
    {
      id: "pickup_or_delivery",
      name: "Pickup vs delivery",
      prompt_fragment: "Ask whether this order is for pickup or delivery.",
      allowed_tools: [],
    },
    {
      id: "collect_delivery_address",
      name: "Collect delivery address",
      prompt_fragment:
        "Resolve the delivery address per the saved-address rule (none/one/several). If the " +
        "caller picks a saved address, pass its address_id on create_order — do not re-ask for " +
        "the full street. If they give a brand-new address, read it back and pass street/city/" +
        "state/zip instead. If create_order later declines the order as out_of_delivery_radius, " +
        "apologize and offer pickup instead — never argue about the radius or offer a discount " +
        "to make up for it.",
      allowed_tools: [],
    },
    {
      id: "confirm_order",
      name: "Confirm order",
      prompt_fragment:
        "Follow the full-read-back rule, ask the consent question, then call create_order — " +
        "pass whatever the caller said about allergies as the allergies argument (an empty " +
        "list if they said none) and any other special instructions as special_instructions, " +
        "so the kitchen sees them, not just the transcript. If the order requires prepayment, " +
        "send a payment link; always send the SMS confirmation.",
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
    { from: "greeting", to: "order_or_reservation", on: { intent: "greeting_complete" } },
    {
      from: "order_or_reservation",
      to: "collect_party_size",
      on: { intent: "wants_reservation" },
    },
    { from: "order_or_reservation", to: "collect_items", on: { intent: "wants_order" } },
    {
      from: "order_or_reservation",
      to: "manage_booking",
      on: { intent: "wants_to_change_existing_reservation" },
    },
    {
      from: "order_or_reservation",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_general_message" },
    },
    {
      from: "collect_party_size",
      to: "check_time_reservation",
      on: { intent: "party_size_and_time_given" },
    },
    {
      from: "check_time_reservation",
      to: "confirm_reservation",
      on: { predicate: "slot_selected" },
    },
    {
      from: "check_time_reservation",
      to: "take_message_fallback",
      on: { predicate: "none_available_and_caller_declines_waitlist" },
    },
    { from: "collect_items", to: "collect_allergies", on: { intent: "items_confirmed" } },
    {
      from: "collect_allergies",
      to: "pickup_or_delivery",
      on: { intent: "allergies_recorded" },
    },
    {
      from: "pickup_or_delivery",
      to: "collect_delivery_address",
      on: { intent: "wants_delivery" },
    },
    { from: "pickup_or_delivery", to: "confirm_order", on: { intent: "wants_pickup" } },
    { from: "collect_delivery_address", to: "confirm_order", on: { intent: "address_confirmed" } },
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
    joinWaitlistTool(),
    lookupCustomerTool(),
    takeMessageTool("restaurant"),
    sendSmsConfirmationTool(),
    sendPaymentLinkTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
