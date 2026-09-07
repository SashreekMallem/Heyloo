/**
 * Dental — SYSTEM_DESIGN §4.1 (conversation_flow) + §4.3 input-collection
 * spec: "patient name · new vs existing · pain triage (pain/swelling/fever/
 * knocked-out tooth → urgency tiers, same-day check) · time. DOB/insurance
 * deferred to a secure post-call form link — PHI stays out of transcripts
 * where possible."
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
  safetyEmergencyState,
  solicitorDeflectState,
  takeMessageFallbackState,
  transferToHumanState,
} from "../shared/utility-states.js";

const PHI_DEFERRAL_FRAGMENT =
  "Never ask for the patient's date of birth, insurance details, or SSN over the phone — " +
  "those are collected later through a secure post-call form link so they stay out of the " +
  "call transcript. If the caller volunteers them anyway, don't repeat them back or dwell on " +
  "them — just acknowledge and move on.";

const SYSTEM_PROMPT = buildSystemPrompt(
  "You are the front-desk assistant for a dental office. You book appointments, triage pain " +
    "complaints for urgency, and take messages. You are never a substitute for a dentist — " +
    "never diagnose, and never promise a specific treatment or price.",
  PHI_DEFERRAL_FRAGMENT,
  CONSENT_ASK_FRAGMENT,
  CANCELLATION_POLICY_READOUT_FRAGMENT,
  WAITLIST_OFFER_FRAGMENT,
);

export const DENTAL_TEMPLATE: AgentTemplate = {
  vertical: "dental",
  compile_target: "conversation_flow",
  system_prompt: SYSTEM_PROMPT,
  states: [
    {
      id: "greeting",
      name: "Greeting",
      prompt_fragment:
        "Greet the caller and ask how you can help — a new appointment, changing an existing " +
        "one, or something else.",
      allowed_tools: [],
    },
    {
      id: "collect_patient_name",
      name: "Collect patient name",
      prompt_fragment:
        "Ask for the patient's full name (the person being seen, which may differ from the " +
        "caller for a child or dependent) and confirm it.",
      allowed_tools: [],
    },
    {
      id: "new_or_existing",
      name: "New vs existing patient",
      prompt_fragment: "Ask whether this patient has been seen at this office before.",
      allowed_tools: [],
    },
    {
      id: "pain_triage",
      name: "Pain triage",
      prompt_fragment:
        "Ask if this visit is for pain or a routine check-up. If pain: ask about pain level, " +
        "swelling, fever, and specifically whether a tooth was knocked out or badly broken — " +
        "any of those is a same-day urgency tier, so flag it clearly and prioritize the " +
        "earliest possible slot in the next step. If there's severe facial swelling affecting " +
        "breathing or swallowing, treat this as a safety emergency instead of routine triage.",
      allowed_tools: [],
    },
    {
      id: "check_time",
      name: "Check availability",
      prompt_fragment:
        "If same-day urgency was flagged, ask check_availability for the soonest possible " +
        "window today; otherwise ask what day/time works. Offer the returned open slots; if " +
        "none_available, follow the waitlist-offer rule (for a same-day urgent case, also " +
        "offer to take a message so the office can call back immediately if nothing opens).",
      allowed_tools: ["check_availability"],
    },
    {
      id: "confirm_booking",
      name: "Confirm booking",
      prompt_fragment:
        "Read back the patient name, reason for visit, and date/time, ask the consent " +
        "question, state the cancellation policy, then create the booking and send the SMS " +
        "confirmation — including a mention that a secure link for insurance/DOB will follow " +
        "separately.",
      allowed_tools: ["create_booking", "send_sms_confirmation"],
      is_terminal: true,
    },
    manageBookingState(),
    transferToHumanState(),
    solicitorDeflectState(),
    safetyEmergencyState(),
    takeMessageFallbackState(),
  ],
  transitions: [
    { from: "greeting", to: "collect_patient_name", on: { intent: "wants_to_book" } },
    { from: "greeting", to: "manage_booking", on: { intent: "wants_to_reschedule_or_cancel" } },
    {
      from: "greeting",
      to: "take_message_fallback",
      on: { intent: "after_hours_or_general_message" },
    },
    {
      from: "collect_patient_name",
      to: "new_or_existing",
      on: { intent: "patient_name_confirmed" },
    },
    { from: "new_or_existing", to: "pain_triage", on: { intent: "status_confirmed" } },
    { from: "pain_triage", to: "check_time", on: { intent: "triage_complete" } },
    { from: "check_time", to: "confirm_booking", on: { predicate: "slot_selected" } },
    {
      from: "check_time",
      to: "take_message_fallback",
      on: { predicate: "none_available_and_caller_declines_waitlist" },
    },
  ],
  global_intents: [
    safetyEmergencyGlobalIntent("safety_emergency"),
    humanRequestGlobalIntent("transfer_to_human"),
    solicitorGlobalIntent("solicitor_deflect"),
  ],
  tools: [
    checkAvailabilityTool(),
    createBookingTool(
      "Create an appointment once the patient name, triage result, and a confirmed open time " +
        "are collected and the consent question has been asked.",
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
