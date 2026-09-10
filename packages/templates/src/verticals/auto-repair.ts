/**
 * Auto repair — SYSTEM_DESIGN §4.1 (conversation_flow: "hard slot-filling;
 * tool-backed nodes only") + §4.3 input-collection spec: "name · phone ·
 * vehicle year/make/model (validated) · symptom → service category ·
 * drop-off vs wait · time (via check_availability)."
 */

import type { AgentState, AgentTemplate, GlobalIntent } from "@heyloo/canonical-types";
import { DISCLOSURE_LINE } from "../shared/disclosure.js";
import { withCallOutcomeExtraction } from "../shared/extraction.js";
import {
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
} from "../shared/fragments.js";
import { humanRequestGlobalIntent, solicitorGlobalIntent } from "../shared/global-intents.js";
import { buildSystemPrompt } from "../shared/system-prompt.js";
import {
  cancelBookingTool,
  checkAvailabilityTool,
  createBookingTool,
  joinWaitlistTool,
  lookupCustomerTool,
  sendSmsConfirmationTool,
  takeMessageTool,
  transferCallTool,
  updateBookingTool,
} from "../shared/tools.js";
import {
  manageBookingState,
  solicitorDeflectState,
  takeMessageFallbackState,
  transferToHumanState,
} from "../shared/utility-states.js";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are the friendly front-desk assistant for an auto repair shop. Your job is a new " +
    "service booking, a reschedule/cancel, a status check, or a message — never a repair " +
    "diagnosis or a firm price quote over the phone; only the shop's own estimator does that " +
    "in person. Use {{vehicle_makes_serviced}} to know which makes this shop services; if the " +
    "caller's vehicle isn't one of them, say so honestly and offer to take a message anyway.",
  CONSENT_ASK_FRAGMENT,
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
);

/**
 * Auto's own vehicle-safety emergency (brakes failing, smoke, a wreck) is a
 * distinct, well-defined category in this trade — richer than the generic
 * 911 safety net every other vertical uses, so it gets its own state
 * (SYSTEM_DESIGN §4.1's auto fixture: "brakes failing, smoke, or another
 * immediate safety issue" → tow-partner referral) while still folding in
 * the life-threatening 911 case for a true injury/collision.
 */
function vehicleSafetyEmergencyState(): AgentState {
  return {
    id: "vehicle_safety_emergency",
    name: "Vehicle safety emergency",
    prompt_fragment:
      "The caller describes an immediate vehicle safety issue — brakes failing, smoke, a " +
      "wreck just happened, or similar. If anyone is hurt or in danger, tell them to hang up " +
      "and dial 911 first. Otherwise, do not tell them to keep driving: refer them to the " +
      "shop's tow partner, {{tow_partner_name}} at {{tow_partner_phone}}, and take a message " +
      "with their name, phone, and location so the shop can follow up right away.",
    allowed_tools: ["take_message"],
    is_terminal: true,
    // GAP_REGISTER.md — post-call extraction gap: lowered by the compiler's
    // post-call-analysis pass (`packages/adapters/retell/src/compiler/
    // extraction.ts`) into Retell `post_call_analysis_data`, read back by
    // `voice-events/handler.ts`'s `handleCallAnalyzed` as
    // `emergency_detected` — a retroactive safety net catching a vehicle-
    // safety issue the model handled inline but didn't escalate loudly
    // enough. Deliberately just this one boolean (see `veterinary.ts`/
    // `dental.ts` for why no separate `urgency_flag` enum is declared).
    extraction: [
      {
        field: "emergency_detected",
        type: "boolean",
        description:
          "True if the call reached this vehicle-safety-emergency state — brakes failing, " +
          "smoke, a collision, or another immediate vehicle safety issue or injury.",
      },
    ],
  };
}

function emergencyGlobalIntent(): GlobalIntent {
  return {
    name: "emergency",
    reachable_from: "any",
    target_state: "vehicle_safety_emergency",
    description:
      "The caller describes brakes failing, smoke, a collision, or another immediate vehicle " +
      "safety issue or injury.",
  };
}

export const AUTO_REPAIR_TEMPLATE: AgentTemplate = {
  vertical: "auto",
  compile_target: "conversation_flow",
  system_prompt: SYSTEM_PROMPT,
  states: [
    {
      id: "greeting",
      name: "Greeting",
      prompt_fragment:
        "Greet the caller warmly and ask how you can help today — a new appointment, " +
        "changing an existing one, a status check, or something else.",
      allowed_tools: [],
    },
    {
      id: "collect_name",
      name: "Collect name",
      prompt_fragment: "Ask for the caller's full name and confirm it back.",
      allowed_tools: [],
    },
    {
      id: "collect_phone",
      name: "Collect phone",
      prompt_fragment:
        "Ask for the best callback number and read it back digit by digit to confirm. Call " +
        "lookup_customer with that number — if it returns a vehicle already on file, confirm " +
        "it back in the next step instead of asking from scratch.",
      allowed_tools: ["lookup_customer"],
    },
    {
      id: "collect_vehicle",
      name: "Collect vehicle",
      prompt_fragment:
        "If lookup_customer already returned this caller's vehicle (year/make/model), confirm " +
        'it back ("still the 2019 Honda Civic?") instead of re-asking from scratch — ' +
        "otherwise ask for the vehicle's year, make, and model, one at a time. Cross-check the " +
        "make against {{vehicle_makes_serviced}}.",
      allowed_tools: [],
    },
    {
      id: "collect_symptom",
      name: "Collect symptom",
      prompt_fragment:
        "Ask what's going on with the vehicle and map it to a service category (oil change, " +
        "brakes, check-engine light, tires, general inspection, etc.) — never diagnose the " +
        "actual mechanical cause yourself.",
      allowed_tools: [],
    },
    {
      id: "drop_off_or_wait",
      name: "Drop-off vs wait",
      prompt_fragment: "Ask whether they'd like to drop the vehicle off or wait on-site.",
      allowed_tools: [],
    },
    {
      id: "check_time",
      name: "Check availability",
      prompt_fragment:
        "Ask what day/time works, then call check_availability for that window. Offer the " +
        "returned open slots; if none_available, follow the waitlist-offer rule.",
      allowed_tools: ["check_availability", "join_waitlist"],
    },
    {
      id: "confirm_booking",
      name: "Confirm booking",
      prompt_fragment:
        "Read back the full appointment (vehicle, service, drop-off/wait, date/time), ask the " +
        "consent question, state the cancellation policy, then create the booking — pass " +
        "structured_payload with vehicle_year, vehicle_make, vehicle_model, symptom_category, " +
        "and drop_off_or_wait — and send the SMS confirmation.",
      allowed_tools: ["create_booking", "send_sms_confirmation"],
      is_terminal: true,
    },
    manageBookingState(),
    vehicleSafetyEmergencyState(),
    transferToHumanState(),
    solicitorDeflectState(),
    takeMessageFallbackState(),
  ].map(withCallOutcomeExtraction),
  transitions: [
    { from: "greeting", to: "collect_name", on: { intent: "wants_to_book_service" } },
    { from: "greeting", to: "manage_booking", on: { intent: "wants_to_reschedule_or_cancel" } },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_general_message" },
    },
    { from: "collect_name", to: "collect_phone", on: { intent: "name_confirmed" } },
    { from: "collect_phone", to: "collect_vehicle", on: { intent: "phone_confirmed" } },
    { from: "collect_vehicle", to: "collect_symptom", on: { intent: "vehicle_confirmed" } },
    { from: "collect_symptom", to: "drop_off_or_wait", on: { intent: "symptom_confirmed" } },
    { from: "drop_off_or_wait", to: "check_time", on: { intent: "preference_confirmed" } },
    { from: "check_time", to: "confirm_booking", on: { predicate: "slot_selected" } },
    {
      from: "check_time",
      to: "take_message_fallback",
      on: { predicate: "none_available_and_caller_declines_waitlist" },
    },
  ],
  global_intents: [
    emergencyGlobalIntent(),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
  ],
  tools: [
    checkAvailabilityTool(),
    createBookingTool(
      "Create a service booking once vehicle, symptom, drop-off/wait preference, and a " +
        "confirmed open time are collected and the consent question has been asked.",
      "auto",
    ),
    updateBookingTool(),
    cancelBookingTool(),
    joinWaitlistTool(),
    lookupCustomerTool(),
    takeMessageTool("auto"),
    sendSmsConfirmationTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
