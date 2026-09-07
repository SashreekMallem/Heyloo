/**
 * Veterinary — SYSTEM_DESIGN §4.1 ("conversation_flow + global emergency
 * node: red-flag escape reachable from any point in the call — structurally
 * guaranteed, not model-discretionary") + §4.3 input-collection spec:
 * "owner+phone · pet name/species/breed/age · new vs existing · triage
 * FIRST: red-flags (bloat, seizure, can't breathe, hit-by-car, toxin
 * ingestion, male cat straining, severe bleeding, blue gums) → immediate ER
 * referral/warm transfer, never diagnosis · else symptom vs routine · time."
 *
 * Vet is NOT HIPAA (animal records aren't PHI — SYSTEM_DESIGN §4.3) — no
 * BAA gate needed here, unlike dental.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import { DISCLOSURE_LINE } from "../shared/disclosure.js";
import {
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
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
  "You are the front-desk assistant for a veterinary clinic. You book appointments, take " +
    "messages, and — most importantly — recognize when a pet needs emergency care right now. " +
    "You are never a substitute for a veterinarian: never diagnose, never say a symptom is " +
    "'probably fine', and never guess at treatment. This clinic treats {{species_treated}}; if " +
    "a caller's pet is a different species, say so honestly and offer the emergency referral " +
    "or a message either way.",
  CONSENT_ASK_FRAGMENT,
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
);

const RED_FLAG_LIST =
  "bloat/a distended abdomen, a seizure, difficulty breathing, being hit by a car, eating " +
  "something toxic, a male cat straining to urinate, severe bleeding, or pale/blue gums";

export const VETERINARY_TEMPLATE: AgentTemplate = {
  vertical: "vet",
  compile_target: "conversation_flow",
  system_prompt: SYSTEM_PROMPT,
  states: [
    {
      id: "greeting",
      name: "Greeting",
      prompt_fragment:
        "Greet the caller and ask how you can help today — a new appointment, changing an " +
        "existing one, or something else. If they say anything suggesting the pet is in " +
        "immediate danger, do not continue this flow — go straight to the emergency referral.",
      allowed_tools: [],
    },
    {
      id: "collect_owner_phone",
      name: "Collect owner + phone",
      prompt_fragment: "Ask for the owner's name, then their phone number, confirming each.",
      allowed_tools: [],
    },
    {
      id: "collect_pet_info",
      name: "Collect pet info",
      prompt_fragment:
        "Ask for the pet's name, species, breed, and age, one at a time. Cross-check species " +
        "against {{species_treated}}.",
      allowed_tools: [],
    },
    {
      id: "new_or_existing",
      name: "New vs existing patient",
      prompt_fragment: "Ask whether this pet has been seen at this clinic before.",
      allowed_tools: [],
    },
    {
      id: "triage_redflags",
      name: "Red-flag triage (FIRST, before any routine scheduling)",
      prompt_fragment:
        "Before discussing anything routine, explicitly ask what's going on with the pet and " +
        `listen for these red flags: ${RED_FLAG_LIST}. This triage happens BEFORE routine ` +
        "symptom/scheduling discussion, every time, for every call — never skip it. If ANY " +
        "red flag is present, do not continue this flow; move immediately to the emergency " +
        "referral. Never attempt to diagnose or reassure — your only job here is to detect a " +
        "red flag and route accordingly.",
      allowed_tools: [],
    },
    {
      id: "symptom_or_routine",
      name: "Symptom vs routine",
      prompt_fragment:
        "No red flags were present. Ask whether this is for a specific symptom or a routine " +
        "visit (wellness, vaccines, grooming, etc.) and note it for the appointment.",
      allowed_tools: [],
    },
    {
      id: "check_time",
      name: "Check availability",
      prompt_fragment:
        "Ask what day/time works, then call check_availability. Offer the returned open " +
        "slots; if none_available, follow the waitlist-offer rule.",
      allowed_tools: ["check_availability"],
    },
    {
      id: "confirm_booking",
      name: "Confirm booking",
      prompt_fragment:
        "Read back the pet's name, visit reason, and date/time, ask the consent question, " +
        "state the cancellation policy, then create the booking and send the SMS " +
        "confirmation.",
      allowed_tools: ["create_booking", "send_sms_confirmation"],
      is_terminal: true,
    },
    manageBookingState(),
    {
      id: "emergency_referral",
      name: "Emergency referral",
      prompt_fragment:
        `A red flag is present (${RED_FLAG_LIST}) or the caller otherwise describes an ` +
        "immediate danger to the pet's life. Do not diagnose, do not reassure, and do not " +
        "continue any routine scheduling. Tell the caller clearly to go to emergency care now: " +
        "refer them to {{emergency_referral_name}} at {{emergency_referral_phone}}, or offer a " +
        "warm transfer if this clinic can connect them directly. Take a message with the " +
        "owner's name, phone, and pet's condition so the clinic has a record either way.",
      allowed_tools: ["take_message", "transfer_call"],
      is_terminal: true,
    },
    transferToHumanState(),
    solicitorDeflectState(),
    takeMessageFallbackState(),
  ],
  transitions: [
    { from: "greeting", to: "collect_owner_phone", on: { intent: "wants_to_book_or_ask" } },
    { from: "greeting", to: "manage_booking", on: { intent: "wants_to_reschedule_or_cancel" } },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_general_message" },
    },
    {
      from: "collect_owner_phone",
      to: "collect_pet_info",
      on: { intent: "owner_phone_confirmed" },
    },
    { from: "collect_pet_info", to: "new_or_existing", on: { intent: "pet_info_confirmed" } },
    { from: "new_or_existing", to: "triage_redflags", on: { intent: "status_confirmed" } },
    {
      from: "triage_redflags",
      to: "emergency_referral",
      on: { predicate: "red_flag_detected" },
    },
    {
      from: "triage_redflags",
      to: "symptom_or_routine",
      on: { predicate: "no_red_flag_detected" },
    },
    { from: "symptom_or_routine", to: "check_time", on: { intent: "symptom_confirmed" } },
    { from: "check_time", to: "confirm_booking", on: { predicate: "slot_selected" } },
    {
      from: "check_time",
      to: "take_message_fallback",
      on: { predicate: "none_available_and_caller_declines_waitlist" },
    },
  ],
  global_intents: [
    // SYSTEM_DESIGN §4.1's canonical example: reachable from ANY state, not just triage_redflags —
    // a red flag can surface at any point in the call, not only during the dedicated triage question.
    safetyEmergencyGlobalIntent("emergency_referral"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
  ],
  tools: [
    checkAvailabilityTool(),
    createBookingTool(
      "Create an appointment once pet info, visit reason, and a confirmed open time are " +
        "collected and the consent question has been asked. Never used for a red-flag call — " +
        "those go to emergency referral instead.",
    ),
    updateBookingTool(),
    cancelBookingTool(),
    lookupCustomerTool(),
    takeMessageTool(),
    sendSmsConfirmationTool(),
    transferCallTool(),
  ],
  disclosure_line: DISCLOSURE_LINE,
};
